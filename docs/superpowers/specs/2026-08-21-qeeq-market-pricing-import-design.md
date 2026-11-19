# QEEQ provider ranking, MM alert, pricing, and import design

Date: 2026-08-21

Status: approved in chat; pending written review
Target repository: `qeeq-tool`
Amends: `docs/superpowers/specs/2026-08-20-qeeq-scraper-design.md`

## 1. Objective

Extend the existing QEEQ scraper so its market view and downstream pricing workflow match the useful business behavior of DiscoverCars without copying DiscoverCars-specific broker markup assumptions.

The extension must:

1. rank the cheapest verified offer from each distinct provider;
2. show MM Cars Rental separately with its provider rank;
3. distinguish confirmed MM absence from incomplete data;
4. produce QEEQ pricing recommendations and an import-ready Excel workbook only when a separately approved QEEQ rate calibration makes the conversion safe.

This design supersedes the earlier exclusion of pricing recommendations and Excel mutation. All other safety and authorization boundaries in the original QEEQ design remain in force.

## 2. Scope and boundaries

### Included

- One shared, pure market-view module used by HTML, XLSX, Telegram, and pricing recommendations.
- Top 3 distinct providers per scenario, based on the cheapest verified public PLN offer from each provider.
- A separate MM Cars Rental view with price, provider rank, and number of cheaper providers.
- Date-level MM availability classification using the complete planned airport and duration matrix.
- QEEQ-specific pricing recommendations derived only from verified public PLN offers.
- A separately approved QEEQ public-price-to-import-rate calibration.
- A local import-ready workbook generator that takes an explicit baseline workbook path.
- Integration of recommendation JSON and MM alert text into the existing report and daily workflow outputs.
- Offline unit and integration tests plus visual verification of the affected HTML and XLSX outputs.

### Excluded

- Copying the DiscoverCars broker markup multiplier into QEEQ.
- Committing the current tariff workbook or any generated import workbook to the public repository.
- Automatically enabling Pages, Telegram delivery, the full QEEQ schedule, or an Excel write in GitHub Actions.
- Changing DiscoverCars source files, its baseline workbook, or its pricing outputs.
- Treating failed, missing, unverified, conditional, member, Diamond, coupon, deposit, or reference-price data as a valid public market observation.
- Automatically mapping Warsaw Modlin to an unrelated tariff zone.

## 3. Shared provider market view

A new `src/qeeq/marketView.js` module will own provider normalization, provider deduplication, MM recognition, and scenario market summaries.

Provider names will be compared case-insensitively after trimming whitespace and normalizing punctuation. MM aliases will include:

- `MM Cars Rental`
- `MM Car Rental`
- `MM Service Lease Polska`

Only offers accepted by the existing `isVerifiedPublicOffer` predicate may enter the market view. For each normalized provider, the module will keep its cheapest verified public offer. The distinct providers will then be sorted by total rental price, with deterministic provider-name and vehicle-name tie breakers.

For each scenario, the market view will expose:

- `ranked_providers`: all distinct providers in price order;
- `top_3_providers`: the first three ranked providers;
- `mm_cars_rental`: the cheapest verified MM offer or `null`;
- `mm_provider_rank`: one-based rank among distinct providers or `null`;
- `cheaper_provider_count`: number of distinct providers cheaper than MM or `null`;
- `verified_provider_count`: number of distinct providers with usable public prices.

The market view will be derived from canonical offers rather than persisted as a second source of truth in the canonical scraper envelope. Every consumer will call the same pure helper so HTML, XLSX, Telegram, and pricing recommendations cannot disagree.

## 4. HTML and XLSX presentation

`reportHtml.js` will replace offer-level Top 3 selection with `top_3_providers`. A provider may occupy at most one position even when it has several cars. The displayed vehicle remains the cheapest verified vehicle for that provider.

The HTML report will add a separate MM Cars Rental section per scenario with:

- airport, pickup date, and duration;
- MM visibility status;
- provider rank;
- number of cheaper providers;
- cheapest verified MM vehicle;
- verified public total and daily price.

`reportXlsx.js` will apply the same distinct-provider Top 3 rule and add an eighth worksheet named `MM Cars Rental`. Existing sheets and their purposes remain unchanged. The new worksheet will contain the same fields as the HTML MM section plus scenario status and data-completeness classification. Currency and price values will remain typed numeric cells.

Reports will never place a conditional or unverified MM price in the public MM price columns. Such values remain visible only in existing detail fields.

## 5. Date-level MM availability alert

A new `src/qeeq/mmAvailability.js` module will classify each requested pickup date independently.

The expected scenarios for a date are the Cartesian product of the root options for that date: every requested airport key and every requested duration. A date has `complete` coverage only when every expected scenario key is present exactly once, has scenario status `success`, and contains at least one verified public provider offer.

Classification rules are:

- `present`: at least one scenario for the date contains a verified public MM offer; no missing-MM alert is emitted even when other scenarios are incomplete.
- `confirmed_missing`: no scenario contains a verified public MM offer and coverage is complete.
- `incomplete`: no scenario contains a verified public MM offer and at least one expected scenario is missing, failed, duplicated, or has no verified public provider offer.

The Telegram final summary will append two independently labelled sections when non-empty:

- `Brak MM - pelne dane` for `confirmed_missing` dates;
- `Nie mozna potwierdzic - niepelne dane` for `incomplete` dates.

The HTML MM section and XLSX MM sheet will expose the same classification. A warning about incomplete evidence must never be phrased as confirmed MM absence.

## 6. QEEQ pricing recommendations

A new `src/qeeq/pricingRecommendations.js` module and `qeeq-pricing-rules.config.example.json` will generate `output/qeeq-pricing-recommendations.json` from canonical QEEQ results.

Inputs are restricted to distinct-provider market views built from verified public PLN totals. Daily rates are derived from verified whole-rental totals and the canonical duration. Recommendations above the configured maximum duration, initially seven days to match the current tariff updater contract, will be retained as `hold` decisions with an explicit reason rather than silently omitted.

The initial business rules mirror the existing DiscoverCars decision thresholds but operate at the visible QEEQ site-price level:

- if MM is rank 1 and the gap to rank 2 is at least 10 PLN/day, target 1 PLN/day below rank 2;
- if MM is rank 2 and reaching rank 1 requires a decrease below 10 PLN/day, target 1 PLN/day below rank 1;
- if MM is rank 3 or lower and a decrease below 10 PLN/day can improve its rank, target 1 PLN/day below the relevant competitor;
- changes below 0.50 PLN/day remain `hold`;
- when MM is absent, public data is incomplete, currency is not PLN, or a benchmark is missing, the decision remains `hold` or `review` and no import rate is produced.

Every decision will include the scenario identity, airport key and IATA, tariff zones, pickup date, duration, MM rank/rate, Top 3 providers and rates, benchmark, site-level action, site target, calibration status, import action, suggested import rate, data-quality status, and reason.

The module will expose a CLI and pure builder. Unknown options, unsafe paths, input/output collisions, malformed canonical input, and non-finite pricing rules will fail before writing output.

## 7. QEEQ calibration safety gate

`qeeq-rate-calibration.config.example.json` will document the conversion from an imported daily rate to the public daily price observed on QEEQ.

The configuration will support this deterministic resolution order:

1. airport-and-duration multiplier;
2. airport multiplier;
3. duration multiplier;
4. global default multiplier.

The entire calibration file must contain `approved: true`. Every selected multiplier must be finite, positive, and inside a conservative configured range. An absent, unapproved, invalid, or uncovered calibration leaves `suggested_rate_pln_day` null and sets `import_action: review`. The site-level target remains available for human analysis.

The suggested import rate is:

`site_target_rate_pln_day / approved_multiplier`

No value from the DiscoverCars calibration file will be loaded implicitly or used as a fallback. An explicit multiplier of `1.0` is allowed only in an approved QEEQ calibration file; it is never an assumed default.

## 8. Tariff-zone mapping

QEEQ airport entries will gain explicit `tariffZones` arrays:

| IATA | Tariff zones |
|---|---|
| WAW | `WALO` |
| WMI | none; manual review |
| KRK | `KRLO`, `KRTI` |
| GDN | `GDLO` |
| KTW | `KALO` |
| WRO | `WRLO` |
| POZ | `POLO` |
| BZG | `BYLO` |
| LCJ | `LOLO` |

An airport without a tariff zone remains visible in recommendations with `data_quality_status: unmapped_tariff_zone`, but the Excel importer cannot modify a row for it.

## 9. Import-ready Excel generator

A new `src/qeeq/updateExcelRates.js` CLI will accept:

- an explicit existing baseline workbook path;
- QEEQ pricing recommendations JSON;
- the existing tariff layout configuration adapted into `qeeq-excel-rate-update.config.example.json`;
- an explicit output path for `qeeq-rates-import-ready.xlsx`;
- an explicit summary JSON output path.

The implementation will use the repository's existing Node.js and ExcelJS stack. It will never search for a baseline automatically. The baseline workbook and generated workbook remain ignored and uncommitted.

The updater will:

1. validate all inputs before creating an output file;
2. load the configured source worksheet, normally `Sheet1`;
3. retain all original rows, formulas, styles, widths, heights, merged cells, and relevant sheet settings supported by the existing library;
4. apply only finite `increase` or `decrease` import recommendations with an approved calibration and mapped tariff zone;
5. match rows by tariff zone, pickup start date, and the duration band defined in rows 2 and 3;
6. preserve excluded vehicle groups and every unmatched cell;
7. write a workbook containing only the import worksheet;
8. write a machine-readable summary with applied, held, reviewed, skipped, unmapped, and unmatched counts plus changed cell coordinates;
9. use a temporary file and atomic rename so a failed write cannot replace a valid output.

The updater will reject source/output collisions and formula-like untrusted text in generated summaries. It will not modify the baseline in place.

## 10. Commands and workflow integration

`package.json` will add commands for:

- generating QEEQ pricing recommendations;
- generating the import-ready workbook from an explicitly supplied baseline;
- running the existing report pipeline with the new market and MM views.

The daily merge job will always generate site-level QEEQ recommendation JSON and include it in the merged artifact and Pages downloads when Pages is separately enabled. Telegram will include recommendation counts and the MM availability classification.

The daily workflow will not run the Excel updater until a baseline workbook and an approved QEEQ calibration are separately supplied and authorized. The bounded smoke workflow remains free of Pages, Telegram sending, tariff mutation, and import-workbook generation.

## 11. Testing strategy

Implementation will follow red-green-refactor test-driven development.

Tests will cover:

- distinct providers in Top 3 despite several cheaper vehicles from one provider;
- deterministic tie breaking and provider normalization;
- all supported MM aliases and MM ranking outside Top 3;
- date-level `present`, `confirmed_missing`, and `incomplete` classification, including dates with no result rows;
- Telegram wording that separates confirmed absence from incomplete evidence;
- HTML Top 3 and MM sections using the shared market view;
- XLSX Top 3 and the eighth MM worksheet with typed prices;
- pricing thresholds, missing MM, incomplete data, unsupported duration, and missing benchmark behavior;
- calibration resolution priority, absent approval, invalid multipliers, and no DiscoverCars fallback;
- tariff-zone mapping and WMI review behavior;
- Excel application to a synthetic baseline fixture, including duration-band matching, excluded groups, formulas, formats, and unchanged baseline verification;
- atomic output behavior and safe path validation;
- static daily and smoke workflow contracts.

The final verification must include the complete `npm.cmd test` suite, generation of reports from a controlled canonical fixture, generation of an import workbook from a synthetic or explicitly selected local baseline, value/formula inspection, a formula-error scan, and a visual render of the affected HTML and import worksheet.

## 12. Success criteria

The extension is ready for local handoff when:

- Top 3 contains at most one offer per normalized provider in HTML and XLSX.
- MM Cars Rental has a separate visible row with a provider rank in HTML and XLSX.
- Telegram and reports distinguish confirmed missing MM from incomplete data for every requested pickup date.
- Recommendation JSON is deterministic and uses only verified public PLN provider observations.
- No import rate is emitted without an explicitly approved QEEQ calibration.
- The importer changes only mapped, matched, authorized tariff cells and never changes the baseline file.
- WMI remains an explicit review item until the user supplies its tariff zone.
- The import workbook contains only the configured import worksheet and retains its expected structure and formatting.
- All tests and compact report/workbook verification checks pass.
- Git diff contains only QEEQ repository files.
- No baseline workbook, generated import workbook, credential, push, workflow dispatch, Pages deployment, or Telegram send occurs without separate authorization.

## 13. Risks and controls

- **Incorrect platform multiplier:** explicit approved QEEQ calibration gate; no DiscoverCars fallback.
- **Duplicate providers occupying Top 3:** one shared provider-deduplication helper for every consumer.
- **False missing-MM alert:** complete expected-matrix proof before confirmed absence.
- **Conditional price leakage:** existing verified-public predicate remains the only ranking and pricing input.
- **Wrong tariff zone:** explicit airport mapping, WMI review state, and unmatched-zone counts.
- **Workbook damage:** preflight validation, output-to-new-file only, atomic replacement, and structural/visual verification.
- **Public data leakage:** baseline and generated workbooks remain uncommitted and outside workflow artifacts until separately authorized.
