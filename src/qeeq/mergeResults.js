const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeCsvReport } = require('./report');
const { buildRootPayload } = require('./run');

const FORBIDDEN_FIELDS = new Set([
  '_vv_', 'auth', 'authorization', 'businessbid', 'businessid', 'business_bid', 'business_id',
  'clid', 'cookie', 'cookies', 'fpt', 'qeeq_fpt', 'raw_html', 'result_session_id', 'ticket', 'ts'
]);

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

function findJsonFiles(inputDir) {
  const root = path.resolve(inputDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Input directory not found: ${inputDir}`);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in input directory: ${target}`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') files.push(target);
    }
  }
  visit(root);
  return files.sort((a, b) => path.relative(root, a).replace(/\\/g, '/').localeCompare(path.relative(root, b).replace(/\\/g, '/')));
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

function safeCode(value, fallback = 'execution_failed') {
  return typeof value === 'string' && /^[a-z0-9_:-]+$/i.test(value) ? value : fallback;
}

function assertNoForbiddenFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) throw new Error(`Forbidden field in QEEQ chunk: ${key}`);
    if (key === 'source_search_url' && child != null && child !== 'https://www.qeeq.pl/car/search') {
      throw new Error('Unsafe source_search_url in QEEQ chunk');
    }
    assertNoForbiddenFields(child);
  }
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
}

function validateOptionArray(options, key, scenario, scenarioField, transform = value => value) {
  const requested = options[key];
  if (!Array.isArray(requested)) throw new Error(`Invalid requested option set: ${key}`);
  if (new Set(requested.map(value => JSON.stringify(value))).size !== requested.length) throw new Error(`Duplicate requested option: ${key}`);
  const actual = transform(scenario[scenarioField]);
  if (actual != null && !requested.includes(actual)) throw new Error(`Scenario ${scenario.key} is outside requested ${key}`);
}

function validateChunk(entry, optionSignatures) {
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Invalid QEEQ chunk payload: ${entry?.file || 'unknown'}`);
  if (payload.schema_version !== 1) throw new Error(`Unsupported schema_version ${payload.schema_version}`);
  if (!Array.isArray(payload.scenarios)) throw new Error(`Invalid scenarios array in ${entry.file}`);
  assertNoForbiddenFields(payload);
  if (payload.provider != null && payload.provider !== 'qeeq.pl') throw new Error(`Unsupported provider in ${entry.file}`);
  for (const field of ['expected_scenarios', 'expected_checks']) {
    if (payload[field] != null && (!Number.isInteger(payload[field]) || payload[field] < 0)) throw new Error(`Invalid ${field} in ${entry.file}`);
  }
  if (payload.expected_scenarios != null && payload.expected_checks != null && payload.expected_scenarios !== payload.expected_checks) {
    throw new Error(`Incompatible requested scenario counts in ${entry.file}`);
  }
  if (payload.options != null) {
    if (!payload.options || typeof payload.options !== 'object' || Array.isArray(payload.options)) throw new Error(`Invalid requested options in ${entry.file}`);
    for (const scenario of payload.scenarios) {
      validateOptionArray(payload.options, 'start_dates', scenario, 'pickup_at', value => typeof value === 'string' ? value.slice(0, 10) : null);
      validateOptionArray(payload.options, 'durations_days', scenario, 'rental_days');
      validateOptionArray(payload.options, 'airport_keys', scenario, 'airport_key');
    }
    const signature = JSON.stringify(stableObject(payload.options.limits || {}));
    if (optionSignatures.limits == null) optionSignatures.limits = signature;
    else if (optionSignatures.limits !== signature) throw new Error(`Incompatible requested option limits in ${entry.file}`);
    const concurrency = payload.options.concurrency ?? null;
    if (optionSignatures.concurrency === undefined) optionSignatures.concurrency = concurrency;
    else if (optionSignatures.concurrency !== concurrency) throw new Error(`Incompatible requested option concurrency in ${entry.file}`);
    const requestedCount = payload.options.start_dates.length * payload.options.durations_days.length * payload.options.airport_keys.length;
    const expectedCount = payload.expected_scenarios ?? payload.expected_checks ?? payload.scenarios.length;
    if (requestedCount !== expectedCount) throw new Error(`Incompatible requested option set size in ${entry.file}`);
  }
}

function sanitizedErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map(error => ({
    code: safeCode(error?.code),
    scenario_key: typeof error?.scenario_key === 'string' && /^[a-z0-9:_|.-]{1,256}$/i.test(error.scenario_key)
      ? error.scenario_key
      : null
  }));
}

function mergeOptions(entries) {
  const payloadOptions = entries.map(entry => entry.payload.options).filter(Boolean);
  if (payloadOptions.length === 0) return undefined;
  const union = key => [...new Set(payloadOptions.flatMap(options => options[key] || []))].sort((a, b) => String(a).localeCompare(String(b)));
  const concurrencyValues = [...new Set(payloadOptions.map(options => options.concurrency).filter(value => value != null))];
  return {
    start_dates: union('start_dates'),
    durations_days: union('durations_days'),
    airport_keys: union('airport_keys'),
    limits: stableObject(payloadOptions[0].limits || {}),
    concurrency: concurrencyValues.length === 1 ? concurrencyValues[0] : null
  };
}

function mergePayloads(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error('Merge entries must be an array');
  const sortedEntries = [...entries].sort((a, b) => String(a?.file).localeCompare(String(b?.file)));
  const optionDeclarationCount = sortedEntries.filter(entry => entry?.payload?.options != null).length;
  if (optionDeclarationCount !== 0 && optionDeclarationCount !== sortedEntries.length) {
    throw new Error('Incompatible requested option declarations across chunks');
  }
  const optionSignatures = { limits: null, concurrency: undefined };
  for (const entry of sortedEntries) validateChunk(entry, optionSignatures);

  const scenarios = [];
  const scenarioKeys = new Set();
  for (const entry of sortedEntries) {
    for (const scenario of entry.payload.scenarios) {
      if (!scenario || typeof scenario.key !== 'string' || scenario.key.length === 0) throw new Error(`Invalid scenario key in ${entry.file}`);
      if (scenarioKeys.has(scenario.key)) throw new Error(`Duplicate scenario key: ${scenario.key}`);
      scenarioKeys.add(scenario.key);
      scenarios.push({ ...scenario });
    }
  }

  if (options.expectedScenarioKeys != null && !Array.isArray(options.expectedScenarioKeys)) {
    throw new Error('expectedScenarioKeys must be an array');
  }
  const expectedKeys = options.expectedScenarioKeys == null ? null : [...options.expectedScenarioKeys];
  if (expectedKeys?.some(key => typeof key !== 'string' || key.length === 0)) throw new Error('Invalid expected scenario key');
  if (expectedKeys && new Set(expectedKeys).size !== expectedKeys.length) throw new Error('Duplicate expected scenario key');
  const explicitExpected = expectedKeys ? new Set(expectedKeys) : null;
  if (explicitExpected) {
    for (const key of scenarioKeys) if (!explicitExpected.has(key)) throw new Error(`Unexpected scenario key: ${key}`);
  }
  const chunkExpected = sortedEntries.reduce((total, entry) => total + (entry.payload.expected_scenarios ?? entry.payload.expected_checks ?? entry.payload.scenarios.length), 0);
  if (explicitExpected && sortedEntries.length > 0 && chunkExpected !== explicitExpected.size) {
    throw new Error('Expected scenario keys do not match chunk requested workload');
  }
  const expectedCount = explicitExpected ? explicitExpected.size : chunkExpected;
  if (expectedCount < scenarios.length) throw new Error('Chunk scenarios exceed the requested workload');

  const rootErrors = sortedEntries.flatMap(entry => sanitizedErrors(entry.payload.errors));
  const failedKeys = new Set(rootErrors.map(error => error.scenario_key).filter(Boolean));
  const normalizedScenarios = scenarios.map(scenario => ({
    ...scenario,
    status: failedKeys.has(scenario.key) || scenario.status !== 'success' ? 'failure' : 'success',
    errors: [
      ...(Array.isArray(scenario.errors) ? scenario.errors.map(error => ({ code: safeCode(error?.code) })) : []),
      ...rootErrors.filter(error => error.scenario_key === scenario.key).map(error => ({ code: error.code }))
    ],
    quality_errors: [...new Set((Array.isArray(scenario.quality_errors) ? scenario.quality_errors : []).map(value => safeCode(value, 'quality_warning')))]
  })).sort((a, b) => a.key.localeCompare(b.key));

  const missingKeys = explicitExpected ? [...explicitExpected].filter(key => !scenarioKeys.has(key)).sort() : [];
  const missingCount = Math.max(0, expectedCount - normalizedScenarios.length);
  const missingErrors = missingKeys.map(key => ({ code: 'missing_chunk_scenario', scenario_key: key }));
  if (!explicitExpected && missingCount > 0) missingErrors.push({ code: 'missing_chunk_scenario', scenario_key: null });
  const preservedRootErrors = rootErrors.filter(error => !error.scenario_key || !scenarioKeys.has(error.scenario_key));
  const allErrors = [...normalizedScenarios.flatMap(scenario => scenario.errors.map(error => ({ code: error.code, scenario_key: scenario.key }))), ...preservedRootErrors, ...missingErrors]
    .sort((a, b) => String(a.scenario_key).localeCompare(String(b.scenario_key)) || a.code.localeCompare(b.code));
  const chunkQuality = sortedEntries.flatMap(entry => [
    ...(Array.isArray(entry.payload.quality?.quality_errors) ? entry.payload.quality.quality_errors : []),
    ...(Array.isArray(entry.payload.quality_errors) ? entry.payload.quality_errors : [])
  ])
    .map(value => safeCode(value, 'quality_warning'));
  const started = sortedEntries.map(entry => entry.payload.started_at).filter(value => typeof value === 'string').sort()[0];
  const completedValues = sortedEntries.map(entry => entry.payload.completed_at).filter(value => typeof value === 'string').sort();
  const merged = buildRootPayload({
    started_at: started,
    completed_at: completedValues.at(-1) || null,
    expected_scenarios: expectedCount,
    expected_checks: expectedCount,
    scenarios: normalizedScenarios,
    options: mergeOptions(sortedEntries)
  });
  const qualityErrors = [...new Set([...chunkQuality, ...merged.quality.quality_errors])].sort();
  const failedChecks = normalizedScenarios.filter(scenario => scenario.status !== 'success').length + missingCount;
  const successfulChecks = normalizedScenarios.filter(scenario => scenario.status === 'success').length;
  merged.completed_scenarios = normalizedScenarios.length;
  merged.started_at = started || null;
  merged.completed_checks = successfulChecks;
  merged.failed_checks = failedChecks;
  merged.errors = allErrors;
  merged.quality.quality_errors = qualityErrors;
  merged.run_status = expectedCount === 0 || normalizedScenarios.length === 0
    ? 'failure'
    : normalizedScenarios.length === expectedCount && failedChecks === 0 ? 'success' : 'partial';
  merged.quality_status = merged.quality.verified_public_offer_count === 0
    ? 'fail'
    : qualityErrors.length > 0 || failedChecks > 0 ? 'warning' : 'pass';
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
    if (!['input-dir', 'output-json', 'output-csv'].includes(match[1])) throw new Error(`Unknown option: --${match[1]}`);
    if (values[match[1]] != null) throw new Error(`Duplicate option: --${match[1]}`);
    values[match[1]] = match[2];
  }
  if (values.help) {
    if (Object.keys(values).length !== 1) throw new Error('--help cannot be combined with other options');
    return { help: true };
  }
  for (const key of ['input-dir', 'output-json', 'output-csv']) if (!values[key]) throw new Error(`Missing required option: --${key}`);
  return { inputDir: values['input-dir'], outputJson: values['output-json'], outputCsv: values['output-csv'] };
}

function printHelp() {
  console.log('Usage: node src/qeeq/mergeResults.js --input-dir=downloaded-parts --output-json=output/qeeq-results-latest.json --output-csv=output/qeeq-results.csv');
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
    backups.forEach(backup => fs.rmSync(backup, { force: true }));
  } catch (error) {
    outputs.forEach((output, index) => {
      if (fs.existsSync(backups[index])) {
        fs.rmSync(output, { force: true });
        fs.renameSync(backups[index], output);
      } else if (!existed[index]) fs.rmSync(output, { force: true });
      fs.rmSync(temps[index], { force: true });
    });
    throw error;
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseMergeArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const entries = readJsonPayloads(args.inputDir);
  const inputIdentities = new Set(entries.map(entry => pathIdentity(entry.file)));
  const jsonIdentity = pathIdentity(args.outputJson);
  const csvIdentity = pathIdentity(args.outputCsv);
  if (jsonIdentity === csvIdentity) throw new Error('Merge outputs cannot collide');
  if (inputIdentities.has(jsonIdentity) || inputIdentities.has(csvIdentity)) throw new Error('Merge output cannot overwrite an input chunk');
  const payload = mergePayloads(entries);
  writeOutputTransaction(args.outputJson, args.outputCsv, payload);
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
