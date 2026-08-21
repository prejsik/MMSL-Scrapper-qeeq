const fs = require('node:fs');
const path = require('node:path');
const { catalogEntryForLocation } = require('./locations');
const { loadConfig, parseCliArgs, printHelp } = require('./config');
const { isVerifiedConditionalOffer, isVerifiedPublicOffer, scenarioArtifactRef } = require('./utils');

const OFFER_FIELDS = [
  'vehicle_name', 'vehicle_category', 'transmission', 'seats', 'doors', 'luggage',
  'provider_name', 'provider_rating', 'provider_rating_count', 'deposit_amount', 'deposit_currency',
  'public_discounted_total', 'total_price', 'daily_price', 'conditional_offer_total',
  'conditional_offer_daily', 'conditional_offer_type', 'conditional_member_total',
  'conditional_member_daily', 'reference_price', 'reference_currency', 'currency', 'price_label', 'price_tier',
  'price_scope', 'price_verified', 'conditional_price_verified', 'parsing_source',
  'source_search_url', 'captured_at'
];
const FAILURE_ARTIFACT_REF = /^failure\/([a-f0-9]{16})\/attempt-\d+\/\d{8}T\d{9}Z\/(?:browser\.log|screenshot\.png|sanitized-dom\.html|error\.json)$/;

function cleanCode(value) {
  return typeof value === 'string' && /^[a-z0-9_:-]+$/i.test(value) ? value : 'execution_failed';
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function qualityErrorsForOffer(offer) {
  if (typeof offer?.provider_name !== 'string' || !offer.provider_name.trim()) return ['provider_unresolved'];
  if ([offer.currency, offer.deposit_currency, offer.reference_currency].some(currency => currency && currency !== 'PLN')) {
    return ['unexpected_currency'];
  }
  if (offer.conditional_price_verified === true && !isVerifiedConditionalOffer(offer)) return ['price_unverified'];
  if (isVerifiedPublicOffer(offer)) return [];
  const verifiedConditional = offer.price_verified !== true
    && ['conditional', 'diamond', 'member'].includes(offer.price_tier)
    && isVerifiedConditionalOffer(offer);
  return verifiedConditional ? [] : ['price_unverified'];
}

function canonicalArtifactRefs(value, artifactsDir = null, scenarioKey = null) {
  const root = typeof artifactsDir === 'string' ? artifactsDir.replace(/\\/g, '/').replace(/\/+$/, '') : null;
  if (root && (/^(?:[A-Za-z]:|\/)/.test(root) || root.split('/').includes('..'))) return [];
  const expectedScenarioRef = scenarioArtifactRef(scenarioKey);
  const refs = arrayOf(value).flatMap(reference => {
    if (typeof reference !== 'string' || /[\u0000-\u001f\u007f?#]/.test(reference)) return [];
    const normalized = reference.replace(/\\/g, '/');
    if (/^(?:[A-Za-z]:|\/)/.test(normalized) || normalized.split('/').includes('..')) return [];
    const relative = root ? (normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : null) : normalized;
    const match = relative && FAILURE_ARTIFACT_REF.exec(relative);
    return match && match[1] === expectedScenarioRef ? [relative] : [];
  });
  return [...new Set(refs)].sort();
}

function canonicalSourceSearchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.qeeq.pl' && url.pathname === '/car/search'
      ? 'https://www.qeeq.pl/car/search'
      : null;
  } catch {
    return null;
  }
}

function dateTime(date, time) {
  return typeof date === 'string' && typeof time === 'string' ? `${date}T${time}:00` : null;
}

function buildScenarioPayload(input = {}) {
  const scenario = input.scenario || {};
  const outcome = input.outcome || {};
  const airport = scenario.airport || {};
  const key = scenario.key || outcome.key || null;
  const offers = arrayOf(outcome.offers)
    .filter(offer => offer?.record_type === 'offer')
    .map(offer => ({
      ...Object.fromEntries(OFFER_FIELDS.map(field => [field, offer[field] ?? null])),
      source_search_url: canonicalSourceSearchUrl(offer.source_search_url)
    }));
  const offerQualityErrors = arrayOf(outcome.offers).flatMap(offer => arrayOf(offer?.quality_errors));
  const qualityErrors = [...new Set([...arrayOf(outcome.quality_errors), ...offerQualityErrors].map(cleanCode))];
  const errors = arrayOf(outcome.errors).map(error => ({ code: cleanCode(error?.code || outcome.error_code) }));
  const failed = outcome.status === 'failure' || Boolean(outcome.error_code) || errors.length > 0;
  if (failed && errors.length === 0) errors.push({ code: cleanCode(outcome.error_code) });
  return {
    key,
    status: failed ? 'failure' : 'success',
    requested_city: airport.city ?? null,
    airport_key: airport.key ?? null,
    iata: airport.iata ?? null,
    qeeq_city_id: outcome.qeeq_city_id ?? airport.cityId ?? null,
    qeeq_landmark_id: outcome.qeeq_landmark_id ?? airport.landmarkId ?? null,
    pickup_at: dateTime(scenario.pickupDate, scenario.pickupTime),
    dropoff_at: dateTime(scenario.dropoffDate, scenario.dropoffTime),
    rental_days: scenario.rentalDays ?? null,
    driver_age: input.config?.driverAge ?? null,
    residence: input.config?.residenceCountryCode ?? null,
    duration_ms: Number.isFinite(outcome.duration_ms) ? outcome.duration_ms : null,
    groups: arrayOf(outcome.groups).map(group => ({
      record_type: 'group', vehicle_name: group?.vehicle_name ?? null,
      price_verified: false, rental_days: group?.rental_days ?? scenario.rentalDays ?? null,
      parsing_source: group?.parsing_source ?? null,
      quality_errors: [...new Set(arrayOf(group?.quality_errors).map(cleanCode))].sort()
    })),
    offers,
    errors,
    quality_errors: qualityErrors,
    artifact_refs: canonicalArtifactRefs(outcome.artifacts, input.config?.artifactsDir, key)
  };
}

function runOptions(config, scenarios) {
  return {
    start_dates: [...new Set(scenarios.map(scenario => scenario.pickupDate).filter(Boolean))],
    durations_days: [...new Set(scenarios.map(scenario => scenario.rentalDays).filter(Number.isInteger))],
    airport_keys: [...new Set(scenarios.map(scenario => scenario.airport?.key).filter(Boolean))],
    limits: {
      max_scenarios: config.maxScenarios ?? null,
      max_vehicle_groups_per_scenario: config.maxVehicleGroupsPerScenario ?? null,
      max_offers_per_scenario: config.maxOffersPerScenario ?? null
    },
    concurrency: config.locationConcurrency ?? null
  };
}

function deriveStatuses(payload = {}) {
  const expected = Number(payload.expected_checks) || 0;
  const completed = Number(payload.completed_checks) || 0;
  const failed = Number(payload.failed_checks) || 0;
  const verified = Number(payload.verified_public_offer_count ?? payload.quality?.verified_public_offer_count) || 0;
  const qualityErrors = payload.quality_errors || payload.quality?.quality_errors || [];
  const run_status = expected === 0 || completed === 0
    ? 'failure'
    : completed === expected && failed === 0 ? 'success' : 'partial';
  const quality_status = verified === 0
    ? 'fail'
    : qualityErrors.length > 0 ? 'warning' : 'pass';
  return { run_status, quality_status };
}

function exitCodeForPayload(payload = {}) {
  if (payload.run_status === 'success' && payload.quality_status === 'pass') return 0;
  if (['success', 'partial'].includes(payload.run_status) && ['pass', 'warning'].includes(payload.quality_status)) return 2;
  return 1;
}

function buildRootPayload(input = {}) {
  const scenarios = arrayOf(input.scenarios);
  const completedChecks = scenarios.filter(scenario => scenario.status === 'success').length;
  const failedChecks = scenarios.filter(scenario => scenario.status !== 'success').length;
  const verified = scenarios.flatMap(scenario => arrayOf(scenario.offers))
    .filter(isVerifiedPublicOffer).length;
  const unverified = scenarios.flatMap(scenario => arrayOf(scenario.offers)).length - verified;
  const qualityErrors = [...new Set([
    ...scenarios.flatMap(scenario => arrayOf(scenario.quality_errors)),
    ...scenarios.flatMap(scenario => arrayOf(scenario.groups).flatMap(group => arrayOf(group?.quality_errors))),
    ...scenarios.flatMap(scenario => arrayOf(scenario.offers).flatMap(qualityErrorsForOffer)),
    ...scenarios.filter(scenario => scenario.status === 'success' && arrayOf(scenario.offers).length === 0).map(() => 'empty_result')
  ].map(cleanCode))].sort();
  const errors = scenarios.flatMap(scenario => arrayOf(scenario.errors).map(error => ({
    code: cleanCode(error.code), scenario_key: scenario.key
  })));
  const counts = {
    expected_checks: input.expected_checks ?? input.expected_scenarios ?? scenarios.length,
    completed_checks: completedChecks,
    failed_checks: failedChecks,
    verified_public_offer_count: verified,
    quality_errors: qualityErrors
  };
  return {
    schema_version: 1,
    provider: 'qeeq.pl',
    started_at: input.started_at || new Date().toISOString(),
    completed_at: input.completed_at || null,
    expected_scenarios: input.expected_scenarios ?? scenarios.length,
    completed_scenarios: scenarios.length,
    expected_checks: counts.expected_checks,
    completed_checks: counts.completed_checks,
    failed_checks: counts.failed_checks,
    ...deriveStatuses(counts),
    scenarios,
    errors,
    quality: {
      verified_public_offer_count: verified,
      unverified_offer_count: unverified,
      quality_errors: qualityErrors
    },
    options: input.options || { start_dates: [], durations_days: [], airport_keys: [], limits: {}, concurrency: null }
  };
}

function writeAtomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function progressLine(completed, total, elapsedMs) {
  return `${completed}/${total} scenarios completed in ${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`;
}

async function executeRun(config = {}, deps = {}) {
  const unknown = Object.keys(deps).filter(key => !['scenarioPlanner', 'runScenario'].includes(key));
  if (unknown.length) throw new Error(`Unsupported executeRun dependency override: ${unknown[0]}`);
  const scenarioPlanner = deps.scenarioPlanner || expandScenarios;
  const scenarios = scenarioPlanner(config, new Date());
  let runScenario = deps.runScenario;
  if (!runScenario) {
    const { QeeqScraper } = require('./scraper');
    const scraper = new QeeqScraper(config);
    runScenario = scenario => scraper.runScenario(scenario);
  }
  const startedAt = new Date().toISOString();
  const results = new Array(scenarios.length);
  const writeSnapshot = () => {
    const snapshot = buildRootPayload({
      started_at: startedAt,
      expected_scenarios: scenarios.length,
      expected_checks: scenarios.length,
      scenarios: results.filter(Boolean),
      options: runOptions(config, scenarios)
    });
    if (config.savePath) writeAtomicJson(config.savePath, snapshot);
  };
  let nextIndex = 0;
  const concurrency = Number.isInteger(config.locationConcurrency) && config.locationConcurrency > 0
    ? Math.min(config.locationConcurrency, Math.max(scenarios.length, 1))
    : 1;
  const worker = async () => {
    while (nextIndex < scenarios.length) {
      const index = nextIndex;
      nextIndex += 1;
      const scenario = scenarios[index];
      let outcome;
      try {
        outcome = await runScenario(scenario);
      } catch {
        outcome = { key: scenario.key, status: 'failure', errors: [{ code: 'execution_failed' }], groups: [], offers: [], quality_errors: [] };
      }
      results[index] = buildScenarioPayload({ scenario, outcome, config });
      writeSnapshot();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const payload = buildRootPayload({
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    expected_scenarios: scenarios.length,
    expected_checks: scenarios.length,
    scenarios: results,
    options: runOptions(config, scenarios)
  });
  if (config.savePath) writeAtomicJson(config.savePath, payload);
  return payload;
}

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function scenarioKey(scenario) {
  return `${scenario.airport.key}:${scenario.pickupDate}:${scenario.rentalDays}`;
}

function assertScenarioLimit(count, maxScenarios) {
  if (count > maxScenarios) throw new Error(`Scenario count ${count} exceeds maxScenarios ${maxScenarios}`);
}

function pickupDates(config, now) {
  if (config.startDates.length) return config.startDates;
  const tomorrow = addDays(dateInTimeZone(now, config.timeZone), 1);
  return Array.from({ length: config.rollingDays }, (_, index) => addDays(tomorrow, index));
}

function expandScenarios(config, now = new Date()) {
  const dates = pickupDates(config, now);
  const airports = config.locations.flatMap(location => {
    const entry = catalogEntryForLocation(location);
    if (!entry) throw new Error(`Unknown QEEQ location: ${location}`);
    return entry.airports.map(airport => ({ ...airport, city: entry.city }));
  });
  const count = airports.length * dates.length * config.durationsDays.length;
  assertScenarioLimit(count, config.maxScenarios);
  if (count > 9 && config.fullScheduleEnabled !== true) {
    throw new Error(`Expanded scenario count ${count} requires fullScheduleEnabled=true`);
  }

  return airports.flatMap(airport => dates.flatMap(pickupDate => config.durationsDays.map(rentalDays => {
    const scenario = {
      airport,
      pickupDate,
      dropoffDate: addDays(pickupDate, rentalDays),
      pickupTime: config.pickupTime,
      dropoffTime: config.dropoffTime,
      rentalDays
    };
    return { ...scenario, key: scenarioKey(scenario) };
  })));
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    printHelp();
    return 0;
  }
  const config = loadConfig(argv);
  const args = parseCliArgs(argv);
  const payload = await executeRun({ ...config, savePath: args.save });
  process.exitCode = exitCodeForPayload(payload);
  return process.exitCode;
}

if (require.main === module) {
  main().catch(() => {
    console.error('QEEQ run failed.');
    process.exitCode = 1;
  });
}

module.exports = {
  assertScenarioLimit,
  canonicalArtifactRefs,
  buildRootPayload,
  buildScenarioPayload,
  deriveStatuses,
  executeRun,
  exitCodeForPayload,
  expandScenarios,
  main,
  progressLine,
  scenarioKey,
  writeAtomicJson
};
