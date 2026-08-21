const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { locationCatalog } = require('./locations');
const { buildScenarioMarketView } = require('./marketView');
const { classifyMmAvailability } = require('./mmAvailability');

const DEFAULT_PRICING_RULES = Object.freeze({
  top1GapThresholdPlnDay: 10,
  top1RaiseBufferPlnDay: 1,
  top1UndercutThresholdPlnDay: 10,
  undercutBufferPlnDay: 1,
  top3SmallDecreaseThresholdPlnDay: 10,
  minChangePlnDay: 0.5,
  roundingIncrementPlnDay: 0.01,
  maxRecommendationRentalDays: 7
});

const AIRPORTS = locationCatalog.flatMap(entry => entry.airports);

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveApprovedMultiplier(calibration, airportKey, rentalDays) {
  if (!calibration || calibration.approved !== true) return { status: 'unapproved', multiplier: null, source: null };
  const candidates = [
    ['airport_duration', calibration.airportDurationMultipliers?.[`${airportKey}|${rentalDays}`]],
    ['airport', calibration.airportMultipliers?.[airportKey]],
    ['duration', calibration.durationMultipliers?.[String(rentalDays)]],
    ['default', calibration.defaultMultiplier]
  ];
  const selected = candidates.find(([, value]) => value !== null && value !== undefined);
  if (!selected) return { status: 'uncovered', multiplier: null, source: null };
  const multiplier = Number(selected[1]);
  const min = Number(calibration.minMultiplier);
  const max = Number(calibration.maxMultiplier);
  if (!Number.isFinite(multiplier) || !Number.isFinite(min) || !Number.isFinite(max)
      || multiplier <= 0 || min <= 0 || max < min || multiplier < min || multiplier > max) {
    return {
      status: 'invalid', multiplier: null, source: selected[0],
      reason: 'invalid_or_outside_approved_range'
    };
  }
  return { status: 'approved', multiplier, source: selected[0] };
}

function pricingRules(options = {}) {
  const supplied = options.rules || options.pricing || {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new Error('QEEQ pricing rules must be an object');
  const rules = { ...DEFAULT_PRICING_RULES, ...supplied };
  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isFinite(value)) throw new Error(`QEEQ pricing rule ${key} must be finite`);
  }
  if (rules.top1GapThresholdPlnDay < 0 || rules.top1RaiseBufferPlnDay < 0
      || rules.top1UndercutThresholdPlnDay < 0 || rules.undercutBufferPlnDay < 0
      || rules.top3SmallDecreaseThresholdPlnDay < 0 || rules.minChangePlnDay < 0
      || rules.roundingIncrementPlnDay <= 0
      || !Number.isInteger(rules.maxRecommendationRentalDays) || rules.maxRecommendationRentalDays <= 0) {
    throw new Error('QEEQ pricing rules contain an invalid value');
  }
  return rules;
}

function roundToIncrement(value, increment) {
  return Number((Math.round((value + Number.EPSILON) / increment) * increment).toFixed(10));
}

function scenarioIdentity(scenario) {
  const pickupDate = typeof scenario?.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : '';
  if (typeof scenario?.key !== 'string' || !scenario.key
      || typeof scenario?.airport_key !== 'string' || !scenario.airport_key
      || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)
      || !Number.isInteger(scenario?.rental_days) || scenario.rental_days <= 0
      || !Array.isArray(scenario?.offers)) {
    throw new Error('Malformed canonical QEEQ scenario');
  }
  return { pickupDate, airportKey: scenario.airport_key, rentalDays: scenario.rental_days };
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function canonicalList(value, label, validate) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => !validate(item))
      || new Set(value).size !== value.length) {
    throw new Error(`Malformed canonical QEEQ options: ${label}`);
  }
  return new Set(value);
}

function validateCanonicalPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.schema_version !== 1 || payload.provider !== 'qeeq.pl'
      || !Array.isArray(payload.scenarios)
      || !payload.options || typeof payload.options !== 'object' || Array.isArray(payload.options)) {
    throw new Error('Malformed canonical QEEQ input');
  }
  const dates = canonicalList(payload.options.start_dates, 'start_dates', validDateOnly);
  const airports = canonicalList(payload.options.airport_keys, 'airport_keys',
    value => typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value));
  const durations = canonicalList(payload.options.durations_days, 'durations_days',
    value => Number.isInteger(value) && value > 0);
  const requestedCount = dates.size * airports.size * durations.size;
  for (const field of ['expected_scenarios', 'expected_checks']) {
    if (payload[field] != null
        && (!Number.isInteger(payload[field]) || payload[field] !== requestedCount)) {
      throw new Error(`Malformed canonical QEEQ input: ${field}`);
    }
  }
  if (payload.expected_scenarios != null && payload.expected_checks != null
      && payload.expected_scenarios !== payload.expected_checks) {
    throw new Error('Malformed canonical QEEQ input: incompatible expected counts');
  }

  const keys = new Set();
  for (const scenario of payload.scenarios) {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)
        || !['success', 'failure'].includes(scenario.status)
        || !Array.isArray(scenario.offers)
        || typeof scenario.airport_key !== 'string' || !/^[A-Za-z0-9._-]+$/.test(scenario.airport_key)
        || !Number.isInteger(scenario.rental_days) || scenario.rental_days <= 0
        || typeof scenario.pickup_at !== 'string') {
      throw new Error('Malformed canonical QEEQ scenario');
    }
    const pickupDate = scenario.pickup_at.slice(0, 10);
    if (!validDateOnly(pickupDate)
        || !dates.has(pickupDate)
        || !airports.has(scenario.airport_key)
        || !durations.has(scenario.rental_days)) {
      throw new Error(`Malformed canonical QEEQ scenario matrix: ${scenario.key ?? 'unknown'}`);
    }
    const expectedKey = `${scenario.airport_key}:${pickupDate}:${scenario.rental_days}`;
    if (scenario.key !== expectedKey || keys.has(scenario.key)) {
      throw new Error(`Malformed canonical QEEQ scenario key: ${scenario.key ?? 'unknown'}`);
    }
    keys.add(scenario.key);
  }
}

function providerSummary(offer, rentalDays, increment) {
  return {
    provider_name: offer.provider_name,
    vehicle_name: offer.vehicle_name ?? null,
    total_price_pln: offer.total_price,
    rate_pln_day: roundToIncrement(offer.total_price / rentalDays, increment)
  };
}

function siteDecision(view, mmRate, rules, rentalDays) {
  if (rentalDays > rules.maxRecommendationRentalDays) {
    return { action: 'hold', target: null, benchmark: null, reason: 'duration_above_recommendation_limit' };
  }
  if (view.mm_provider_rank === 1) {
    const benchmark = view.ranked_providers[1] || null;
    if (!benchmark) return { action: 'hold', target: null, benchmark: null, reason: 'second_provider_unavailable' };
    const benchmarkRate = benchmark.total_price / rentalDays;
    if (benchmarkRate - mmRate < rules.top1GapThresholdPlnDay) {
      return { action: 'hold', target: null, benchmark, reason: 'top1_gap_below_threshold' };
    }
    return { action: 'increase', target: benchmarkRate - rules.top1RaiseBufferPlnDay, benchmark, reason: 'increase_to_second_provider' };
  }
  const benchmark = view.ranked_providers[view.mm_provider_rank - 2] || null;
  if (!benchmark) return { action: 'hold', target: null, benchmark: null, reason: 'benchmark_unavailable' };
  const benchmarkRate = benchmark.total_price / rentalDays;
  const threshold = view.mm_provider_rank === 2
    ? rules.top1UndercutThresholdPlnDay
    : rules.top3SmallDecreaseThresholdPlnDay;
  const target = benchmarkRate - rules.undercutBufferPlnDay;
  if (mmRate - target >= threshold) {
    return {
      action: 'hold', target: null, benchmark,
      reason: view.mm_provider_rank === 2 ? 'top1_decrease_above_threshold' : 'rank_improvement_decrease_above_threshold'
    };
  }
  return {
    action: 'decrease', target, benchmark,
    reason: view.mm_provider_rank === 2 ? 'decrease_below_top_provider' : 'decrease_below_next_provider'
  };
}

function buildDecision(scenario, dateAvailability, options, rules) {
  const { pickupDate, airportKey, rentalDays } = scenarioIdentity(scenario);
  const airport = AIRPORTS.find(item => item.key === airportKey) || null;
  const tariffZones = airport ? [...airport.tariffZones] : [];
  const view = buildScenarioMarketView(scenario);
  const calibration = resolveApprovedMultiplier(options.calibration, airportKey, rentalDays);
  const complete = Boolean(dateAvailability && dateAvailability.expected_checks > 0 && dateAvailability.failed_checks === 0);
  let dataQualityStatus = complete ? 'complete' : 'incomplete';
  if (complete && tariffZones.length === 0) dataQualityStatus = 'unmapped_tariff_zone';

  const mm = view.mm_cars_rental;
  const mmRate = mm ? roundToIncrement(mm.total_price / rentalDays, rules.roundingIncrementPlnDay) : null;
  let site = { action: 'review', target: null, benchmark: null, reason: 'public_data_incomplete' };
  if (complete && scenario.status === 'success') {
    site = mm
      ? siteDecision(view, mmRate, rules, rentalDays)
      : { action: 'review', target: null, benchmark: null, reason: 'mm_not_visible' };
  }
  if (site.target !== null) {
    site.target = roundToIncrement(site.target, rules.roundingIncrementPlnDay);
    const change = site.target - mmRate;
    if ((site.action === 'increase' && change < rules.minChangePlnDay)
        || (site.action === 'decrease' && -change < rules.minChangePlnDay)) {
      site = { ...site, action: 'hold', target: null, reason: 'change_below_minimum' };
    }
  }

  let importAction = site.action;
  let suggestedRate = null;
  if (site.action === 'increase' || site.action === 'decrease') {
    if (calibration.status === 'approved' && dataQualityStatus === 'complete') {
      importAction = site.action;
      suggestedRate = roundToIncrement(site.target / calibration.multiplier, rules.roundingIncrementPlnDay);
    } else {
      importAction = 'review';
    }
  }
  const benchmark = site.benchmark
    ? providerSummary(site.benchmark, rentalDays, rules.roundingIncrementPlnDay)
    : null;
  return {
    scenario_key: scenario.key,
    airport_key: airportKey,
    iata: scenario.iata || airport?.iata || null,
    tariff_zones: tariffZones,
    pickup_date: pickupDate,
    rental_days: rentalDays,
    mm_provider_rank: view.mm_provider_rank,
    cheaper_provider_count: view.cheaper_provider_count,
    mm_provider_name: mm?.provider_name ?? null,
    mm_vehicle_name: mm?.vehicle_name ?? null,
    mm_total_price_pln: mm?.total_price ?? null,
    mm_rate_pln_day: mmRate,
    top_3_providers: view.top_3_providers.map(offer => providerSummary(offer, rentalDays, rules.roundingIncrementPlnDay)),
    benchmark_provider_name: benchmark?.provider_name ?? null,
    benchmark_rate_pln_day: benchmark?.rate_pln_day ?? null,
    site_action: site.action,
    site_target_rate_pln_day: site.target,
    calibration_status: calibration.status,
    calibration_source: calibration.source,
    calibration_multiplier: calibration.multiplier,
    calibration_reason: calibration.reason ?? null,
    import_action: importAction,
    suggested_rate_pln_day: suggestedRate,
    data_quality_status: dataQualityStatus,
    reason: site.reason
  };
}

function buildPricingRecommendations(payload, options = {}) {
  validateCanonicalPayload(payload);
  const rules = pricingRules(options);
  const availability = classifyMmAvailability(payload);
  const byDate = new Map(availability.dates.map(item => [item.pickup_date, item]));
  const decisions = payload.scenarios
    .map(scenario => buildDecision(scenario, byDate.get(String(scenario?.pickup_at || '').slice(0, 10)), options, rules))
    .sort((left, right) => compareText(left.pickup_date, right.pickup_date)
      || compareText(left.airport_key, right.airport_key)
      || left.rental_days - right.rental_days
      || compareText(left.scenario_key, right.scenario_key));
  const siteRecommendations = decisions.filter(item => ['increase', 'decrease'].includes(item.site_action));
  const importRecommendations = decisions.filter(item => ['increase', 'decrease'].includes(item.import_action));
  const count = action => decisions.filter(item => item.site_action === action).length;
  return {
    schema_version: 1,
    provider: 'qeeq.pl',
    source_completed_at: payload.completed_at ?? null,
    decisions,
    site_recommendations: siteRecommendations,
    import_recommendations: importRecommendations,
    counts: {
      decision_count: decisions.length,
      site_recommendation_count: siteRecommendations.length,
      import_recommendation_count: importRecommendations.length,
      increase_count: count('increase'),
      decrease_count: count('decrease'),
      hold_count: count('hold'),
      review_count: count('review')
    }
  };
}

function pathIdentity(filePath) {
  let cursor = path.resolve(filePath);
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

function readRegularJson(filePath, label) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function writeAtomicJson(outputPath, value) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const positional = [];
  const options = {};
  for (const argument of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) positional.push(argument);
    else {
      if (!['config', 'calibration'].includes(match[1]) || !match[2]) throw new Error(`Unknown option: --${match[1]}`);
      if (Object.hasOwn(options, match[1])) throw new Error(`Duplicate option: --${match[1]}`);
      options[match[1]] = match[2];
    }
  }
  if (positional.length !== 2 || !options.config || !options.calibration) {
    throw new Error('Expected input, output, --config, and --calibration');
  }
  return { input: positional[0], output: positional[1], ...options };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node src/qeeq/pricingRecommendations.js <input.json> <output.json> --config=<rules.json> --calibration=<calibration.json>');
    return 0;
  }
  const inputPaths = [args.input, args.config, args.calibration].map(item => path.resolve(item));
  const outputPath = path.resolve(args.output);
  if (inputPaths.some(input => pathIdentity(input) === pathIdentity(outputPath))) {
    throw new Error('Pricing output cannot overwrite an input file');
  }
  const payload = readRegularJson(inputPaths[0], 'Pricing input');
  const config = readRegularJson(inputPaths[1], 'Pricing config');
  const calibration = readRegularJson(inputPaths[2], 'Calibration config');
  const result = buildPricingRecommendations(payload, { rules: config.pricing, calibration });
  writeAtomicJson(outputPath, result);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ pricing recommendations failed.');
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_PRICING_RULES, buildPricingRecommendations, main, resolveApprovedMultiplier };
