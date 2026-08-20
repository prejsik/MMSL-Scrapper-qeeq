const fs = require('node:fs');
const path = require('node:path');

const { compareLiveAirport, locationCatalog } = require('./locations');
const { SELECTORS, dismissPolishPopups, visibleAirportSuggestions } = require('./scraper');

async function launchDefaultBrowser(config) {
  const { chromium } = require('playwright');
  const options = { headless: config.headless !== false };
  if (config.browserExecutablePath) options.executablePath = config.browserExecutablePath;
  return chromium.launch(options);
}

function publicSuggestion(suggestion) {
  return {
    label: suggestion.label,
    iata: suggestion.iata,
    city: suggestion.city,
    landmark: suggestion.landmark,
    dataType: suggestion.dataType,
    type: suggestion.type
  };
}

async function withBrowserResolver(config, deps, validate) {
  const launchBrowser = deps.launchBrowser || (() => launchDefaultBrowser(config));
  const browser = await launchBrowser();
  let context;
  try {
    context = await browser.newContext({ locale: 'pl-PL', timezoneId: config.timeZone || 'Europe/Warsaw' });
    const page = await context.newPage();
    page.setDefaultTimeout?.(config.resultsTimeoutMs ?? 30000);
    await page.goto(config.baseUrl || 'https://www.qeeq.pl', {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs ?? 60000
    });
    await dismissPolishPopups(page);
    const resolveAirport = async airport => {
      await page.locator(SELECTORS.pickupInput).fill(airport.iata);
      return (await visibleAirportSuggestions(page))
        .filter(item => item.iata === airport.iata)
        .map(publicSuggestion);
    };
    return await validate(resolveAirport);
  } finally {
    await context?.close();
    await browser.close();
  }
}

async function validateLiveLocationCatalog(config = {}, deps = {}) {
  const now = deps.now || (() => new Date());
  const catalogAirports = locationCatalog.flatMap(entry => entry.airports.map(airport => ({ ...airport, cityName: entry.city })));
  const validate = async resolveAirport => {
    const airports = [];
    const seenIata = new Set();
    let validatedAirports = 0;

    for (const expected of catalogAirports) {
      const resolved = await resolveAirport(expected);
      const matches = Array.isArray(resolved) ? resolved.filter(Boolean) : (resolved ? [resolved] : []);
      const base = {
        airport_key: expected.key,
        iata: expected.iata,
        expected_label: expected.label,
        expected_city_id: expected.cityId,
        expected_landmark_id: expected.landmarkId,
        expected_data_type: expected.dataType,
        expected_type: expected.type
      };
      if (matches.length === 0) {
        airports.push({ ...base, validation_status: 'fail', error_code: 'location_match_missing' });
        continue;
      }
      if (matches.length !== 1) {
        airports.push({ ...base, validation_status: 'fail', error_code: 'location_match_ambiguous' });
        continue;
      }

      const live = matches[0];
      const liveIata = String(live.iata || '').toUpperCase();
      if (seenIata.has(liveIata)) {
        airports.push({ ...base, validation_status: 'fail', error_code: 'location_match_duplicate' });
        continue;
      }
      seenIata.add(liveIata);
      const comparison = compareLiveAirport(expected, live);
      const current = {
        current_label: live.label ?? null,
        current_city_id: live.city === null || live.city === undefined ? null : String(live.city),
        current_landmark_id: live.landmark === null || live.landmark === undefined ? null : String(live.landmark),
        current_data_type: live.dataType ?? null,
        current_type: live.type === null || live.type === undefined ? null : String(live.type)
      };
      if (!current.current_city_id?.trim() || !current.current_landmark_id?.trim()) {
        airports.push({ ...base, ...current, validation_status: 'fail', error_code: 'location_id_missing' });
        continue;
      }
      if (comparison.error) {
        airports.push({ ...base, ...current, validation_status: 'fail', error_code: comparison.error.code });
        continue;
      }
      validatedAirports += 1;
      airports.push({
        ...base,
        ...current,
        validation_status: comparison.qualityWarning ? 'warning' : 'pass',
        quality_warning: comparison.qualityWarning?.code || null
      });
    }

    const failed = airports.some(airport => airport.validation_status === 'fail');
    const warned = airports.some(airport => airport.validation_status === 'warning');
    return {
      captured_at: new Date(now()).toISOString(),
      expected_airports: catalogAirports.length,
      validated_airports: validatedAirports,
      validation_status: failed ? 'fail' : (warned ? 'warning' : 'pass'),
      airports
    };
  };

  if (deps.resolveAirport) return validate(deps.resolveAirport);
  return withBrowserResolver(config, deps, validate);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const equalsAt = argument.indexOf('=');
    const name = argument.slice(2, equalsAt < 0 ? undefined : equalsAt);
    const value = equalsAt >= 0 ? argument.slice(equalsAt + 1) : argv[++index];
    if (!['config', 'output'].includes(name) || !value) throw new Error(`Invalid argument: ${argument}`);
    result[name] = value;
  }
  return result;
}

function writeAtomicJson(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  const temporaryPath = `${absolutePath}.tmp`;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, absolutePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = args.config ? JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')) : { baseUrl: 'https://www.qeeq.pl' };
  const result = await validateLiveLocationCatalog(config);
  if (args.output) writeAtomicJson(args.output, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.validation_status === 'fail' ? 1 : 0;
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, validateLiveLocationCatalog, writeAtomicJson };
