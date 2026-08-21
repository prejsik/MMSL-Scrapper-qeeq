const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeCsvReport } = require('./report');
const { buildRootPayload, canonicalArtifactRefs } = require('./run');
const { isVerifiedPublicOffer } = require('./utils');

const FORBIDDEN_NORMALIZED_FIELDS = new Set([
  'auth', 'authorization', 'businessbid', 'businessid', 'clid', 'cookie', 'cookies', 'fpt',
  'qeeqfpt', 'rawhtml', 'resultsessionid', 'ticket', 'ts', 'vv'
]);
const SCENARIO_STRING_FIELDS = [
  'requested_city', 'airport_key', 'iata', 'qeeq_city_id', 'qeeq_landmark_id', 'pickup_at',
  'dropoff_at', 'driver_age', 'residence'
];
const OFFER_STRING_FIELDS = [
  'vehicle_name', 'vehicle_category', 'transmission', 'provider_name', 'deposit_currency',
  'conditional_offer_type', 'currency', 'price_label', 'price_tier', 'price_scope',
  'parsing_source', 'source_search_url', 'captured_at'
];
const OFFER_NUMBER_FIELDS = [
  'seats', 'doors', 'luggage', 'provider_rating', 'provider_rating_count', 'deposit_amount',
  'public_discounted_total', 'total_price', 'daily_price', 'conditional_offer_total',
  'conditional_offer_daily', 'conditional_member_total', 'conditional_member_daily', 'reference_price'
];
const OFFER_BOOLEAN_FIELDS = ['price_verified', 'conditional_price_verified'];
const GROUP_FIELDS = ['record_type', 'vehicle_name', 'price_verified', 'rental_days', 'parsing_source'];
const LIMIT_FIELDS = ['max_scenarios', 'max_vehicle_groups_per_scenario', 'max_offers_per_scenario'];

function compareCodePoints(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function pathIdentity(filePath) {
  const absolute = path.resolve(filePath);
  let cursor = absolute;
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonical = path.join(fs.realpathSync.native(cursor), ...suffix);
  return process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
}

function isWithin(parentIdentity, childIdentity) {
  const relative = path.relative(parentIdentity, childIdentity);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative.split(path.sep)[0] !== '..';
}

function assertRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
}

function findJsonFiles(inputDir) {
  const root = path.resolve(inputDir);
  if (!fs.existsSync(root)) throw new Error(`Input directory not found: ${inputDir}`);
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error(`Symbolic links or junctions are not allowed as input root: ${inputDir}`);
  if (!rootStat.isDirectory()) throw new Error(`Input directory not found: ${inputDir}`);
  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareCodePoints(a.name, b.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error(`Symbolic links or junctions are not allowed in input directory: ${target}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') files.push(target);
    }
  }
  visit(root);
  return files.sort((a, b) => compareCodePoints(path.relative(root, a).replace(/\\/g, '/'), path.relative(root, b).replace(/\\/g, '/')));
}

function readJsonPayloads(inputDir) {
  return findJsonFiles(inputDir).map(file => {
    try {
      return { file, payload: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
      throw new Error(`Invalid JSON chunk ${file}: ${error.message}`);
    }
  });
}

function normalizedFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNoForbiddenFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_NORMALIZED_FIELDS.has(normalizedFieldName(key))) throw new Error(`Forbidden field in QEEQ chunk: ${key}`);
    assertNoForbiddenFields(child);
  }
}

function requireArray(value, label, defaultMissing = true) {
  if (value == null && defaultMissing) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function safeCode(value, fallback = 'execution_failed') {
  return typeof value === 'string' && /^[A-Za-z0-9_:-]+$/.test(value) ? value : fallback;
}

function assertAsciiKey(value, label = 'scenario key') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._|:-]+$/.test(value)) throw new Error(`Invalid ASCII canonical ${label}`);
  return value;
}

function nullableString(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  return value;
}

function nullableFinite(value, label, integer = false) {
  if (value == null) return null;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) throw new Error(`${label} must be finite${integer ? ' integer' : ''}`);
  return value;
}

function nullableBoolean(value, label) {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean or null`);
  return value;
}

function normalizeErrors(value, scenarioKey = null) {
  return requireArray(value, 'errors').map(error => {
    if (!error || typeof error !== 'object' || Array.isArray(error)) throw new Error('error must be an object');
    const rawKey = scenarioKey ?? error.scenario_key;
    return {
      code: safeCode(error.code),
      scenario_key: rawKey == null ? null : assertAsciiKey(rawKey)
    };
  });
}

function normalizeQualityErrors(value) {
  return [...new Set(requireArray(value, 'quality_errors').map(code => safeCode(code, 'quality_warning')))].sort(compareCodePoints);
}

function normalizeGroup(group) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('group must be an object');
  if (group.record_type != null && group.record_type !== 'group') throw new Error('group record_type must be group');
  const normalized = {};
  for (const field of GROUP_FIELDS) {
    if (field === 'record_type') normalized[field] = 'group';
    else if (field === 'price_verified') normalized[field] = nullableBoolean(group[field], `group.${field}`);
    else if (field === 'rental_days') normalized[field] = nullableFinite(group[field], `group.${field}`, true);
    else normalized[field] = nullableString(group[field], `group.${field}`);
  }
  if (normalized.price_verified !== false) throw new Error('group.price_verified must be false');
  if (normalized.rental_days != null && normalized.rental_days <= 0) throw new Error('group.rental_days must be positive');
  normalized.quality_errors = normalizeQualityErrors(group.quality_errors);
  return normalized;
}

function normalizeOffer(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new Error('offer must be an object');
  if (offer.record_type != null && offer.record_type !== 'offer') throw new Error('offer record_type must be offer');
  const normalized = {};
  if (offer.record_type != null) normalized.record_type = 'offer';
  for (const field of OFFER_STRING_FIELDS) normalized[field] = nullableString(offer[field], `offer.${field}`);
  for (const field of OFFER_NUMBER_FIELDS) normalized[field] = nullableFinite(offer[field], `offer.${field}`);
  for (const field of OFFER_BOOLEAN_FIELDS) normalized[field] = nullableBoolean(offer[field], `offer.${field}`);
  if (normalized.source_search_url != null && normalized.source_search_url !== 'https://www.qeeq.pl/car/search') {
    throw new Error('Unsafe source_search_url in QEEQ chunk');
  }
  if (typeof normalized.provider_name !== 'string' || normalized.provider_name.trim() === '') throw new Error('offer.provider_name must be a nonblank string');
  if (typeof normalized.price_verified !== 'boolean') throw new Error('offer.price_verified must be boolean');
  if (normalized.price_tier != null && !['public', 'diamond', 'member', 'conditional', 'unknown'].includes(normalized.price_tier)) throw new Error('offer.price_tier is invalid');
  if (normalized.price_verified === true && !isVerifiedPublicOffer(normalized)) {
    throw new Error('offer.price_verified true requires the verified-public contract');
  }
  return normalized;
}

function normalizeScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error('scenario must be an object');
  const key = assertAsciiKey(scenario.key);
  if (scenario.status != null && !['success', 'failure'].includes(scenario.status)) throw new Error(`Invalid scenario status: ${scenario.status}`);
  const normalized = { key, status: scenario.status ?? 'failure' };
  for (const field of SCENARIO_STRING_FIELDS) normalized[field] = nullableString(scenario[field], `scenario.${field}`);
  normalized.rental_days = nullableFinite(scenario.rental_days, 'scenario.rental_days', true);
  normalized.duration_ms = nullableFinite(scenario.duration_ms, 'scenario.duration_ms');
  if (normalized.rental_days != null && normalized.rental_days <= 0) throw new Error('scenario.rental_days must be positive');
  if (normalized.duration_ms != null && normalized.duration_ms < 0) throw new Error('scenario.duration_ms must be non-negative');
  normalized.groups = requireArray(scenario.groups, 'groups').map(normalizeGroup);
  normalized.offers = requireArray(scenario.offers, 'offers').map(normalizeOffer);
  normalized.errors = normalizeErrors(scenario.errors, key).map(error => ({ code: error.code }));
  normalized.quality_errors = normalizeQualityErrors(scenario.quality_errors);
  normalized.artifact_refs = canonicalArtifactRefs(scenario.artifact_refs, null, key);
  return normalized;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort(compareCodePoints).map(key => [key, stableObject(value[key])]));
}

function normalizeUniqueArray(value, label, validate, comparator = compareCodePoints) {
  const items = requireArray(value, label, false).map(validate);
  if (new Set(items.map(item => JSON.stringify(item))).size !== items.length) throw new Error(`Duplicate requested option: ${label}`);
  return items.sort(comparator);
}

function normalizeLimits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid requested option limits');
  return Object.fromEntries(LIMIT_FIELDS.map(field => {
    const item = value[field];
    if (item != null && (!Number.isInteger(item) || item <= 0)) throw new Error(`Invalid requested option limit: ${field}`);
    return [field, item ?? null];
  }));
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid requested options');
  const startDates = normalizeUniqueArray(options.start_dates, 'start_dates', value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid requested start_dates');
    return value;
  });
  const durations = normalizeUniqueArray(options.durations_days, 'durations_days', value => {
    if (!Number.isInteger(value) || value <= 0) throw new Error('Invalid requested durations_days');
    return value;
  }, (a, b) => a - b);
  const airports = normalizeUniqueArray(options.airport_keys, 'airport_keys', value => assertAsciiKey(value, 'airport key'));
  const concurrency = options.concurrency ?? null;
  if (concurrency != null && (!Number.isInteger(concurrency) || concurrency <= 0)) throw new Error('Invalid requested option concurrency');
  return { start_dates: startDates, durations_days: durations, airport_keys: airports, limits: normalizeLimits(options.limits || {}), concurrency };
}

function validateScenarioOptions(scenario, options) {
  if (scenario.pickup_at == null || scenario.rental_days == null || scenario.airport_key == null) {
    throw new Error(`Scenario ${scenario.key} requires pickup_at, rental_days, and airport_key`);
  }
  const date = scenario.pickup_at.slice(0, 10);
  if (!options.start_dates.includes(date)) throw new Error(`Scenario ${scenario.key} is outside requested start_dates`);
  if (!options.durations_days.includes(scenario.rental_days)) throw new Error(`Scenario ${scenario.key} is outside requested durations_days`);
  if (!options.airport_keys.includes(scenario.airport_key)) throw new Error(`Scenario ${scenario.key} is outside requested airport_keys`);
  const expectedKey = `${scenario.airport_key}:${date}:${scenario.rental_days}`;
  if (scenario.key !== expectedKey) throw new Error(`Scenario ${scenario.key} does not match canonical tuple ${expectedKey}`);
}

function normalizeChunk(entry) {
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Invalid QEEQ chunk payload: ${entry?.file || 'unknown'}`);
  if (payload.schema_version !== 1) throw new Error(`Unsupported schema_version ${payload.schema_version}`);
  assertNoForbiddenFields(payload);
  if (payload.provider !== 'qeeq.pl') throw new Error(`Unsupported provider in ${entry.file}`);
  const scenarios = requireArray(payload.scenarios, 'scenarios', false).map(normalizeScenario);
  const errors = normalizeErrors(payload.errors);
  for (const field of ['expected_scenarios', 'expected_checks']) {
    if (payload[field] != null && (!Number.isInteger(payload[field]) || payload[field] < 0)) throw new Error(`Invalid ${field} in ${entry.file}`);
  }
  if (payload.expected_scenarios != null && payload.expected_checks != null && payload.expected_scenarios !== payload.expected_checks) {
    throw new Error(`Incompatible requested scenario counts in ${entry.file}`);
  }
  for (const field of ['completed_scenarios', 'completed_checks', 'failed_checks']) {
    if (payload[field] != null && (!Number.isInteger(payload[field]) || payload[field] < 0)) throw new Error(`${field} must be a non-negative integer`);
  }
  if (payload.run_status != null && !['success', 'partial', 'failure'].includes(payload.run_status)) throw new Error('Invalid run_status');
  if (payload.quality_status != null && !['pass', 'warning', 'fail'].includes(payload.quality_status)) throw new Error('Invalid quality_status');
  const expected = payload.expected_scenarios ?? payload.expected_checks ?? scenarios.length;
  const options = payload.options == null ? null : normalizeOptions(payload.options);
  if (options) {
    const requestedCount = options.start_dates.length * options.durations_days.length * options.airport_keys.length;
    if (requestedCount !== expected) throw new Error(`Incompatible requested option set size in ${entry.file}`);
    scenarios.forEach(scenario => validateScenarioOptions(scenario, options));
  }
  const qualityObject = payload.quality == null ? {} : payload.quality;
  if (!qualityObject || typeof qualityObject !== 'object' || Array.isArray(qualityObject)) throw new Error('quality must be an object');
  for (const field of ['verified_public_offer_count', 'unverified_offer_count']) {
    if (qualityObject[field] != null && (!Number.isInteger(qualityObject[field]) || qualityObject[field] < 0)) throw new Error(`quality.${field} must be a non-negative integer`);
  }
  const qualityErrors = normalizeQualityErrors([
    ...requireArray(qualityObject.quality_errors, 'quality.quality_errors'),
    ...requireArray(payload.quality_errors, 'quality_errors')
  ]);
  return {
    file: String(entry.file), expected, scenarios, errors, options, qualityErrors,
    started_at: nullableString(payload.started_at, 'started_at'),
    completed_at: nullableString(payload.completed_at, 'completed_at')
  };
}

function validateExpectedKeys(value) {
  if (!Array.isArray(value)) throw new Error('expectedScenarioKeys must be an array');
  const keys = value.map(key => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9._|:-]+$/.test(key)) throw new Error('Invalid expected scenario key');
    return key;
  });
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate expected scenario key');
  return keys;
}

function validateCompatibleOptions(chunks) {
  const optionCount = chunks.filter(chunk => chunk.options != null).length;
  if (optionCount !== 0 && optionCount !== chunks.length) throw new Error('Incompatible requested option declarations across chunks');
  if (optionCount === 0) return undefined;
  const first = chunks[0].options;
  const signatures = {
    durations_days: JSON.stringify(first.durations_days),
    airport_keys: JSON.stringify(first.airport_keys),
    limits: JSON.stringify(stableObject(first.limits)),
    concurrency: JSON.stringify(first.concurrency)
  };
  const dates = new Set();
  for (const chunk of chunks) {
    for (const field of ['durations_days', 'airport_keys', 'limits', 'concurrency']) {
      const signature = field === 'limits' ? JSON.stringify(stableObject(chunk.options[field])) : JSON.stringify(chunk.options[field]);
      if (signature !== signatures[field]) {
        const label = ['limits', 'concurrency'].includes(field) ? `option ${field}` : field;
        throw new Error(`Incompatible requested ${label}`);
      }
    }
    for (const date of chunk.options.start_dates) {
      if (dates.has(date)) throw new Error(`Overlapping requested start_dates: ${date}`);
      dates.add(date);
    }
  }
  return { ...first, start_dates: [...dates].sort(compareCodePoints) };
}

function dedupeAndSortErrors(errors) {
  const unique = new Map();
  for (const error of errors) unique.set(`${error.scenario_key ?? ''}\0${error.code}`, error);
  return [...unique.values()].sort((a, b) => compareCodePoints(a.scenario_key ?? '', b.scenario_key ?? '') || compareCodePoints(a.code, b.code));
}

function mergePayloads(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error('Merge entries must be an array');
  const chunks = [...entries].sort((a, b) => compareCodePoints(a?.file, b?.file)).map(normalizeChunk);
  const mergedOptions = validateCompatibleOptions(chunks);
  const scenarios = [];
  const scenarioKeys = new Set();
  for (const chunk of chunks) {
    for (const scenario of chunk.scenarios) {
      if (scenarioKeys.has(scenario.key)) throw new Error(`Duplicate scenario key: ${scenario.key}`);
      scenarioKeys.add(scenario.key);
      scenarios.push(scenario);
    }
  }

  const expectedKeys = options.expectedScenarioKeys == null ? null : validateExpectedKeys(options.expectedScenarioKeys);
  const expectedSet = expectedKeys ? new Set(expectedKeys) : null;
  if (expectedSet) for (const key of scenarioKeys) if (!expectedSet.has(key)) throw new Error(`Unexpected scenario key: ${key}`);
  const chunkExpected = chunks.reduce((total, chunk) => total + chunk.expected, 0);
  if (expectedSet && chunkExpected > expectedSet.size) throw new Error('Chunk declared workload exceeds authoritative expected keys');
  const expectedCount = expectedSet ? expectedSet.size : chunkExpected;
  if (expectedCount < scenarios.length) throw new Error('Chunk scenarios exceed the requested workload');

  const rootErrors = chunks.flatMap(chunk => chunk.errors);
  const matchingErrors = new Map();
  for (const error of rootErrors) {
    if (error.scenario_key != null && scenarioKeys.has(error.scenario_key)) {
      const current = matchingErrors.get(error.scenario_key) || [];
      current.push(error);
      matchingErrors.set(error.scenario_key, current);
    }
  }
  const normalizedScenarios = scenarios.map(scenario => {
    const rootMatches = matchingErrors.get(scenario.key) || [];
    const localErrors = dedupeAndSortErrors([
      ...scenario.errors.map(error => ({ code: error.code, scenario_key: scenario.key })),
      ...rootMatches
    ]);
    return {
      ...scenario,
      status: scenario.status === 'failure' || localErrors.length > 0 ? 'failure' : 'success',
      errors: localErrors.map(error => ({ code: error.code }))
    };
  }).sort((a, b) => compareCodePoints(a.key, b.key));

  const missingKeys = expectedSet ? expectedKeys.filter(key => !scenarioKeys.has(key)).sort(compareCodePoints) : [];
  const missingCount = Math.max(0, expectedCount - normalizedScenarios.length);
  const missingErrors = expectedSet
    ? missingKeys.map(key => ({ code: 'missing_chunk_scenario', scenario_key: key }))
    : missingCount > 0 ? [{ code: 'missing_chunk_scenario', scenario_key: null }] : [];
  const orphanErrors = rootErrors.filter(error => error.scenario_key == null || !scenarioKeys.has(error.scenario_key));
  const allErrors = dedupeAndSortErrors([
    ...normalizedScenarios.flatMap(scenario => scenario.errors.map(error => ({ code: error.code, scenario_key: scenario.key }))),
    ...orphanErrors,
    ...missingErrors
  ]);
  const startedValues = chunks.map(chunk => chunk.started_at).filter(Boolean).sort(compareCodePoints);
  const completedValues = chunks.map(chunk => chunk.completed_at).filter(Boolean).sort(compareCodePoints);
  const merged = buildRootPayload({
    started_at: startedValues[0],
    completed_at: completedValues.at(-1) || null,
    expected_scenarios: expectedCount,
    expected_checks: expectedCount,
    scenarios: normalizedScenarios,
    options: mergedOptions
  });
  const qualityErrors = [...new Set([
    ...chunks.flatMap(chunk => chunk.qualityErrors),
    ...merged.quality.quality_errors
  ])].sort(compareCodePoints);
  const successfulChecks = normalizedScenarios.filter(scenario => scenario.status === 'success').length;
  const failedChecks = normalizedScenarios.length - successfulChecks + missingCount;
  const hasOrphanError = orphanErrors.length > 0;
  merged.started_at = startedValues[0] || null;
  merged.completed_scenarios = normalizedScenarios.length;
  merged.completed_checks = successfulChecks;
  merged.failed_checks = failedChecks;
  merged.errors = allErrors;
  merged.quality.quality_errors = qualityErrors;
  merged.run_status = expectedCount === 0 || successfulChecks === 0
    ? 'failure'
    : failedChecks === 0 && !hasOrphanError ? 'success' : 'partial';
  merged.quality_status = merged.quality.verified_public_offer_count === 0
    ? 'fail'
    : qualityErrors.length > 0 || failedChecks > 0 || hasOrphanError ? 'warning' : 'pass';
  return merged;
}

function parseMergeArgs(argv) {
  const values = {};
  for (const argument of argv) {
    if (argument === '--help') {
      values.help = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) throw new Error(`Unknown option: ${argument}`);
    if (!['input-dir', 'expected-keys-file', 'output-json', 'output-csv'].includes(match[1])) throw new Error(`Unknown option: --${match[1]}`);
    if (values[match[1]] != null) throw new Error(`Duplicate option: --${match[1]}`);
    values[match[1]] = match[2];
  }
  if (values.help) {
    if (Object.keys(values).length !== 1) throw new Error('--help cannot be combined with other options');
    return { help: true };
  }
  for (const key of ['input-dir', 'output-json', 'output-csv']) if (!values[key]) throw new Error(`Missing required option: --${key}`);
  return {
    inputDir: values['input-dir'],
    ...(values['expected-keys-file'] ? { expectedKeysFile: values['expected-keys-file'] } : {}),
    outputJson: values['output-json'],
    outputCsv: values['output-csv']
  };
}

function printHelp() {
  console.log('Usage: node src/qeeq/mergeResults.js --input-dir=downloaded-parts [--expected-keys-file=expected-keys.json] --output-json=output/qeeq-results-latest.json --output-csv=output/qeeq-results.csv');
}

function removeBestEffort(filePath) {
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

function writeOutputTransaction(outputJson, outputCsv, payload) {
  const outputs = [path.resolve(outputJson), path.resolve(outputCsv)];
  for (const output of outputs) fs.mkdirSync(path.dirname(output), { recursive: true });
  const token = crypto.randomUUID();
  const temps = outputs.map(output => path.join(path.dirname(output), `.${path.basename(output)}.${token}.tmp`));
  const backups = outputs.map(output => path.join(path.dirname(output), `.${path.basename(output)}.${token}.bak`));
  const existed = outputs.map(output => fs.existsSync(output));
  try {
    fs.writeFileSync(temps[0], `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    writeCsvReport(temps[1], payload);
    outputs.forEach((output, index) => { if (existed[index]) fs.renameSync(output, backups[index]); });
    temps.forEach((temp, index) => fs.renameSync(temp, outputs[index]));
  } catch (error) {
    outputs.forEach((output, index) => {
      if (fs.existsSync(backups[index])) {
        removeBestEffort(output);
        try { fs.renameSync(backups[index], output); } catch {}
      } else if (!existed[index]) removeBestEffort(output);
      removeBestEffort(temps[index]);
    });
    throw error;
  }
  backups.forEach(removeBestEffort);
}

function readExpectedKeys(filePath) {
  assertRegularFile(filePath, 'expected-keys-file');
  try {
    return validateExpectedKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new Error(`Invalid expected-keys-file: ${error.message}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseMergeArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const entries = readJsonPayloads(args.inputDir);
  const inputRootIdentity = pathIdentity(args.inputDir);
  const protectedIdentities = new Set(entries.map(entry => pathIdentity(entry.file)));
  let expectedScenarioKeys;
  if (args.expectedKeysFile) {
    const expectedIdentity = pathIdentity(args.expectedKeysFile);
    if (isWithin(inputRootIdentity, expectedIdentity)) throw new Error('expected-keys-file must be outside the chunk input tree');
    expectedScenarioKeys = readExpectedKeys(args.expectedKeysFile);
    protectedIdentities.add(expectedIdentity);
  }
  const outputs = [path.resolve(args.outputJson), path.resolve(args.outputCsv)];
  for (const output of outputs) if (fs.existsSync(output)) assertRegularFile(output, 'Merge output');
  const identities = outputs.map(pathIdentity);
  if (identities[0] === identities[1]) throw new Error('Merge outputs cannot collide');
  if (identities.some(identity => protectedIdentities.has(identity))) throw new Error('Merge output cannot overwrite a protected input');
  const payload = mergePayloads(entries, { expectedScenarioKeys });
  writeOutputTransaction(outputs[0], outputs[1], payload);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ merge failed.');
    process.exitCode = 1;
  }
}

module.exports = { findJsonFiles, mergePayloads, parseMergeArgs, readJsonPayloads };
