# QEEQ scraper design

Date: 2026-08-20

Status: approved in chat for written review
Target repository: `qeeq-tool`

## 1. Objective

Build a standalone Node.js and Playwright scraper for `https://www.qeeq.pl/` that follows the operating conventions of the existing DiscoverCars and RentCars tools without sharing their source tree, outputs, workflows, or runtime state.

The tool will collect public rental offers for the configured Polish airports and date ranges, normalize the results, and generate JSON, CSV, HTML, and XLSX outputs. GitHub Actions will support a bounded smoke run and a chunked daily production run with artifacts, GitHub Pages, and Telegram notification.

The user has confirmed that MM Cars Rental has permission from QEEQ to perform automated collection. The implementation will still use bounded concurrency, explicit timeouts, and diagnostic artifacts so that it does not place unnecessary load on QEEQ.

## 2. Scope

### Included

- A new, independent Git repository in `C:\Users\barte\OneDrive\Codex\qeeq-tool`.
- Provider-specific QEEQ configuration, location catalog, browser flow, parsing, normalization, retries, logging, and diagnostics.
- A config-driven CLI for local and GitHub Actions runs.
- Canonical JSON results and derived CSV, HTML, and XLSX reports.
- Chunk creation and deterministic merge for the production matrix.
- A GitHub Actions smoke workflow.
- A GitHub Actions daily workflow with plan, scrape, merge, Pages, artifacts, and Telegram stages.
- Offline automated tests plus one bounded real-browser smoke scenario.
- Scheduled production defaults of 60 rolling pickup dates and rental durations from 2 through 14 days.
- The same eight Polish airport groups currently used by the standalone RentCars tool.

### Excluded

- Changes to the DiscoverCars or RentCars repositories.
- Automated booking, authentication, payment, reservation management, or collection of personal data.
- Direct calls to QEEQ offer APIs outside a Playwright-created browser session.
- Reproduction of QEEQ session protection parameters.
- DiscoverCars-specific Excel rate updating and pricing recommendation logic.
- Creating a remote GitHub repository, pushing commits, enabling Pages, configuring secrets, or running the full production matrix without separate authorization.

## 3. Chosen approach

Use a hybrid, DOM-first Playwright architecture.

Playwright will create the browser session, choose the location, set the search parameters, submit the official form, and load result groups. Inside that same session, the scraper may observe QEEQ list responses when they are available and parseable. DOM parsing remains the required fallback and the source of truth when the network contract is incomplete or changes.

This approach is preferred over:

- DOM-only scraping, which is simpler but more exposed to layout and CSS changes.
- Direct API scraping, which would depend on QEEQ session values such as `fpt`, `ticket`, `ts`, `qeeq_fpt`, and a generated result-session ID.

The implementation will not synthesize, persist, or replay QEEQ session IDs across browser contexts.

## 4. Repository structure

```text
qeeq-tool/
  .github/workflows/
    qeeq-daily.yml
    qeeq-smoke.yml
  docs/superpowers/
    specs/2026-08-20-qeeq-scraper-design.md
    plans/2026-08-20-qeeq-scraper-implementation.md
  src/qeeq/
    cli.js
    config.js
    locations.js
    locations.json
    mergeResults.js
    report.js
    reportHtml.js
    reportXlsx.js
    run.js
    scraper.js
    telegramSummary.js
    utils.js
  tests/
    fixtures/
    run-qeeq-tests.js
  .gitignore
  package.json
  package-lock.json
  qeeq.config.example.json
  README.md
```

Generated files will remain under `output/` and `artifacts/qeeq/` and will be ignored by Git.

## 5. Components and responsibilities

### Configuration

`config.js` will load JSON configuration, apply CLI overrides, validate all user input, and return a normalized immutable configuration object.

The example configuration will include:

- `baseUrl`: `https://www.qeeq.pl`
- pickup and drop-off times
- explicit dates or `rollingDays`
- `durationsDays`
- selected location cities
- driver age range and residence country
- `headless`
- navigation, results, and API observation timeouts
- scenario concurrency, defaulting conservatively
- maximum “Pokaż więcej wyników” iterations
- optional maximum offers per location for smoke runs
- `maxScenarios`, `maxVehicleGroupsPerScenario`, and `maxOffersPerScenario`
- a full-schedule enable switch that is false unless explicitly enabled in GitHub repository variables
- browser executable override
- output and artifact paths

Production schedule defaults will live in `qeeq-daily.yml`; manual `workflow_dispatch` defaults will remain smaller so a manual click cannot accidentally start the entire scheduled workload.

### Location catalog

`locations.json` will contain provider-specific QEEQ identifiers and labels. The initial catalog will cover:

- Warsaw Modlin
- Warsaw Chopin
- Kraków Balice
- Gdańsk Rębiechowo
- Katowice Pyrzowice
- Wrocław Strachowice
- Poznań Ławica
- Bydgoszcz Szwederowo
- Łódź Lublinek

Warsaw contains two airports, so the catalog represents eight city groups and nine airport checks.

Each airport entry will contain the visible label, IATA code, expected QEEQ city ID, expected landmark ID, data type, and a normalized internal key. IDs will be obtained from the QEEQ autocomplete response and tested against fixtures.

The current visible autocomplete response is authoritative for a run. If its IATA code and label match the configured airport but its IDs differ from the catalog, the scraper will use the live IDs and raise a data-quality warning containing the old and new non-secret values. A missing or ambiguous IATA/label match is a controlled scenario failure. The implementation must validate and fixture all nine catalog airports before completion; only KTW IDs are considered confirmed at design time.

### Browser session and search

`scraper.js` will:

1. Open QEEQ in a fresh Playwright context.
2. Dismiss the privacy dialog and the lower cookie banner when present.
3. Locate the pickup input using `input[name="pickup"]` or `.J-pick-up-input`.
4. Resolve the configured airport through the visible autocomplete item, matching its title or IATA code. Hidden stale suggestions must be ignored.
5. Set pickup and return dates and times through supported UI interactions. Hidden inputs are validation evidence, not the primary interaction mechanism.
6. Set same-location return, driver age, and residence.
7. Submit through `.J-search-submit`.
8. Wait for the generated `/car/search?id=...` result session and the first result group.
9. Observe list responses inside the active browser session without recreating protected requests.
10. Parse result groups and expand provider offers. A group without at least one expanded provider offer is diagnostic data, not a successful canonical offer.
11. Repeatedly click the visible exact-text control `Pokaż więcej wyników`, waiting for the result-group count to increase after each click.

Hashed CSS module classes will be matched only by stable prefixes such as `[class*="car-group-item___"]` and `[class*="car_name___"]`, supplemented by labels and inner text. Complete hashed class names will never be stored as constants.

Provider, deposit, rating, and offer price must be parsed only from the DOM subtree of one expanded provider offer or from a network object tied to that offer. Global filter labels and counts in the sidebar are never valid offer data.

### Offer parsing and normalization

The canonical unit is one provider-package offer for one vehicle group and scenario. Group-level observations are stored separately in `groups[]`; they may support diagnostics and offer expansion but never participate in Top 3 ranking.

Every normalized provider-package offer will include:

- requested city and airport key
- QEEQ city and landmark IDs
- pickup and return timestamps
- rental duration in days
- vehicle name and category
- transmission
- seats, doors, and luggage when present
- rental provider name
- provider rating and rating count when present
- deposit amount and currency when present
- public discounted price when available without membership
- conditional membership price, including Diamond price, when displayed
- crossed-out reference price when displayed
- displayed total public price
- displayed or derived daily public price
- currency
- price label captured from the source
- `price_tier`: `public`, `diamond`, `member`, `conditional`, or `unknown`
- `price_scope`: `total`, `daily`, `both`, or `unknown`
- `price_verified`: boolean
- a sanitized source search URL without the session `id`
- normalized search parameters
- capture timestamp
- parsing source: `network`, `dom`, or `hybrid`

Price rules:

- A value labelled as the total for the whole rental may populate `total_price`.
- A value explicitly labelled per day may populate `daily_price`.
- `daily_price = total_price / rental_days` is allowed only when the total scope is explicit.
- `total_price = daily_price * rental_days` is allowed only when the daily scope is explicit.
- A one-day result alone cannot establish how QEEQ labels multi-day prices.
- The first real smoke must use a two-day rental. Until that smoke confirms the semantics, affected records remain `price_verified: false` and the run cannot receive a full-success quality status.
- Ratings, discount percentages, deposits, and crossed-out amounts must never be accepted as the payable price.
- A Diamond, member, login-only, coupon-dependent, or otherwise conditional price is stored separately and never used as the public ranking price.
- Top 3 ranking uses only `price_tier: public`, `price_verified: true`, and a normalized public total price. Conditional prices may be shown in separate report columns but cannot change the public Top 3 order.
- If a card shows both “Cena ze zniżką” and “Cena Diamentowa”, the first is the public candidate and the second is conditional until a fixture or live evidence proves otherwise.

### Runner and canonical JSON

`run.js` will expand dates, durations, and airports into deterministic scenarios. Each scenario will have its own status, results, errors, duration, and diagnostic artifact references.

The root JSON result will contain:

- schema version
- start and completion timestamps
- requested and completed scenario counts
- expected and completed airport-check counts
- `run_status`: `success`, `partial`, or `failure`
- `quality_status`: `pass`, `warning`, or `fail`
- aggregate errors
- normalized scenarios
- data-quality summary
- run options without secrets

An empty result, an unexpected currency, an unexpanded provider offer, or a price-semantic failure must not receive `quality_status: pass`.

CLI exit codes are:

| Exit code | Meaning | Workflow handling |
|---|---|---|
| `0` | `run_status: success` and `quality_status: pass` | Normal success. |
| `2` | Usable partial output or a quality warning | Upload diagnostics and continue to merge; final workflow is visibly warning/partial. |
| `1` | Invalid configuration, execution failure, or `quality_status: fail` | Upload diagnostics, allow merge/notification jobs to run, and fail the final workflow status. |

Chunk jobs always record the code and upload their result envelope. Merge recalculates both statuses from expected counts and chunk contents rather than trusting a chunk's label. Pages may publish partial reports only with an unavoidable warning banner. Telegram includes both statuses.

### CSV, HTML, and XLSX

`report.js` will flatten canonical offers into a stable UTF-8 CSV contract.

`reportHtml.js` will generate a self-contained report with:

- run status and data-quality warnings
- filters for airport, pickup date, duration, transmission, provider, and scenario status
- Top 3 offers per scenario
- full offer details
- source links
- visible distinction between verified and unverified prices
- separate public and conditional membership prices; Top 3 is based only on verified public prices

`reportXlsx.js` will generate:

- `Overview`
- `Top 3`
- `By airport`
- `By duration`
- `Providers`
- `Details`
- `Data quality`

No rate recommendation or workbook mutation is included in this project.

### Merge

`mergeResults.js` will:

- read chunk JSON files in deterministic order
- validate their schema versions and requested option sets
- reject duplicate scenario keys
- preserve partial failures
- calculate aggregate status and quality metrics
- write one canonical merged JSON file
- generate the merged CSV used by artifacts and report consumers

Missing chunks or incompatible schemas make the merge partial or failed rather than silently reducing the expected workload.

### Telegram summary

`telegramSummary.js` will prepare, but not send, the message text. The workflow will perform the actual Telegram API call using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets.

The summary will include:

- overall status
- requested and completed checks
- verified and unverified price counts
- failed scenario count
- report or artifact link
- GitHub Actions run link

The planning-failure notification will be a separate job so a failure before checkout or scraping is still reported.

## 6. GitHub Actions

### Smoke workflow

`qeeq-smoke.yml` will run on relevant pushes and manual dispatch. Its default scope is one KTW airport, one pickup date, and a two-day duration. It will:

- install Node dependencies and Playwright Chromium
- run offline tests
- execute one bounded browser scenario
- require expansion of at least one provider offer with provider name and a verified public price
- generate JSON, CSV, and HTML
- upload JSON, CSV, HTML, sanitized DOM diagnostics, logs, screenshots, and error envelopes
- avoid Pages deployment and Telegram messages

### Daily workflow

`qeeq-daily.yml` will contain:

1. `plan`: Warsaw-time schedule gate, option validation, date expansion, and chunk matrix generation.
2. `notify-plan-failure`: independent Telegram alert for failures before scraping.
3. `scrape`: one job per chunk, bounded concurrency, per-chunk timeout, and diagnostic artifacts.
4. `merge`: download chunks, validate completeness, merge JSON, and generate CSV/HTML/XLSX.
5. `pages`: prepare and deploy the report site when Pages is configured.
6. `notify`: send the final Telegram summary with Pages and artifact fallback links.

Each scrape chunk artifact contains its result envelope, scenario errors, sanitized diagnostics, screenshots, and logs, with seven-day retention. The merged artifact contains canonical JSON, flattened CSV, self-contained HTML, XLSX, the quality summary, and the run manifest, with 30-day retention. Pages contains the report HTML plus downloadable JSON, CSV, and XLSX copies; if Pages is unavailable, Telegram links to the merged Actions artifact.

Scheduled defaults:

- 60 rolling pickup dates beginning tomorrow in `Europe/Warsaw`
- durations `2,3,4,5,6,7,8,9,10,11,12,13,14`
- all configured airport checks
- conservative browser concurrency and chunk size determined from measured smoke timing

The full matrix contains 7,020 airport-search scenarios: nine airports multiplied by 60 pickup dates and 13 durations. The daily workflow will contain the requested defaults but the scheduled full run is gated by the GitHub repository variable `QEEQ_FULL_SCHEDULE_ENABLED=true`. Without that exact value, scheduled triggers stop after planning and report that production remains disabled; manual smoke remains available.

Before enabling the full schedule, the following stages must succeed:

1. One KTW two-day smoke.
2. All nine airports for one pickup date and one two-day duration.
3. Seven pickup dates and durations 2 through 4.
4. A plan-only full-matrix estimate using measured median and p95 scenario times and expected artifact size.

The planner enforces `maxScenarios` with a default hard cap of 7,020, prints the estimated browser-minutes and offer volume, and refuses a larger matrix. Per-scenario vehicle-group and provider-offer limits are explicit, recorded in the result envelope, and cause `quality_status: warning` when reached. Full-matrix concurrency and limits require timing evidence from stages 2 and 3; a single smoke is not sufficient.

The implementation will create these defaults but will not run the full matrix locally. Chunk count and timeout will be set from bounded timing evidence, not copied blindly from another provider.

## 7. Error handling and diagnostics

Expected recoverable errors include navigation timeouts, stale autocomplete entries, session expiry, missing optional fields, stalled lazy loading, and transient network failures.

The scraper will use bounded retries. A retry requiring a fresh QEEQ search will use a new browser context and will not reuse the old result-session ID.

For every failed scenario, the tool will attempt to save:

- screenshot
- a sanitized DOM snapshot when sanitization succeeds
- the current URL with session identifiers removed
- concise error JSON
- browser console and relevant request failures

Diagnostics will exclude cookies, authorization values, Telegram secrets, sensitive request headers, the result-session `id`, `fpt`, `ticket`, and `ts`. Raw page HTML is not uploaded. If the sanitizer cannot prove those fields were removed, the HTML/DOM artifact is discarded while the screenshot and structured error remain available.

`source_search_url` is always the stable path `https://www.qeeq.pl/car/search` without query parameters. Reproducibility comes from the separately stored non-secret location/date/time/age/residence parameters, not from the expired session URL.

## 8. Testing strategy

Implementation will follow test-driven development.

Offline tests will cover:

- config defaults and invalid input
- CLI override parsing
- location resolution and airport counts
- deterministic date and scenario expansion
- result URL/session recognition
- cookie and popup handling contracts
- fixture-based group and provider-offer parsing
- strict subtree scoping using fixtures that also contain sidebar provider, deposit, and rating filters
- separation of public, Diamond, member, reference, deposit, rating, and discount values
- price parsing and false-price rejection
- one-day versus multi-day price verification
- lazy-loading stop conditions
- retry boundaries
- CSV escaping and columns
- JSON merge, missing chunks, and duplicate scenarios
- HTML content and safety escaping
- XLSX sheets and essential cells
- Telegram message formatting
- static workflow contracts, including separate plan-failure notification

Browser smoke will verify:

- one real KTW two-day search reaches results
- at least one vehicle group is parsed and expanded into a provider-package offer
- the expanded offer includes a provider name and its own price
- currency is PLN
- total and/or daily price scope is explicitly confirmed
- generated JSON and HTML are non-empty
- diagnostics are produced on failure

The full production workload is not a test and will not be used for local validation.

## 9. Success criteria

The project is ready for handoff when:

- `npm.cmd test` passes with no failures.
- CLI help and invalid-config behavior are verified.
- One bounded real-browser KTW two-day smoke completes or, if QEEQ is temporarily unavailable, produces complete safe diagnostics and the limitation is reported.
- Canonical JSON, CSV, HTML, and XLSX are generated from a verified fixture and validated.
- Workflow files pass static contract tests.
- The planner rejects more than 7,020 scenarios and keeps scheduled production disabled without `QEEQ_FULL_SCHEDULE_ENABLED=true`.
- Git diff contains only `qeeq-tool` files.
- No user changes in the DiscoverCars repository are modified.
- No push, deployment, Telegram message, remote repository creation, or full scheduled run occurs without explicit authorization.

## 10. Known risks and controls

- **QEEQ UI drift:** stable labels, partial class matches, fixtures, and browser smoke.
- **Session-bound APIs:** observe only inside the Playwright session; DOM fallback is mandatory.
- **Ambiguous pricing:** explicit scope fields and a two-day verification gate.
- **Large production matrix:** conservative concurrency, chunking based on measurements, and no local full run.
- **Popup interference:** idempotent popup handlers before important interactions.
- **Partial data mistaken for success:** expected-count checks and quality status separate from process exit details.
- **Secret leakage:** sanitize diagnostics and keep all credentials in GitHub secrets.
