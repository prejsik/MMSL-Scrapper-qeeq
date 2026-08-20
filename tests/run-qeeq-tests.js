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

test('rolling dates retain date-only duration across Warsaw spring DST', () => {
  const { expandScenarios } = require('../src/qeeq/run');
  const scenarios = expandScenarios({ locations: ['Katowice'], startDates: [], rollingDays: 1, durationsDays: [2], pickupTime: '10:00', dropoffTime: '10:00', timeZone: 'Europe/Warsaw', maxScenarios: 7020 }, new Date('2026-03-28T10:00:00Z'));
  assert.equal(scenarios[0].pickupDate, '2026-03-29');
  assert.equal(scenarios[0].dropoffDate, '2026-03-31');
  assert.equal(scenarios[0].rentalDays, 2);
});

test('rolling dates retain date-only duration across Warsaw autumn DST', () => {
  const { expandScenarios } = require('../src/qeeq/run');
  const scenarios = expandScenarios({ locations: ['Katowice'], startDates: [], rollingDays: 1, durationsDays: [2], pickupTime: '10:00', dropoffTime: '10:00', timeZone: 'Europe/Warsaw', maxScenarios: 7020 }, new Date('2026-10-24T10:00:00Z'));
  assert.equal(scenarios[0].pickupDate, '2026-10-25');
  assert.equal(scenarios[0].dropoffDate, '2026-10-27');
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

test('money parsing selects the amount associated with a currency marker', () => {
  const { parseMoney } = require('../src/qeeq/utils');
  assert.equal(parseMoney('2 dni, Cena 119 zł', 'PLN'), 119);
  assert.equal(parseMoney('PLN 3 399,99', null), 3399.99);
});

test('text-only login and Diamond conditions cannot become public prices', () => {
  const { normalizePriceCandidate } = require('../src/qeeq/utils');
  const base = { displayedText: 'Cena 119 zł', rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2 };
  assert.equal(normalizePriceCandidate({ ...base, memberText: 'Zaloguj się, aby otrzymać ofertę' }).total_price, null);
  assert.equal(normalizePriceCandidate({ ...base, memberText: 'Oferta Diamond dostępna dla członków' }).price_tier, 'conditional');
});

test('malformed source URLs are sanitized without recursive diagnostics', () => {
  const { sanitizeSourceUrl } = require('../src/qeeq/utils');
  assert.equal(sanitizeSourceUrl('http://[bad?ticket=secret-ticket'), 'http://[bad');
});

test('diagnostics redact quoted session values and credential headers', () => {
  const { sanitizeDiagnosticText } = require('../src/qeeq/utils');
  const clean = sanitizeDiagnosticText('ticket = "quoted-secret" clid = spaced-secret\nCookie: sid=cookie-secret; qeeq_fpt=other-cookie\nAuthorization: Bearer bearer-secret');
  assert.doesNotMatch(clean, /quoted-secret|spaced-secret|cookie-secret|other-cookie|bearer-secret/);
});

test('CSV excludes forbidden identifiers and their values', () => {
  const { toCsv } = require('../src/qeeq/utils');
  const csv = toCsv([{ ID: 'secret-id', clid: 'secret-clid', safe: 'visible' }]);
  assert.doesNotMatch(csv, /ID|clid|secret-id|secret-clid/i);
  assert.match(csv, /safe|visible/);
});

test('CSV neutralizes string formulas but preserves numeric negatives', () => {
  const { toCsv } = require('../src/qeeq/utils');
  assert.equal(toCsv([{ formula: '=SUM(1,1)', negative: -2 }]), '"formula","negative"\n"\'=SUM(1,1)","-2"');
});

test('spaced Log in and Sign in labels block public price ranking', () => {
  const { normalizePriceCandidate, rankVerifiedPublicOffers } = require('../src/qeeq/utils');
  const base = { displayedText: 'Cena 119 zł', rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2 };
  const offers = ['Log in to continue', 'Sign in to continue'].map((memberText, index) => ({
    id: `conditional-${index}`,
    ...normalizePriceCandidate({ ...base, memberText })
  }));
  assert.deepEqual(offers.map(offer => offer.total_price), [null, null]);
  assert.deepEqual(rankVerifiedPublicOffers(offers), []);
});

test('diagnostics redact quoted Bearer tokens and equals-style credential headers', () => {
  const { sanitizeDiagnosticText } = require('../src/qeeq/utils');
  const clean = sanitizeDiagnosticText('Bearer "synthetic-bearer-secret"\nCookie = sid=synthetic-cookie-secret\nAuthorization = Bearer \'synthetic-authorization-secret\'');
  assert.doesNotMatch(clean, /synthetic-bearer-secret|synthetic-cookie-secret|synthetic-authorization-secret/);
});

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
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const providers = parseObservedListPayload(apiFixture);
  const offer = parseOfferSnapshot({ ...fixture.offer, ratingText: '', depositText: '' }, { rentalDays: 2, vehicle: fixture.vehicle }, providers);
  assert.equal(offer.record_type, 'offer');
  assert.equal(offer.provider_name, 'CARWIZ');
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

test('missing and ambiguous provider joins stay diagnostic end to end', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const { buildOfferBusinessKey, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const assertDiagnostic = (record, error) => {
    assert.equal(record.record_type, 'group');
    assert.equal(record.provider_name, undefined);
    assert.equal(record.total_price, undefined);
    assert.equal(record.price_verified, false);
    assert.deepEqual(record.quality_errors, [error]);
  };

  assertDiagnostic(parseOfferSnapshot(publicSnapshot, { rentalDays: 2, vehicle: fixture.vehicle }, new Map()), 'provider_unresolved');
  const key = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  const ambiguous = new Map([[key, [{ providerName: 'A' }, { providerName: 'B' }]]]);
  assertDiagnostic(parseOfferSnapshot(publicSnapshot, { rentalDays: 2, vehicle: fixture.vehicle }, ambiguous), 'provider_ambiguous');
  const invalidNamed = new Map([[key, [{ providerName: '   ' }]]]);
  assertDiagnostic(parseOfferSnapshot(publicSnapshot, { rentalDays: 2, vehicle: fixture.vehicle }, invalidNamed), 'provider_unresolved');
});

test('missing blank and duplicate shops cannot produce an offer', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const parseWithShops = shops => parseOfferSnapshot(
    publicSnapshot,
    { rentalDays: 2, vehicle: fixture.vehicle },
    parseObservedListPayload({ data: { list: apiFixture.data.list, shops } })
  );
  const assertDiagnostic = (record, error) => {
    assert.equal(record.record_type, 'group');
    assert.equal(record.provider_name, undefined);
    assert.equal(record.total_price, undefined);
    assert.equal(record.price_verified, false);
    assert.deepEqual(record.quality_errors, [error]);
  };

  assertDiagnostic(parseWithShops([]), 'provider_unresolved');
  assertDiagnostic(parseWithShops([{ ...apiFixture.data.shops[0], name: '   ' }]), 'provider_unresolved');
  assertDiagnostic(parseWithShops([
    apiFixture.data.shops[0],
    { ...apiFixture.data.shops[0], name: 'OTHER PROVIDER' }
  ]), 'provider_ambiguous');
});

test('lone id and lone bid matches cannot produce an offer', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const providers = parseObservedListPayload(apiFixture);
  const context = { rentalDays: 2, vehicle: fixture.vehicle };
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const snapshots = [
    { ...publicSnapshot, businessId: 'different-id' },
    { ...publicSnapshot, businessBid: 'different-bid' }
  ];

  for (const snapshot of snapshots) {
    const record = parseOfferSnapshot(snapshot, context, providers);
    assert.equal(record.record_type, 'group');
    assert.equal(record.provider_name, undefined);
    assert.equal(record.total_price, undefined);
    assert.equal(record.price_verified, false);
    assert.deepEqual(record.quality_errors, ['provider_unresolved']);
  }
});

test('discount disagreement stays conditional and API origin alone is not a reference price', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { buildOfferBusinessKey, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const providers = parseObservedListPayload(apiFixture);
  const key = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  providers.get(key)[0].bestPriceInfo = { discount_type: 'other_coupon' };
  providers.get(key)[0].originPriceInfo = { price: 150 };

  const offer = parseOfferSnapshot(fixture.offer, { rentalDays: 2, vehicle: fixture.vehicle }, providers);
  assert.equal(offer.record_type, 'offer');
  assert.equal(offer.total_price, null);
  assert.equal(offer.price_tier, 'conditional');
  assert.equal(offer.price_verified, false);
  assert.equal(offer.reference_price, null);
  assert.deepEqual(offer.quality_errors, ['discount_type_mismatch']);
});

test('malformed parser inputs remain unresolved without throwing', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseGroupSnapshot, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  assert.doesNotThrow(() => parseObservedListPayload({ data: { shops: [null], list: [null, { meal_list: [null] }] } }));
  assert.equal(parseObservedListPayload(null).size, 0);
  assert.equal(parseObservedListPayload({ data: { shops: {}, list: {} } }).size, 0);
  assert.deepEqual(parseGroupSnapshot(null, null), {
    record_type: 'group',
    vehicle_name: null,
    price_verified: false,
    rental_days: null,
    parsing_source: 'dom'
  });
  const record = parseOfferSnapshot(fixture.offer, { rentalDays: 2, vehicle: fixture.vehicle }, {});
  assert.equal(record.record_type, 'group');
  assert.equal(record.provider_name, undefined);
  assert.equal(record.total_price, undefined);
  assert.equal(record.price_verified, false);
  assert.deepEqual(record.quality_errors, ['provider_unresolved']);
  const providers = parseObservedListPayload(apiFixture);
  const noContext = parseOfferSnapshot({ ...fixture.offer, discountType: null, diamondAmount: null }, null, providers);
  assert.equal(noContext.total_price, null);
  assert.equal(noContext.price_verified, false);
  assert.doesNotThrow(() => parseOfferSnapshot(null, null, null));
});

test('blank business-key components stay unresolved end to end', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const { buildOfferBusinessKey, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const context = { rentalDays: 2, vehicle: fixture.vehicle };
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const snapshots = [
    { ...publicSnapshot, businessId: '' },
    { ...publicSnapshot, businessId: '   ' },
    { ...publicSnapshot, businessBid: '' },
    { ...publicSnapshot, businessBid: ' \t ' }
  ];

  for (const snapshot of snapshots) {
    const key = buildOfferBusinessKey(snapshot.businessId, snapshot.businessBid);
    const providers = new Map([[key, [{ providerName: 'SHOULD NOT RESOLVE' }]]]);
    const record = parseOfferSnapshot(snapshot, context, providers);
    assert.equal(key, null);
    assert.equal(record.record_type, 'group');
    assert.equal(record.provider_name, undefined);
    assert.equal(record.total_price, undefined);
    assert.equal(record.price_verified, false);
    assert.deepEqual(record.quality_errors, ['provider_unresolved']);
  }
});

test('duplicate exact-pair meals remain ambiguous when one shop is unmatched', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { buildOfferBusinessKey, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const meal = apiFixture.data.list[0].meal_list[0];
  const providers = parseObservedListPayload({
    data: {
      list: [{ meal_list: [meal, { ...meal, pickup_shop: 'unmatched-shop' }] }],
      shops: apiFixture.data.shops
    }
  });
  const key = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  assert.equal(providers.get(key).length, 2);
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const record = parseOfferSnapshot(publicSnapshot, { rentalDays: 2, vehicle: fixture.vehicle }, providers);

  assert.equal(record.record_type, 'group');
  assert.equal(record.provider_name, undefined);
  assert.equal(record.total_price, undefined);
  assert.equal(record.price_verified, false);
  assert.deepEqual(record.quality_errors, ['provider_ambiguous']);
});

test('duplicate exact-pair meals remain ambiguous when one shop name is blank', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { buildOfferBusinessKey, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const meal = apiFixture.data.list[0].meal_list[0];
  const providers = parseObservedListPayload({
    data: {
      list: [{ meal_list: [meal, { ...meal, pickup_shop: 'blank-shop' }] }],
      shops: [...apiFixture.data.shops, { id: 'blank-shop', name: '   ', score: 9.9 }]
    }
  });
  const key = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  assert.equal(providers.get(key).length, 2);
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const record = parseOfferSnapshot(publicSnapshot, { rentalDays: 2, vehicle: fixture.vehicle }, providers);

  assert.equal(record.record_type, 'group');
  assert.equal(record.provider_name, undefined);
  assert.equal(record.total_price, undefined);
  assert.equal(record.price_verified, false);
  assert.deepEqual(record.quality_errors, ['provider_ambiguous']);
});

test('padded DOM business components do not match an unpadded API pair', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { buildOfferBusinessKey, parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const providers = parseObservedListPayload(apiFixture);
  const context = { rentalDays: 2, vehicle: fixture.vehicle };
  const publicSnapshot = { ...fixture.offer, displayedAmount: '119 zł', discountType: null, diamondAmount: null };
  const canonicalKey = buildOfferBusinessKey(fixture.offer.businessId, fixture.offer.businessBid);
  const snapshots = [
    { ...publicSnapshot, businessId: ` ${fixture.offer.businessId} ` },
    { ...publicSnapshot, businessBid: ` ${fixture.offer.businessBid} ` }
  ];

  for (const snapshot of snapshots) {
    assert.notEqual(buildOfferBusinessKey(snapshot.businessId, snapshot.businessBid), canonicalKey);
    const record = parseOfferSnapshot(snapshot, context, providers);
    assert.equal(record.record_type, 'group');
    assert.equal(record.provider_name, undefined);
    assert.equal(record.total_price, undefined);
    assert.equal(record.price_verified, false);
    assert.deepEqual(record.quality_errors, ['provider_unresolved']);
  }
});

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
  assert.equal(fake.responseListenerAttachedBeforeSubmit, true);
  assert.match(fake.observedRequestUrls[0], /\/car-api\/search\/list/);
  assert.deepEqual(fake.popupClicks, { optionalCookies: 1, lowerBanner: 1 });
  assert.equal(outcome.source_search_url, 'https://www.qeeq.pl/car/search');
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
  assert.equal(snapshot.transmission, 'Automatyczna');
  assert.equal(snapshot.seats, 5);
  assert.equal(snapshot.doors, 5);
  assert.equal(snapshot.luggage, 1);
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

test('search parameter mismatch prevents form submission', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ hiddenValueOverrides: { to_date_1: '11:00' } });
  const scraper = new QeeqScraper({ baseUrl: 'https://www.qeeq.pl', driverAge: '30-60', residenceCountryCode: 'PL' }, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
  const outcome = await scraper.runScenario({ key: 'ktw|2026-09-19|2', airport: { iata: 'KTW' }, pickupDate: '2026-09-19', pickupTime: '10:00', dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2 });
  assert.equal(outcome.error_code, 'search_parameter_mismatch');
  assert.equal(fake.submitted, false);
});

test('transient scenario retry creates only one fresh context', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ failSessions: [1] });
  const scraper = new QeeqScraper({ baseUrl: 'https://www.qeeq.pl', driverAge: '30-60', residenceCountryCode: 'PL' }, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
  const outcome = await scraper.runScenario({ key: 'ktw|2026-09-19|2', airport: { iata: 'KTW' }, pickupDate: '2026-09-19', pickupTime: '10:00', dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2 });
  assert.equal(outcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(fake.contextsCreated, 2);
});

test('unknown network schema falls back to scoped DOM with a quality error', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ networkPayload: { changed: true } });
  const scraper = new QeeqScraper({ baseUrl: 'https://www.qeeq.pl', driverAge: '30-60', residenceCountryCode: 'PL' }, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
  const outcome = await scraper.runScenario({ key: 'ktw|2026-09-19|2', airport: { iata: 'KTW' }, pickupDate: '2026-09-19', pickupTime: '10:00', dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2 });
  assert.equal(outcome.quality_errors.includes('network_schema_unrecognized'), true);
  assert.equal(outcome.groups.length > 0, true);
});

test('missing scoped rating count remains null', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const offer = parseOfferSnapshot({ ...fixture.offer, ratingCountText: null }, { rentalDays: 2, vehicle: fixture.vehicle }, parseObservedListPayload(apiFixture));
  assert.equal(offer.provider_rating_count, null);
});

test('location validator fails ambiguous visible matches', async () => {
  const fixture = require('./fixtures/qeeq-airport-autocomplete.json');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const result = await validateLiveLocationCatalog({}, {
    resolveAirport: async airport => airport.iata === 'KTW'
      ? [fixture.find(item => item.iata === 'KTW'), fixture.find(item => item.iata === 'KTW')]
      : fixture.find(item => item.iata === airport.iata),
    now: () => new Date('2026-08-20T10:00:00Z')
  });
  assert.equal(result.validation_status, 'fail');
  assert.equal(result.validated_airports, 8);
  assert.equal(result.airports.find(item => item.iata === 'KTW').error_code, 'location_match_ambiguous');
});

test('location validator writes JSON atomically', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { writeAtomicJson } = require('../src/qeeq/validateLocations');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-locations-'));
  const output = path.join(directory, 'locations.json');
  try {
    writeAtomicJson(output, { validation_status: 'pass' });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), { validation_status: 'pass' });
    assert.equal(fs.existsSync(`${output}.tmp`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scraper rejects dependency overrides outside the documented seam', () => {
  const { QeeqScraper } = require('../src/qeeq/scraper');
  assert.throws(() => new QeeqScraper({}, { page: {} }), /Unsupported QeeqScraper dependency override: page/);
});

test('location validator rejects missing current QEEQ IDs', async () => {
  const fixture = require('./fixtures/qeeq-airport-autocomplete.json');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const result = await validateLiveLocationCatalog({}, {
    resolveAirport: async airport => {
      const match = fixture.find(item => item.iata === airport.iata);
      return airport.iata === 'KTW' ? { ...match, landmark: undefined } : match;
    },
    now: () => new Date('2026-08-20T10:00:00Z')
  });
  assert.equal(result.validation_status, 'fail');
  assert.equal(result.airports.find(item => item.iata === 'KTW').error_code, 'location_id_missing');
});
