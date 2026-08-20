# QEEQ scraper

Standalone Node.js 20 scraper for `https://www.qeeq.pl`. It validates the current visible airport autocomplete, runs bounded car-rental searches in a real browser, keeps conditional prices separate from public prices, and produces canonical JSON, CSV, HTML, XLSX, quality, and manifest outputs.

The checked-in defaults are deliberately limited to Katowice (KTW), the next pickup date, and a two-day rental. The 7,020-scenario schedule is disabled until its independent repository gates are explicitly enabled from measured evidence.

## Requirements and Windows setup

- Node.js 20 or newer
- npm
- Playwright Chromium, or an absolute path to an installed Chromium-compatible browser

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
```

Use `npm.cmd` and `npx.cmd` in PowerShell if script execution policy blocks the `.ps1` shims. Do not put cookies, session URLs, tokens, or QEEQ response payloads in configuration or source control.

## Safe local run

`qeeq.config.example.json` is a safe manual profile. With its defaults, `startDates` is empty, so the runner uses tomorrow in `Europe/Warsaw`; `rollingDays: 1`, `locations: ["Katowice"]`, and `durationsDays: [2]` produce one scenario.

Validate the entire airport catalog against the current visible QEEQ autocomplete first. The validator only selects autocomplete suggestions for inspection and never submits a rental search:

```powershell
node src/qeeq/validateLocations.js --config=qeeq.config.example.json --output=output/qeeq-location-validation.json
node -e "const p=require('./output/qeeq-location-validation.json'); if(p.validation_status!=='pass'||p.expected_airports!==9||p.validated_airports!==9||new Set(p.airports.map(x=>x.iata)).size!==9) process.exit(1); console.log({validation_status:p.validation_status,validated_airports:p.validated_airports});"
```

A current ID drift for an otherwise exact IATA, label, and data type may be reported as `location_id_drift`; missing or ambiguous identity is a blocker. Review any warning before scraping.

Run one fresh KTW two-day scenario and build the two presentation reports:

```powershell
$pickupDate = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
node src/qeeq/run.js --config=qeeq.config.example.json --locations=Katowice --start-dates=$pickupDate --durations-days=2 --save=output/qeeq-smoke.json
node src/qeeq/reportHtml.js output/qeeq-smoke.json output/qeeq-smoke.html
node src/qeeq/reportXlsx.js output/qeeq-smoke.json output/qeeq-smoke.xlsx
```

Confirm that the run is complete and contains a verified public PLN offer:

```powershell
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('output/qeeq-smoke.json','utf8')); const offers=p.scenarios.flatMap(s=>s.offers||[]); if(p.run_status!=='success'||p.quality_status!=='pass'||!offers.some(o=>o.provider_name&&o.price_verified&&o.price_tier==='public'&&o.currency==='PLN'&&Number.isFinite(o.total_price))) process.exit(1); console.log({run_status:p.run_status,quality_status:p.quality_status,offers:offers.length});"
```

This project does not authorize a push, workflow dispatch, full-matrix run, Pages deployment, or Telegram send. Each of those actions requires separate, explicit approval.

## Package scripts

| Command | Purpose |
|---|---|
| `npm.cmd test` | Run the complete offline Node test suite. |
| `npm.cmd run qeeq -- [options]` | Run the scraper through `cli.js`, write canonical JSON plus configured CSV, `quality-summary.json`, and `run-manifest.json`, then print results and status. |
| `npm.cmd run qeeq:json -- [options]` | Run `run.js` and save canonical JSON to `output/qeeq-results-latest.json` by default. |
| `npm.cmd run qeeq:merge -- [options]` | Merge chunk JSON below `downloaded-parts` into `output/qeeq-results-latest.json` and `output/qeeq-results.csv`; the workflow also supplies an authoritative expected-keys file. |
| `npm.cmd run qeeq:report` | Generate self-contained `output/qeeq-report.html` from canonical merged JSON. |
| `npm.cmd run qeeq:xlsx` | Generate `output/qeeq-summary.xlsx` from canonical merged JSON. |
| `npm.cmd run qeeq:aux` | Generate `output/quality-summary.json` and `output/run-manifest.json` after all four main merged outputs exist. |
| `npm.cmd run qeeq:plan -- [options]` | Validate the requested workload and calculate the GitHub Actions chunk plan; it does not scrape. |

Inspect the supported CLI syntax without starting a browser:

```powershell
node src/qeeq/run.js --help
node src/qeeq/cli.js --help
node src/qeeq/workflowPlan.js --help
node src/qeeq/mergeResults.js --help
node src/qeeq/report.js --help
node src/qeeq/telegramSummary.js --help
```

`validateLocations.js` has no help-only mode. Use the complete validator command in **Safe local run**; invoking it opens a browser and performs the nine-location autocomplete validation.

## Configuration contract

All paths in the JSON profile are repository-relative except `browserExecutablePath`, which must be empty or absolute. CLI options override their matching JSON fields.

| Field | Meaning |
|---|---|
| `baseUrl` | Fixed origin; must be `https://www.qeeq.pl`. |
| `timeZone` | Fixed date zone; must be `Europe/Warsaw`. |
| `locations` | Non-empty catalog city list. Safe default: `Katowice`. |
| `rollingDays` | Number of consecutive pickup dates starting tomorrow when `startDates` is empty. |
| `startDates` | Optional explicit valid `YYYY-MM-DD` pickup dates. |
| `durationsDays` | Positive rental durations in days. Safe default: `[2]`. |
| `pickupTime`, `dropoffTime` | Visible form times in 24-hour `HH:MM` form. |
| `driverAge` | Visible driver-age range, `MIN-MAX` within 18–99. |
| `residenceCountryCode` | Two-letter uppercase residence code, normally `PL`. |
| `headless` | `true` for normal automation; set `false` only for an intentional visual diagnostic. |
| `navigationTimeoutMs` | Per-navigation timeout. |
| `resultsTimeoutMs` | Visible-control and results timeout. |
| `apiObservationTimeoutMs` | Bounded window for the supported in-browser response observation. |
| `locationConcurrency` | Number of scenarios processed concurrently; safe default is `1`. |
| `maxLoadMoreIterations` | Per-scenario cap on visible load-more actions. |
| `maxVehicleGroupsPerScenario` | Per-scenario vehicle-group cap. |
| `maxOffersPerScenario` | Per-scenario expanded provider-offer cap. |
| `maxScenarios` | Hard workload cap; must be from 1 through `7020`. |
| `fullScheduleEnabled` | Local runner safety flag. It remains `false` in the manual example. |
| `browserExecutablePath` | Empty for bundled Playwright Chromium, or an absolute browser executable path. |
| `outputCsv` | Safe relative CSV destination used by `cli.js`. |
| `artifactsDir` | Safe relative directory for sanitized diagnostics. |

Common overrides include `--locations`, `--rolling-days`, `--start-dates`, `--durations-days`, `--location-concurrency`, `--max-scenarios`, and `--save`. Unknown options, unsafe relative paths, a non-catalog location, and a matrix above the cap fail before scraping.

## Location coverage

The catalog has eight cities and nine airports:

| City | IATA |
|---|---|
| Warszawa | WAW, WMI |
| Krakow | KRK |
| Gdansk | GDN |
| Katowice | KTW |
| Wroclaw | WRO |
| Poznan | POZ |
| Bydgoszcz | BZG |
| Lodz | LCJ |

The preflight output `output/qeeq-location-validation.json` records the expected and current public autocomplete identity. Production readiness requires nine validated, unique IATA entries. The validator does not submit the search form.

## Data and price rules

Each expanded provider offer is joined to the observed QEEQ shop with the exact pair `(id,bid)` inside the active browser flow. Those business keys, `clid`, session/result identifiers, cookies, authorization headers, raw HTML, and session-valued URLs are never persisted to canonical JSON, CSV, HTML, XLSX, manifests, logs, or uploaded diagnostics. Only the resolved public provider name and normalized non-secret offer fields leave memory.

Public ranking requires all of the following:

- a finite whole-rental total;
- `price_tier: "public"`;
- `price_verified: true`;
- a supported currency (the Polish workflow expects `PLN`);
- an expanded offer with a resolved provider name.

Conditional prices are retained only in separate conditional fields. `newcomer_coupon`, Diamond/member, login-only, and other conditional totals never become `total_price` and never enter Top 3. A crossed-out reference amount, deposit, rating, or discount percentage is not a payable price. Daily price is derived only from an explicitly scoped verified total, or vice versa when the daily scope is explicit.

## Outputs and statuses

| Output | Contract |
|---|---|
| `qeeq-results-latest.json` | Canonical schema-v1 result: options, scenario identities and times, offers, sanitized error codes, independent run/data-quality status, and counts. A bounded smoke can use `qeeq-smoke.json` instead. |
| `qeeq-results.csv` | Stable UTF-8 flattened provider-offer rows; formulas are neutralized and groups/business keys are excluded. |
| `qeeq-report.html` | Self-contained filterable report with a status banner, per-scenario public Top 3, and separate conditional/detail fields. |
| `qeeq-summary.xlsx` | Seven sheets: `Overview`, `Top 3`, `By airport`, `By duration`, `Providers`, `Details`, and `Data quality`. |
| `quality-summary.json` | Compact independent run/quality statuses, check counts, verified/unverified offer counts, and sanitized error-code counts. |
| `run-manifest.json` | Completion status plus relative file names, byte sizes, and SHA-256 hashes for generated outputs. |

`run_status` and `quality_status` are independent. Exit codes are:

| Code | Meaning |
|---|---|
| `0` | `run_status: success` and `quality_status: pass`. |
| `2` | Usable `success` or `partial` result with `pass` or `warning`; retain and review diagnostics. |
| `1` | Invalid configuration, execution/merge/report failure, `run_status: failure`, or `quality_status: fail`. |

Chunk and merged outputs preserve missing or failed work rather than silently reducing expected checks. The merge uses authoritative expected scenario keys, rejects duplicate/incompatible chunks, and recalculates statuses.

## Scheduled workload and enablement gates

The scheduled shape is fixed at 60 rolling pickup dates × durations 2–14 (13 values) × 9 airports = **7,020 scenarios**. This is a hard cap, not a recommended local command. The repository must progress through four evidence stages:

1. One KTW, one fresh pickup date, two days.
2. All nine airports, one pickup date, two days.
3. Seven pickup dates with durations 2–4.
4. A plan-only 7,020-scenario estimate using measured median/p95 timings, expected artifact size, and reviewed browser budget.

Stage 3 or 4 may calculate the full estimate with `plan_only=true`; it always emits `should_run=false` and starts no scrape, merge, Pages, or Telegram job. An actual full or scheduled run requires both `QEEQ_BENCHMARK_STAGE=4` and `QEEQ_FULL_SCHEDULE_ENABLED=true`. Scheduled execution without that exact full-schedule flag ends successfully after a disabled plan.

Repository variables used by `.github/workflows/qeeq-daily.yml`:

| Variable | Purpose |
|---|---|
| `QEEQ_FULL_SCHEDULE_ENABLED` | Exact `true` enables scheduled/full execution after all other gates pass; default/unset is disabled. |
| `QEEQ_BENCHMARK_STAGE` | Reviewed evidence stage. Scheduled and actual full execution require `4`; full plan-only accepts `3` or `4`. |
| `QEEQ_P50_SCENARIO_SECONDS` | Positive finite measured median scenario time. |
| `QEEQ_P95_SCENARIO_SECONDS` | Positive finite measured p95 time, at least p50; drives conservative estimates and chunking. |
| `QEEQ_MAX_PARALLEL` | Positive measured expanded-run concurrency, at most 256. |
| `QEEQ_TARGET_CHUNK_MINUTES` | Positive target browser work per date chunk. |
| `QEEQ_MAX_BROWSER_MINUTES` | Positive total browser-minute budget; execution is refused when the p95 estimate exceeds it. |
| `QEEQ_PAGES_ENABLED` | Exact `true` allows Pages only after merge produced every required report; otherwise artifacts remain the fallback. |

The planner estimates browser use as `scenario_count × QEEQ_P95_SCENARIO_SECONDS / 60`, limits the matrix to 256 chunks, and rejects a derived GitHub job timeout above 360 minutes. Measurement variables must come from bounded stages, not guesses.

Manual `workflow_dispatch` defaults remain one KTW/two-day scenario with parallelism 1. A request above nine scenarios additionally requires `acknowledge_expanded_run=true` and valid measured repository variables. `plan_only=true` is the safe way to inspect a larger plan without running scrape jobs. The separate `qeeq-smoke.yml` never deploys Pages or sends Telegram.

## Artifacts, Pages, and Telegram

The daily workflow retains planning and chunk diagnostics for 7 days and merged reports for 30 days. If `QEEQ_PAGES_ENABLED=true` and all merged outputs exist, Pages publishes the self-contained report and JSON/CSV/XLSX downloads. If Pages is disabled or unavailable, the Telegram summary uses the merged GitHub Actions artifact/run link instead.

Telegram delivery is performed only by the workflow, never by `telegramSummary.js`; that module only builds sanitized text. Its GitHub Actions secrets are:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

If either secret is absent, notification steps exit without sending. Never print either value or pass it as a normal repository variable.

## Authorization boundary

Local tests, help commands, planning, the nine-airport no-submit validator, and one expressly approved bounded KTW smoke are read-only verification of the implementation. Do not run the 7,020 matrix locally, trigger GitHub Actions, change repository variables or secrets, push commits, deploy Pages, or send Telegram messages unless that exact external action has been separately approved.
