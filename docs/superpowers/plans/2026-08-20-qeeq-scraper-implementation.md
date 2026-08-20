# QEEQ Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, tested Node.js/Playwright QEEQ scraper that collects verified public provider offers and produces JSON, CSV, HTML, XLSX, GitHub Actions artifacts/Pages, and Telegram summaries.

**Architecture:** Playwright creates and owns every QEEQ search session. The scraper observes offer-list responses inside that session for provider metadata, parses price/deposit/rating fields from a strictly scoped expanded-offer DOM subtree, and falls back to DOM when a supported network payload is absent. Canonical JSON is the only upstream data contract; CSV, HTML, XLSX, Pages, and Telegram are derived from it.

**Tech Stack:** Node.js 20+, CommonJS, Playwright `^1.52.0`, ExcelJS `^4.4.0`, Node built-in assertions, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-20-qeeq-scraper-design.md`

## Global Constraints

- Work only inside `C:\Users\barte\OneDrive\Codex\qeeq-tool`.
- Do not modify the parent DiscoverCars repository or its existing Excel/report changes.
- Use `npm.cmd`, not `npm`, in PowerShell commands.
- Keep QEEQ code, outputs, workflows, and artifacts provider-specific and separate.
- The canonical unit is one provider-package offer; group-only observations never enter Top 3.
- Rank Top 3 only by verified public total price. Diamond/member/conditional prices are informational.
- Persist no QEEQ result-session `id`/`clid`, `_vv_`, `fpt`, `ticket`, `ts`, cookies, authorization values, or Telegram secrets. The business `(id,bid)` join exists only in the smallest sanitized fixture and in memory, never in public outputs.
- Store no raw page HTML. A failed sanitizer discards the DOM artifact.
- Default scheduled scope is 60 rolling dates × durations 2–14 × nine airports = 7,020 searches.
- A scheduled full run requires repository variable `QEEQ_FULL_SCHEDULE_ENABLED=true`; manual defaults remain one KTW two-day smoke.
- Do not run the full production matrix locally.
- Do not create a remote repository, push, deploy Pages, send Telegram, or trigger GitHub Actions without explicit authorization.
- Every production behavior follows RED → verify RED → GREEN → verify GREEN → commit.

## File map

| Path | Responsibility |
|---|---|
| `.gitignore` | Exclude dependencies, outputs, artifacts, browser state, logs, and secrets. |
| `package.json`, `package-lock.json` | Node version, dependencies, and stable commands. |
| `qeeq.config.example.json` | Safe manual defaults and all supported runtime limits. |
| `src/qeeq/config.js` | CLI/config loading, overrides, validation, and help. |
| `src/qeeq/locations.json` | Nine QEEQ airport records with current IDs and IATA codes. |
| `src/qeeq/locations.js` | Catalog lookup, live-ID comparison, and airport counts. |
| `src/qeeq/utils.js` | Dates, money, CSV, file paths, ranking, and sanitization. |
| `src/qeeq/scraper.js` | Pure offer parsers plus Playwright session/form/result orchestration. |
| `src/qeeq/validateLocations.js` | Live visible-autocomplete validation for all nine catalog airports. |
| `src/qeeq/run.js` | Scenario expansion, execution envelopes, atomic snapshots, statuses, and exit codes. |
| `src/qeeq/cli.js` | User-facing CSV command. |
| `src/qeeq/report.js` | Console table and canonical CSV export. |
| `src/qeeq/mergeResults.js` | Deterministic chunk validation and merge. |
| `src/qeeq/reportHtml.js` | Self-contained verified-price HTML report. |
| `src/qeeq/reportXlsx.js` | Seven-sheet Excel workbook. |
| `src/qeeq/telegramSummary.js` | Pure final/plan-failure Telegram text generation. |
| `src/qeeq/workflowPlan.js` | Pure workflow gates, timing budget, date chunking, and plan CLI. |
| `tests/run-qeeq-tests.js` | Offline regression runner and static workflow assertions. |
| `tests/fixtures/*.json` | Sanitized autocomplete, list-response, group, offer, and payload fixtures. |
| `tests/fixtures/fake-qeeq-browser.js` | Deterministic browser-flow test double. |
| `.github/workflows/qeeq-smoke.yml` | One real KTW two-day validation. |
| `.github/workflows/qeeq-daily.yml` | Gated, chunked production pipeline. |
| `README.md` | Local usage, data contract, workflow gates, and verification. |

---

### Task 1: Bootstrap the project and validated configuration

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `qeeq.config.example.json`
- Create: `src/qeeq/config.js`
- Create: `tests/run-qeeq-tests.js`

**Interfaces:**
- Produces: `loadConfig(argv: string[]): object`
- Produces: `printHelp(): void`
- Produces: `parseCliArgs(argv: string[]): Record<string,string|boolean>`
- Configuration consumers may rely on `baseUrl`, `timeZone`, `locations`, `rollingDays`, `startDates`, `durationsDays`, times, residence, driver age, navigation/results/API-observation timeouts, limits, output paths, and `fullScheduleEnabled`.

- [ ] **Step 1: Create the package/test harness and write the failing config tests**

Create `package.json` with CommonJS, Node 20, the final scripts, and no dependencies yet:

```json
{
  "name": "qeeq-tool",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=20" },
  "scripts": {
    "qeeq": "node src/qeeq/cli.js --config=qeeq.config.example.json",
    "qeeq:json": "node src/qeeq/run.js --config=qeeq.config.example.json --save=output/qeeq-results-latest.json",
    "qeeq:merge": "node src/qeeq/mergeResults.js --input-dir=downloaded-parts --output-json=output/qeeq-results-latest.json --output-csv=output/qeeq-results.csv",
    "qeeq:report": "node src/qeeq/reportHtml.js output/qeeq-results-latest.json output/qeeq-report.html",
    "qeeq:xlsx": "node src/qeeq/reportXlsx.js output/qeeq-results-latest.json output/qeeq-summary.xlsx",
    "qeeq:aux": "node src/qeeq/report.js --input=output/qeeq-results-latest.json --output-quality=output/quality-summary.json --output-manifest=output/run-manifest.json --manifest-files=output/qeeq-results-latest.json,output/qeeq-results.csv,output/qeeq-report.html,output/qeeq-summary.xlsx",
    "qeeq:plan": "node src/qeeq/workflowPlan.js",
    "test": "node --test tests/run-qeeq-tests.js"
  }
}
```

Use Node's built-in test runner so every later `test(...)` declaration is registered before execution. Create the first tests:

```js
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('config keeps a manual run bounded', () => {
  const { loadConfig } = require('../src/qeeq/config');
  const config = loadConfig(['--config=qeeq.config.example.json']);
  assert.equal(config.baseUrl, 'https://www.qeeq.pl');
  assert.equal(config.timeZone, 'Europe/Warsaw');
  assert.deepEqual(config.locations, ['Katowice']);
  assert.equal(config.rollingDays, 1);
  assert.deepEqual(config.durationsDays, [2]);
  assert.equal(config.maxScenarios, 7020);
  assert.equal(config.fullScheduleEnabled, false);
  assert.equal(config.apiObservationTimeoutMs, 30000);
});

test('config rejects a scenario limit above 7020', () => {
  const { loadConfig } = require('../src/qeeq/config');
  assert.throws(
    () => loadConfig(['--config=qeeq.config.example.json', '--max-scenarios=7021']),
    /maxScenarios must be between 1 and 7020/
  );
});

test('config rejects invalid durations and times', () => {
  const { loadConfig } = require('../src/qeeq/config');
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--durations-days=0']), /durationsDays must contain positive integers/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--durations-days=2x']), /durationsDays must be a positive integer/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--pickup-time=25:00']), /pickupTime must use HH:MM/);
});

test('config rejects unsafe browser and extraction limits', () => {
  const { loadConfig } = require('../src/qeeq/config');
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--location-concurrency=0']), /locationConcurrency must be a positive integer/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--max-load-more-iterations=0']), /maxLoadMoreIterations must be a positive integer/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--max-offers=0']), /maxOffersPerScenario must be a positive integer/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--api-observation-timeout-ms=0']), /apiObservationTimeoutMs must be a positive integer/);
});

test('config parses explicit boolean safety switches', () => {
  const { loadConfig } = require('../src/qeeq/config');
  const config = loadConfig(['--config=qeeq.config.example.json', '--headless=false', '--full-schedule-enabled=true']);
  assert.equal(config.headless, false);
  assert.equal(config.fullScheduleEnabled, true);
});

test('config validates dates profile paths and unknown options', () => {
  const { loadConfig } = require('../src/qeeq/config');
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--start-dates=2026-02-31']), /valid YYYY-MM-DD/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--driver-age=unknown']), /driverAge must use MIN-MAX/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--output-csv=../outside.csv']), /outputCsv must be a safe relative path/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--save=../outside.json']), /save must be a safe relative path/);
  assert.throws(() => loadConfig(['--config=qeeq.config.example.json', '--unknown=value']), /Unknown option: --unknown/);
});

test('config accepts both equals and space-form arguments', () => {
  const { parseCliArgs } = require('../src/qeeq/config');
  assert.equal(parseCliArgs(['--config=qeeq.config.example.json']).config, 'qeeq.config.example.json');
  assert.equal(parseCliArgs(['--config', 'qeeq.config.example.json']).config, 'qeeq.config.example.json');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm.cmd test
```

Expected: FAIL with `Cannot find module '../src/qeeq/config'`.

- [ ] **Step 3: Install exact dependencies and implement minimal config loading**

Run:

```powershell
npm.cmd install playwright@^1.52.0 exceljs@^4.4.0 --save
```

Create `qeeq.config.example.json` with safe manual values:

```json
{
  "baseUrl": "https://www.qeeq.pl",
  "timeZone": "Europe/Warsaw",
  "locations": ["Katowice"],
  "rollingDays": 1,
  "startDates": [],
  "durationsDays": [2],
  "pickupTime": "10:00",
  "dropoffTime": "10:00",
  "driverAge": "30-60",
  "residenceCountryCode": "PL",
  "headless": true,
  "navigationTimeoutMs": 45000,
  "resultsTimeoutMs": 90000,
  "apiObservationTimeoutMs": 30000,
  "locationConcurrency": 1,
  "maxLoadMoreIterations": 20,
  "maxVehicleGroupsPerScenario": 300,
  "maxOffersPerScenario": 1500,
  "maxScenarios": 7020,
  "fullScheduleEnabled": false,
  "browserExecutablePath": "",
  "outputCsv": "output/qeeq-results.csv",
  "artifactsDir": "artifacts/qeeq"
}
```

Implement `config.js` with these exact override names:

```js
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
```

Create `.gitignore`:

```gitignore
node_modules/
output/
artifacts/
downloaded-parts/
.playwright-cli/
.env
*.log
*.tmp
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```powershell
npm.cmd test
node src/qeeq/config.js --help
```

Expected: both config tests PASS. The direct module command exits 0 without side effects.

- [ ] **Step 5: Commit the foundation**

```powershell
git add .gitignore package.json package-lock.json qeeq.config.example.json src/qeeq/config.js tests/run-qeeq-tests.js
git commit -m "chore: bootstrap QEEQ tool configuration"
```

### Task 2: Add the nine-airport catalog and bounded scenario planner

**Files:**
- Create: `src/qeeq/locations.json`
- Create: `src/qeeq/locations.js`
- Create: `tests/fixtures/qeeq-airport-autocomplete.json`
- Create: `src/qeeq/run.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: `loadConfig(argv)` from Task 1.
- Produces: `catalogEntryForLocation(value)`, `defaultLocationCities()`, `expectedAirportCount(locations)`, `compareLiveAirport(catalogAirport, liveAirport)`, `locationCatalog`, `normalizeLocationKey(value)`.
- Produces: `expandScenarios(config, now)`, `scenarioKey(scenario)`, `assertScenarioLimit(count, maxScenarios)`.

- [ ] **Step 1: Write failing catalog and planner tests**

Append:

```js
test('location catalog contains eight cities and nine airports', () => {
  const { defaultLocationCities, expectedAirportCount } = require('../src/qeeq/locations');
  const cities = defaultLocationCities();
  assert.equal(cities.length, 8);
  assert.equal(expectedAirportCount(cities), 9);
});

test('full scheduled matrix expands to 7020 airport searches', () => {
  const { expandScenarios } = require('../src/qeeq/run');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const config = {
    locations: defaultLocationCities(),
    timeZone: 'Europe/Warsaw',
    startDates: [],
    rollingDays: 60,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14],
    pickupTime: '10:00',
    dropoffTime: '10:00',
    maxScenarios: 7020
  };
  const scenarios = expandScenarios(config, new Date('2026-08-20T10:00:00+02:00'));
  assert.equal(scenarios.length, 7020);
  assert.equal(new Set(scenarios.map(item => item.key)).size, 7020);
});

test('rolling dates begin tomorrow in Europe Warsaw across UTC midnight', () => {
  const { expandScenarios } = require('../src/qeeq/run');
  const scenarios = expandScenarios({ locations: ['Katowice'], startDates: [], rollingDays: 1, durationsDays: [2], pickupTime: '10:00', dropoffTime: '10:00', timeZone: 'Europe/Warsaw', maxScenarios: 7020 }, new Date('2026-08-20T22:30:00Z'));
  assert.equal(scenarios[0].pickupDate, '2026-08-22');
  assert.equal(scenarios[0].rentalDays, 2);
});

test('scenario expansion refuses a matrix above the configured cap', () => {
  const { expandScenarios } = require('../src/qeeq/run');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  assert.throws(() => expandScenarios({
    locations: defaultLocationCities(), startDates: [], rollingDays: 61,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14],
    pickupTime: '10:00', dropoffTime: '10:00', timeZone: 'Europe/Warsaw', maxScenarios: 7020
  }, new Date('2026-08-20T10:00:00+02:00')), /Scenario count 7137 exceeds maxScenarios 7020/);
});

test('catalog warns when live QEEQ IDs drift for the same IATA', () => {
  const { compareLiveAirport, locationCatalog } = require('../src/qeeq/locations');
  const ktw = locationCatalog.find(city => city.city === 'Katowice').airports[0];
  const result = compareLiveAirport(ktw, { label: ktw.label, iata: 'KTW', city: '2477', landmark: '999999', dataType: ktw.dataType, type: '2' });
  assert.equal(result.useLiveIds, true);
  assert.equal(result.qualityWarning.code, 'location_id_drift');
});

test('all nine airports match the sanitized live autocomplete fixture', () => {
  const live = require('./fixtures/qeeq-airport-autocomplete.json');
  const { compareLiveAirport, locationCatalog } = require('../src/qeeq/locations');
  const catalog = locationCatalog.flatMap(entry => entry.airports);
  assert.equal(live.length, 9);
  for (const airport of catalog) {
    const match = live.find(item => item.iata === airport.iata);
    const result = compareLiveAirport(airport, match);
    assert.equal(result.error, undefined, airport.iata);
    assert.equal(result.useLiveIds, true, airport.iata);
  }
});

test('live airport identity requires IATA normalized label and type', () => {
  const { compareLiveAirport, locationCatalog } = require('../src/qeeq/locations');
  const ktw = locationCatalog.find(city => city.city === 'Katowice').airports[0];
  assert.equal(compareLiveAirport(ktw, { ...ktw, label: 'Lotnisko Kraków', type: '2' }).error.code, 'location_label_mismatch');
  assert.equal(compareLiveAirport(ktw, { ...ktw, type: '1' }).error.code, 'location_type_mismatch');
  assert.equal(compareLiveAirport(ktw, { ...ktw, dataType: 'city' }).error.code, 'location_data_type_mismatch');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `locations.js` and `run.js` do not exist.

- [ ] **Step 3: Implement the catalog and scenario expansion**

Create `locations.json` with IDs observed from QEEQ autocomplete on 2026-08-20. KTW is browser-confirmed; the other eight records remain provisional until all nine are validated against the sanitized autocomplete fixture and the first staged live run:

```json
[
  {"city":"Warszawa","airports":[
    {"key":"warsaw-chopin","label":"Lotnisko Chopina w Warszawie","iata":"WAW","cityId":"2486","landmarkId":"98942","dataType":"airport","type":"2"},
    {"key":"warsaw-modlin","label":"Lotnisko Warszawa Modlin","iata":"WMI","cityId":"2486","landmarkId":"99522","dataType":"airport","type":"2"}
  ]},
  {"city":"Krakow","airports":[{"key":"krakow-balice","label":"Lotnisko w Krakowie","iata":"KRK","cityId":"2479","landmarkId":"98939","dataType":"airport","type":"2"}]},
  {"city":"Gdansk","airports":[{"key":"gdansk-rebiechowo","label":"Lotnisko Gdańsk","iata":"GDN","cityId":"2475","landmarkId":"99177","dataType":"airport","type":"2"}]},
  {"city":"Katowice","airports":[{"key":"katowice-pyrzowice","label":"Port Lotniczy Katowice-Pyrzowice","iata":"KTW","cityId":"2477","landmarkId":"404260","dataType":"airport","type":"2"}]},
  {"city":"Wroclaw","airports":[{"key":"wroclaw-strachowice","label":"Lotnisko we Wrocławiu","iata":"WRO","cityId":"2487","landmarkId":"98954","dataType":"airport","type":"2"}]},
  {"city":"Poznan","airports":[{"key":"poznan-lawica","label":"Lotnisko Poznań","iata":"POZ","cityId":"2483","landmarkId":"99001","dataType":"airport","type":"2"}]},
  {"city":"Bydgoszcz","airports":[{"key":"bydgoszcz-szwederowo","label":"Port Lotniczy Bydgoszcz","iata":"BZG","cityId":"2474","landmarkId":"98976","dataType":"airport","type":"2"}]},
  {"city":"Lodz","airports":[{"key":"lodz-lublinek","label":"Port Lotniczy Łódź","iata":"LCJ","cityId":"2480","landmarkId":"98993","dataType":"airport","type":"2"}]}
]
```

Save the smallest non-secret autocomplete objects for all nine airports in `qeeq-airport-autocomplete.json`; keep only visible label, IATA, city ID, landmark ID, data type, and type. Implement catalog normalization and live-ID drift output:

```js
const locationCatalog = require('./locations.json');

function normalizeLocationKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function catalogEntryForLocation(value) {
  const key = normalizeLocationKey(value);
  return locationCatalog.find(entry => normalizeLocationKey(entry.city) === key) || null;
}

function defaultLocationCities() {
  return locationCatalog.map(entry => entry.city);
}

function expectedAirportCount(locations) {
  return locations.reduce((sum, value) => {
    const entry = catalogEntryForLocation(value);
    if (!entry) throw new Error(`Unknown QEEQ location: ${value}`);
    return sum + entry.airports.length;
  }, 0);
}

function compareLiveAirport(catalogAirport, liveAirport) {
  if (!liveAirport) {
    return { useLiveIds: false, error: { code: 'location_match_missing', expected: catalogAirport.iata } };
  }
  if (String(liveAirport.iata).toUpperCase() !== catalogAirport.iata) {
    return { useLiveIds: false, error: { code: 'location_iata_mismatch', expected: catalogAirport.iata, actual: liveAirport.iata } };
  }
  if (normalizeLocationKey(liveAirport.label) !== normalizeLocationKey(catalogAirport.label)) {
    return { useLiveIds: false, error: { code: 'location_label_mismatch', expected: catalogAirport.label, actual: liveAirport.label } };
  }
  if (String(liveAirport.type) !== String(catalogAirport.type)) {
    return { useLiveIds: false, error: { code: 'location_type_mismatch', expected: catalogAirport.type, actual: liveAirport.type } };
  }
  if (normalizeLocationKey(liveAirport.dataType) !== normalizeLocationKey(catalogAirport.dataType)) {
    return { useLiveIds: false, error: { code: 'location_data_type_mismatch', expected: catalogAirport.dataType, actual: liveAirport.dataType } };
  }
  const drifted = String(liveAirport.city) !== catalogAirport.cityId || String(liveAirport.landmark) !== catalogAirport.landmarkId;
  return {
    useLiveIds: true,
    cityId: String(liveAirport.city),
    landmarkId: String(liveAirport.landmark),
    qualityWarning: drifted ? { code: 'location_id_drift', expectedCityId: catalogAirport.cityId, actualCityId: String(liveAirport.city), expectedLandmarkId: catalogAirport.landmarkId, actualLandmarkId: String(liveAirport.landmark) } : null
  };
}

module.exports = { catalogEntryForLocation, compareLiveAirport, defaultLocationCities, expectedAirportCount, locationCatalog, normalizeLocationKey };
```

Implement `scenarioKey` from airport key, pickup date, and `rentalDays`. Implement `assertScenarioLimit` before returning the matrix. `expandScenarios` returns objects with `key`, airport metadata, pickup/drop-off ISO dates and times, and `rentalDays` (the config input remains plural `durationsDays`). Determine the first rolling pickup date from the calendar date in `config.timeZone` (`Europe/Warsaw`), then use UTC-safe date-only arithmetic; do not mutate the input date or derive “tomorrow” from the runner's UTC date.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: all catalog/planner tests PASS and the exact full count is 7,020.

- [ ] **Step 5: Commit the catalog and planner**

```powershell
git add src/qeeq/locations.json src/qeeq/locations.js src/qeeq/run.js tests/run-qeeq-tests.js tests/fixtures/qeeq-airport-autocomplete.json
git commit -m "feat: add QEEQ airport scenario planner"
```

### Task 3: Implement verified public-price normalization and safe diagnostics

**Files:**
- Create: `src/qeeq/utils.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Produces: `parseMoney(raw, fallbackCurrency, options = {})`, `normalizePriceCandidate(input)`, `rankVerifiedPublicOffers(offers)`, `sanitizeSourceUrl(rawUrl)`, `sanitizeDiagnosticText(text)`, `toCsv(rows)`, `ensureDir(path)`, `writeTextFile(path, content)`.

- [ ] **Step 1: Write failing tests for price tiers, false prices, ranking, and redaction**

```js
test('newcomer coupon and Diamond totals remain separate from public price', () => {
  const { normalizePriceCandidate } = require('../src/qeeq/utils');
  const result = normalizePriceCandidate({
    displayedText: 'Cena ze zniżką 106 zł',
    discountType: 'newcomer_coupon',
    memberText: 'Cena Diamentowa 98 zł',
    rentalPeriodText: 'łącznie za 2 dni',
    rentalDays: 2
  });
  assert.equal(result.total_price, null);
  assert.equal(result.daily_price, null);
  assert.equal(result.conditional_offer_total, 106);
  assert.equal(result.conditional_offer_daily, 53);
  assert.equal(result.conditional_offer_type, 'newcomer_coupon');
  assert.equal(result.conditional_member_total, 98);
  assert.equal(result.conditional_member_daily, 49);
  assert.equal(result.price_tier, 'conditional');
  assert.equal(result.price_scope, 'total');
  assert.equal(result.price_verified, false);
  assert.equal(result.conditional_price_verified, true);
});

test('an explicit non-conditional two-day total can become verified public price', () => {
  const { normalizePriceCandidate } = require('../src/qeeq/utils');
  const result = normalizePriceCandidate({
    displayedText: 'Cena 119 zł', discountType: null,
    rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2
  });
  assert.equal(result.total_price, 119);
  assert.equal(result.daily_price, 59.5);
  assert.equal(result.price_tier, 'public');
  assert.equal(result.price_verified, true);
});

test('rating deposit and discount percent cannot become price', () => {
  const { parseMoney } = require('../src/qeeq/utils');
  assert.equal(parseMoney('Ocena 8.5', 'PLN'), null);
  assert.equal(parseMoney('Depozyt: 3 399,99 zł', 'PLN', { rejectLabels: ['Depozyt'] }), null);
  assert.equal(parseMoney('60% zniżki', 'PLN'), null);
});

test('ranking excludes Diamond-only and unverified prices', () => {
  const { rankVerifiedPublicOffers } = require('../src/qeeq/utils');
  const ranked = rankVerifiedPublicOffers([
    { id: 'diamond', price_tier: 'diamond', price_verified: true, total_price: 98 },
    { id: 'public-b', price_tier: 'public', price_verified: true, total_price: 119 },
    { id: 'unknown', price_tier: 'public', price_verified: false, total_price: 90 },
    { id: 'newcomer', price_tier: 'conditional', price_verified: false, conditional_offer_total: 106 },
    { id: 'public-a', price_tier: 'public', price_verified: true, total_price: 110 }
  ]);
  assert.deepEqual(ranked.map(item => item.id), ['public-a', 'public-b']);
});

test('diagnostics redact QEEQ session values', () => {
  const { sanitizeDiagnosticText, sanitizeSourceUrl } = require('../src/qeeq/utils');
  const url = 'https://www.qeeq.pl/car/search?id=secret-session&ticket=secret-ticket&ts=123';
  assert.equal(sanitizeSourceUrl(url), 'https://www.qeeq.pl/car/search');
  const clean = sanitizeDiagnosticText('id=secret-session clid=session-2 _vv_=view-secret fpt=abc ticket=def ts=123 qeeq_fpt=cookie');
  assert.doesNotMatch(clean, /secret-session|session-2|view-secret|abc|def|123|cookie/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL with `Cannot find module '../src/qeeq/utils'`.

- [ ] **Step 3: Implement the minimal pure utilities**

Use Polish number normalization (`3 399,99` → `3399.99`) and require an explicit currency marker or fallback. `normalizePriceCandidate` must require both `łącznie` and the configured rental-day count before it verifies a total. A `discountType` such as `newcomer_coupon`, member/login condition, or Diamond label moves the displayed amount to conditional fields even when the period is verified; it never populates public `total_price`/`daily_price`. Only an explicitly non-conditional displayed amount can become `price_tier: 'public'`.

Redaction must remove query-string and `name=value` forms of session/security fields `clid`, `_vv_`, `fpt`, `ticket`, `ts`, and `qeeq_fpt`. Generic `id` must be removed from persisted URLs/diagnostic text but may exist as a typed business field only inside the smallest sanitized fixture and canonical in-memory provider map, paired with `bid`; neither key is emitted in public reports.

The ranking implementation is exactly:

```js
function rankVerifiedPublicOffers(offers) {
  return offers
    .filter(offer => offer.price_tier === 'public' && offer.price_verified === true && Number.isFinite(offer.total_price))
    .slice()
    .sort((left, right) => left.total_price - right.total_price);
}
```

Return `null`, never `0`, for an invalid or absent monetary field.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: all price/ranking/redaction tests PASS.

- [ ] **Step 5: Commit the utilities**

```powershell
git add src/qeeq/utils.js tests/run-qeeq-tests.js
git commit -m "feat: normalize verified QEEQ public prices"
```

### Task 4: Parse scoped vehicle groups, provider metadata, and provider-package offers

**Files:**
- Create: `tests/fixtures/qeeq-search-list-ktw.json`
- Create: `tests/fixtures/qeeq-expanded-group-ktw.json`
- Create: `src/qeeq/scraper.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: price and sanitization utilities from Task 3.
- Produces: `buildOfferBusinessKey(id, bid)`, `parseObservedListPayload(payload)`, `resolveProviderForOffer(snapshot, providerMetadata)`, `parseGroupSnapshot(snapshot, context)`, `parseOfferSnapshot(snapshot, context, providerMetadata)`, `selectTopPublicOffers(offers, limit)`.
- `parseOfferSnapshot` accepts only one expanded-offer subtree snapshot; it has no page-global text parameter.

- [ ] **Step 1: Capture and sanitize one real two-day network/DOM fixture before production parsing code**

Use the Playwright CLI skill to open a fresh KTW two-day search, attach the response listener before submit, expand `Skoda Fabia` through `button[class*="suppliers-btn"]`, and capture the current official `GET /car-api/search/list` response. Save only the smallest sanitized subtree needed from `data.list[].meal_list[]` and `data.shops[]` in `qeeq-search-list-ktw.json`.

The DOM reserve anchor contains `id`, `bid`, `clid`, `_vv_`, and `list_discount_type`. Persist only the business pair `(id, bid)` as typed fixture fields plus the non-secret discount type; never persist `clid` or the raw href. The verified mapping contract is:

```text
DOM id  == data.list[].meal_list[].id
DOM bid == data.list[].meal_list[].bid
meal.pickup_shop -> data.shops[].id -> data.shops[].name
```

Create `qeeq-expanded-group-ktw.json` from that same captured offer. It records the actual `(id,bid)` pair, `ratingText=8.5`, `depositText=Depozyt: 3 399,99 zł`, displayed amount `106 zł`, `discountType=newcomer_coupon`, Diamond amount `98 zł`, and `rentalPeriodText=łącznie za 2 dni`. It also records `referencePriceText: null`, because the live CARWIZ subtree did not render `[class*="line-through"]` or `[class*="origin-price-tag"]`. Keep the sidebar text as a separate ignored field. Do not put invented sample IDs or provider-name hints into the DOM fixture.

The network fixture keeps `best_price_info`, `diamond_price_info`, and `origin_price_info` only for the matched meal, plus the matched shop ID/name/score. Treat `origin_price_info` as a reference price only when a crossed-out reference is also rendered in the scoped DOM subtree; its mere presence in JSON is insufficient.

Verify fixture safety:

```powershell
rg -n 'resultSessionId|result_session_id|clid|_vv_|fpt|ticket|qeeq_fpt|"ts"\s*:|https://www\.qeeq\.pl/car/search\?' tests/fixtures
```

Expected: no matches for session/security fields or raw result URLs. The captured `id` and `bid` may remain only as the exact business pair verified against `meal_list[]`.

- [ ] **Step 2: Write failing parser tests against the sanitized fixtures**

```js
test('expanded provider offer is the canonical record', () => {
  const domFixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { buildOfferBusinessKey, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const providers = parseObservedListPayload(apiFixture);
  const key = buildOfferBusinessKey(domFixture.offer.businessId, domFixture.offer.businessBid);
  assert.equal(providers.get(key)[0].providerName, 'CARWIZ');
  const offer = parseOfferSnapshot(domFixture.offer, { rentalDays: 2, vehicle: domFixture.vehicle }, providers);
  assert.equal(offer.provider_name, 'CARWIZ');
  assert.equal(offer.total_price, null);
  assert.equal(offer.daily_price, null);
  assert.equal(offer.conditional_offer_total, 106);
  assert.equal(offer.conditional_offer_daily, 53);
  assert.equal(offer.conditional_offer_type, 'newcomer_coupon');
  assert.equal(offer.conditional_member_total, 98);
  assert.equal(offer.reference_price, null);
  assert.equal(offer.deposit_amount, 3399.99);
  assert.equal(offer.provider_rating, 8.5);
  assert.equal(offer.price_tier, 'conditional');
  assert.equal(offer.price_verified, false);
  assert.equal(offer.conditional_price_verified, true);
});

test('vehicle group parser emits diagnostic group data only', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const { parseGroupSnapshot } = require('../src/qeeq/scraper');
  const group = parseGroupSnapshot(fixture.vehicle, { rentalDays: 2 });
  assert.equal(group.record_type, 'group');
  assert.equal(group.vehicle_name, 'Skoda Fabia');
  assert.equal(group.provider_name, undefined);
  assert.equal(group.price_verified, false);
});

test('group-only observations do not enter Top 3', () => {
  const { selectTopPublicOffers } = require('../src/qeeq/scraper');
  const result = selectTopPublicOffers([
    { record_type: 'group', total_price: 90, price_tier: 'public', price_verified: true },
    { record_type: 'offer', conditional_offer_total: 106, price_tier: 'conditional', price_verified: false, provider_name: 'CARWIZ' },
    { record_type: 'offer', total_price: 119, price_tier: 'public', price_verified: true, provider_name: 'PUBLIC PROVIDER' }
  ], 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].provider_name, 'PUBLIC PROVIDER');
});

test('sidebar filter values never populate an offer', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const { parseOfferSnapshot } = require('../src/qeeq/scraper');
  const offer = parseOfferSnapshot({ ...fixture.offer, ratingText: '', depositText: '' }, { rentalDays: 2, vehicle: fixture.vehicle }, new Map());
  assert.equal(offer.provider_rating, null);
  assert.equal(offer.deposit_amount, null);
});

test('missing and ambiguous business-key matches never invent a provider', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const { buildOfferBusinessKey, resolveProviderForOffer } = require('../src/qeeq/scraper');
  const key = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  assert.equal(resolveProviderForOffer(fixture.offer, new Map()).quality_error, 'provider_unresolved');
  const ambiguous = new Map([[key, [{ providerName: 'A' }, { providerName: 'B' }]]]);
  assert.equal(resolveProviderForOffer(fixture.offer, ambiguous).quality_error, 'provider_ambiguous');
});
```

- [ ] **Step 3: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because the parser exports are absent.

- [ ] **Step 4: Implement minimal fixture-driven parsers**

Build the provider map from `data.list[].meal_list[]` and `data.shops[]`, keyed by the exact string pair `(id,bid)`. Map `meal.pickup_shop` to the matching shop name/score. Resolve DOM metadata only when exactly one API meal matches both values. Never use `clid`, OCR, logo URL, a lone `id`, or a lone `bid` as the join. The DOM snapshot supplies displayed price, period, deposit, rating, discount type, and reference-price visibility. Return for the confirmed CARWIZ fixture:

```js
{
  record_type: 'offer',
  vehicle_name: 'Skoda Fabia',
  provider_name: 'CARWIZ',
  provider_rating: 8.5,
  deposit_amount: 3399.99,
  deposit_currency: 'PLN',
  total_price: null,
  daily_price: null,
  conditional_offer_total: 106,
  conditional_offer_daily: 53,
  conditional_offer_type: 'newcomer_coupon',
  conditional_member_total: 98,
  conditional_member_daily: 49,
  reference_price: null,
  currency: 'PLN',
  price_tier: 'conditional',
  price_scope: 'total',
  price_verified: false,
  conditional_price_verified: true,
  rental_days: 2,
  parsing_source: 'hybrid'
}
```

If provider metadata cannot be tied to the DOM offer, return a group/diagnostic record with `quality_errors: ['provider_unresolved']`; if more than one candidate shares the pair, use `provider_ambiguous`. A disagreement between DOM `list_discount_type` and API `best_price_info.discount_type` is `discount_type_mismatch` and must take the safer conditional classification. Do not invent a provider name or public price.

- [ ] **Step 5: Run tests, verify GREEN, and commit**

```powershell
npm.cmd test
git add src/qeeq/scraper.js tests/run-qeeq-tests.js tests/fixtures/qeeq-search-list-ktw.json tests/fixtures/qeeq-expanded-group-ktw.json
git commit -m "feat: parse QEEQ provider offers"
```

Expected: parser tests PASS and the fixture safety scan is clean.

### Task 5: Drive the QEEQ browser session, form, expansion, and lazy loading

**Files:**
- Create: `tests/fixtures/fake-qeeq-browser.js`
- Create: `src/qeeq/validateLocations.js`
- Modify: `src/qeeq/scraper.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: Task 2 catalog and Task 4 parsers.
- Produces: `SELECTORS`, `QeeqScraper`, `shouldRetryScenario(outcome)`, `snapshotOfferSubtree(input)`.
- Produces: `validateLiveLocationCatalog(config, deps)` and a `validateLocations.js` CLI with atomic `--output=PATH`.
- `new QeeqScraper(config, deps = {})`; dependency overrides are limited to `launchBrowser`, `now`, and `sleep` for deterministic tests.
- Public methods: `runScenario(scenario): Promise<ScenarioOutcome>` and `run(): Promise<ScenarioOutcome[]>`.

- [ ] **Step 1: Write a failing browser-flow test with a deterministic fake**

The fake records actions and returns one hidden stale WRO suggestion plus one visible KTW suggestion, one expandable Skoda group, one CARWIZ offer, and a load-more sequence of 25 → 50 → 50 groups.

```js
test('browser flow selects visible IATA match and stops stalled load-more', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { expandScenarios } = require('../src/qeeq/run');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser();
  const scraperConfig = {
    baseUrl: 'https://www.qeeq.pl',
    timeZone: 'Europe/Warsaw', locations: ['Katowice'], startDates: ['2026-09-19'], rollingDays: 1,
    durationsDays: [2], pickupTime: '10:00', dropoffTime: '10:00', maxScenarios: 7020,
    driverAge: '30-60',
    residenceCountryCode: 'PL',
    maxLoadMoreIterations: 20,
    maxVehicleGroupsPerScenario: 300,
    maxOffersPerScenario: 1500,
    artifactsDir: 'artifacts/qeeq-test'
  };
  const [scenario] = expandScenarios(scraperConfig, new Date('2026-08-20T10:00:00+02:00'));
  assert.equal(scenario.rentalDays, 2);
  const scraper = new QeeqScraper(scraperConfig, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
  const outcome = await scraper.runScenario(scenario);
  assert.equal(fake.selectedSuggestionIata, 'KTW');
  assert.deepEqual(fake.hiddenSearchValues, {
    from_date_0: '2026-09-19', from_date_1: '10:00',
    to_date_0: '2026-09-21', to_date_1: '10:00'
  });
  assert.equal(fake.driverAge, '30-60');
  assert.equal(fake.residenceCountryCode, 'PL');
  assert.equal(fake.loadMoreClicks, 2);
  assert.equal(outcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(outcome.quality_errors.includes('load_more_stalled'), true);
});

test('retry is bounded to one fresh session for transient failures', () => {
  const { shouldRetryScenario } = require('../src/qeeq/scraper');
  assert.equal(shouldRetryScenario({ error_code: 'session_expired', attempt: 0 }), true);
  assert.equal(shouldRetryScenario({ error_code: 'navigation_timeout', attempt: 1 }), false);
  assert.equal(shouldRetryScenario({ error_code: 'price_unverified', attempt: 0 }), false);
});

test('offer fields are read only from the expanded provider subtree', () => {
  const { snapshotOfferSubtree } = require('../src/qeeq/scraper');
  const snapshot = snapshotOfferSubtree({
    supplierInfoText: 'CARWIZ 8.5 (120)',
    featureTexts: ['Automatyczna', 'Depozyt: 3 399,99 zł', '5 miejsc', '5 drzwi', '1 bagaż'],
    priceText: '106 zł', periodText: 'łącznie za 2 dni',
    outsideSidebarText: 'Kaucja poniżej 3 000 zł Ocena 8+'
  });
  assert.equal(snapshot.ratingText, '8.5');
  assert.equal(snapshot.ratingCountText, '120');
  assert.equal(snapshot.depositText, 'Depozyt: 3 399,99 zł');
  assert.doesNotMatch(JSON.stringify(snapshot), /poniżej|Ocena 8\+/);
});

test('age and residence use visible-label fallbacks when primary selectors are absent', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ primaryProfileControls: false });
  const scraper = new QeeqScraper({ baseUrl: 'https://www.qeeq.pl', driverAge: '30-60', residenceCountryCode: 'PL' }, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
  await scraper.runScenario({ key: 'ktw|2026-09-19|2', airport: { iata: 'KTW' }, pickupDate: '2026-09-19', pickupTime: '10:00', dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2 });
  assert.deepEqual(fake.semanticLabelsUsed, ['Wiek kierowcy', 'Kraj zamieszkania']);
});

test('live catalog validator requires nine unique visible autocomplete matches', async () => {
  const fixture = require('./fixtures/qeeq-airport-autocomplete.json');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const result = await validateLiveLocationCatalog({ baseUrl: 'https://www.qeeq.pl' }, { resolveAirport: async airport => fixture.find(item => item.iata === airport.iata), now: () => new Date('2026-08-20T10:00:00Z') });
  assert.equal(result.expected_airports, 9);
  assert.equal(result.validated_airports, 9);
  assert.equal(result.validation_status, 'pass');
  assert.equal(new Set(result.airports.map(item => item.iata)).size, 9);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `QeeqScraper` and the fake browser do not exist.

- [ ] **Step 3: Implement the fake and minimal real Playwright orchestration**

Export these selectors exactly:

```js
const SELECTORS = Object.freeze({
  pickupInput: 'input[name="pickup"], .J-pick-up-input',
  pickPlace: 'input[name="pick-place"].J-place-of-pick',
  pickupSuggestion: 'li.auto-com-item[data-role="item"]:visible',
  pickupDate: '.J-os-search-pick-date',
  pickupTime: '.J-os-search-pick-time',
  returnDate: '.J-os-search-return-date',
  returnTime: '.J-os-search-return-time',
  pickupDateValue: 'input[name="from_date_0"]',
  pickupTimeValue: 'input[name="from_date_1"]',
  returnDateValue: 'input[name="to_date_0"]',
  returnTimeValue: 'input[name="to_date_1"]',
  sameLocation: '.J-all-the-place',
  driverAge: '.J-search-age-input',
  residence: '.J-search-region-input',
  submit: '.J-search-submit',
  group: '[class*="car-group-item___"]',
  openGroup: '[class*="car-group-item___"][class*="group-open___"]',
  vehicleName: '[class*="car_name___"]',
  supplierButton: 'button[class*="suppliers-btn"]',
  reserveAnchor: 'a[data-tj="reserve_btn_regular_click_b"]',
  supplierInfo: '.supplier-info',
  supplierRating: '.supplier-info > div:first-child > div:last-child',
  feature: '.car-feature-item',
  priceInfo: '[class*="price-info-root___"]',
  displayedPrice: '[class*="origin-row-price___"]',
  diamondPrice: '[class*="diamond-row___"]',
  referencePrice: '[class*="line-through"], [class*="origin-price-tag"]',
  rentalDays: '[class*="rental-days___"]',
  loadMoreText: 'Pokaż więcej wyników'
});
```

The offer subtree is the nearest ancestor of `reserveAnchor` containing both `supplierInfo` and `priceInfo`. Extract the deposit only from `feature` elements whose normalized text starts with `Depozyt:`; parse rating/rating count only from `supplierRating` inside that same subtree. Vehicle attributes use scoped feature labels and remain `null` when absent.

After setting the calendar and time controls, read back all four hidden values and compare them exactly with the scenario. A mismatch is the controlled error `search_parameter_mismatch` and the form must not be submitted. Age and residence first use their primary selectors; if missing, resolve a visible control by its Polish label, fill/select it, and read the value back. The deterministic fake must exercise the primary path plus a separate test where only the semantic label fallbacks exist.

Attach the response listener before submit for the current `GET /car-api/search/list` contract and bound the wait with `config.apiObservationTimeoutMs`. It may additionally recognize the legacy `/revision/search/getList`, `/revision/search/getListAsyncInfo`, and `/revision/search/getListExt` shapes as explicitly tested fallbacks, but the current endpoint is mandatory in the fixture and browser-flow test. Parse supported JSON; record `network_schema_unrecognized` and continue with DOM when unsupported.

Popup handling is idempotent and uses visible Polish labels: `Odrzuć nieobowiązkowe pliki cookie` and lower-banner `OK`. Wait for `/car/search?id=` but store only `sanitizeSourceUrl(page.url())`.

`validateLocations.js` reuses the same cookie handling and visible autocomplete resolution but never submits a result search. It validates every catalog airport by IATA, normalized visible label, data type, type, and current IDs, writes old/new non-secret values plus `captured_at`, and exits nonzero for missing, ambiguous, duplicate, or identity-mismatched records. The offline fixture test proves parser behavior; the Task 12 live CLI is the independent current-state acceptance check for all nine airports.

- [ ] **Step 4: Run the full offline suite and verify GREEN**

Run:

```powershell
npm.cmd test
```

Expected: fake browser flow PASS, no real browser or network access during `npm.cmd test`.

- [ ] **Step 5: Commit the browser flow**

```powershell
git add src/qeeq/scraper.js src/qeeq/validateLocations.js tests/run-qeeq-tests.js tests/fixtures/fake-qeeq-browser.js
git commit -m "feat: automate QEEQ search flow"
```

### Task 6: Build canonical run envelopes, atomic snapshots, CLI, and CSV

**Files:**
- Modify: `src/qeeq/run.js`
- Create: `src/qeeq/cli.js`
- Create: `src/qeeq/report.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: `loadConfig`, `expandScenarios`, `QeeqScraper`, and `toCsv`.
- Produces: `buildScenarioPayload(input)`, `buildRootPayload(input)`, `deriveStatuses(payload)`, `exitCodeForPayload(payload)`, `executeRun(config, deps)`, `progressLine(completed, total, elapsedMs)`.
- `executeRun` uses `deps.scenarioPlanner` and `deps.runScenario` when supplied; production defaults are `expandScenarios` and `QeeqScraper.runScenario`.
- Produces: `buildCsv(payload)`, `writeCsvReport(outputPath, payload)`, `buildQualitySummary(payload)`, `buildRunManifest(payload, generatedFiles)`, `writeAuxiliaryReports(outputDir, payload, generatedFiles)`, `printResultsTable(payload)`, `printSummary(payload)`.

- [ ] **Step 1: Write failing status, exit-code, atomic-output, and CSV tests**

```js
test('run and quality statuses are independent', () => {
  const { deriveStatuses, exitCodeForPayload } = require('../src/qeeq/run');
  const status = deriveStatuses({ expected_checks: 2, completed_checks: 2, failed_checks: 0, verified_public_offer_count: 1, quality_errors: [] });
  assert.deepEqual(status, { run_status: 'success', quality_status: 'pass' });
  assert.equal(exitCodeForPayload(status), 0);
  const warning = deriveStatuses({ expected_checks: 2, completed_checks: 1, failed_checks: 1, verified_public_offer_count: 1, quality_errors: ['location_id_drift'] });
  assert.deepEqual(warning, { run_status: 'partial', quality_status: 'warning' });
  assert.equal(exitCodeForPayload(warning), 2);
  const failed = deriveStatuses({ expected_checks: 1, completed_checks: 1, failed_checks: 0, verified_public_offer_count: 0, quality_errors: ['price_unverified'] });
  assert.equal(failed.quality_status, 'fail');
  assert.equal(exitCodeForPayload(failed), 1);
});

test('CSV exports the full provider-offer contract and excludes groups', () => {
  const { buildCsv } = require('../src/qeeq/report');
  const csv = buildCsv({ scenarios: [{ groups: [{ record_type: 'group', vehicle_name: 'Skoda Fabia' }], offers: [{ record_type: 'offer', provider_name: 'PUBLIC PROVIDER', provider_rating_count: 120, seats: 5, doors: 5, luggage: 1, total_price: 119, daily_price: 59.5, reference_price: 140, price_label: 'Cena', currency: 'PLN', price_verified: true }] }] });
  assert.match(csv, /seats,doors,luggage,provider_name,provider_rating,provider_rating_count/);
  assert.match(csv, /total_price,daily_price,conditional_offer_total,conditional_offer_daily,conditional_offer_type,conditional_member_total,conditional_member_daily,reference_price/);
  assert.match(csv, /5,5,1,PUBLIC PROVIDER,.*120/);
  assert.doesNotMatch(csv, /record_type,group/);
});

test('quality summary and run manifest have concrete secret-free producers', () => {
  const { buildQualitySummary, buildRunManifest } = require('../src/qeeq/report');
  const payload = { schema_version: 1, run_status: 'partial', quality_status: 'warning', expected_checks: 2, completed_checks: 1, failed_checks: 1, quality: { verified_public_offer_count: 1, unverified_offer_count: 1 }, errors: [{ code: 'location_id_drift', scenario_key: 'x' }] };
  const quality = buildQualitySummary(payload);
  assert.equal(quality.quality_status, 'warning');
  assert.equal(quality.error_codes.location_id_drift, 1);
  const manifest = buildRunManifest(payload, [{ path: 'qeeq-results.csv', bytes: 123, sha256: 'abc' }]);
  assert.equal(manifest.files[0].path, 'qeeq-results.csv');
  assert.doesNotMatch(JSON.stringify(manifest), /ticket|qeeq_fpt|result_session_id/);
});

test('executeRun writes an atomic snapshot after each scenario', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { executeRun } = require('../src/qeeq/run');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-run-'));
  const savePath = path.join(tempDir, 'result.json');
  let snapshotsSeen = 0;
  await executeRun({ savePath }, {
    scenarioPlanner: () => [{ key: 'a' }, { key: 'b' }],
    runScenario: async scenario => {
      if (fs.existsSync(savePath)) snapshotsSeen += 1;
      return { key: scenario.key, groups: [], offers: [{ record_type: 'offer', provider_name: 'PUBLIC PROVIDER', price_tier: 'public', price_verified: true, total_price: 119, currency: 'PLN' }], errors: [], quality_errors: [] };
    }
  });
  assert.equal(snapshotsSeen, 1);
  assert.equal(fs.existsSync(`${savePath}.tmp`), false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because the payload/status/report exports do not exist.

- [ ] **Step 3: Implement the run contract and CLI**

The root payload keys are:

```js
{
  schema_version: 1,
  provider: 'qeeq.pl',
  started_at: 'ISO-8601',
  completed_at: 'ISO-8601',
  expected_scenarios: 1,
  completed_scenarios: 1,
  expected_checks: 1,
  completed_checks: 1,
  failed_checks: 0,
  run_status: 'success',
  quality_status: 'pass',
  scenarios: [],
  errors: [],
  quality: {},
  options: {}
}
```

Write snapshots atomically as `<target>.tmp` followed by `renameSync`. The `options` field contains non-secret dates, durations, airport keys, limits, and concurrency only.

`cli.js` loads config, executes the run, prints tables, writes the configured CSV plus `quality-summary.json` and a run manifest for files generated by that invocation, and sets `process.exitCode = exitCodeForPayload(payload)`. `run.js` supports `--save=path`; `--help` calls `printHelp()` without launching Playwright. `report.js` also exposes the `qeeq:aux` CLI: after merged JSON/CSV/HTML/XLSX exist, it regenerates `quality-summary.json` and `run-manifest.json` from the recalculated merged payload and SHA-256 hashes/sizes of those exact whitelisted files. Missing manifest inputs are an error, not silently omitted.

Implement CSV headers in this fixed order:

```js
const CSV_HEADERS = [
  'scenario_key','scenario_status','requested_city','airport_key','iata','qeeq_city_id','qeeq_landmark_id',
  'pickup_at','dropoff_at','rental_days','driver_age','residence','vehicle_name','vehicle_category',
  'transmission','seats','doors','luggage','provider_name','provider_rating','provider_rating_count',
  'deposit_amount','deposit_currency','public_discounted_total','total_price','daily_price',
  'conditional_offer_total','conditional_offer_daily','conditional_offer_type',
  'conditional_member_total','conditional_member_daily','reference_price','currency','price_label',
  'price_tier','price_scope','price_verified','conditional_price_verified',
  'parsing_source','source_search_url','captured_at'
];
```

- [ ] **Step 4: Verify CLI behavior and GREEN tests**

```powershell
npm.cmd test
node src/qeeq/run.js --help
node src/qeeq/cli.js --help
```

Expected: all tests PASS; both help commands exit 0 and do not create `output/`.

- [ ] **Step 5: Commit runner and CSV**

```powershell
git add src/qeeq/run.js src/qeeq/cli.js src/qeeq/report.js tests/run-qeeq-tests.js
git commit -m "feat: add QEEQ run and CSV contracts"
```

### Task 7: Merge chunk results deterministically

**Files:**
- Create: `src/qeeq/mergeResults.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: canonical schema version 1 and `writeCsvReport`.
- Produces: `findJsonFiles(inputDir)`, `readJsonPayloads(inputDir)`, `mergePayloads(entries, options)`, `parseMergeArgs(argv)`.

- [ ] **Step 1: Write failing merge tests**

```js
test('merge preserves partial failures and deterministic scenario order', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const merged = mergePayloads([
    { file: 'part-b.json', payload: { schema_version: 1, expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'b', offers: [] }], errors: [{ scenario_key: 'b' }] } },
    { file: 'part-a.json', payload: { schema_version: 1, expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'a', offers: [{ record_type: 'offer', provider_name: 'PUBLIC PROVIDER', price_tier: 'public', price_verified: true, total_price: 119 }] }], errors: [] } }
  ], { expectedScenarioKeys: ['a', 'b'] });
  assert.deepEqual(merged.scenarios.map(item => item.key), ['a', 'b']);
  assert.equal(merged.run_status, 'partial');
  assert.equal(merged.quality_status, 'warning');
});

test('merge rejects duplicate scenario keys', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const duplicate = { schema_version: 1, scenarios: [{ key: 'a', offers: [] }], errors: [] };
  assert.throws(() => mergePayloads([{ file: 'one.json', payload: duplicate }, { file: 'two.json', payload: duplicate }]), /Duplicate scenario key: a/);
});

test('merge fails incompatible schema versions', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  assert.throws(() => mergePayloads([{ file: 'old.json', payload: { schema_version: 2, scenarios: [] } }]), /Unsupported schema_version 2/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `mergeResults.js` is missing.

- [ ] **Step 3: Implement deterministic merge and CLI output**

Sort input filenames and scenario keys lexically. Recompute expected/completed/failed counts, verified public offer count, `run_status`, and `quality_status`. If `expectedScenarioKeys` includes a missing key, add error code `missing_chunk_scenario` and make `run_status: partial` or `failure` depending on whether any usable scenario remains.

The CLI writes both `--output-json` and `--output-csv`; either write failure exits 1. Use atomic JSON output.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: merge tests PASS, including duplicate and schema rejection.

- [ ] **Step 5: Commit merge support**

```powershell
git add src/qeeq/mergeResults.js tests/run-qeeq-tests.js
git commit -m "feat: merge QEEQ result chunks"
```

### Task 8: Generate a safe self-contained HTML report

**Files:**
- Create: `src/qeeq/reportHtml.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: canonical merged JSON.
- Produces: `escapeHtml(value)`, `buildHtmlReport(payload)`, `writeHtmlReport(payload, outputPath)`, `generateReportFromFile(inputPath, outputPath)`.

- [ ] **Step 1: Write failing HTML report tests**

```js
test('HTML ranks verified public prices and separates conditional prices', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const html = buildHtmlReport({
    run_status: 'success', quality_status: 'pass',
    scenarios: [{ key: 'ktw', offers: [
      { provider_name: 'PUBLIC PROVIDER', vehicle_name: 'Test public', total_price: 119, daily_price: 59.5, currency: 'PLN', price_tier: 'public', price_verified: true, source_search_url: 'https://www.qeeq.pl/car/search' },
      { provider_name: 'CARWIZ', vehicle_name: 'Skoda Fabia', total_price: null, conditional_offer_total: 106, conditional_offer_type: 'newcomer_coupon', conditional_member_total: 98, currency: 'PLN', price_tier: 'conditional', price_verified: false, conditional_price_verified: true, source_search_url: 'https://www.qeeq.pl/car/search' },
      { provider_name: 'MEMBER', vehicle_name: 'Test', total_price: 90, currency: 'PLN', price_tier: 'diamond', price_verified: true }
    ] }]
  });
  assert.match(html, /Top 3 zweryfikowanych cen publicznych/);
  assert.match(html, /CARWIZ/);
  assert.match(html, /newcomer_coupon.*106/s);
  assert.match(html, /Cena Diamentowa.*98/s);
  const top3 = html.match(/<section id="top3">([\s\S]*?)<\/section>/)[1];
  assert.match(top3, /PUBLIC PROVIDER.*119/s);
  assert.doesNotMatch(top3, /CARWIZ|106|MEMBER|90/);
});

test('HTML escapes provider and vehicle text', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const html = buildHtmlReport({ run_status: 'partial', quality_status: 'warning', scenarios: [{ key: 'x', offers: [{ provider_name: '<script>alert(1)</script>', vehicle_name: '<b>x</b>', total_price: 10, currency: 'PLN', price_tier: 'public', price_verified: true }] }] });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `reportHtml.js` is missing.

- [ ] **Step 3: Implement the report**

Generate one HTML file with inline CSS and JavaScript only. Include status banner, expected/completed counts, quality warnings, filters for airport/date/duration/transmission/provider/status, verified public Top 3, full details, conditional-price columns, and stable source path. Never embed diagnostic text without `escapeHtml`.

Partial or warning reports must display an always-visible banner before any Top 3 table.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: HTML tests PASS and no raw `<script>` from data appears.

- [ ] **Step 5: Commit HTML reporting**

```powershell
git add src/qeeq/reportHtml.js tests/run-qeeq-tests.js
git commit -m "feat: add QEEQ HTML report"
```

### Task 9: Generate the seven-sheet XLSX report

**Files:**
- Create: `src/qeeq/reportXlsx.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: canonical merged JSON and ExcelJS.
- Produces: `buildDetailRows(payload)`, `buildWorkbook(payload)`, `generateWorkbookFromFile(inputPath, outputPath)`.

- [ ] **Step 1: Write failing workbook tests**

```js
test('XLSX contains seven required sheets and verified price fields', async () => {
  const { buildWorkbook } = require('../src/qeeq/reportXlsx');
  const workbook = await buildWorkbook({ run_status: 'success', quality_status: 'pass', scenarios: [{ key: 'ktw', offers: [
    { provider_name: 'PUBLIC PROVIDER', vehicle_name: 'Test public', airport_key: 'katowice-pyrzowice', rental_days: 2, total_price: 119, daily_price: 59.5, currency: 'PLN', price_tier: 'public', price_verified: true },
    { provider_name: 'CARWIZ', vehicle_name: 'Skoda Fabia', airport_key: 'katowice-pyrzowice', rental_days: 2, conditional_offer_total: 106, conditional_offer_type: 'newcomer_coupon', conditional_member_total: 98, currency: 'PLN', price_tier: 'conditional', price_verified: false, conditional_price_verified: true }
  ] }] });
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Overview','Top 3','By airport','By duration','Providers','Details','Data quality']);
  const details = workbook.getWorksheet('Details');
  assert.equal(details.getRow(1).values.includes('Public total'), true);
  assert.equal(details.getRow(1).values.includes('Conditional offer total'), true);
  assert.equal(details.getRow(1).values.includes('Diamond/member total'), true);
  const top3 = workbook.getWorksheet('Top 3');
  assert.equal(top3.getSheetValues().flat(2).includes('CARWIZ'), false);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `reportXlsx.js` is missing.

- [ ] **Step 3: Implement workbook generation**

Use ExcelJS only. Freeze header rows, enable filters, use numeric cells for prices/ratings/deposits, format PLN values as `#,##0.00 "PLN"`, and add red/yellow/green quality formatting. `Top 3` uses only verified public offers. `Data quality` contains each warning/error code, count, and affected scenario keys.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: workbook test PASS and the in-memory workbook has exactly seven sheets.

- [ ] **Step 5: Commit XLSX reporting**

```powershell
git add src/qeeq/reportXlsx.js tests/run-qeeq-tests.js
git commit -m "feat: add QEEQ XLSX report"
```

### Task 10: Build pure Telegram summaries

**Files:**
- Create: `src/qeeq/telegramSummary.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: canonical payload plus optional `reportUrl`, `artifactUrl`, and `runUrl`.
- Produces: `buildFinalSummary(payload, options)`, `buildPlanFailureSummary(error, options)`, `parseSummaryArgs(argv)`.

- [ ] **Step 1: Write failing summary tests**

```js
test('Telegram summary includes both statuses and fallback links', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const text = buildFinalSummary({ run_status: 'partial', quality_status: 'warning', expected_checks: 9, completed_checks: 8, failed_checks: 1, quality: { verified_public_offer_count: 7, unverified_offer_count: 2 } }, { artifactUrl: 'https://github.com/example/actions/runs/1', runUrl: 'https://github.com/example/actions/runs/1' });
  assert.match(text, /Run: partial/);
  assert.match(text, /Jakość: warning/);
  assert.match(text, /8\/9/);
  assert.match(text, /Artefakt/);
});

test('plan failure summary is available without scrape output', () => {
  const { buildPlanFailureSummary } = require('../src/qeeq/telegramSummary');
  const text = buildPlanFailureSummary(new Error('invalid matrix'), { runUrl: 'https://github.com/example/actions/runs/2' });
  assert.match(text, /QEEQ plan failure/);
  assert.match(text, /invalid matrix/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `telegramSummary.js` is missing.

- [ ] **Step 3: Implement pure message builders and CLI output**

Do not call Telegram from Node. The CLI prints one message to stdout so GitHub Actions can send it. Escape or remove control characters; limit error text to 300 characters. Prefer Pages URL, otherwise artifact URL, then run URL.

- [ ] **Step 4: Run tests and verify GREEN**

Run `npm.cmd test`.

Expected: summary tests PASS without network access.

- [ ] **Step 5: Commit Telegram formatting**

```powershell
git add src/qeeq/telegramSummary.js tests/run-qeeq-tests.js
git commit -m "feat: add QEEQ Telegram summaries"
```

### Task 11: Add gated smoke and daily GitHub Actions workflows

**Files:**
- Create: `src/qeeq/workflowPlan.js`
- Create: `.github/workflows/qeeq-smoke.yml`
- Create: `.github/workflows/qeeq-daily.yml`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes package scripts and canonical outputs from Tasks 6–10.
- Produces: `buildWorkflowPlan(input)`, `partitionDates(dates, datesPerChunk)`, `validateRunGates(input, scenarioCount)` plus a CLI that writes JSON and optional GitHub outputs.
- Produces smoke artifacts, chunk artifacts, merged artifacts, optional Pages, and Telegram API calls from workflow secrets.

- [ ] **Step 1: Write failing static workflow contract tests**

```js
test('smoke is KTW two-day and has no Pages or Telegram', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-smoke.yml', 'utf8');
  assert.match(yaml, /Katowice/);
  assert.match(yaml, /durations-days=2/);
  assert.match(yaml, /npm\.cmd test|npm test/);
  assert.match(yaml, /Europe\/Warsaw/);
  assert.match(yaml, /retention-days:\s*7/);
  assert.doesNotMatch(yaml, /deploy-pages|TELEGRAM_BOT_TOKEN/);
});

test('daily is gated and preserves requested scheduled defaults', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  assert.match(yaml, /QEEQ_FULL_SCHEDULE_ENABLED/);
  assert.match(yaml, /QEEQ_BENCHMARK_STAGE/);
  assert.match(yaml, /QEEQ_P95_SCENARIO_SECONDS/);
  assert.match(yaml, /QEEQ_MAX_BROWSER_MINUTES/);
  assert.match(yaml, /SCHEDULE_ROLLING_DAYS: "60"/);
  assert.match(yaml, /SCHEDULE_DURATIONS: "2,3,4,5,6,7,8,9,10,11,12,13,14"/);
  assert.match(yaml, /notify-plan-failure:/);
  assert.match(yaml, /max-parallel:/);
  assert.doesNotMatch(yaml, /max-parallel:\s*2(?:\s|$)/);
  assert.match(yaml, /256/);
  assert.match(yaml, /QEEQ_PAGES_ENABLED/);
  assert.match(yaml, /Europe\/Warsaw/);
  assert.match(yaml, /set \+e/);
  assert.match(yaml, /final-status:/);
  assert.match(yaml, /qeeq-results-/);
  assert.match(yaml, /output\/qeeq-results\.csv/);
  assert.match(yaml, /retention-days:\s*7/);
  assert.match(yaml, /retention-days:\s*30/);
  assert.match(yaml, /pages:\s*write/);
  assert.match(yaml, /id-token:\s*write/);
  assert.match(yaml, /actions\/configure-pages/);
  assert.match(yaml, /actions\/upload-pages-artifact/);
  assert.match(yaml, /actions\/deploy-pages/);
  assert.match(yaml, /environment:[\s\S]*github-pages/);
  for (const file of ['qeeq-results-latest.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx']) assert.match(yaml, new RegExp(file.replaceAll('.', '\\.')));
});

test('manual daily dispatch defaults to one bounded KTW two-day run', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  assert.match(yaml, /workflow_dispatch:[\s\S]*locations:[\s\S]*default:\s*Katowice/);
  assert.match(yaml, /rolling_days:[\s\S]*default:\s*["']?1["']?/);
  assert.match(yaml, /durations_days:[\s\S]*default:\s*["']?2["']?/);
  assert.match(yaml, /max_parallel:[\s\S]*default:\s*["']?1["']?/);
  assert.match(yaml, /acknowledge_expanded_run:[\s\S]*default:\s*false/);
  assert.match(yaml, /plan_only:[\s\S]*default:\s*false/);
});

test('workflow planner partitions every full-run date into at most 256 chunks', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const plan = buildWorkflowPlan({
    eventName: 'schedule', timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14],
    fullEnabled: true, benchmarkStage: 4, p50ScenarioSeconds: 15, p95ScenarioSeconds: 25,
    maxParallel: 3, targetChunkMinutes: 60, maxBrowserMinutes: 3000,
    now: new Date('2026-08-20T10:00:00+02:00')
  });
  assert.equal(plan.scenario_count, 7020);
  assert.ok(plan.matrix.include.length <= 256);
  const dates = plan.matrix.include.flatMap(chunk => chunk.start_dates.split(','));
  assert.equal(dates.length, 60);
  assert.equal(new Set(dates).size, 60);
  assert.equal(plan.max_parallel, 3);
  assert.ok(plan.chunk_timeout_minutes > 0);
  assert.equal(plan.matrix.include[0].start_dates.split(',')[0], '2026-08-21');
});

test('stage three can produce a full plan-only estimate without enabling production', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const plan = buildWorkflowPlan({ eventName: 'workflow_dispatch', planOnly: true, acknowledgeExpandedRun: true, timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60, durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], fullEnabled: false, benchmarkStage: 3, p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, maxParallel: 3, targetChunkMinutes: 60, maxBrowserMinutes: 100, now: new Date('2026-08-20T10:00:00+02:00') });
  assert.equal(plan.plan_only, true);
  assert.equal(plan.should_run, false);
  assert.equal(plan.scenario_count, 7020);
  assert.equal(plan.budget_ok, false);
  assert.ok(plan.estimated_browser_minutes > 100);
});

test('workflow planner cannot bypass full-run gate and browser-minute budget', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const full = { eventName: 'workflow_dispatch', planOnly: false, timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60, durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], benchmarkStage: 4, p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, maxParallel: 3, targetChunkMinutes: 60, maxBrowserMinutes: 3000, acknowledgeExpandedRun: true, now: new Date('2026-08-20T10:00:00+02:00') };
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: false }), /QEEQ_FULL_SCHEDULE_ENABLED=true/);
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: true, maxBrowserMinutes: 100 }), /browser-minute budget/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL with missing `workflowPlan.js` and workflow files.

- [ ] **Step 3: Implement `qeeq-smoke.yml`**

Use `push` path filters for QEEQ source/config/tests/workflow plus `workflow_dispatch`. Use Node 20, `npm ci`, `npx playwright install --with-deps chromium`, `npm test`, and a pickup date computed as tomorrow in `Europe/Warsaw` with duration 2. Generate JSON/CSV/HTML. Run the scrape under `set +e`, write its exact exit code to a step output and `exit-code.txt`, and use `if: always()` for artifact upload before a final status step returns that code. Upload JSON, CSV, HTML, logs, screenshots, sanitized DOM diagnostics, and error envelopes with `retention-days: 7`. Do not include Pages or Telegram.

The real scrape command is:

```bash
node src/qeeq/run.js --config=qeeq.config.example.json --locations=Katowice --rolling-days=1 --durations-days=2 --save=output/qeeq-smoke.json
```

- [ ] **Step 4: Implement `qeeq-daily.yml` with explicit gates**

Implement the pure planner first and make its new tests pass. The workflow plan job invokes `qeeq:plan` and copies only the validated JSON fields to `$GITHUB_OUTPUT`; date expansion, gates, budget calculation, and chunking must not be duplicated as ad-hoc YAML shell logic.

Jobs and required dependencies:

```yaml
jobs:
  plan:
    outputs:
      should_run: ${{ steps.plan.outputs.should_run }}
      matrix: ${{ steps.plan.outputs.matrix }}
      max_parallel: ${{ steps.plan.outputs.max_parallel }}
      chunk_timeout_minutes: ${{ steps.plan.outputs.chunk_timeout_minutes }}
  notify-plan-failure:
    if: ${{ always() && needs.plan.result == 'failure' }}
    needs: plan
  scrape:
    if: ${{ needs.plan.result == 'success' && needs.plan.outputs.should_run == 'true' }}
    needs: plan
    strategy:
      fail-fast: false
      max-parallel: ${{ fromJSON(needs.plan.outputs.max_parallel) }}
      matrix: ${{ fromJson(needs.plan.outputs.matrix) }}
    timeout-minutes: ${{ fromJSON(needs.plan.outputs.chunk_timeout_minutes) }}
  merge:
    if: ${{ always() && needs.plan.result == 'success' && needs.plan.outputs.should_run == 'true' }}
    needs: [plan, scrape]
  pages:
    if: ${{ always() && needs.merge.result == 'success' && needs.merge.outputs.report_ready == 'true' && vars.QEEQ_PAGES_ENABLED == 'true' }}
    needs: merge
  notify:
    if: ${{ always() && needs.plan.outputs.should_run == 'true' }}
    needs: [plan, scrape, merge, pages]
  final-status:
    if: ${{ always() }}
    needs: [plan, scrape, merge, pages, notify]
```

Define explicit `workflow_dispatch` inputs with safe defaults: `locations=Katowice`, `rolling_days=1`, `durations_days=2`, `max_parallel=1`, `acknowledge_expanded_run=false`, and `plan_only=false`. The planner classifies any manual request above nine scenarios as expanded and refuses it unless `acknowledge_expanded_run=true`.

`plan_only=true` is the sole non-executing exception for stage 4: it may calculate the full 7,020-scenario estimate when `QEEQ_BENCHMARK_STAGE=3` and measured p50/p95 inputs exist, but it always emits `should_run=false`, starts no scrape/merge/Pages/Telegram job, and reports whether the proposed browser-minute budget is sufficient. After that estimate is reviewed, repository state may advance to stage 4. Any request that would actually execute all 7,020 scenarios requires both `QEEQ_FULL_SCHEDULE_ENABLED=true` and `QEEQ_BENCHMARK_STAGE=4`, regardless of event type, so manual inputs cannot bypass the production gate.

Scheduled runs also require `QEEQ_FULL_SCHEDULE_ENABLED=true`, `QEEQ_BENCHMARK_STAGE=4`, and positive numeric repository variables `QEEQ_P50_SCENARIO_SECONDS`, `QEEQ_P95_SCENARIO_SECONDS`, `QEEQ_MAX_PARALLEL`, `QEEQ_TARGET_CHUNK_MINUTES`, and `QEEQ_MAX_BROWSER_MINUTES`. Values are written only after stages 2–4 have produced timing evidence. The planner computes `estimated_browser_minutes = scenario_count * p95_seconds / 60` and refuses an estimate above the configured browser-minute budget.

Partition by consecutive pickup-date slices, not by individual scenarios. Each matrix item carries `chunk_id` plus a comma-separated date list; locations and durations are processed within the chunk. Derive `dates_per_chunk` from measured p95, scenarios per date, and `QEEQ_TARGET_CHUNK_MINUTES`, then derive `chunk_timeout_minutes` from the same p95 estimate with a 50% safety margin and a fixed setup allowance. Refuse more than 256 matrix entries. For the safe manual default only, use one chunk, `max_parallel=1`, and a conservative single-scenario timeout; expanded and scheduled runs take `max_parallel` from the measured repository variable rather than a hard-coded value.

All date expansion uses `Europe/Warsaw`. The plan step still enforces the 7,020 scenario cap and prints scenario count, matrix entry count, median/p95 estimate, estimated browser-minutes, selected parallelism, derived timeout, plan-only state, and budget result. A disabled schedule or successful plan-only estimate emits `should_run=false` and a clear summary, not a failure.

Each chunk runs the scraper under `set +e`, stores the numeric code in both a step output and its envelope, and uploads result JSON/errors/logs/sanitized artifacts with `if: always()` and `retention-days: 7`. It does not discard code `2` or `1`. Merge always downloads every available chunk, treats a missing artifact as a missing scenario, recalculates the statuses, runs `qeeq:merge`, `qeeq:report`, `qeeq:xlsx`, then `qeeq:aux` so `quality-summary.json` and `run-manifest.json` describe the final files. Merge/report generation also captures its exit code without blocking uploads.

The merged artifact uses `retention-days: 30` and contains JSON, CSV, HTML, XLSX, quality summary, and run manifest. Declare workflow permissions `contents: read`, `pages: write`, and `id-token: write`. When `QEEQ_PAGES_ENABLED=true`, the Pages job uses `actions/configure-pages`, stages `index.html` plus downloadable JSON/CSV/XLSX, uploads with `actions/upload-pages-artifact`, runs in the protected `github-pages` environment, and deploys with `actions/deploy-pages`; otherwise the job is intentionally skipped. Telegram uses only `secrets.TELEGRAM_BOT_TOKEN` and `secrets.TELEGRAM_CHAT_ID` and has an artifact fallback link. The final-status job runs after uploads/Pages/notification and returns the merged status code (`0`, `2`, or `1`), or `1` for plan/infrastructure failure, so diagnostics are retained before the workflow becomes warning/failure.

- [ ] **Step 5: Run tests and commit workflows**

```powershell
npm.cmd test
git add src/qeeq/workflowPlan.js .github/workflows/qeeq-smoke.yml .github/workflows/qeeq-daily.yml tests/run-qeeq-tests.js
git commit -m "ci: add gated QEEQ workflows"
```

Expected: all workflow contract tests PASS.

### Task 12: Document usage, execute the bounded two-day smoke, and verify the complete local story

**Files:**
- Create: `README.md`
- Modify only if a smoke exposes a tested bug: the directly affected source and its regression test.

**Interfaces:**
- Documents every package script, config field, output, exit code, workflow gate, secret name, and authorization boundary.

- [ ] **Step 1: Write a failing README contract test**

```js
test('README documents safety gate outputs and verification commands', () => {
  const fs = require('node:fs');
  const readme = fs.readFileSync('README.md', 'utf8');
  for (const required of ['QEEQ_FULL_SCHEDULE_ENABLED', 'QEEQ_BENCHMARK_STAGE', 'QEEQ_P95_SCENARIO_SECONDS', 'QEEQ_MAX_BROWSER_MINUTES', 'QEEQ_PAGES_ENABLED', '7020', 'npm.cmd test', 'qeeq-location-validation.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx', 'quality-summary.json', 'run-manifest.json', 'newcomer_coupon', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    assert.match(readme, new RegExp(required.replace('.', '\\.')));
  }
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `npm.cmd test`.

Expected: FAIL because `README.md` is missing.

- [ ] **Step 3: Write the README and verify GREEN**

Document Windows setup, `npm.cmd` commands, safe example config, output schema, public versus newcomer-coupon/Diamond price semantics, exact `(id,bid)` provider matching and non-persistence of `clid`, the all-nine live location-validation command/output, 60 × 2–14 schedule, 7,020 hard cap, four-stage enablement, plan-only estimate, all benchmark/budget repository variables, safe dispatch defaults, Pages/artifact fallback, GitHub secrets, exit codes 0/2/1, and the explicit no-push/no-send boundary.

Run `npm.cmd test` and expect all offline tests PASS.

- [ ] **Step 4: Run the bounded real-browser smoke**

Install the browser if needed, first validate all nine catalog airports against current visible autocomplete without submitting searches, then compute a fresh start date and run only KTW for two days:

```powershell
npx.cmd playwright install chromium
node src/qeeq/validateLocations.js --config=qeeq.config.example.json --output=output/qeeq-location-validation.json
node -e "const p=require('./output/qeeq-location-validation.json'); if(p.validation_status!=='pass'||p.expected_airports!==9||p.validated_airports!==9||new Set(p.airports.map(x=>x.iata)).size!==9) process.exit(1); console.log({validation_status:p.validation_status,validated_airports:p.validated_airports});"
$pickupDate = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
node src/qeeq/run.js --config=qeeq.config.example.json --locations=Katowice --start-dates=$pickupDate --durations-days=2 --save=output/qeeq-smoke.json
node src/qeeq/reportHtml.js output/qeeq-smoke.json output/qeeq-smoke.html
node src/qeeq/reportXlsx.js output/qeeq-smoke.json output/qeeq-smoke.xlsx
```

Verify with a read-only Node command:

```powershell
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('output/qeeq-smoke.json','utf8')); const offers=p.scenarios.flatMap(s=>s.offers||[]); if(p.run_status!=='success'||p.quality_status!=='pass'||!offers.some(o=>o.provider_name&&o.price_verified&&o.price_tier==='public'&&o.currency==='PLN')) process.exit(1); console.log({run_status:p.run_status,quality_status:p.quality_status,offers:offers.length});"
```

Expected: the location validation exits 0 with nine unique current matches. The smoke then exits 0 with `run_status: success`, `quality_status: pass`, and at least one provider-package offer with provider name and verified public PLN total. A live ID drift may produce a documented warning while still using current IDs, but any missing/ambiguous identity is a blocker.

If the smoke exposes a bug, write a failing regression test that reproduces the exact fixture/state, run it to verify RED, implement the minimal fix, run it to verify GREEN, and commit that fix separately before repeating the smoke.

- [ ] **Step 5: Run final verification and commit documentation**

```powershell
npm.cmd test
node src/qeeq/run.js --help
node src/qeeq/cli.js --help
node src/qeeq/validateLocations.js --help
git diff --check
git status --short --branch
git add README.md tests/run-qeeq-tests.js
git commit -m "docs: document QEEQ scraper operations"
git status --short --branch
```

Expected: offline tests PASS, help commands exit 0, diff check is clean, the smoke evidence is recorded in the handoff, and the repository is clean after the documentation commit.
