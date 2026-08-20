const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HARD_MAX_SCENARIOS } = require('./config');
const { catalogEntryForLocation } = require('./locations');

const TIME_ZONE = 'Europe/Warsaw';
const MAX_MATRIX_ENTRIES = 256;
const SAFE_MANUAL_TIMEOUT_MINUTES = 30;
const SETUP_ALLOWANCE_MINUTES = 10;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive finite`);
  return value;
}

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function partitionDates(dates, datesPerChunk) {
  positiveInteger(datesPerChunk, 'datesPerChunk');
  const validDate = date => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  if (!Array.isArray(dates) || dates.some((date, index) => !validDate(date) || (index > 0 && addDays(dates[index - 1], 1) !== date))) {
    throw new Error('dates must be valid consecutive YYYY-MM-DD values');
  }
  const chunks = [];
  for (let index = 0; index < dates.length; index += datesPerChunk) chunks.push(dates.slice(index, index + datesPerChunk));
  return chunks;
}

function validateRunGates(input, scenarioCount) {
  const eventName = input.eventName;
  const planOnly = input.planOnly === true;
  const expanded = eventName === 'workflow_dispatch' && scenarioCount > 9;
  const fullRun = scenarioCount === HARD_MAX_SCENARIOS;

  if (expanded && input.acknowledgeExpandedRun !== true) {
    throw new Error('Expanded manual runs require acknowledge_expanded_run=true');
  }
  if (eventName === 'schedule' && input.fullEnabled !== true) {
    return { expanded, fullRun, planOnly, shouldRun: false, requiresMeasurements: false, disabledSchedule: true };
  }
  if (eventName === 'schedule' && input.benchmarkStage !== 4) {
    throw new Error('Scheduled runs require QEEQ_BENCHMARK_STAGE=4');
  }
  if (fullRun && !planOnly && input.fullEnabled !== true) {
    throw new Error('A 7020-scenario run requires QEEQ_FULL_SCHEDULE_ENABLED=true');
  }
  if (fullRun && !planOnly && input.benchmarkStage !== 4) {
    throw new Error('A 7020-scenario run requires QEEQ_BENCHMARK_STAGE=4');
  }
  if (fullRun && planOnly && ![3, 4].includes(input.benchmarkStage)) {
    throw new Error('A full plan-only estimate requires QEEQ_BENCHMARK_STAGE=3 or 4');
  }
  return {
    expanded,
    fullRun,
    planOnly,
    shouldRun: !planOnly,
    requiresMeasurements: eventName === 'schedule' || expanded || fullRun,
    disabledSchedule: false
  };
}

function normalizedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Workflow plan input must be an object');
  const eventName = input.eventName ?? 'workflow_dispatch';
  if (!['schedule', 'workflow_dispatch'].includes(eventName)) throw new Error('eventName must be schedule or workflow_dispatch');
  const timeZone = input.timeZone ?? TIME_ZONE;
  if (timeZone !== TIME_ZONE) throw new Error('timeZone must be Europe/Warsaw');
  const locations = input.locations ?? ['Katowice'];
  if (!Array.isArray(locations) || locations.length === 0 || locations.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('locations must be a nonempty string array');
  }
  if (new Set(locations).size !== locations.length) throw new Error('locations must not contain duplicates');
  const catalogEntries = locations.map(location => {
    const entry = catalogEntryForLocation(location);
    if (!entry) throw new Error('Unknown QEEQ location');
    return entry;
  });
  if (new Set(catalogEntries.map(entry => entry.city)).size !== catalogEntries.length) {
    throw new Error('locations must not contain duplicates');
  }
  const rollingDays = positiveInteger(input.rollingDays ?? 1, 'rollingDays');
  const durationsDays = input.durationsDays ?? [2];
  if (!Array.isArray(durationsDays) || durationsDays.length === 0) throw new Error('durationsDays must be a nonempty array');
  durationsDays.forEach(value => positiveInteger(value, 'durationsDays value'));
  if (new Set(durationsDays).size !== durationsDays.length) throw new Error('durationsDays must not contain duplicates');
  const now = input.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('now must be a valid Date');
  return { ...input, eventName, timeZone, locations, catalogEntries, rollingDays, durationsDays, now };
}

function validateMeasurements(input) {
  const p50 = positiveFinite(input.p50ScenarioSeconds, 'p50ScenarioSeconds');
  const p95 = positiveFinite(input.p95ScenarioSeconds, 'p95ScenarioSeconds');
  if (p95 < p50) throw new Error('p95ScenarioSeconds must be at least p50ScenarioSeconds');
  return {
    p50,
    p95,
    maxParallel: positiveInteger(input.maxParallel, 'maxParallel'),
    targetChunkMinutes: positiveFinite(input.targetChunkMinutes, 'targetChunkMinutes'),
    maxBrowserMinutes: positiveFinite(input.maxBrowserMinutes, 'maxBrowserMinutes')
  };
}

function scenarioKeys(catalogEntries, dates, durationsDays) {
  return catalogEntries.flatMap(entry => entry.airports.flatMap(airport => dates.flatMap(date =>
    durationsDays.map(duration => `${airport.key}:${date}:${duration}`)
  )));
}

function buildWorkflowPlan(rawInput = {}) {
  const input = normalizedInput(rawInput);
  const airports = input.catalogEntries.flatMap(entry => entry.airports);
  const scenarioCount = airports.length * input.rollingDays * input.durationsDays.length;
  if (scenarioCount > HARD_MAX_SCENARIOS) throw new Error(`Scenario count ${scenarioCount} exceeds hard cap ${HARD_MAX_SCENARIOS}`);
  const gates = validateRunGates(input, scenarioCount);
  const firstDate = addDays(dateInTimeZone(input.now, input.timeZone), 1);
  const dates = Array.from({ length: input.rollingDays }, (_, index) => addDays(firstDate, index));
  const expectedScenarioKeys = scenarioKeys(input.catalogEntries, dates, input.durationsDays);

  if (gates.disabledSchedule) {
    return {
      schema_version: 1,
      event_name: input.eventName,
      time_zone: input.timeZone,
      plan_only: false,
      should_run: false,
      summary: 'Scheduled QEEQ run is disabled by QEEQ_FULL_SCHEDULE_ENABLED.',
      scenario_count: scenarioCount,
      matrix: { include: [] },
      max_parallel: 1,
      chunk_timeout_minutes: SAFE_MANUAL_TIMEOUT_MINUTES,
      dates_per_chunk: 0,
      p50_scenario_seconds: null,
      p95_scenario_seconds: null,
      estimated_browser_minutes: null,
      budget_ok: null,
      expected_scenario_keys: expectedScenarioKeys
    };
  }

  const measurements = gates.requiresMeasurements ? validateMeasurements(input) : null;
  const estimatedBrowserMinutes = measurements ? scenarioCount * measurements.p95 / 60 : null;
  const budgetOk = measurements ? estimatedBrowserMinutes <= measurements.maxBrowserMinutes : true;
  if (!gates.planOnly && !budgetOk) throw new Error('Estimated run exceeds the configured browser-minute budget');

  const scenariosPerDate = airports.length * input.durationsDays.length;
  const datesPerChunk = measurements
    ? Math.max(1, Math.min(dates.length, Math.floor(measurements.targetChunkMinutes * 60 / (scenariosPerDate * measurements.p95))))
    : dates.length;
  const dateChunks = partitionDates(dates, datesPerChunk);
  if (dateChunks.length > MAX_MATRIX_ENTRIES) throw new Error(`Workflow matrix exceeds ${MAX_MATRIX_ENTRIES} entries`);
  const chunkTimeoutMinutes = measurements
    ? Math.ceil((datesPerChunk * scenariosPerDate * measurements.p95 / 60) * 1.5 + SETUP_ALLOWANCE_MINUTES)
    : SAFE_MANUAL_TIMEOUT_MINUTES;
  const matrix = {
    include: dateChunks.map((chunk, index) => ({
      chunk_id: `chunk-${String(index + 1).padStart(3, '0')}`,
      start_dates: chunk.join(','),
      locations: input.locations.join(','),
      durations_days: input.durationsDays.join(',')
    }))
  };
  const maxParallel = gates.requiresMeasurements ? measurements.maxParallel : 1;
  const summary = gates.planOnly
    ? `Plan-only estimate: ${scenarioCount} scenarios; browser-minute budget ${budgetOk ? 'sufficient' : 'insufficient'}.`
    : `Ready to run ${scenarioCount} scenarios in ${matrix.include.length} date chunks.`;
  return {
    schema_version: 1,
    event_name: input.eventName,
    time_zone: input.timeZone,
    plan_only: gates.planOnly,
    should_run: gates.shouldRun,
    summary,
    scenario_count: scenarioCount,
    matrix,
    max_parallel: maxParallel,
    chunk_timeout_minutes: chunkTimeoutMinutes,
    dates_per_chunk: datesPerChunk,
    p50_scenario_seconds: measurements?.p50 ?? null,
    p95_scenario_seconds: measurements?.p95 ?? null,
    estimated_browser_minutes: estimatedBrowserMinutes,
    budget_ok: budgetOk,
    expected_scenario_keys: expectedScenarioKeys
  };
}

function parseBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function parseNumber(value, name) {
  if (value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function parseArgs(argv) {
  const allowed = new Set([
    'event-name', 'time-zone', 'locations', 'rolling-days', 'durations-days', 'full-enabled',
    'benchmark-stage', 'p50-scenario-seconds', 'p95-scenario-seconds', 'max-parallel',
    'manual-max-parallel', 'target-chunk-minutes', 'max-browser-minutes',
    'acknowledge-expanded-run', 'plan-only', 'output', 'expected-keys-output', 'github-output'
  ]);
  if (argv.includes('--help')) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other options');
    return { help: true };
  }
  const values = {};
  for (const argument of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1])) throw new Error('Invalid workflow plan option');
    values[match[1]] = match[2];
  }
  const list = name => values[name] === undefined ? undefined : values[name].split(',').map(value => value.trim()).filter(Boolean);
  const number = name => values[name] === undefined ? undefined : parseNumber(values[name], name);
  const bool = (name, fallback) => values[name] === undefined ? fallback : parseBoolean(values[name], name);
  return {
    input: {
      eventName: values['event-name'] || 'workflow_dispatch',
      timeZone: values['time-zone'] || TIME_ZONE,
      locations: list('locations') || ['Katowice'],
      rollingDays: number('rolling-days') ?? 1,
      durationsDays: (list('durations-days') || ['2']).map(value => parseNumber(value, 'durations-days')),
      fullEnabled: bool('full-enabled', false),
      benchmarkStage: number('benchmark-stage'),
      p50ScenarioSeconds: number('p50-scenario-seconds'),
      p95ScenarioSeconds: number('p95-scenario-seconds'),
      maxParallel: number('max-parallel'),
      manualMaxParallel: number('manual-max-parallel') ?? 1,
      targetChunkMinutes: number('target-chunk-minutes'),
      maxBrowserMinutes: number('max-browser-minutes'),
      acknowledgeExpandedRun: bool('acknowledge-expanded-run', false),
      planOnly: bool('plan-only', false)
    },
    output: values.output,
    expectedKeysOutput: values['expected-keys-output'],
    githubOutput: values['github-output']
  };
}

function writeAtomicJson(filePath, value) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function writeGithubOutputs(filePath, plan) {
  const values = {
    should_run: String(plan.should_run),
    matrix: JSON.stringify(plan.matrix),
    max_parallel: String(plan.max_parallel),
    chunk_timeout_minutes: String(plan.chunk_timeout_minutes),
    plan_only: String(plan.plan_only),
    scenario_count: String(plan.scenario_count),
    budget_ok: JSON.stringify(plan.budget_ok),
    estimated_browser_minutes: JSON.stringify(plan.estimated_browser_minutes)
  };
  if (Object.values(values).some(value => /[\r\n]/.test(value))) throw new Error('Unsafe GitHub output value');
  fs.appendFileSync(path.resolve(filePath), `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, 'utf8');
}

function printHelp() {
  console.log('Usage: node src/qeeq/workflowPlan.js --event-name=<schedule|workflow_dispatch> --locations=Katowice --rolling-days=1 --durations-days=2 [--output=plan.json] [--expected-keys-output=expected.json] [--github-output=<path>]');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const outputPaths = [args.output, args.expectedKeysOutput, args.githubOutput].filter(Boolean).map(value => path.resolve(value));
  const identities = outputPaths.map(value => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value);
  if (new Set(identities).size !== identities.length) throw new Error('Workflow plan output files must differ');
  const plan = buildWorkflowPlan(args.input);
  if (args.output) writeAtomicJson(args.output, plan);
  if (args.expectedKeysOutput) writeAtomicJson(args.expectedKeysOutput, plan.expected_scenario_keys);
  if (args.githubOutput) writeGithubOutputs(args.githubOutput, plan);
  console.log(JSON.stringify({
    scenario_count: plan.scenario_count,
    matrix_entries: plan.matrix.include.length,
    p50_scenario_seconds: plan.p50_scenario_seconds,
    p95_scenario_seconds: plan.p95_scenario_seconds,
    estimated_browser_minutes: plan.estimated_browser_minutes,
    max_parallel: plan.max_parallel,
    chunk_timeout_minutes: plan.chunk_timeout_minutes,
    plan_only: plan.plan_only,
    should_run: plan.should_run,
    budget_ok: plan.budget_ok,
    summary: plan.summary
  }));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ workflow plan failed.');
    process.exitCode = 1;
  }
}

module.exports = { buildWorkflowPlan, partitionDates, validateRunGates };
