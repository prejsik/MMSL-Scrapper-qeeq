# QEEQ Market Pricing and Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add distinct-provider Top 3, a dedicated MM Cars Rental market view and availability alert, QEEQ-specific pricing recommendations, and a calibration-gated import-ready Excel generator.

**Architecture:** Canonical QEEQ offers remain the only stored source of truth. A pure shared market-view module derives provider ranking and MM facts for HTML, XLSX, Telegram, and pricing; a second pure module proves date-level MM coverage; pricing decisions consume those views and only produce import rates through an explicitly approved QEEQ calibration. The Excel updater receives an explicit baseline path, writes a new one-sheet workbook atomically, and never mutates the baseline.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, Playwright, ExcelJS 4.4, GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-08-21-qeeq-market-pricing-import-design.md`

## Global Constraints

- Use only offers accepted by `isVerifiedPublicOffer` for provider ranking, MM public price, alerts, and pricing recommendations.
- Keep QEEQ separate from DiscoverCars; do not import files or runtime state from the sibling repository.
- Never assume or copy a DiscoverCars markup multiplier; import rates require `approved: true` in a QEEQ calibration file.
- Keep Warsaw Modlin unmapped until an explicit tariff zone is supplied.
- Do not commit a tariff baseline or generated workbook.
- Do not push, dispatch Actions, enable Pages, or send Telegram during implementation.
- Write every production behavior test first and observe the intended RED failure before implementation.
- Modify only `qeeq-tool` files and preserve the existing canonical QEEQ offer schema.

---

### Task 1: Shared distinct-provider market view

**Files:**
- Create: `src/qeeq/marketView.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: `isVerifiedPublicOffer(offer)` from `src/qeeq/utils.js`.
- Produces: `normalizeProviderName(value)`, `isMmCarsProvider(value)`, `rankVerifiedProviders(offers)`, and `buildScenarioMarketView(scenario)`.

- [ ] **Step 1: Add failing market-view tests**

Append focused tests with literal expectations:

```js
test('market view ranks the cheapest verified offer from each distinct provider', () => {
  const { rankVerifiedProviders, buildScenarioMarketView } = require('../src/qeeq/marketView');
  const offer = (provider_name, total_price, vehicle_name) => ({
    record_type: 'offer', provider_name, total_price, daily_price: total_price / 2,
    vehicle_name, currency: 'PLN', price_tier: 'public', price_verified: true
  });
  const offers = [
    offer('Ace', 169, 'Fiesta'), offer(' ACE ', 171, 'Golf'), offer('Alamo', 180, 'Corsa'),
    offer('Europcar', 190, 'Focus'), { ...offer('Hidden', 1, 'Bad'), price_verified: false }
  ];
  assert.deepEqual(rankVerifiedProviders(offers).map(item => item.provider_name), ['Ace', 'Alamo', 'Europcar']);
  assert.deepEqual(buildScenarioMarketView({ offers }).top_3_providers.map(item => item.total_price), [169, 180, 190]);
});

test('market view recognizes QEEQ MM aliases and ranks MM outside Top 3', () => {
  const { isMmCarsProvider, buildScenarioMarketView } = require('../src/qeeq/marketView');
  assert.equal(isMmCarsProvider('Mm car rental'), true);
  assert.equal(isMmCarsProvider('MM Cars Rental'), true);
  assert.equal(isMmCarsProvider('MM Service Lease Polska'), true);
  const offers = ['Ace', 'Alamo', 'Europcar', 'Mm car rental'].map((provider_name, index) => ({
    record_type: 'offer', provider_name, total_price: 100 + index * 10, daily_price: 50 + index * 5,
    vehicle_name: provider_name, currency: 'PLN', price_tier: 'public', price_verified: true
  }));
  const view = buildScenarioMarketView({ offers });
  assert.equal(view.mm_provider_rank, 4);
  assert.equal(view.cheaper_provider_count, 3);
  assert.equal(view.mm_cars_rental.provider_name, 'Mm car rental');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="market view" tests/run-qeeq-tests.js
```

Expected: failure because `../src/qeeq/marketView` does not exist.

- [ ] **Step 3: Implement the minimal pure market view**

Create `src/qeeq/marketView.js` with deterministic normalization and tie breaking:

```js
const { isVerifiedPublicOffer } = require('./utils');

function normalizeProviderName(value) {
  return String(value || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

const MM_ALIASES = new Set(['mm cars rental', 'mm car rental', 'mm service lease polska']);

function isMmCarsProvider(value) {
  return MM_ALIASES.has(normalizeProviderName(value));
}

function compareOffers(left, right) {
  return left.total_price - right.total_price
    || normalizeProviderName(left.provider_name).localeCompare(normalizeProviderName(right.provider_name), 'en')
    || String(left.vehicle_name || '').localeCompare(String(right.vehicle_name || ''), 'en');
}

function rankVerifiedProviders(offers) {
  const cheapest = new Map();
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!isVerifiedPublicOffer(offer)) continue;
    const key = normalizeProviderName(offer.provider_name);
    const current = cheapest.get(key);
    if (!current || compareOffers(offer, current) < 0) cheapest.set(key, offer);
  }
  return [...cheapest.values()].sort(compareOffers);
}

function buildScenarioMarketView(scenario = {}) {
  const rankedProviders = rankVerifiedProviders(scenario.offers);
  const mmIndex = rankedProviders.findIndex(offer => isMmCarsProvider(offer.provider_name));
  return {
    ranked_providers: rankedProviders,
    top_3_providers: rankedProviders.slice(0, 3),
    mm_cars_rental: mmIndex >= 0 ? rankedProviders[mmIndex] : null,
    mm_provider_rank: mmIndex >= 0 ? mmIndex + 1 : null,
    cheaper_provider_count: mmIndex >= 0 ? mmIndex : null,
    verified_provider_count: rankedProviders.length
  };
}

module.exports = { normalizeProviderName, isMmCarsProvider, rankVerifiedProviders, buildScenarioMarketView };
```

- [ ] **Step 4: Run targeted and full tests**

Run:

```powershell
node --test --test-name-pattern="market view" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit the market view**

```powershell
git add -- src/qeeq/marketView.js tests/run-qeeq-tests.js
git commit -m "feat: rank distinct QEEQ providers"
```

---

### Task 2: Date-level MM availability proof

**Files:**
- Create: `src/qeeq/mmAvailability.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: canonical root `options` and `scenarios`; `buildScenarioMarketView`.
- Produces: `classifyMmAvailability(payload)` and `buildMmAvailabilityAlert(payload)`.

- [ ] **Step 1: Add failing availability tests**

Add one controlled payload with three dates: MM present, complete competitors-only, and incomplete:

```js
test('MM availability separates present confirmed missing and incomplete dates', () => {
  const { classifyMmAvailability, buildMmAvailabilityAlert } = require('../src/qeeq/mmAvailability');
  const publicOffer = provider_name => ({ record_type: 'offer', provider_name, total_price: 200,
    daily_price: 100, currency: 'PLN', price_tier: 'public', price_verified: true });
  const scenario = (date, airport_key, rental_days, status, offers) => ({
    key: `${airport_key}|${date}|${rental_days}`, airport_key, rental_days, status,
    pickup_at: `${date}T10:00:00`, offers
  });
  const payload = {
    options: { start_dates: ['2026-09-01', '2026-09-02', '2026-09-03'], airport_keys: ['ktw', 'krk'], durations_days: [2] },
    scenarios: [
      scenario('2026-09-01', 'ktw', 2, 'success', [publicOffer('MM Car Rental')]),
      scenario('2026-09-01', 'krk', 2, 'failure', []),
      scenario('2026-09-02', 'ktw', 2, 'success', [publicOffer('Ace')]),
      scenario('2026-09-02', 'krk', 2, 'success', [publicOffer('Alamo')]),
      scenario('2026-09-03', 'ktw', 2, 'success', [publicOffer('Ace')])
    ]
  };
  const result = classifyMmAvailability(payload);
  assert.deepEqual(result.dates.map(item => [item.pickup_date, item.status]), [
    ['2026-09-01', 'present'], ['2026-09-02', 'confirmed_missing'], ['2026-09-03', 'incomplete']
  ]);
  assert.match(buildMmAvailabilityAlert(payload), /Brak MM - pelne dane\n- 2026-09-02/);
  assert.match(buildMmAvailabilityAlert(payload), /Nie mozna potwierdzic - niepelne dane\n- 2026-09-03/);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="MM availability" tests/run-qeeq-tests.js
```

Expected: module-not-found failure for `mmAvailability.js`.

- [ ] **Step 3: Implement exact matrix classification**

Implement `classifyMmAvailability` so it:

```js
const { buildScenarioMarketView } = require('./marketView');

function classifyMmAvailability(payload = {}) {
  const options = payload && typeof payload === 'object' ? payload.options || {} : {};
  const scenarios = Array.isArray(payload?.scenarios) ? payload.scenarios : [];
  const dates = [...new Set(Array.isArray(options.start_dates) ? options.start_dates.filter(Boolean) : [])].sort();
  const airports = [...new Set(Array.isArray(options.airport_keys) ? options.airport_keys.filter(Boolean) : [])].sort();
  const durations = [...new Set(Array.isArray(options.durations_days) ? options.durations_days.filter(Number.isInteger) : [])].sort((a, b) => a - b);
  const rows = dates.map(pickupDate => {
    const expected = airports.flatMap(airportKey => durations.map(rentalDays => ({ airportKey, rentalDays })));
    const matches = scenarios.filter(item => String(item?.pickup_at || '').slice(0, 10) === pickupDate);
    const anyMm = matches.some(item => buildScenarioMarketView(item).mm_cars_rental !== null);
    let completed = 0;
    let failed = 0;
    for (const item of expected) {
      const found = matches.filter(scenario => scenario?.airport_key === item.airportKey && scenario?.rental_days === item.rentalDays);
      const usable = found.length === 1 && found[0].status === 'success'
        && buildScenarioMarketView(found[0]).verified_provider_count > 0;
      if (usable) completed += 1;
      else failed += 1;
    }
    const status = anyMm ? 'present' : failed === 0 && expected.length > 0 ? 'confirmed_missing' : 'incomplete';
    return { pickup_date: pickupDate, status, expected_checks: expected.length, completed_checks: completed, failed_checks: failed };
  });
  return {
    dates: rows,
    confirmed_missing_dates: rows.filter(item => item.status === 'confirmed_missing').map(item => item.pickup_date),
    incomplete_dates: rows.filter(item => item.status === 'incomplete').map(item => item.pickup_date)
  };
}
```

Add `buildMmAvailabilityAlert` using only the two exact Polish section labels from the spec, returning an empty string when both lists are empty.

- [ ] **Step 4: Verify targeted and full tests**

```powershell
node --test --test-name-pattern="MM availability" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: exit `0` with all existing merge/status tests unchanged.

- [ ] **Step 5: Commit availability proof**

```powershell
git add -- src/qeeq/mmAvailability.js tests/run-qeeq-tests.js
git commit -m "feat: classify missing MM evidence"
```

---

### Task 3: HTML and XLSX market presentation

**Files:**
- Modify: `src/qeeq/reportHtml.js`
- Modify: `src/qeeq/reportXlsx.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: `buildScenarioMarketView` and `classifyMmAvailability`.
- Produces: HTML Top 3 distinct-provider rows, HTML MM table, and an eighth `MM Cars Rental` workbook sheet.

- [ ] **Step 1: Add failing report tests**

Extend the existing HTML/XLSX fixtures with two Ace vehicles plus Alamo, Europcar, and MM. Assert literal consumer behavior:

```js
test('HTML and XLSX use distinct-provider Top 3 and expose MM rank separately', async () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const { buildWorkbook } = require('../src/qeeq/reportXlsx');
  const payload = marketReportFixture();
  const html = buildHtmlReport(payload);
  assert.equal((html.match(/data-top-provider="Ace"/g) || []).length, 1);
  assert.match(html, /MM Cars Rental.*Pozycja.*4/s);
  const workbook = await buildWorkbook(payload);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'Overview', 'Top 3', 'By airport', 'By duration', 'Providers', 'Details', 'MM Cars Rental', 'Data quality'
  ]);
  assert.equal(workbook.getWorksheet('Top 3').getCell('F2').value, 'Ace');
  assert.equal(workbook.getWorksheet('Top 3').getCell('F3').value, 'Alamo');
  assert.equal(workbook.getWorksheet('MM Cars Rental').getCell('F2').value, 4);
});
```

Define `marketReportFixture()` in the test file as a literal canonical payload; do not compute expectations with `marketView`.

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="distinct-provider Top 3" tests/run-qeeq-tests.js
```

Expected: HTML still emits duplicate Ace rows and XLSX lacks the eighth sheet.

- [ ] **Step 3: Replace report-local ranking with the shared view**

In `reportHtml.js`, replace:

```js
rankVerifiedPublicOffers(arrayOf(scenario.offers).filter(isPlainObject)).slice(0, 3)
```

with:

```js
buildScenarioMarketView(scenario).top_3_providers
```

Add stable `data-top-provider` attributes and one MM row per scenario. Build a map from `classifyMmAvailability(root).dates` so the MM row includes `present`, `confirmed_missing`, or `incomplete` for its pickup date.

In `reportXlsx.js`:

- replace `rankVerifiedPublicOffers(...).slice(0, 3)` in `topRows` with the shared view;
- insert `MM Cars Rental` before `Data quality` in `SHEET_NAMES`;
- add `mmRows(root)` returning `Scenario key`, `IATA`, `Pickup at`, `Rental days`, `Availability`, `Provider rank`, `Cheaper providers`, `Provider`, `Vehicle`, `Public total`, `Public daily`, and `Currency`;
- keep price cells numeric and apply `PLN_FORMAT`.

- [ ] **Step 4: Verify report tests and the full suite**

```powershell
node --test --test-name-pattern="HTML|XLSX" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: exit `0`; update existing seven-sheet assertions to the approved eight-sheet contract rather than weakening them.

- [ ] **Step 5: Commit report changes**

```powershell
git add -- src/qeeq/reportHtml.js src/qeeq/reportXlsx.js tests/run-qeeq-tests.js
git commit -m "feat: show QEEQ provider and MM rankings"
```

---

### Task 4: Telegram MM alert integration

**Files:**
- Modify: `src/qeeq/telegramSummary.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Consumes: `buildMmAvailabilityAlert(payload)`.
- Preserves: existing `buildFinalSummary`, `buildPlanFailureSummary`, and CLI mode contracts.

- [ ] **Step 1: Add failing Telegram tests**

```js
test('Telegram final summary labels confirmed missing and incomplete MM evidence separately', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const message = buildFinalSummary(mmAvailabilityFixture(), {});
  assert.match(message, /Brak MM - pelne dane\n- 2026-09-02/);
  assert.match(message, /Nie mozna potwierdzic - niepelne dane\n- 2026-09-03/);
  assert.doesNotMatch(message, /Brak MM - pelne dane\n- 2026-09-03/);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="Telegram final summary labels" tests/run-qeeq-tests.js
```

Expected: the existing summary contains neither MM section.

- [ ] **Step 3: Append the pure MM alert**

Import `buildMmAvailabilityAlert` and append its non-empty result before link lines:

```js
const mmAlert = buildMmAvailabilityAlert(root);
if (mmAlert) lines.push(mmAlert);
return [...lines, ...linkLines(options)].join('\n');
```

Do not change plan-failure mode, URL validation, secret sanitation, or sending behavior.

- [ ] **Step 4: Verify targeted and full tests**

```powershell
node --test --test-name-pattern="Telegram" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: exit `0`.

- [ ] **Step 5: Commit Telegram integration**

```powershell
git add -- src/qeeq/telegramSummary.js tests/run-qeeq-tests.js
git commit -m "feat: alert on missing QEEQ MM coverage"
```

---

### Task 5: Tariff mapping, pricing rules, and calibration-gated recommendations

**Files:**
- Create: `src/qeeq/pricingRecommendations.js`
- Create: `qeeq-pricing-rules.config.example.json`
- Create: `qeeq-rate-calibration.config.example.json`
- Modify: `src/qeeq/locations.json`
- Modify: `src/qeeq/locations.js`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Produces: `DEFAULT_PRICING_RULES`, `resolveApprovedMultiplier(calibration, airportKey, rentalDays)`, `buildPricingRecommendations(payload, options)`, and CLI `main(argv)`.
- Decision fields: `site_action`, `site_target_rate_pln_day`, `import_action`, `suggested_rate_pln_day`, `calibration_status`, `data_quality_status`.

- [ ] **Step 1: Add failing mapping and pricing tests**

Add literal tests covering mappings, one active site recommendation with no import rate, and approved calibration:

```js
test('QEEQ tariff mapping leaves WMI under review and maps the other airports', () => {
  const { locationCatalog } = require('../src/qeeq/locations');
  const byIata = new Map(locationCatalog.flatMap(city => city.airports).map(item => [item.iata, item.tariffZones]));
  assert.deepEqual(byIata.get('WMI'), []);
  assert.deepEqual(byIata.get('KTW'), ['KALO']);
  assert.deepEqual(byIata.get('KRK'), ['KRLO', 'KRTI']);
});

test('pricing emits a site target but no import rate without approved QEEQ calibration', () => {
  const { buildPricingRecommendations } = require('../src/qeeq/pricingRecommendations');
  const result = buildPricingRecommendations(pricingFixtureRankTwo(), { calibration: { approved: false } });
  assert.equal(result.decisions[0].site_action, 'decrease');
  assert.equal(result.decisions[0].site_target_rate_pln_day, 99);
  assert.equal(result.decisions[0].import_action, 'review');
  assert.equal(result.decisions[0].suggested_rate_pln_day, null);
  assert.equal(result.decisions[0].calibration_status, 'unapproved');
});

test('pricing converts an authorized QEEQ site target with the approved multiplier', () => {
  const { buildPricingRecommendations } = require('../src/qeeq/pricingRecommendations');
  const calibration = { approved: true, minMultiplier: 1, maxMultiplier: 1.2,
    airportDurationMultipliers: { 'katowice-pyrzowice|2': 1.1 } };
  const decision = buildPricingRecommendations(pricingFixtureRankTwo(), { calibration }).decisions[0];
  assert.equal(decision.calibration_status, 'approved');
  assert.equal(decision.suggested_rate_pln_day, 90);
  assert.equal(decision.import_action, 'decrease');
});
```

Also test rank 1 increase, outside-Top-3 small decrease, missing MM review, incomplete date review, duration above seven hold, invalid multiplier rejection, and deterministic recommendation order.

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="tariff mapping|pricing" tests/run-qeeq-tests.js
```

Expected: missing `tariffZones` and missing pricing module.

- [ ] **Step 3: Add exact airport tariff zones**

Add the spec table values to `locations.json`. In `locations.js`, validate `tariffZones` as a duplicate-free array of uppercase identifiers and expose them through existing catalog entries. Do not infer aliases for WMI.

- [ ] **Step 4: Add pricing and calibration example configs**

Create the pricing config:

```json
{
  "pricing": {
    "top1GapThresholdPlnDay": 10,
    "top1RaiseBufferPlnDay": 1,
    "top1UndercutThresholdPlnDay": 10,
    "undercutBufferPlnDay": 1,
    "top3SmallDecreaseThresholdPlnDay": 10,
    "minChangePlnDay": 0.5,
    "roundingIncrementPlnDay": 0.01,
    "maxRecommendationRentalDays": 7
  }
}
```

Create a deliberately disabled calibration example:

```json
{
  "approved": false,
  "minMultiplier": 1,
  "maxMultiplier": 1.2,
  "defaultMultiplier": null,
  "airportMultipliers": {},
  "durationMultipliers": {},
  "airportDurationMultipliers": {}
}
```

- [ ] **Step 5: Implement pricing decisions and safe CLI**

Use `buildScenarioMarketView` for all provider facts and `classifyMmAvailability` for date completeness. Implement calibration resolution in this exact order:

```js
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
    throw new Error('QEEQ calibration multiplier is invalid or outside the approved range');
  }
  return { status: 'approved', multiplier, source: selected[0] };
}
```

For each scenario, build one decision. Compute daily rates from verified totals divided by `rental_days`. Apply the threshold rules from the spec, then set `suggested_rate_pln_day = round(siteTarget / multiplier)` only for approved, covered calibrations. Emit all decisions, site recommendations, import recommendations, and literal counts in a stable JSON envelope.

CLI syntax:

```text
node src/qeeq/pricingRecommendations.js <input.json> <output.json> --config=<rules.json> --calibration=<calibration.json>
```

Use regular-file checks, canonical input/output collision checks, temporary output, and atomic rename matching existing report modules.

- [ ] **Step 6: Verify pricing tests and full suite**

```powershell
node --test --test-name-pattern="tariff mapping|pricing|calibration" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: exit `0`.

- [ ] **Step 7: Commit pricing support**

```powershell
git add -- src/qeeq/pricingRecommendations.js src/qeeq/locations.js src/qeeq/locations.json qeeq-pricing-rules.config.example.json qeeq-rate-calibration.config.example.json tests/run-qeeq-tests.js
git commit -m "feat: recommend calibration-gated QEEQ rates"
```

---

### Task 6: Import-ready Excel updater

**Files:**
- Create: `src/qeeq/updateExcelRates.js`
- Create: `qeeq-excel-rate-update.config.example.json`
- Modify: `.gitignore`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Produces: `normalizeDateCell(value)`, `durationColumn(sheet, duration, config)`, `applyRecommendationsToWorkbook(workbook, payload, config)`, and async CLI `main(argv)`.
- Consumes: active `import_recommendations` with approved finite suggested rates.

- [ ] **Step 1: Mark the spreadsheet operation before the first workbook write**

Use the workspace dependency runtime and run exactly once for this task:

```powershell
& 'C:\Users\barte\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\barte\.codex\plugins\cache\openai-primary-runtime\spreadsheets\26.819.11345\skills\spreadsheets\container_tools\mark_artifact_operation_started.mjs' --operation-kind create --expected-output-count 1 --output-format xlsx
```

Expected: exit `0` before any fixture or product code generates a workbook.

- [ ] **Step 2: Add failing Excel updater tests**

Use ExcelJS inside the test to build a synthetic baseline in a temporary directory with:

- `Sheet1` plus an unrelated second sheet;
- duration minimums in `I2:J2` and maximums in `I3:J3`;
- headers in row 4;
- KALO and WALO rows beginning at row 5;
- an excluded `CGAV` row;
- one formula cell, one styled rate cell, column widths, and a merged title range.

Then assert:

```js
test('Excel updater changes only authorized mapped cells and preserves the baseline', async () => {
  const ExcelJS = require('exceljs');
  const { generateImportWorkbook } = require('../src/qeeq/updateExcelRates');
  const fixture = await createSyntheticTariffFixture();
  const before = require('node:fs').readFileSync(fixture.baselinePath);
  const summary = await generateImportWorkbook({
    workbookPath: fixture.baselinePath,
    recommendationsPath: fixture.recommendationsPath,
    configPath: fixture.configPath,
    outputPath: fixture.outputPath,
    summaryPath: fixture.summaryPath
  });
  assert.deepEqual(require('node:fs').readFileSync(fixture.baselinePath), before);
  assert.equal(summary.applied_count, 1);
  assert.equal(summary.review_count, 1);
  const output = new ExcelJS.Workbook();
  await output.xlsx.readFile(fixture.outputPath);
  assert.deepEqual(output.worksheets.map(sheet => sheet.name), ['Sheet1']);
  assert.equal(output.getWorksheet('Sheet1').getCell('I5').value, 90);
  assert.equal(output.getWorksheet('Sheet1').getCell('I6').value, 70);
  assert.equal(output.getWorksheet('Sheet1').getCell('K5').formula, 'I5+J5');
});
```

Add separate tests for source/output collision, unapproved/null recommendations, WMI unmapped review, unmatched zone/date, duration-band selection, excluded groups, atomic rename failure, and formula/style preservation.

- [ ] **Step 3: Verify RED**

```powershell
node --test --test-name-pattern="Excel updater" tests/run-qeeq-tests.js
```

Expected: missing `updateExcelRates.js`.

- [ ] **Step 4: Add the tariff layout config**

Create `qeeq-excel-rate-update.config.example.json` with explicit worksheet and column numbers matching the established tariff:

```json
{
  "worksheet": "Sheet1",
  "headerRow": 4,
  "dataStartRow": 5,
  "durationMinRow": 2,
  "durationMaxRow": 3,
  "columns": { "group": 1, "zone": 4, "pickupStartDate": 7, "rateStart": 9 },
  "excludedGroups": ["CGAV", "FVMD", "SWAV"],
  "groupRateAdjustmentsPlnDay": { "EDMV": 1 },
  "minExcelChangePlnDay": 0.01
}
```

- [ ] **Step 5: Implement preflight, matching, mutation, and atomic output**

Implement these gates before the first output write:

- baseline, recommendations, and config are existing regular files;
- baseline/output and JSON/summary paths are pairwise distinct after canonicalization;
- worksheet and duration headers exist;
- recommendations contain finite positive `suggested_rate_pln_day`, approved calibration status, active import action, mapped tariff zones, ISO pickup date, and positive integer duration;
- duplicate recommendation keys are rejected.

Core cell matching must use:

```js
const matches = recommendation.tariff_zones.includes(String(row.getCell(config.columns.zone).value || '').trim())
  && normalizeDateCell(row.getCell(config.columns.pickupStartDate).value) === recommendation.pickup_date
  && !config.excludedGroups.includes(String(row.getCell(config.columns.group).value || '').trim());
```

Find the duration column whose row-2 minimum and row-3 maximum contain the recommendation duration. Apply the configured group adjustment and skip changes smaller than `minExcelChangePlnDay`. Remove every worksheet except the configured import sheet only after all mutations validate. Write to a unique temporary `.xlsx`, rename atomically, then write the summary JSON atomically.

Expose CLI syntax:

```text
node src/qeeq/updateExcelRates.js --workbook=<baseline.xlsx> --recommendations=<recommendations.json> --config=<layout.json> --output=<import.xlsx> --summary=<summary.json>
```

- [ ] **Step 6: Verify Excel behavior**

```powershell
node --test --test-name-pattern="Excel updater" tests/run-qeeq-tests.js
npm.cmd test
```

Expected: exit `0`; tests prove the baseline hash is unchanged and the output has only `Sheet1`.

- [ ] **Step 7: Ignore local tariff artifacts and commit**

Add explicit ignored paths for local baselines and generated QEEQ import workbooks without broadening unrelated ignore rules.

```powershell
git add -- src/qeeq/updateExcelRates.js qeeq-excel-rate-update.config.example.json .gitignore tests/run-qeeq-tests.js
git commit -m "feat: generate QEEQ import-ready workbook"
```

---

### Task 7: Commands, daily outputs, documentation, and end-to-end verification

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/qeeq-daily.yml`
- Modify: `src/qeeq/report.js`
- Modify: `src/qeeq/telegramSummary.js`
- Modify: `README.md`
- Modify: `tests/run-qeeq-tests.js`

**Interfaces:**
- Adds scripts `qeeq:recommend` and `qeeq:excel`.
- Adds `qeeq-pricing-recommendations.json` to merged artifacts, manifest, and optional Pages downloads.
- Keeps Excel generation local/manual until a baseline and approved calibration are separately supplied.

- [ ] **Step 1: Add failing package/workflow contract tests**

Assert behavior, not loose source fragments:

```js
test('daily merge publishes QEEQ recommendations but never runs the Excel updater', () => {
  const packageJson = require('../package.json');
  const workflow = require('node:fs').readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  assert.equal(packageJson.scripts['qeeq:recommend'],
    'node src/qeeq/pricingRecommendations.js output/qeeq-results-latest.json output/qeeq-pricing-recommendations.json --config=qeeq-pricing-rules.config.example.json --calibration=qeeq-rate-calibration.config.example.json');
  assert.match(workflow, /npm run qeeq:recommend/);
  assert.match(workflow, /output\/qeeq-pricing-recommendations\.json/);
  assert.doesNotMatch(workflow, /qeeq:excel/);
  assert.doesNotMatch(workflow, /qeeq-rates-import-ready\.xlsx/);
});
```

Add a test that `qeeq:aux` includes the recommendation file in the manifest only after it exists, and that smoke workflow still contains no pricing/import, Pages, or Telegram actions.

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="daily merge publishes QEEQ recommendations" tests/run-qeeq-tests.js
```

Expected: missing package script and artifact path.

- [ ] **Step 3: Wire scripts and daily recommendation output**

Add:

```json
"qeeq:recommend": "node src/qeeq/pricingRecommendations.js output/qeeq-results-latest.json output/qeeq-pricing-recommendations.json --config=qeeq-pricing-rules.config.example.json --calibration=qeeq-rate-calibration.config.example.json",
"qeeq:excel": "node src/qeeq/updateExcelRates.js"
```

In the daily merge job, run `npm run qeeq:recommend` after XLSX generation and before `qeeq:aux`. Require the recommendation JSON in `report_ready`, upload it in the merged artifact, copy it into Pages when Pages is separately enabled, and include it in the run manifest file list. Do not invoke the Excel updater in Actions.

Extend Telegram final-summary options with an optional sanitized recommendations payload or counts object, and pass the downloaded recommendation file from the notify job. Keep the message within Telegram limits and preserve existing link priority.

- [ ] **Step 4: Update README commands and safety boundaries**

Document:

- distinct-provider Top 3 and dedicated MM section;
- the two missing-MM evidence labels;
- pricing rule and calibration config behavior;
- exact local recommendation and Excel commands;
- WMI unmapped review status;
- explicit baseline path requirement;
- no workbook upload/commit and no automatic workflow Excel generation.

- [ ] **Step 5: Run the full automated suite**

```powershell
npm.cmd test
```

Expected: all tests pass, zero failures, exit `0`.

- [ ] **Step 6: Generate controlled local outputs**

Use the existing successful bounded canonical JSON for a non-network report smoke:

```powershell
node src/qeeq/reportHtml.js output/github-run-32455312997/output/qeeq-smoke.json output/qeeq-market-report.html
node src/qeeq/reportXlsx.js output/github-run-32455312997/output/qeeq-smoke.json output/qeeq-market-summary.xlsx
node src/qeeq/pricingRecommendations.js output/github-run-32455312997/output/qeeq-smoke.json output/qeeq-pricing-recommendations.json --config=qeeq-pricing-rules.config.example.json --calibration=qeeq-rate-calibration.config.example.json
```

Because the committed calibration is unapproved, verify every `suggested_rate_pln_day` is null and every active site recommendation has `import_action: review`.

- [ ] **Step 7: Generate and verify one synthetic import workbook**

Run the updater only against the test-created synthetic baseline and an approved synthetic calibration fixture. Do not use or copy the real tariff workbook during this verification.

Inspect the resulting workbook with the bundled spreadsheet runtime:

- sheet list contains only `Sheet1`;
- representative changed and excluded cells have expected typed values/formulas;
- formula-error scan finds no `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, or `#N/A` introduced by the updater;
- render `Sheet1!A1:N12` and visually confirm headers, widths, values, and styles are readable.

- [ ] **Step 8: Render and inspect the HTML report**

Use Playwright to capture the complete local HTML report. Confirm Top 3 has unique providers, the MM section is visible, and the status/filter controls still render without clipping.

- [ ] **Step 9: Review the requirements and diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat 1b4ecda..HEAD
git diff 1b4ecda..HEAD -- . ':!package-lock.json'
```

Check every success criterion in the spec against code or fresh verification evidence. Confirm no file outside `qeeq-tool`, no workbook baseline, no generated output, and no secret is staged.

- [ ] **Step 10: Commit final integration and docs**

```powershell
git add -- package.json .github/workflows/qeeq-daily.yml src/qeeq/report.js src/qeeq/telegramSummary.js README.md tests/run-qeeq-tests.js
git commit -m "feat: integrate QEEQ pricing outputs"
```

- [ ] **Step 11: Run final fresh verification after the last commit**

```powershell
npm.cmd test
git status --short
git log -8 --oneline --decorate
```

Expected: tests exit `0`, worktree is clean except ignored local output artifacts, and the new commits are local only.
