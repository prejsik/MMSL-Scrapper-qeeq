const fs = require('node:fs');
const path = require('node:path');

const HARD_MAX_SCENARIOS = 7020;
const OVERRIDES = {
  'base-url': 'baseUrl',
  locations: 'locations',
  'rolling-days': 'rollingDays',
  'start-dates': 'startDates',
  'durations-days': 'durationsDays',
  'pickup-time': 'pickupTime',
  'dropoff-time': 'dropoffTime',
  'driver-age': 'driverAge',
  'residence-country-code': 'residenceCountryCode',
  headless: 'headless',
  'navigation-timeout-ms': 'navigationTimeoutMs',
  'results-timeout-ms': 'resultsTimeoutMs',
  'api-observation-timeout-ms': 'apiObservationTimeoutMs',
  'location-concurrency': 'locationConcurrency',
  'max-load-more-iterations': 'maxLoadMoreIterations',
  'max-vehicle-groups': 'maxVehicleGroupsPerScenario',
  'max-offers': 'maxOffersPerScenario',
  'max-scenarios': 'maxScenarios',
  'full-schedule-enabled': 'fullScheduleEnabled',
  'browser-executable-path': 'browserExecutablePath',
  'output-csv': 'outputCsv',
  'artifacts-dir': 'artifactsDir'
};

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const equalsAt = value.indexOf('=');
    if (equalsAt >= 0) {
      args[value.slice(2, equalsAt)] = value.slice(equalsAt + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[value.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      args[value.slice(2)] = true;
    }
  }
  return args;
}

function list(value) {
  return Array.isArray(value) ? value : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function integer(value, fieldName) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${fieldName} must be a positive integer`);
  return Number(value);
}

function integers(value, fieldName) {
  return list(value).map(item => integer(item, fieldName));
}

function boolean(value, fieldName) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${fieldName} must be true or false`);
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

function loadConfig(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  for (const name of Object.keys(args)) {
    if (!['config', 'help', 'save'].includes(name) && !(name in OVERRIDES)) throw new Error(`Unknown option: --${name}`);
  }
  const configPath = path.resolve(args.config || 'qeeq.config.example.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if ('save' in args && !safeRelativePath(args.save)) throw new Error('save must be a safe relative path');
  for (const [argName, fieldName] of Object.entries(OVERRIDES)) {
    if (!(argName in args)) continue;
    config[fieldName] = ['locations', 'startDates'].includes(fieldName)
      ? list(args[argName])
      : fieldName === 'durationsDays'
        ? integers(args[argName], 'durationsDays')
        : ['rollingDays', 'navigationTimeoutMs', 'resultsTimeoutMs', 'apiObservationTimeoutMs', 'locationConcurrency', 'maxLoadMoreIterations', 'maxVehicleGroupsPerScenario', 'maxOffersPerScenario', 'maxScenarios'].includes(fieldName)
          ? integer(args[argName], fieldName)
          : ['headless', 'fullScheduleEnabled'].includes(fieldName)
            ? boolean(args[argName], fieldName)
            : args[argName];
  }
  config.locations = list(config.locations);
  config.startDates = list(config.startDates);
  config.durationsDays = integers(config.durationsDays, 'durationsDays');
  config.headless = boolean(config.headless, 'headless');
  config.fullScheduleEnabled = boolean(config.fullScheduleEnabled, 'fullScheduleEnabled');
  if (!Number.isInteger(config.maxScenarios) || config.maxScenarios < 1 || config.maxScenarios > HARD_MAX_SCENARIOS) {
    throw new Error(`maxScenarios must be between 1 and ${HARD_MAX_SCENARIOS}`);
  }
  if (!config.durationsDays.length || config.durationsDays.some(value => !Number.isInteger(value) || value < 1)) {
    throw new Error('durationsDays must contain positive integers');
  }
  for (const field of ['pickupTime', 'dropoffTime']) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config[field])) throw new Error(`${field} must use HH:MM`);
  }
  if (!config.locations.length) throw new Error('locations must not be empty');
  for (const field of ['rollingDays', 'navigationTimeoutMs', 'resultsTimeoutMs', 'apiObservationTimeoutMs', 'locationConcurrency', 'maxLoadMoreIterations', 'maxVehicleGroupsPerScenario', 'maxOffersPerScenario']) {
    if (!Number.isInteger(config[field]) || config[field] < 1) throw new Error(`${field} must be a positive integer`);
  }
  if (!/^[A-Z]{2}$/.test(config.residenceCountryCode)) throw new Error('residenceCountryCode must be a two-letter uppercase code');
  if (!/^\d{2}-\d{2}$/.test(config.driverAge)) throw new Error('driverAge must use MIN-MAX');
  const [minimumAge, maximumAge] = config.driverAge.split('-').map(Number);
  if (minimumAge < 18 || maximumAge > 99 || minimumAge > maximumAge) throw new Error('driverAge must use MIN-MAX within 18-99');
  if (config.startDates.some(value => !validDateOnly(value))) throw new Error('startDates must contain valid YYYY-MM-DD dates');
  for (const field of ['outputCsv', 'artifactsDir']) {
    if (!safeRelativePath(config[field])) throw new Error(`${field} must be a safe relative path`);
  }
  if (config.browserExecutablePath && !path.isAbsolute(config.browserExecutablePath)) throw new Error('browserExecutablePath must be empty or absolute');
  if (config.timeZone !== 'Europe/Warsaw') throw new Error('timeZone must be Europe/Warsaw');
  if (config.baseUrl !== 'https://www.qeeq.pl') throw new Error('baseUrl must be https://www.qeeq.pl');
  return Object.freeze(config);
}

function printHelp() {
  console.log('Usage: node src/qeeq/run.js --config=qeeq.config.example.json [--locations=Katowice] [--rolling-days=1] [--start-dates=YYYY-MM-DD] [--durations-days=2]');
}

module.exports = { HARD_MAX_SCENARIOS, loadConfig, parseCliArgs, printHelp };
