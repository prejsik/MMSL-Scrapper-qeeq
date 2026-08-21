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
    { id: 'public-b', provider_name: 'PUBLIC B', currency: 'PLN', price_tier: 'public', price_verified: true, total_price: 119 },
    { id: 'unknown', price_tier: 'public', price_verified: false, total_price: 90 },
    { id: 'newcomer', price_tier: 'conditional', price_verified: false, conditional_offer_total: 106 },
    { id: 'public-a', provider_name: 'PUBLIC A', currency: 'PLN', price_tier: 'public', price_verified: true, total_price: 110 }
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
    { record_type: 'offer', total_price: 119, currency: 'PLN', price_tier: 'public', price_verified: true, provider_name: 'PUBLIC PROVIDER' }
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
    supplierRatingText: '8.5 (120)',
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
  const scraper = new QeeqScraper({ baseUrl: 'https://www.qeeq.pl', driverAge: '30-60', residenceCountryCode: 'PL', apiObservationTimeoutMs: 10 }, { launchBrowser: fake.launchBrowser, sleep: async () => {} });
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

function task5Scenario() {
  return {
    key: 'ktw|2026-09-19|2',
    airport: { iata: 'KTW', label: 'Port Lotniczy Katowice-Pyrzowice' },
    pickupDate: '2026-09-19', pickupTime: '10:00',
    dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2
  };
}

function task5Config(overrides = {}) {
  return {
    baseUrl: 'https://www.qeeq.pl', timeZone: 'Europe/Warsaw',
    driverAge: '30-60', residenceCountryCode: 'PL',
    navigationTimeoutMs: 300, resultsTimeoutMs: 300, apiObservationTimeoutMs: 100,
    maxLoadMoreIterations: 20, maxVehicleGroupsPerScenario: 300, maxOffersPerScenario: 1500,
    ...overrides
  };
}

test('rating never falls back outside the scoped supplier-rating locator', () => {
  const { snapshotOfferSubtree } = require('../src/qeeq/scraper');
  const snapshot = snapshotOfferSubtree({
    supplierRatingText: '',
    supplierInfoText: 'CARWIZ 9.9 (999)',
    outsideSidebarText: 'Ocena 8.8 (888)'
  });
  assert.equal(snapshot.ratingText, null);
  assert.equal(snapshot.ratingCountText, null);
});

test('scraper polls past stale autocomplete before selecting a fresh exact match', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ autocompleteDelayPolls: 2 });
  const outcome = await new QeeqScraper(task5Config(), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.status, 'success');
  assert.equal(fake.selectedSuggestionIata, 'KTW');
  assert.equal(fake.clockMs >= 200, true);
});

test('scraper bounds missing autocomplete polling and rejects ambiguous fresh matches', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const missing = createFakeQeeqBrowser({ autocompleteOverrides: { KTW: 'missing' } });
  const missingOutcome = await new QeeqScraper(task5Config({ resultsTimeoutMs: 200 }), { launchBrowser: missing.launchBrowser, now: missing.now, sleep: missing.sleep }).runScenario(task5Scenario());
  assert.equal(missingOutcome.error_code, 'location_match_missing');
  assert.equal(missing.clockMs >= 200, true);

  const ambiguous = createFakeQeeqBrowser({ autocompleteOverrides: { KTW: 'ambiguous' } });
  const ambiguousOutcome = await new QeeqScraper(task5Config(), { launchBrowser: ambiguous.launchBrowser, now: ambiguous.now, sleep: ambiguous.sleep }).runScenario(task5Scenario());
  assert.equal(ambiguousOutcome.error_code, 'location_match_ambiguous');
});

test('browser-backed validator polls fresh suggestions and never submits', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const fake = createFakeQeeqBrowser({ autocompleteDelayPolls: 1 });
  const result = await validateLiveLocationCatalog(task5Config(), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep });
  assert.equal(result.validation_status, 'pass');
  assert.equal(result.validated_airports, 9);
  assert.equal(fake.submitted, false);
});

test('browser-backed validator reports missing and ambiguous timed autocomplete results', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  for (const [mode, expectedCode] of [['missing', 'location_match_missing'], ['ambiguous', 'location_match_ambiguous']]) {
    const fake = createFakeQeeqBrowser({ autocompleteOverrides: { KTW: mode } });
    const result = await validateLiveLocationCatalog(task5Config({ resultsTimeoutMs: 200 }), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep });
    assert.equal(result.validation_status, 'fail');
    assert.equal(result.airports.find(item => item.iata === 'KTW').error_code, expectedCode);
    assert.equal(fake.submitted, false);
  }
});

test('group expansion waits for scoped anchors and skips an already-open group', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const delayed = createFakeQeeqBrowser({ expansionDelayPolls: 2 });
  const delayedOutcome = await new QeeqScraper(task5Config(), { launchBrowser: delayed.launchBrowser, now: delayed.now, sleep: delayed.sleep }).runScenario(task5Scenario());
  assert.equal(delayedOutcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(delayed.supplierButtonClicks, 1);
  assert.equal(delayed.clockMs >= 200, true);

  const alreadyOpen = createFakeQeeqBrowser({ initiallyOpen: true });
  const openOutcome = await new QeeqScraper(task5Config(), { launchBrowser: alreadyOpen.launchBrowser, now: alreadyOpen.now, sleep: alreadyOpen.sleep }).runScenario(task5Scenario());
  assert.equal(openOutcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(alreadyOpen.supplierButtonClicks, 0);
});

test('group expansion timeout remains diagnostic and does not read hidden anchors', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ expansionDelayPolls: 99 });
  const outcome = await new QeeqScraper(task5Config({ resultsTimeoutMs: 200 }), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.offers.length, 0);
  assert.equal(outcome.quality_errors.includes('group_expansion_timeout'), true);
});

test('load-more polls delayed growth and treats button disappearance as completion', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const delayed = createFakeQeeqBrowser({ loadMoreCounts: [25, 50], loadMoreDelayPolls: [2] });
  const delayedOutcome = await new QeeqScraper(task5Config(), { launchBrowser: delayed.launchBrowser, now: delayed.now, sleep: delayed.sleep }).runScenario(task5Scenario());
  assert.equal(delayedOutcome.quality_errors.includes('load_more_stalled'), false);
  assert.equal(delayed.currentGroupCount, 50);

  const disappeared = createFakeQeeqBrowser({ loadMoreCounts: [25, 25], loadMoreDisappearsAfterClick: 1 });
  const disappearedOutcome = await new QeeqScraper(task5Config(), { launchBrowser: disappeared.launchBrowser, now: disappeared.now, sleep: disappeared.sleep }).runScenario(task5Scenario());
  assert.equal(disappearedOutcome.quality_errors.includes('load_more_stalled'), false);
});

test('load-more respects the vehicle group cap before clicking', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser();
  const outcome = await new QeeqScraper(task5Config({ maxVehicleGroupsPerScenario: 25 }), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(fake.loadMoreClicks, 0);
  assert.equal(outcome.quality_errors.includes('vehicle_group_limit_reached'), true);
});

test('API observation continues from an early unknown response to a later supported response', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ responseSequence: [
    { url: 'https://www.qeeq.pl/car-api/search/list?page=stale', payload: { changed: true } },
    { url: 'https://www.qeeq.pl/car-api/search/list?page=current', payload: apiFixture, emitDelayMs: 5 }
  ] });
  const outcome = await new QeeqScraper(task5Config({ apiObservationTimeoutMs: 100 }), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(outcome.quality_errors.includes('network_schema_unrecognized'), true);
  assert.equal(fake.responseListeners, 0);
});

test('API observation uses one absolute budget across all JSON responses', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ responseSequence: [
    { url: 'https://www.qeeq.pl/car-api/search/list?page=first', payload: { changed: true }, jsonCostMs: 30 },
    { url: 'https://www.qeeq.pl/car-api/search/list?page=second', payload: apiFixture, jsonCostMs: 30 }
  ] });
  const outcome = await new QeeqScraper(task5Config({ apiObservationTimeoutMs: 50 }), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.offers.length, 0);
  assert.equal(outcome.quality_errors.includes('network_schema_unrecognized'), true);
  assert.equal(fake.responseListeners, 0);
});

test('visible popup and profile controls are used when hidden matches come first', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ hiddenFirstControls: true });
  const outcome = await new QeeqScraper(task5Config(), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.status, 'success');
  assert.deepEqual(fake.popupClicks, { optionalCookies: 1, lowerBanner: 1 });
  assert.equal(fake.driverAge, '30-60');
  assert.equal(fake.residenceCountryCode, 'PL');
});

test('atomic validator output overwrites and removes a unique temp after rename failure', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { writeAtomicJson } = require('../src/qeeq/validateLocations');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-atomic-'));
  const output = path.join(directory, 'locations.json');
  const originalRename = fs.renameSync;
  const tempPaths = [];
  try {
    fs.renameSync = (source, destination) => {
      tempPaths.push(source);
      return originalRename(source, destination);
    };
    writeAtomicJson(output, { version: 1 });
    writeAtomicJson(output, { version: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), { version: 2 });
    assert.notEqual(tempPaths[0], tempPaths[1]);

    fs.renameSync = () => { throw new Error('simulated rename failure'); };
    assert.throws(() => writeAtomicJson(output, { version: 3 }), /simulated rename failure/);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), { version: 2 });
    assert.deepEqual(fs.readdirSync(directory).filter(name => name !== 'locations.json'), []);
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scraper cleanup closes both resources and preserves the primary operation error', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ failSessions: [1, 2], contextCloseError: 'context_close_failed', browserCloseError: 'browser_close_failed' });
  const outcome = await new QeeqScraper(task5Config(), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.error_code, 'session_expired');
  assert.equal(fake.contextCloseAttempts, 2);
  assert.equal(fake.browserCloseAttempts, 2);
});

test('scraper surfaces cleanup failure after success but still closes the browser', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ contextCloseError: 'context_close_failed' });
  const outcome = await new QeeqScraper(task5Config(), { launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep }).runScenario(task5Scenario());
  assert.equal(outcome.error_code, 'context_close_failed');
  assert.equal(fake.contextCloseAttempts, 1);
  assert.equal(fake.browserCloseAttempts, 1);
});

test('browser-backed validator closes both resources with correct error precedence', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const operationFailure = createFakeQeeqBrowser({ failSessions: [1], contextCloseError: 'context_close_failed', browserCloseError: 'browser_close_failed' });
  await assert.rejects(
    validateLiveLocationCatalog(task5Config(), { launchBrowser: operationFailure.launchBrowser, now: operationFailure.now, sleep: operationFailure.sleep }),
    error => error.code === 'session_expired'
  );
  assert.equal(operationFailure.contextCloseAttempts, 1);
  assert.equal(operationFailure.browserCloseAttempts, 1);

  const cleanupFailure = createFakeQeeqBrowser({ contextCloseError: 'context_close_failed', browserCloseError: 'browser_close_failed' });
  await assert.rejects(
    validateLiveLocationCatalog(task5Config(), { launchBrowser: cleanupFailure.launchBrowser, now: cleanupFailure.now, sleep: cleanupFailure.sleep }),
    error => error.code === 'context_close_failed'
  );
  assert.equal(cleanupFailure.contextCloseAttempts, 1);
  assert.equal(cleanupFailure.browserCloseAttempts, 1);
});

test('unchanged exact autocomplete present before fill is rejected as stale by scraper and validator', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');

  const scraperFake = createFakeQeeqBrowser({ staleExactSuggestion: true });
  const outcome = await new QeeqScraper(task5Config({ resultsTimeoutMs: 200 }), {
    launchBrowser: scraperFake.launchBrowser, now: scraperFake.now, sleep: scraperFake.sleep
  }).runScenario(task5Scenario());
  assert.equal(outcome.error_code, 'location_match_missing');
  assert.equal(scraperFake.selectedSuggestionIata, null);

  const validatorFake = createFakeQeeqBrowser({ staleExactSuggestion: true });
  const validation = await validateLiveLocationCatalog(task5Config({ resultsTimeoutMs: 200 }), {
    launchBrowser: validatorFake.launchBrowser, now: validatorFake.now, sleep: validatorFake.sleep
  });
  assert.equal(validation.validation_status, 'fail');
  assert.equal(validation.airports.find(item => item.iata === 'KTW').error_code, 'location_match_missing');
  assert.equal(validatorFake.submitted, false);
});

test('search uses only visible pickup date time and submit controls when hidden duplicates come first', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ hiddenFirstControls: true });
  const outcome = await new QeeqScraper(task5Config(), {
    launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep
  }).runScenario(task5Scenario());

  assert.equal(outcome.status, 'success');
  const interactiveActions = fake.actions.filter(action =>
    (action[0] === 'fill' && ['pickupInput', 'dateOrTime'].includes(action[1]))
    || (action[0] === 'click' && action[1] === 'submit'));
  assert.equal(interactiveActions.filter(action => action[1] === 'pickupInput').length, 2);
  assert.equal(interactiveActions.filter(action => action[1] === 'dateOrTime').length, 4);
  assert.equal(interactiveActions.filter(action => action[1] === 'submit').length, 1);
  assert.equal(interactiveActions.every(action => action[3] === 1), true);
});

test('clear-only autocomplete change cannot establish post-query freshness', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');

  const scraperFake = createFakeQeeqBrowser({ restoredExactWithoutRefresh: true });
  const outcome = await new QeeqScraper(task5Config({ resultsTimeoutMs: 200 }), {
    launchBrowser: scraperFake.launchBrowser, now: scraperFake.now, sleep: scraperFake.sleep
  }).runScenario(task5Scenario());
  assert.equal(outcome.error_code, 'location_match_missing');
  assert.equal(scraperFake.selectedSuggestionIata, null);

  const validatorFake = createFakeQeeqBrowser({ restoredExactWithoutRefresh: true });
  const validation = await validateLiveLocationCatalog(task5Config({ resultsTimeoutMs: 200 }), {
    launchBrowser: validatorFake.launchBrowser, now: validatorFake.now, sleep: validatorFake.sleep
  });
  assert.equal(validation.validation_status, 'fail');
  assert.equal(validation.airports.find(item => item.iata === 'KTW').error_code, 'location_match_missing');
  assert.equal(validatorFake.selectedSuggestionIata, null);
  assert.equal(validatorFake.submitted, false);
});

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

test('canonical envelopes keep only the stable QEEQ search URL', () => {
  const { buildRootPayload, buildScenarioPayload } = require('../src/qeeq/run');
  const scenario = { key: 'a', airport: { key: 'ktw', iata: 'KTW' }, pickupDate: '2026-09-01', pickupTime: '10:00', dropoffDate: '2026-09-03', dropoffTime: '10:00', rentalDays: 2 };
  const stable = buildScenarioPayload({ scenario, outcome: { offers: [{ record_type: 'offer', provider_name: 'PUBLIC', source_search_url: 'https://www.qeeq.pl/car/search?id=secret&ticket=secret', price_verified: true }], errors: [], quality_errors: [] } });
  assert.equal(stable.offers[0].source_search_url, 'https://www.qeeq.pl/car/search');
  assert.doesNotMatch(JSON.stringify(stable), /secret|ticket/);
  assert.doesNotMatch(JSON.stringify(buildRootPayload({ expected_checks: 1, scenarios: [stable] })), /secret|ticket/);
  const foreign = buildScenarioPayload({ scenario, outcome: { offers: [{ record_type: 'offer', provider_name: 'PUBLIC', source_search_url: 'https://example.test/car/search?id=secret' }], errors: [], quality_errors: [] } });
  assert.equal(foreign.offers[0].source_search_url, null);
});

test('exit code accepts only exact known successful and warning states', () => {
  const { exitCodeForPayload } = require('../src/qeeq/run');
  assert.equal(exitCodeForPayload({ run_status: 'success', quality_status: 'pass' }), 0);
  assert.equal(exitCodeForPayload({ run_status: 'partial', quality_status: 'pass' }), 2);
  assert.equal(exitCodeForPayload({ run_status: 'success', quality_status: 'warning' }), 2);
  assert.equal(exitCodeForPayload({ run_status: 'partial', quality_status: 'warning' }), 2);
  for (const payload of [{}, { run_status: 'success', quality_status: 'unknown' }, { run_status: 'unknown', quality_status: 'pass' }, { run_status: 'failure', quality_status: 'warning' }, { run_status: 'partial', quality_status: 'fail' }]) {
    assert.equal(exitCodeForPayload(payload), 1);
  }
});

test('verified conditional price does not downgrade otherwise valid public quality', () => {
  const { buildRootPayload } = require('../src/qeeq/run');
  const payload = buildRootPayload({ expected_checks: 1, scenarios: [{ key: 'a', status: 'success', errors: [], quality_errors: [], offers: [
    { record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, conditional_price_verified: false, total_price: 100, currency: 'PLN' },
    { record_type: 'offer', provider_name: 'MEMBER', price_tier: 'conditional', price_verified: false, conditional_price_verified: true, conditional_offer_total: 90, currency: 'PLN' }
  ] }] });
  assert.equal(payload.quality_status, 'pass');
  assert.equal(payload.quality.quality_errors.includes('price_unverified'), false);
});

test('offer quality errors are sanitized and folded into root quality', () => {
  const { buildScenarioPayload, buildRootPayload } = require('../src/qeeq/run');
  const scenario = { key: 'a' };
  const item = buildScenarioPayload({ scenario, outcome: { offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN', quality_errors: ['discount_type_mismatch', 'ticket=secret'] }], errors: [], quality_errors: [] } });
  const payload = buildRootPayload({ expected_checks: 1, scenarios: [item] });
  assert.equal(payload.quality_status, 'warning');
  assert.equal(payload.quality.quality_errors.includes('discount_type_mismatch'), true);
  assert.doesNotMatch(JSON.stringify(payload), /ticket=secret/);
});

test('auxiliary reports preflight complete inputs and write actual descriptors atomically', () => {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { main } = require('../src/qeeq/report');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-aux-'));
  const names = ['qeeq-results-latest.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx'];
  const files = names.map(name => path.join(directory, name));
  const quality = path.join(directory, 'quality-summary.json');
  const manifest = path.join(directory, 'run-manifest.json');
  try {
    fs.writeFileSync(files[0], JSON.stringify({ run_status: 'success', quality_status: 'pass', quality: {} }));
    fs.writeFileSync(files[1], 'csv');
    fs.writeFileSync(files[2], '<html>report</html>');
    fs.writeFileSync(files[3], 'xlsx');
    assert.equal(main(['--input=' + files[0], '--output-quality=' + quality, '--output-manifest=' + manifest, '--manifest-files=' + files.join(',')]), 0);
    const built = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.deepEqual(built.files.map(item => item.bytes), files.map(file => fs.statSync(file).size));
    assert.deepEqual(built.files.map(item => item.sha256), files.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
    fs.rmSync(quality);
    fs.rmSync(manifest);
    fs.rmSync(files[3]);
    assert.throws(() => main(['--input=' + files[0], '--output-quality=' + quality, '--output-manifest=' + manifest, '--manifest-files=' + files.join(',')]), /Missing manifest input/);
    assert.equal(fs.existsSync(quality), false);
    assert.equal(fs.existsSync(manifest), false);
    assert.throws(() => main(['--input=' + path.join(directory, 'other.json'), '--output-quality=' + quality, '--output-manifest=' + manifest, '--manifest-files=' + files.join(',')]), /exactly match/);
    assert.throws(() => main(['--input=' + files[0], '--output-quality=' + files[1], '--output-manifest=' + manifest, '--manifest-files=' + files.join(',')]), /cannot collide/);
    assert.throws(() => main(['--input=' + files[0], '--output-quality=' + quality, '--output-manifest=' + manifest, '--manifest-files=' + [files[0], files[1], files[2], path.join(os.tmpdir(), 'qeeq-summary.xlsx')].join(',')]), /common output directory/);
    assert.equal(main(['--help']), 0);
    assert.equal(fs.existsSync(quality), false);
    assert.equal(fs.existsSync(manifest), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('executeRun honors bounded concurrency, deterministic result order, and serialized snapshots', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { executeRun } = require('../src/qeeq/run');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-concurrency-'));
  const savePath = path.join(directory, 'result.json');
  let active = 0;
  let maxActive = 0;
  let snapshots = 0;
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (...args) => { snapshots += 1; return originalRename(...args); };
    const payload = await executeRun({ savePath, locationConcurrency: 2 }, {
      scenarioPlanner: () => [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      runScenario: scenario => new Promise(resolve => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active -= 1;
          resolve({ key: scenario.key, status: 'success', groups: [], offers: [{ record_type: 'offer', provider_name: scenario.key, price_tier: 'public', price_verified: true, total_price: 1, currency: 'PLN' }], errors: [], quality_errors: [] });
        }, scenario.key === 'a' ? 20 : 1);
      })
    });
    assert.equal(maxActive, 2);
    assert.deepEqual(payload.scenarios.map(item => item.key), ['a', 'b', 'c']);
    assert.equal(snapshots, 4);
    assert.equal(fs.existsSync(`${savePath}.tmp`), false);
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CSV has the exact fixed header order and neutralizes formulas without forbidden fields', () => {
  const { CSV_HEADERS, buildCsv } = require('../src/qeeq/report');
  const csv = buildCsv({ scenarios: [{ key: 'a', offers: [{ record_type: 'offer', provider_name: '=PUBLIC', total_price: -2, ticket: 'secret', qeeq_fpt: 'secret' }] }] });
  const [header, row] = csv.split('\n');
  assert.equal(header, CSV_HEADERS.join(','));
  assert.match(row, /'=PUBLIC/);
  assert.doesNotMatch(csv, /ticket|qeeq_fpt|secret/);
});

test('canonical envelope tolerates malformed list fields', () => {
  const { buildScenarioPayload } = require('../src/qeeq/run');
  const payload = buildScenarioPayload({ outcome: { offers: {}, groups: {}, errors: {}, quality_errors: 'bad' } });
  assert.deepEqual(payload.offers, []);
  assert.deepEqual(payload.groups, []);
  assert.deepEqual(payload.errors, []);
  assert.deepEqual(payload.quality_errors, []);
});

test('auxiliary reports reject a Windows case-variant output collision without overwriting input', () => {
  if (process.platform !== 'win32') return;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { main } = require('../src/qeeq/report');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-aux-case-'));
  const names = ['qeeq-results-latest.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx'];
  const files = names.map(name => path.join(directory, name));
  const quality = path.join(directory, 'quality-summary.json');
  const manifest = path.join(directory, 'run-manifest.json');
  const originalCsv = 'original CSV bytes';
  try {
    fs.writeFileSync(files[0], JSON.stringify({ run_status: 'success', quality_status: 'pass', quality: {} }));
    fs.writeFileSync(files[1], originalCsv);
    fs.writeFileSync(files[2], '<html>report</html>');
    fs.writeFileSync(files[3], 'xlsx');
    assert.throws(() => main(['--input=' + files[0], '--output-quality=' + path.join(directory, 'QEEQ-RESULTS.CSV'), '--output-manifest=' + manifest, '--manifest-files=' + files.join(',')]), /cannot collide/);
    assert.equal(fs.readFileSync(files[1], 'utf8'), originalCsv);
    assert.equal(fs.existsSync(quality), false);
    assert.equal(fs.existsSync(manifest), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge preserves partial failures and deterministic scenario order', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const merged = mergePayloads([
    { file: 'part-b.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'b', offers: [] }], errors: [{ scenario_key: 'b' }] } },
    { file: 'part-a.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC PROVIDER', price_tier: 'public', price_verified: true, total_price: 119, currency: 'PLN' }] }], errors: [] } }
  ], { expectedScenarioKeys: ['a', 'b'] });
  assert.deepEqual(merged.scenarios.map(item => item.key), ['a', 'b']);
  assert.equal(merged.expected_scenarios, 2);
  assert.equal(merged.completed_scenarios, 2);
  assert.equal(merged.completed_checks, 1);
  assert.equal(merged.failed_checks, 1);
  assert.equal(merged.quality.verified_public_offer_count, 1);
  assert.equal(merged.run_status, 'partial');
  assert.equal(merged.quality_status, 'warning');
  assert.deepEqual(merged.errors, [{ code: 'execution_failed', scenario_key: 'b' }]);
});

test('merge rejects duplicate scenario keys and incompatible schema versions', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const duplicate = { schema_version: 1, provider: 'qeeq.pl', scenarios: [{ key: 'a', offers: [] }], errors: [] };
  assert.throws(() => mergePayloads([{ file: 'one.json', payload: duplicate }, { file: 'two.json', payload: duplicate }]), /Duplicate scenario key: a/);
  assert.throws(() => mergePayloads([{ file: 'old.json', payload: { schema_version: 2, scenarios: [] } }]), /Unsupported schema_version 2/);
});

test('merge records missing expected scenarios without silently shrinking workload', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const publicOffer = { record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' };
  const partial = mergePayloads([{ file: 'one.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 2, expected_checks: 2, scenarios: [{ key: 'a', status: 'success', offers: [publicOffer] }], errors: [] } }]);
  assert.equal(partial.expected_scenarios, 2);
  assert.equal(partial.run_status, 'partial');
  assert.equal(partial.quality_status, 'warning');
  assert.deepEqual(partial.errors, [{ code: 'missing_chunk_scenario', scenario_key: null }]);

  const failed = mergePayloads([], { expectedScenarioKeys: ['a'] });
  assert.equal(failed.expected_scenarios, 1);
  assert.equal(failed.run_status, 'failure');
  assert.equal(failed.quality_status, 'fail');
  assert.deepEqual(failed.errors, [{ code: 'missing_chunk_scenario', scenario_key: 'a' }]);
});

test('merge validates requested option sets and preserves sanitized quality signals', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const entry = {
    file: 'part.json',
    payload: {
      schema_version: 1,
      provider: 'qeeq.pl',
      expected_scenarios: 1,
      expected_checks: 1,
      options: { start_dates: ['2026-09-19'], durations_days: [2], airport_keys: ['katowice-ktw'], limits: { max_scenarios: 7020 } },
      scenarios: [{ key: 'katowice-ktw:2026-09-19:2', status: 'success', pickup_at: '2026-09-19T10:00:00', rental_days: 2, airport_key: 'katowice-ktw', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }], quality_errors: ['location_id_drift'], errors: [] }],
      errors: [],
      quality: { quality_errors: ['chunk_truncated'] }
    }
  };
  const merged = mergePayloads([entry]);
  assert.deepEqual(merged.quality.quality_errors, ['chunk_truncated', 'location_id_drift']);
  assert.equal(merged.quality_status, 'warning');

  const badOptions = structuredClone(entry);
  badOptions.payload.options.durations_days = [3];
  assert.throws(() => mergePayloads([badOptions]), /is outside requested durations_days/);

  const otherLimits = structuredClone(entry);
  otherLimits.file = 'other.json';
  otherLimits.payload.options.limits = { max_scenarios: 10 };
  assert.throws(() => mergePayloads([entry, otherLimits]), /Incompatible requested option limits/);
});

test('merge discovers JSON chunks recursively in deterministic order', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { findJsonFiles, readJsonPayloads } = require('../src/qeeq/mergeResults');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-merge-files-'));
  try {
    fs.mkdirSync(path.join(directory, 'z'));
    fs.mkdirSync(path.join(directory, 'a'));
    fs.writeFileSync(path.join(directory, 'z', 'part-b.json'), '{"schema_version":1,"scenarios":[]}');
    fs.writeFileSync(path.join(directory, 'a', 'part-a.json'), '{"schema_version":1,"scenarios":[]}');
    fs.writeFileSync(path.join(directory, 'ignored.txt'), '{}');
    assert.deepEqual(findJsonFiles(directory).map(file => path.relative(directory, file).replace(/\\/g, '/')), ['a/part-a.json', 'z/part-b.json']);
    assert.deepEqual(readJsonPayloads(directory).map(entry => path.relative(directory, entry.file).replace(/\\/g, '/')), ['a/part-a.json', 'z/part-b.json']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge CLI writes both outputs atomically after complete preflight', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { parseMergeArgs } = require('../src/qeeq/mergeResults');
  const mergeScript = path.resolve(__dirname, '../src/qeeq/mergeResults.js');
  const runMerge = args => spawnSync(process.execPath, [mergeScript, ...args], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-merge-cli-'));
  const inputDir = path.join(directory, 'parts');
  const outputJson = path.join(directory, 'merged.json');
  const outputCsv = path.join(directory, 'merged.csv');
  const originalJson = 'original json';
  const originalCsv = 'original csv';
  try {
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, 'part.json'), JSON.stringify({ schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }], errors: [], quality_errors: [] }], errors: [] }));
    fs.writeFileSync(outputJson, originalJson);
    fs.writeFileSync(outputCsv, originalCsv);
    assert.equal(runMerge(['--input-dir=' + inputDir, '--output-json=' + outputJson, '--output-csv=' + outputCsv]).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(outputJson, 'utf8')).run_status, 'success');
    assert.match(fs.readFileSync(outputCsv, 'utf8'), /PUBLIC/);
    assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.bak')), false);

    fs.writeFileSync(outputJson, originalJson);
    fs.writeFileSync(outputCsv, originalCsv);
    assert.equal(runMerge(['--input-dir=' + inputDir, '--output-json=' + outputJson, '--output-csv=' + outputJson]).status, 1);
    assert.equal(fs.readFileSync(outputJson, 'utf8'), originalJson);
    assert.equal(fs.readFileSync(outputCsv, 'utf8'), originalCsv);
    assert.equal(runMerge(['--input-dir=' + inputDir, '--output-json=' + path.join(inputDir, 'part.json'), '--output-csv=' + outputCsv]).status, 1);
    assert.equal(runMerge(['--help']).status, 0);
    assert.deepEqual(parseMergeArgs(['--input-dir=x', '--output-json=y', '--output-csv=z']), { inputDir: 'x', outputJson: 'y', outputCsv: 'z' });
    assert.throws(() => parseMergeArgs(['--wat']), /Unknown option/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge rejects forbidden QEEQ session and offer business identifiers', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  for (const field of ['clid', 'ticket', 'qeeq_fpt', 'businessId', 'businessBid']) {
    assert.throws(() => mergePayloads([{ file: 'unsafe.json', payload: { schema_version: 1, scenarios: [{ key: 'a', [field]: 'secret', offers: [] }] } }]), /Forbidden field/);
  }
});

test('merge requires comparable option declarations and stable source URLs', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const withOptions = {
    file: 'one.json',
    payload: {
      schema_version: 1, expected_scenarios: 1, expected_checks: 1,
      provider: 'qeeq.pl',
      options: { start_dates: ['2026-09-19'], durations_days: [2], airport_keys: ['katowice-ktw'], limits: {} },
      scenarios: [{ key: 'katowice-ktw:2026-09-19:2', status: 'success', pickup_at: '2026-09-19T10:00:00', rental_days: 2, airport_key: 'katowice-ktw', offers: [] }]
    }
  };
  const withoutOptions = { file: 'two.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'b', offers: [] }], errors: [] } };
  assert.throws(() => mergePayloads([withOptions, withoutOptions]), /Incompatible requested option declarations/);

  const differentConcurrency = structuredClone(withOptions);
  const secondConcurrency = structuredClone(withOptions);
  differentConcurrency.payload.options.concurrency = 1;
  secondConcurrency.file = 'two.json';
  secondConcurrency.payload.options.concurrency = 2;
  assert.throws(() => mergePayloads([differentConcurrency, secondConcurrency]), /Incompatible requested option concurrency/);

  const unsafeUrl = structuredClone(withOptions);
  unsafeUrl.payload.scenarios[0].offers = [{ record_type: 'offer', provider_name: 'PUBLIC', source_search_url: 'https://www.qeeq.pl/car/search?id=secret' }];
  assert.throws(() => mergePayloads([unsafeUrl]), /Unsafe source_search_url/);
});

test('merge preserves safe root errors for absent scenario keys and validates expected key arrays', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const merged = mergePayloads([{ file: 'part.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [], errors: [{ code: 'navigation_timeout', scenario_key: 'missing:2026-09-19:2' }] } }]);
  assert.deepEqual(merged.errors, [
    { code: 'missing_chunk_scenario', scenario_key: null },
    { code: 'navigation_timeout', scenario_key: 'missing:2026-09-19:2' }
  ]);
  assert.throws(() => mergePayloads([], { expectedScenarioKeys: 'a' }), /must be an array/);
  assert.throws(() => mergePayloads([], { expectedScenarioKeys: [''] }), /Invalid expected scenario key/);
  assert.throws(() => mergePayloads([], { expectedScenarioKeys: ['a', 'a'] }), /Duplicate expected scenario key/);
});

test('merge module exposes only the documented pure interfaces', () => {
  assert.deepEqual(Object.keys(require('../src/qeeq/mergeResults')).sort(), ['findJsonFiles', 'mergePayloads', 'parseMergeArgs', 'readJsonPayloads']);
});

test('merge output is deterministic when chunks omit capture timestamps', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const entries = [{ file: 'part.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }] }], errors: [] } }];
  assert.deepEqual(mergePayloads(entries), mergePayloads(entries));
  assert.equal(mergePayloads(entries).started_at, null);
});

test('authoritative expected keys report a wholly absent chunk per scenario key', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const offer = { record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' };
  const merged = mergePayloads([{ file: 'part-a.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'a', status: 'success', offers: [offer], errors: [], quality_errors: [] }], errors: [] } }], { expectedScenarioKeys: ['a', 'b', 'c'] });
  assert.equal(merged.expected_scenarios, 3);
  assert.equal(merged.run_status, 'partial');
  assert.equal(merged.quality_status, 'warning');
  assert.deepEqual(merged.errors, [
    { code: 'missing_chunk_scenario', scenario_key: 'b' },
    { code: 'missing_chunk_scenario', scenario_key: 'c' }
  ]);
});

test('merge CLI accepts a protected expected-keys file and detects an absent chunk', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { parseMergeArgs } = require('../src/qeeq/mergeResults');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-merge-expected-'));
  const inputDir = path.join(directory, 'parts');
  const expectedFile = path.join(directory, 'expected.json');
  const outputJson = path.join(directory, 'merged.json');
  const outputCsv = path.join(directory, 'merged.csv');
  const mergeScript = path.resolve(__dirname, '../src/qeeq/mergeResults.js');
  try {
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, 'part.json'), JSON.stringify({ schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }], errors: [], quality_errors: [] }], errors: [] }));
    fs.writeFileSync(expectedFile, JSON.stringify(['a', 'b']));
    const result = spawnSync(process.execPath, [mergeScript, '--input-dir=' + inputDir, '--expected-keys-file=' + expectedFile, '--output-json=' + outputJson, '--output-csv=' + outputCsv], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const merged = JSON.parse(fs.readFileSync(outputJson, 'utf8'));
    assert.equal(merged.run_status, 'partial');
    assert.deepEqual(merged.errors, [{ code: 'missing_chunk_scenario', scenario_key: 'b' }]);
    assert.deepEqual(parseMergeArgs(['--input-dir=x', '--expected-keys-file=e', '--output-json=y', '--output-csv=z']), { inputDir: 'x', expectedKeysFile: 'e', outputJson: 'y', outputCsv: 'z' });

    assert.equal(spawnSync(process.execPath, [mergeScript, '--input-dir=' + inputDir, '--expected-keys-file=' + path.join(inputDir, 'expected.json'), '--output-json=' + outputJson, '--output-csv=' + outputCsv], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [mergeScript, '--input-dir=' + inputDir, '--expected-keys-file=' + expectedFile, '--output-json=' + expectedFile, '--output-csv=' + outputCsv], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge derives failures from local and orphan errors without double-counting missing work', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const publicOffer = { record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' };
  const merged = mergePayloads([{ file: 'part.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 2, expected_checks: 2, scenarios: [
    { key: 'a', status: 'success', offers: [publicOffer], errors: [{ code: 'navigation_timeout' }], quality_errors: [] },
    { key: 'b', status: 'success', offers: [publicOffer], errors: [], quality_errors: [] }
  ], errors: [{ code: 'chunk_failed', scenario_key: 'orphan' }] } }]);
  assert.equal(merged.scenarios.find(item => item.key === 'a').status, 'failure');
  assert.equal(merged.completed_checks, 1);
  assert.equal(merged.failed_checks, 1);
  assert.equal(merged.run_status, 'partial');
  assert.equal(merged.quality_status, 'warning');
  assert.equal(merged.errors.some(error => error.scenario_key === 'orphan'), true);

  const noUsable = mergePayloads([{ file: 'failed.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [], errors: [{ code: 'execution_failed' }], quality_errors: [] }], errors: [] } }]);
  assert.equal(noUsable.run_status, 'failure');
});

test('merge canonicalizes schema-v1 records and rejects malformed canonical values', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const offer = {
    record_type: 'offer', provider_name: 'PUBLIC', vehicle_name: 'Car', price_tier: 'public', price_scope: 'both',
    price_verified: true, total_price: 100, daily_price: 50, conditional_offer_total: 90,
    conditional_offer_daily: 45, conditional_offer_type: 'diamond', conditional_price_verified: true,
    currency: 'PLN', source_search_url: 'https://www.qeeq.pl/car/search', rawPayload: 'drop-me'
  };
  const payload = { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{
    key: 'a', status: 'success', requested_city: 'Katowice', offers: [offer], groups: [{ record_type: 'group', vehicle_name: 'Car', price_verified: false, rental_days: 2, parsing_source: 'dom', rawSource: 'drop-me' }],
    errors: [], quality_errors: [], arbitraryRawSource: 'drop-me'
  }], errors: [], arbitraryRoot: 'drop-me' };
  const merged = mergePayloads([{ file: 'part.json', payload }]);
  assert.equal(merged.scenarios[0].arbitraryRawSource, undefined);
  assert.equal(merged.scenarios[0].groups[0].rawSource, undefined);
  assert.equal(merged.scenarios[0].offers[0].rawPayload, undefined);
  assert.equal(merged.scenarios[0].offers[0].conditional_offer_total, 90);
  assert.equal(merged.scenarios[0].offers[0].conditional_price_verified, true);
  assert.equal(merged.arbitraryRoot, undefined);

  for (const field of ['resultSessionId', 'result-session-id', 'RESULT_SESSION_ID', 'business-id', 'qeeqFpt']) {
    const unsafe = structuredClone(payload);
    unsafe.scenarios[0][field] = 'secret';
    assert.throws(() => mergePayloads([{ file: 'unsafe.json', payload: unsafe }]), /Forbidden field/);
  }
  const malformedOffers = structuredClone(payload);
  malformedOffers.scenarios[0].offers = {};
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: malformedOffers }]), /offers must be an array/);
  const nonFinite = structuredClone(payload);
  nonFinite.scenarios[0].offers[0].total_price = Number.POSITIVE_INFINITY;
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: nonFinite }]), /total_price must be finite/);
  const wrongProvider = structuredClone(payload);
  wrongProvider.provider = 'other';
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: wrongProvider }]), /Unsupported provider/);
});

test('merge requires disjoint date slices and identical Cartesian dimensions', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const makeEntry = (file, date, overrides = {}) => {
    const duration = overrides.durations_days?.[0] ?? 2;
    const airport = overrides.airport_keys?.[0] ?? 'katowice-ktw';
    return { file, payload: {
    schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1,
    options: { start_dates: [date], durations_days: [2], airport_keys: ['katowice-ktw'], limits: { max_scenarios: 7020 }, concurrency: 1, ...overrides },
    scenarios: [{ key: `${airport}:${date}:${duration}`, status: 'success', pickup_at: `${date}T10:00:00`, rental_days: duration, airport_key: airport, offers: [], errors: [], quality_errors: [] }], errors: []
  } };
  };
  const merged = mergePayloads([makeEntry('a.json', '2026-09-19'), makeEntry('b.json', '2026-09-20')]);
  assert.deepEqual(merged.options.start_dates, ['2026-09-19', '2026-09-20']);
  assert.deepEqual(merged.options.durations_days, [2]);
  assert.deepEqual(merged.options.airport_keys, ['katowice-ktw']);
  assert.throws(() => mergePayloads([makeEntry('a.json', '2026-09-19'), makeEntry('b.json', '2026-09-19')]), /Overlapping requested start_dates/);
  assert.throws(() => mergePayloads([makeEntry('a.json', '2026-09-19'), makeEntry('b.json', '2026-09-20', { durations_days: [3] })]), /Incompatible requested durations_days/);
  assert.throws(() => mergePayloads([makeEntry('a.json', '2026-09-19'), makeEntry('b.json', '2026-09-20', { airport_keys: ['krakow-krk'] })]), /Incompatible requested airport_keys/);

  const wrongTuple = makeEntry('bad.json', '2026-09-19');
  wrongTuple.payload.scenarios[0].key = 'wrong';
  assert.throws(() => mergePayloads([wrongTuple]), /does not match canonical tuple/);
});

test('merge uses ASCII keys and fixed code-point ordering', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const payload = keys => ({ schema_version: 1, provider: 'qeeq.pl', expected_scenarios: keys.length, scenarios: keys.map(key => ({ key, status: 'success', offers: [], errors: [], quality_errors: [] })), errors: [] });
  assert.deepEqual(mergePayloads([{ file: 'part.json', payload: payload(['a', 'Z']) }]).scenarios.map(item => item.key), ['Z', 'a']);
  assert.throws(() => mergePayloads([{ file: 'part.json', payload: payload(['ą']) }]), /ASCII canonical scenario key/);
});

test('merge rejects a symlink or junction input root', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { findJsonFiles } = require('../src/qeeq/mergeResults');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-merge-link-'));
  const real = path.join(directory, 'real');
  const link = path.join(directory, 'link');
  try {
    fs.mkdirSync(real);
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => findJsonFiles(link), /Symbolic links|junctions/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge output transaction rolls back replacement failure and ignores backup cleanup failure', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-merge-transaction-'));
  const inputDir = path.join(directory, 'parts');
  const outputJson = path.join(directory, 'merged.json');
  const outputCsv = path.join(directory, 'merged.csv');
  const hook = path.join(directory, 'hook.cjs');
  const mergeScript = path.resolve(__dirname, '../src/qeeq/mergeResults.js');
  const args = [mergeScript, '--input-dir=' + inputDir, '--output-json=' + outputJson, '--output-csv=' + outputCsv];
  try {
    fs.mkdirSync(inputDir);
    fs.writeFileSync(path.join(inputDir, 'part.json'), JSON.stringify({ schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'NEW', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }], errors: [], quality_errors: [] }], errors: [] }));
    fs.writeFileSync(outputJson, 'OLD JSON');
    fs.writeFileSync(outputCsv, 'OLD CSV');
    fs.writeFileSync(hook, `const fs=require('node:fs');const rename=fs.renameSync;let n=0;fs.renameSync=function(a,b){if(String(a).endsWith('.tmp')&&(b===process.env.OUT_JSON||b===process.env.OUT_CSV)&&++n===2)throw new Error('injected replace failure');return rename.apply(this,arguments)};`);
    const failed = spawnSync(process.execPath, ['-r', hook, ...args], { encoding: 'utf8', env: { ...process.env, OUT_JSON: outputJson, OUT_CSV: outputCsv } });
    assert.equal(failed.status, 1);
    assert.equal(fs.readFileSync(outputJson, 'utf8'), 'OLD JSON');
    assert.equal(fs.readFileSync(outputCsv, 'utf8'), 'OLD CSV');

    fs.writeFileSync(hook, `const fs=require('node:fs');const remove=fs.rmSync;let thrown=false;fs.rmSync=function(p,o){if(!thrown&&String(p).endsWith('.bak')){thrown=true;throw new Error('injected cleanup failure')}return remove.apply(this,arguments)};`);
    const succeeded = spawnSync(process.execPath, ['-r', hook, ...args], { encoding: 'utf8' });
    assert.equal(succeeded.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(outputJson, 'utf8')).run_status, 'success');
    assert.match(fs.readFileSync(outputCsv, 'utf8'), /NEW/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('merge validates recomputed root counts and required offer primitives', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const base = { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [], errors: [], quality_errors: [] }], errors: [] };
  const nonFiniteRoot = structuredClone(base);
  nonFiniteRoot.completed_checks = Number.NaN;
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: nonFiniteRoot }]), /completed_checks must be a non-negative integer/);

  const missingProvider = structuredClone(base);
  missingProvider.scenarios[0].offers = [{ record_type: 'offer', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }];
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: missingProvider }]), /offer.provider_name must be a nonblank string/);

  const missingVerification = structuredClone(base);
  missingVerification.scenarios[0].offers = [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', total_price: 100, currency: 'PLN' }];
  assert.throws(() => mergePayloads([{ file: 'bad.json', payload: missingVerification }]), /offer.price_verified must be boolean/);
});

test('authoritative expected keys may expand but cannot shrink declared chunk workload', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const publicOffer = { record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' };
  const entry = { file: 'part.json', payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [publicOffer], errors: [], quality_errors: [] }], errors: [] } };
  const expanded = mergePayloads([entry], { expectedScenarioKeys: ['a', 'b'] });
  assert.equal(expanded.expected_scenarios, 2);
  assert.equal(expanded.run_status, 'partial');

  const overstated = structuredClone(entry);
  overstated.payload.expected_scenarios = 3;
  assert.throws(() => mergePayloads([overstated], { expectedScenarioKeys: ['a', 'b'] }), /declared workload exceeds authoritative expected keys/);
});

test('merge accepts null price tier emitted by the canonical Task6 builder as unrankable', () => {
  const { buildRootPayload, buildScenarioPayload } = require('../src/qeeq/run');
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const scenario = { key: 'katowice-pyrzowice:2026-09-19:2', airport: { city: 'Katowice', key: 'katowice-pyrzowice', iata: 'KTW', cityId: '2477', landmarkId: '404260' }, pickupDate: '2026-09-19', pickupTime: '10:00', dropoffDate: '2026-09-21', dropoffTime: '10:00', rentalDays: 2 };
  const canonicalScenario = buildScenarioPayload({ scenario, outcome: { status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_verified: false, total_price: null, currency: null }], errors: [], quality_errors: [] } });
  assert.equal(canonicalScenario.offers[0].price_tier, null);
  const chunk = buildRootPayload({ expected_scenarios: 1, expected_checks: 1, scenarios: [canonicalScenario], options: { start_dates: ['2026-09-19'], durations_days: [2], airport_keys: ['katowice-pyrzowice'], limits: { max_scenarios: 7020, max_vehicle_groups_per_scenario: 300, max_offers_per_scenario: 1500 }, concurrency: 1 } });
  const merged = mergePayloads([{ file: 'part.json', payload: chunk }]);
  assert.equal(merged.scenarios[0].offers[0].price_tier, null);
  assert.equal(merged.quality.verified_public_offer_count, 0);
  assert.equal(merged.quality_status, 'fail');
});

test('expected-keys containment uses root-safe relative paths and permits prefix siblings', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-relative-'));
  const inputDir = path.join(directory, 'parts');
  const siblingDir = path.join(directory, 'parts-sibling');
  const mergeScript = path.resolve(__dirname, '../src/qeeq/mergeResults.js');
  const outputJson = path.join(directory, 'merged.json');
  const outputCsv = path.join(directory, 'merged.csv');
  try {
    fs.mkdirSync(inputDir);
    fs.mkdirSync(siblingDir);
    const chunk = { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, scenarios: [{ key: 'a', status: 'success', offers: [{ record_type: 'offer', provider_name: 'PUBLIC', price_tier: 'public', price_verified: true, total_price: 100, currency: 'PLN' }], errors: [], quality_errors: [] }], errors: [] };
    fs.writeFileSync(path.join(inputDir, 'part.json'), JSON.stringify(chunk));
    const siblingExpected = path.join(siblingDir, 'expected.json');
    fs.writeFileSync(siblingExpected, JSON.stringify(['a']));
    const sibling = spawnSync(process.execPath, [mergeScript, '--input-dir=' + inputDir, '--expected-keys-file=' + siblingExpected, '--output-json=' + outputJson, '--output-csv=' + outputCsv], { encoding: 'utf8' });
    assert.equal(sibling.status, 0);

    const nestedExpected = path.join(inputDir, 'expected.txt');
    fs.writeFileSync(nestedExpected, JSON.stringify(['a']));
    const nested = spawnSync(process.execPath, [mergeScript, '--input-dir=' + inputDir, '--expected-keys-file=' + nestedExpected, '--output-json=' + outputJson, '--output-csv=' + outputCsv], { encoding: 'utf8' });
    assert.equal(nested.status, 1);

    const source = fs.readFileSync(mergeScript, 'utf8');
    const helper = /function isWithin[\s\S]*?\n}/.exec(source)?.[0] || '';
    assert.match(helper, /path\.relative/);
    assert.doesNotMatch(helper, /startsWith/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTML ranks only finite verified public totals and separates conditional prices', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const html = buildHtmlReport({
    run_status: 'success', quality_status: 'pass', expected_checks: 1, completed_checks: 1, failed_checks: 0,
    scenarios: [{ key: 'ktw', status: 'success', iata: 'KTW', pickup_at: '2026-09-19T10:00:00', rental_days: 2, offers: [
      { provider_name: 'TIE FIRST', vehicle_name: 'A', total_price: 119, daily_price: 59.5, currency: 'PLN', price_tier: 'public', price_verified: true, source_search_url: 'https://www.qeeq.pl/car/search' },
      { provider_name: 'TIE SECOND', vehicle_name: 'B', total_price: 119, currency: 'PLN', price_tier: 'public', price_verified: true, source_search_url: 'https://www.qeeq.pl/car/search' },
      { provider_name: 'CHEAPEST', vehicle_name: 'C', total_price: 100, currency: 'PLN', price_tier: 'public', price_verified: true },
      { provider_name: 'FOURTH', vehicle_name: 'D', total_price: 120, currency: 'PLN', price_tier: 'public', price_verified: true },
      { provider_name: 'CARWIZ', vehicle_name: 'Skoda Fabia', total_price: null, conditional_offer_total: 106, conditional_offer_type: 'newcomer_coupon', conditional_member_total: 98, currency: 'PLN', price_tier: 'conditional', price_verified: false, conditional_price_verified: true, source_search_url: 'https://www.qeeq.pl/car/search' },
      { provider_name: 'MEMBER', vehicle_name: 'Test', total_price: 90, currency: 'PLN', price_tier: 'diamond', price_verified: true },
      { provider_name: 'INFINITE', vehicle_name: 'Bad', total_price: Infinity, currency: 'PLN', price_tier: 'public', price_verified: true },
      { provider_name: 'NULL TIER', vehicle_name: 'Unknown', total_price: 80, currency: 'PLN', price_tier: null, price_verified: true }
    ] }]
  });
  assert.match(html, /Top 3 zweryfikowanych cen publicznych/);
  assert.match(html, /CARWIZ/);
  assert.match(html, /newcomer_coupon[\s\S]*106/);
  assert.match(html, /Cena Diamentowa[\s\S]*98/);
  const top3 = html.match(/<section id="top3">([\s\S]*?)<\/section>/)[1];
  assert.match(top3, /CHEAPEST[\s\S]*100[\s\S]*TIE FIRST[\s\S]*119[\s\S]*TIE SECOND[\s\S]*119/);
  assert.doesNotMatch(top3, /FOURTH|CARWIZ|MEMBER|INFINITE|NULL TIER/);
});

test('HTML is self-contained, filterable, and shows warning counts before Top 3', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const html = buildHtmlReport({
    run_status: 'partial', quality_status: 'warning', expected_checks: 9, completed_checks: 7, failed_checks: 2,
    quality: { quality_errors: ['price_unverified'] },
    scenarios: [{ key: 'ktw', status: 'failure', iata: 'KTW', pickup_at: '2026-09-19T10:00:00', rental_days: 2, offers: [{ provider_name: 'PUBLIC', transmission: 'Automatic', total_price: 119, currency: 'PLN', price_tier: 'public', price_verified: true }] }]
  });
  const warningIndex = html.indexOf('id="status-banner"');
  const top3Index = html.indexOf('id="top3"');
  assert.ok(warningIndex >= 0 && warningIndex < top3Index);
  assert.match(html, /Oczekiwane[\s\S]*9[\s\S]*Ukończone[\s\S]*7[\s\S]*Nieudane[\s\S]*2/);
  for (const filter of ['airport', 'pickup-date', 'duration', 'transmission', 'provider', 'status']) assert.match(html, new RegExp(`id="filter-${filter}"`));
  assert.match(html, /price_unverified/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<link\b|<img\b[^>]*https?:|<form\b|fetch\s*\(|XMLHttpRequest|https?:\/\/(?!www\.qeeq\.pl\/car\/search)/);
});

test('HTML escapes every dynamic context and never embeds data in executable script', () => {
  const { buildHtmlReport, escapeHtml } = require('../src/qeeq/reportHtml');
  const attack = '</script><img src=x onerror="alert(1)">' + '\u2028' + '\u2029' + "' & < > \"";
  const html = buildHtmlReport({
    run_status: attack, quality_status: 'warning', expected_checks: attack,
    quality: { quality_errors: [attack] }, errors: [{ code: attack }],
    scenarios: [{ key: attack, status: attack, iata: attack, requested_city: attack, pickup_at: attack, rental_days: attack, quality_errors: [attack], offers: [{
      provider_name: attack, vehicle_name: attack, transmission: attack, conditional_offer_type: attack,
      total_price: 10, currency: attack, price_tier: 'public', price_verified: true,
      source_search_url: 'javascript:alert(1)" onmouseover="alert(2)', clid: 'FORBIDDEN-CLID-VALUE', raw_html: 'FORBIDDEN-RAW-HTML'
    }] }]
  });
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(`&<>"'\u2028\u2029`), '&amp;&lt;&gt;&quot;&#39;&#8232;&#8233;');
  assert.doesNotMatch(html, /<img\b|onerror\s*=|onmouseover\s*=|javascript:|<\/script><img|\u2028|\u2029/);
  assert.doesNotMatch(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], /alert\(1\)|price_unverified|PUBLIC/);
  assert.match(html, /&lt;\/script&gt;&lt;img/);
  assert.doesNotMatch(html, /href="(?!https:\/\/www\.qeeq\.pl\/car\/search")/);
  assert.doesNotMatch(html, /FORBIDDEN-CLID-VALUE|FORBIDDEN-RAW-HTML/);
});

test('HTML handles empty and malformed collections deterministically', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const malformed = { run_status: 'failure', quality_status: 'fail', scenarios: { no: 'array' }, quality: { quality_errors: 'bad' }, errors: null };
  assert.equal(buildHtmlReport(malformed), buildHtmlReport(malformed));
  assert.match(buildHtmlReport(malformed), /Brak scenariuszy/);
  assert.doesNotThrow(() => buildHtmlReport({ scenarios: [{ offers: null, quality_errors: {} }] }));
});

test('HTML module exposes exact interfaces and CLI writes atomically without input collision', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const modulePath = path.resolve(__dirname, '../src/qeeq/reportHtml.js');
  const report = require('../src/qeeq/reportHtml');
  assert.deepEqual(Object.keys(report).sort(), ['buildHtmlReport', 'escapeHtml', 'generateReportFromFile', 'writeHtmlReport']);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-html-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'nested', 'report.html');
  try {
    fs.writeFileSync(input, JSON.stringify({ run_status: 'success', quality_status: 'pass', scenarios: [] }));
    const help = spawnSync(process.execPath, [modulePath, '--help'], { cwd: directory, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(fs.readdirSync(directory), ['input.json']);

    const made = spawnSync(process.execPath, [modulePath, input, output], { encoding: 'utf8' });
    assert.equal(made.status, 0);
    assert.match(fs.readFileSync(output, 'utf8'), /<!doctype html>/i);
    assert.deepEqual(fs.readdirSync(path.dirname(output)), ['report.html']);

    fs.writeFileSync(output, 'OLD HTML');
    const hook = path.join(path.dirname(output), 'rename-hook.cjs');
    fs.writeFileSync(hook, `const fs=require('node:fs');fs.renameSync=()=>{throw new Error('injected rename failure')};`);
    const failedWrite = spawnSync(process.execPath, ['-r', hook, modulePath, input, output], { encoding: 'utf8' });
    assert.equal(failedWrite.status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), 'OLD HTML');
    assert.deepEqual(fs.readdirSync(path.dirname(output)).filter(name => name.endsWith('.tmp')), []);
    fs.unlinkSync(hook);

    const before = fs.readFileSync(input, 'utf8');
    const collision = spawnSync(process.execPath, [modulePath, input, input], { encoding: 'utf8' });
    assert.equal(collision.status, 1);
    assert.equal(fs.readFileSync(input, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['input.json', 'nested']);
    assert.equal(spawnSync(process.execPath, [modulePath, input], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTML redacts forbidden session diagnostics but preserves normal quality codes', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const secrets = ['SECRET-ID', 'SECRET-CLID', 'SECRET-VV', 'SECRET-FPT', 'SECRET-TICKET', 'SECRET-TS', 'SECRET-QEEQ'];
  const html = buildHtmlReport({
    run_status: 'partial', quality_status: 'warning',
    quality: { quality_errors: [
      `id=${secrets[0]}`,
      `CLID: ${secrets[1]}`,
      `?_vv_=${secrets[2]}&safe=1`,
      `&fpt:${secrets[3]}`,
      `ticket = '${secrets[4]}'`,
      `ts:"${secrets[5]}"`,
      `qeeq_fpt=${secrets[6]}`,
      'location_id_drift'
    ] },
    scenarios: []
  });
  for (const secret of secrets) assert.doesNotMatch(html, new RegExp(secret));
  assert.match(html, /location_id_drift/);
  assert.match(html, /\[redacted\]/);
});

test('HTML inline filters require one offer row to match provider and transmission together', () => {
  const vm = require('node:vm');
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const html = buildHtmlReport({ scenarios: [{ key: 'x', status: 'success', iata: 'KTW', pickup_at: '2026-09-19T10:00:00', rental_days: 2, offers: [
    { provider_name: 'A', transmission: 'Automatic', total_price: 100, price_tier: 'public', price_verified: true },
    { provider_name: 'B', transmission: 'Manual', total_price: 110, price_tier: 'public', price_verified: true }
  ] }] });
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const ids = ['airport', 'pickup-date', 'duration', 'transmission', 'provider', 'status'];
  const controls = Object.fromEntries(ids.map(id => [id, { value: '', addEventListener(event, callback) { this.callback = callback; } }]));
  const rows = [
    { dataset: { airport: 'KTW', pickupDate: '2026-09-19', duration: '2', transmission: 'Automatic', provider: 'A', status: 'success' }, hidden: false },
    { dataset: { airport: 'KTW', pickupDate: '2026-09-19', duration: '2', transmission: 'Manual', provider: 'B', status: 'success' }, hidden: false }
  ];
  const article = { dataset: { airport: 'KTW', pickupDate: '2026-09-19', duration: '2', status: 'success' }, hidden: false, querySelectorAll() { return rows; } };
  const emptyArticle = { dataset: { airport: 'KTW', pickupDate: '2026-09-19', duration: '2', status: 'failure' }, hidden: false, querySelectorAll() { return []; } };
  const document = {
    getElementById(id) { return controls[id.replace('filter-', '')]; },
    querySelectorAll(selector) { return selector === 'article.scenario' ? [article, emptyArticle] : rows; }
  };
  vm.runInNewContext(script, { document });
  controls.provider.value = 'A';
  controls.transmission.value = 'Manual';
  controls.provider.callback();
  assert.equal(article.hidden, true);
  assert.equal(emptyArticle.hidden, true);
  controls.transmission.value = 'Automatic';
  controls.provider.callback();
  assert.equal(article.hidden, false);
  assert.deepEqual(rows.map(row => row.hidden), [false, true]);
});

test('HTML ignores malformed ranked offers and non-string pickup timestamps', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const payload = { scenarios: [{ key: 'x', pickup_at: { slice: 'not a function' }, offers: [null, { provider_name: 'A', total_price: 100, price_tier: 'public', price_verified: true }] }] };
  assert.doesNotThrow(() => buildHtmlReport(payload));
  assert.equal(buildHtmlReport(payload), buildHtmlReport(payload));
  assert.match(buildHtmlReport(payload), /<td>—<\/td>/);
});

test('XLSX contains seven usable sheets with typed verified and conditional price fields', async () => {
  const { buildDetailRows, buildWorkbook } = require('../src/qeeq/reportXlsx');
  const payload = {
    run_status: 'partial', quality_status: 'warning', expected_checks: 2, completed_checks: 1, failed_checks: 1,
    quality: { verified_public_offer_count: 4, unverified_offer_count: 1, quality_errors: ['price_unverified'] },
    errors: [{ code: 'execution_failed', scenario_key: 'waw:2026-09-20:2' }],
    scenarios: [
      { key: 'ktw:2026-09-19:2', status: 'success', requested_city: 'Katowice', airport_key: 'katowice-pyrzowice', iata: 'KTW', pickup_at: '2026-09-19T10:00:00', dropoff_at: '2026-09-21T10:00:00', rental_days: 2, quality_errors: ['price_unverified'], offers: [
        { provider_name: 'CHEAPEST', vehicle_name: 'A', transmission: 'Automatic', provider_rating: 8.7, provider_rating_count: 120, deposit_amount: 500, deposit_currency: 'PLN', total_price: 100, daily_price: 50, currency: 'PLN', price_tier: 'public', price_verified: true },
        { provider_name: 'TIE FIRST', vehicle_name: 'B', total_price: 119, daily_price: 59.5, currency: 'PLN', price_tier: 'public', price_verified: true },
        { provider_name: 'TIE SECOND', vehicle_name: 'C', total_price: 119, currency: 'PLN', price_tier: 'public', price_verified: true },
        { provider_name: 'FOURTH', vehicle_name: 'D', total_price: 120, currency: 'PLN', price_tier: 'public', price_verified: true },
        { provider_name: 'CARWIZ', vehicle_name: 'Skoda Fabia', conditional_offer_total: 106, conditional_offer_daily: 53, conditional_offer_type: 'newcomer_coupon', conditional_member_total: 98, conditional_member_daily: 49, currency: 'PLN', price_tier: 'conditional', price_verified: false, conditional_price_verified: true }
      ] },
      { key: 'waw:2026-09-20:2', status: 'failure', requested_city: 'Warszawa', airport_key: 'warsaw-chopin', iata: 'WAW', pickup_at: '2026-09-20T10:00:00', rental_days: 2, errors: [{ code: 'execution_failed' }], offers: [] }
    ]
  };
  const detailRows = buildDetailRows(payload);
  assert.equal(detailRows.length, 5);
  assert.equal(detailRows[0]['Public total'], 100);
  assert.equal(detailRows[4]['Conditional offer total'], 106);
  assert.equal(detailRows[4]['Diamond/member total'], 98);

  const workbook = await buildWorkbook(payload);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Overview', 'Top 3', 'By airport', 'By duration', 'Providers', 'Details', 'Data quality']);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    assert.ok(sheet.autoFilter);
    assert.ok(sheet.getColumn(1).width >= 10);
  }

  const details = workbook.getWorksheet('Details');
  const headers = details.getRow(1).values;
  for (const header of ['Public total', 'Conditional offer total', 'Diamond/member total', 'Provider rating', 'Deposit amount']) assert.equal(headers.includes(header), true);
  const column = header => headers.indexOf(header);
  assert.equal(typeof details.getRow(2).getCell(column('Public total')).value, 'number');
  assert.equal(typeof details.getRow(2).getCell(column('Provider rating')).value, 'number');
  assert.equal(typeof details.getRow(2).getCell(column('Deposit amount')).value, 'number');
  assert.match(details.getRow(2).getCell(column('Public total')).numFmt, /PLN/);
  assert.ok(details.getRow(2).getCell(column('Pickup at')).value instanceof Date);
  assert.equal(details.getRow(2).getCell(column('Pickup at')).value.toISOString(), '2026-09-19T10:00:00.000Z');
  assert.equal(details.getRow(6).getCell(column('Conditional offer total')).value, 106);

  const top3Values = workbook.getWorksheet('Top 3').getSheetValues().flat(2);
  assert.deepEqual(top3Values.filter(value => ['CHEAPEST', 'TIE FIRST', 'TIE SECOND', 'FOURTH', 'CARWIZ'].includes(value)), ['CHEAPEST', 'TIE FIRST', 'TIE SECOND']);
  assert.equal(workbook.getWorksheet('By airport').getSheetValues().flat(2).includes('KTW'), true);
  assert.equal(workbook.getWorksheet('By duration').getSheetValues().flat(2).includes(2), true);
  assert.equal(workbook.getWorksheet('Providers').getSheetValues().flat(2).includes('CARWIZ'), true);

  const qualityValues = workbook.getWorksheet('Data quality').getSheetValues().flat(2);
  assert.equal(qualityValues.includes('price_unverified'), true);
  assert.equal(qualityValues.includes('execution_failed'), true);
  assert.equal(qualityValues.includes('ktw:2026-09-19:2'), true);
  assert.equal(qualityValues.includes('waw:2026-09-20:2'), true);
  const qualityRows = workbook.getWorksheet('Data quality').getSheetValues().slice(2);
  assert.equal(qualityRows.find(row => row.includes('price_unverified'))[3], 1);
  assert.equal(qualityRows.find(row => row.includes('execution_failed'))[3], 1);
  assert.equal(workbook.getWorksheet('Overview').getCell('B3').fill.fgColor.argb, 'FFFFC000');
});

test('XLSX safely ignores malformed objects and never projects forbidden identifiers or diagnostics', async () => {
  const { buildDetailRows, buildWorkbook } = require('../src/qeeq/reportXlsx');
  const secret = 'SESSION-SECRET-123';
  const payload = {
    run_status: 'failure', quality_status: 'fail', quality: { quality_errors: [`clid=${secret}`, 'location_id_drift'] },
    errors: [{ code: `ticket:${secret}`, scenario_key: `id=${secret}` }],
    scenarios: [null, [], { key: 'safe-key', pickup_at: '2026-02-31T10:00:00', qeeq_city_id: secret, qeeq_landmark_id: secret, offers: [null, [], {
      provider_name: `Authorization: Bearer ${secret}`, vehicle_name: 'Safe', total_price: Infinity, price_tier: 'public', price_verified: true,
      id: secret, bid: secret, clid: secret, authorization: secret, cookie: secret, raw_html: secret
    }], quality_errors: [`fpt=${secret}`, 'normal_code'], errors: { bad: true } }]
  };
  assert.equal(buildDetailRows(payload)[0]['Pickup at'], null);
  const workbook = await buildWorkbook(payload);
  const allValues = workbook.worksheets.flatMap(sheet => sheet.getSheetValues().flat(3)).filter(value => value !== undefined && value !== null).join('|');
  assert.doesNotMatch(allValues, new RegExp(secret));
  assert.doesNotMatch(allValues, /qeeq_city_id|qeeq_landmark_id|authorization|raw_html/i);
  assert.match(allValues, /location_id_drift|normal_code/);
  assert.equal(workbook.getWorksheet('Top 3').rowCount, 1);
});

test('XLSX exposes exact interfaces and CLI writes a same-directory atomic file without collisions', async () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const ExcelJS = require('exceljs');
  const modulePath = path.resolve(__dirname, '../src/qeeq/reportXlsx.js');
  const report = require('../src/qeeq/reportXlsx');
  assert.deepEqual(Object.keys(report).sort(), ['buildDetailRows', 'buildWorkbook', 'generateWorkbookFromFile']);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-xlsx-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'nested', 'report.xlsx');
  try {
    fs.writeFileSync(input, JSON.stringify({ run_status: 'success', quality_status: 'pass', scenarios: [] }));
    const help = spawnSync(process.execPath, [modulePath, '--help'], { cwd: directory, encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(fs.readdirSync(directory), ['input.json']);

    const made = spawnSync(process.execPath, [modulePath, input, output], { encoding: 'utf8' });
    assert.equal(made.status, 0);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.readFile(output);
    assert.deepEqual(loaded.worksheets.map(sheet => sheet.name), ['Overview', 'Top 3', 'By airport', 'By duration', 'Providers', 'Details', 'Data quality']);
    assert.deepEqual(fs.readdirSync(path.dirname(output)), ['report.xlsx']);

    fs.writeFileSync(input, JSON.stringify({ run_status: 'partial', quality_status: 'warning', scenarios: [] }));
    const replaced = spawnSync(process.execPath, [modulePath, input, output], { encoding: 'utf8' });
    assert.equal(replaced.status, 0);
    const replacement = new ExcelJS.Workbook();
    await replacement.xlsx.readFile(output);
    assert.equal(replacement.getWorksheet('Overview').getCell('B2').value, 'partial');

    fs.writeFileSync(output, 'OLD XLSX');
    const hook = path.join(path.dirname(output), 'rename-hook.cjs');
    fs.writeFileSync(hook, `require('node:fs').renameSync=()=>{throw new Error('injected rename failure')};`);
    const failedWrite = spawnSync(process.execPath, ['-r', hook, modulePath, input, output], { encoding: 'utf8' });
    assert.equal(failedWrite.status, 1);
    assert.equal(fs.readFileSync(output, 'utf8'), 'OLD XLSX');
    assert.deepEqual(fs.readdirSync(path.dirname(output)).filter(name => name.endsWith('.tmp')), []);
    fs.unlinkSync(hook);

    const before = fs.readFileSync(input, 'utf8');
    const collision = spawnSync(process.execPath, [modulePath, input, input], { encoding: 'utf8' });
    assert.equal(collision.status, 1);
    assert.equal(fs.readFileSync(input, 'utf8'), before);
    assert.equal(spawnSync(process.execPath, [modulePath, input], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('XLSX redacts every secret diagnostic value without collapsing distinct occurrences', async () => {
  const { buildWorkbook } = require('../src/qeeq/reportXlsx');
  const secrets = ['SECRET-ID', 'SECRET-CLID', 'SECRET-VV', 'SECRET-FPT', 'SECRET-A', 'SECRET-B', 'SECRET-TS', 'SECRET-QFPT', 'SECRET-CITY', 'SECRET-LANDMARK', 'SECRET-AUTH', 'SECRET-COOKIE'];
  const diagnosticCodes = [
    `id=${secrets[0]}`, `clid:${secrets[1]}`, `_vv_=${secrets[2]}`, `fpt:${secrets[3]}`,
    `ticket:${secrets[4]}`, `ticket:${secrets[5]}`, `ts=${secrets[6]}`, `qeeq_fpt:${secrets[7]}`,
    `qeeq_city_id=${secrets[8]}`, `qeeq_landmark_id:${secrets[9]}`,
    `Authorization: Bearer ${secrets[10]}`, `cookie=${secrets[11]}`, 'safe_quality_code'
  ];
  const workbook = await buildWorkbook({
    run_status: 'partial', quality_status: 'warning',
    scenarios: [{ key: 'ktw:2026-09-19:2', status: 'success', offers: [], quality_errors: diagnosticCodes }]
  });
  const values = workbook.worksheets.flatMap(sheet => sheet.getSheetValues().flat(3)).filter(value => value !== null && value !== undefined).join('|');
  for (const secret of secrets) assert.doesNotMatch(values, new RegExp(secret));
  assert.doesNotMatch(values, /qeeq_city_id|qeeq_landmark_id|authorization|cookie/i);
  assert.match(values, /safe_quality_code/);
  const rows = workbook.getWorksheet('Data quality').getSheetValues().slice(2);
  const ticket = rows.find(row => row[2] === 'ticket=[redacted]');
  assert.ok(ticket);
  assert.equal(ticket[3], 2);
});

test('XLSX rejects hostile scalar objects at every projection and ordering boundary', async () => {
  const { buildWorkbook } = require('../src/qeeq/reportXlsx');
  const hostile = { toString: null };
  const payloads = [
    { run_status: hostile, quality_status: hostile, scenarios: [] },
    { run_status: 'success', quality_status: 'pass', scenarios: [{ key: 'bad-airport', iata: hostile, airport_key: hostile, rental_days: 2, offers: [] }] },
    { run_status: 'success', quality_status: 'pass', scenarios: [{ key: 'bad-duration', iata: 'KTW', rental_days: hostile, offers: [] }] },
    { run_status: 'success', quality_status: 'pass', scenarios: [{ key: 'bad-labels', iata: 'KTW', rental_days: 2, status: hostile, offers: [{ provider_name: hostile, vehicle_name: hostile, total_price: 100, price_tier: 'public', price_verified: true }] }] }
  ];
  for (const payload of payloads) {
    const first = await buildWorkbook(payload);
    const second = await buildWorkbook(payload);
    assert.deepEqual(first.worksheets.map(sheet => sheet.getSheetValues()), second.worksheets.map(sheet => sheet.getSheetValues()));
    const projected = first.worksheets.flatMap(sheet => sheet.getSheetValues().flat(3));
    assert.equal(projected.includes(hostile), false);
  }
});

test('XLSX atomic failures preserve the primary error while still attempting temp cleanup', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-xlsx-errors-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'report.xlsx');
  const hook = path.join(directory, 'failure-hook.cjs');
  const runner = path.join(directory, 'runner.cjs');
  const modulePath = path.resolve(__dirname, '../src/qeeq/reportXlsx.js');
  const excelPath = require.resolve('exceljs');
  try {
    fs.writeFileSync(input, JSON.stringify({ run_status: 'success', quality_status: 'pass', scenarios: [] }));
    fs.writeFileSync(output, 'OLD XLSX');
    fs.writeFileSync(hook, `
      const fs = require('node:fs');
      const originalWrite = fs.writeFileSync.bind(fs);
      const originalRm = fs.rmSync.bind(fs);
      const mode = process.env.QEEQ_FAILURE_MODE;
      if (mode === 'write') {
        const ExcelJS = require(${JSON.stringify(excelPath)});
        const OriginalWorkbook = ExcelJS.Workbook;
        ExcelJS.Workbook = class extends OriginalWorkbook {
          constructor() { super(); this.xlsx.writeFile = async () => { throw new Error('PRIMARY_WRITE'); }; }
        };
      }
      if (mode === 'rename') fs.renameSync = () => { throw new Error('PRIMARY_RENAME'); };
      fs.rmSync = (target, options) => {
        if (String(target).endsWith('.tmp')) {
          originalWrite(process.env.QEEQ_CLEANUP_MARKER + '.' + mode, 'attempted');
          throw new Error('CLEANUP_FAILURE');
        }
        return originalRm(target, options);
      };
    `);
    fs.writeFileSync(runner, `
      require(${JSON.stringify(modulePath)}).generateWorkbookFromFile(${JSON.stringify(input)}, ${JSON.stringify(output)})
        .then(() => { process.exitCode = 0; })
        .catch(error => { process.stdout.write(error.message); process.exitCode = 7; });
    `);
    for (const mode of ['write', 'rename']) {
      const marker = path.join(directory, 'cleanup-attempted');
      const result = spawnSync(process.execPath, ['-r', hook, runner], {
        encoding: 'utf8',
        env: { ...process.env, QEEQ_FAILURE_MODE: mode, QEEQ_CLEANUP_MARKER: marker }
      });
      assert.equal(result.status, 7, result.stderr);
      assert.equal(result.stdout, mode === 'write' ? 'PRIMARY_WRITE' : 'PRIMARY_RENAME');
      assert.equal(fs.readFileSync(`${marker}.${mode}`, 'utf8'), 'attempted');
      assert.equal(fs.readFileSync(output, 'utf8'), 'OLD XLSX');
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('XLSX preserves distinct root diagnostic counts after presentation redaction', async () => {
  const { buildWorkbook } = require('../src/qeeq/reportXlsx');
  const workbook = await buildWorkbook({
    quality: { quality_errors: ['ticket:ROOT-A', 'ticket:ROOT-B'] },
    scenarios: [{ key: 'ktw', quality_errors: ['safe_scenario_code'], offers: [] }]
  });
  const rows = workbook.getWorksheet('Data quality').getSheetValues().slice(2);
  const ticketRows = rows.filter(row => row[2] === 'ticket=[redacted]');
  assert.equal(ticketRows.length, 1);
  assert.equal(ticketRows[0][3], 2);
  assert.equal(rows.some(row => row[2] === 'safe_scenario_code' && row[3] === 1), true);
  const values = rows.flat(2).filter(value => value !== null && value !== undefined).join('|');
  assert.doesNotMatch(values, /ROOT-A|ROOT-B/);
});

test('Telegram final summary includes independent statuses, counts, safe codes, and prioritized links', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const payload = {
    run_status: 'partial', quality_status: 'warning', expected_checks: 9, completed_checks: 8, failed_checks: 1,
    quality: { verified_public_offer_count: 7, unverified_offer_count: 2, quality_errors: ['price_unverified', 'ticket=SECRET'] },
    errors: [{ code: 'navigation_timeout' }, { code: 'id:SECRET' }]
  };
  const text = buildFinalSummary(payload, {
    reportUrl: 'https://example.test/report.html',
    artifactUrl: 'https://github.com/example/actions/runs/1/artifacts/2',
    runUrl: 'https://github.com/example/actions/runs/1'
  });
  assert.match(text, /Run: partial/);
  assert.match(text, /Jakość: warning/);
  assert.match(text, /Kontrole: 8\/9 \(nieudane: 1\)/);
  assert.match(text, /zweryfikowane: 7, niezweryfikowane: 2/);
  assert.match(text, /navigation_timeout/);
  assert.match(text, /price_unverified/);
  assert.match(text, /Raport: https:\/\/example\.test\/report\.html/);
  assert.match(text, /Run GitHub Actions: https:\/\/github\.com\/example\/actions\/runs\/1/);
  assert.doesNotMatch(text, /SECRET|ticket|\bid:/i);
  assert.doesNotMatch(text, /artifacts\/2/);
});

test('Telegram summaries reject unsafe links and sanitize hostile malformed inputs deterministically', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const hostile = { toString: null };
  const payload = {
    run_status: hostile, quality_status: null, expected_checks: -4, completed_checks: Infinity, failed_checks: '2',
    quality: { verified_public_offer_count: hostile, unverified_offer_count: -1, quality_errors: [null, 'safe_code', '::error::OWNED', 'qeeq_city_id=BUSINESS'] },
    errors: [{ code: 'execution_failed' }, null, { code: hostile }]
  };
  const options = {
    reportUrl: 'https://user:pass@example.test/report#fragment',
    artifactUrl: 'https://example.test/artifact?ticket=SESSION',
    runUrl: 'javascript:alert(1)'
  };
  const first = buildFinalSummary(payload, options);
  const second = buildFinalSummary(payload, options);
  assert.equal(first, second);
  assert.match(first, /Run: unknown/);
  assert.match(first, /Jakość: unknown/);
  assert.match(first, /Kontrole: 0\/0 \(nieudane: 0\)/);
  assert.match(first, /execution_failed|safe_code/);
  assert.doesNotMatch(first, /https?:|javascript:|SESSION|BUSINESS|OWNED|::/);
  const poisonedPayload = Object.defineProperty({}, 'run_status', { get() { throw new Error('getter executed'); } });
  const poisonedOptions = Object.defineProperty({}, 'reportUrl', { get() { throw new Error('getter executed'); } });
  assert.doesNotThrow(() => buildFinalSummary(poisonedPayload, poisonedOptions));
});

test('Telegram links reject every query string and retain clean HTTPS fallback priority', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const payload = { run_status: 'success', quality_status: 'pass', quality: {} };
  const artifactFallback = buildFinalSummary(payload, {
    reportUrl: 'https://pages.example.test/report?download=SESSION-SECRET',
    artifactUrl: 'https://github.com/example/actions/artifacts/2',
    runUrl: 'https://github.com/example/actions/runs/1'
  });
  assert.doesNotMatch(artifactFallback, /SESSION-SECRET|pages\.example/);
  assert.match(artifactFallback, /Artefakt: https:\/\/github\.com\/example\/actions\/artifacts\/2/);
  assert.match(artifactFallback, /Run GitHub Actions: https:\/\/github\.com\/example\/actions\/runs\/1/);

  const runFallback = buildFinalSummary(payload, {
    reportUrl: 'https://pages.example.test/report#fragment',
    artifactUrl: 'https://user:password@example.test/artifact',
    runUrl: 'https://github.com/example/actions/runs/1'
  });
  assert.doesNotMatch(runFallback, /pages\.example|password|Artefakt:/);
  assert.match(runFallback, /Run GitHub Actions: https:\/\/github\.com\/example\/actions\/runs\/1/);

  const rejectedControls = buildFinalSummary(payload, {
    reportUrl: 'https://example.test/re\u0001port',
    artifactUrl: 'https://example.test/art\u202Eifact'
  });
  assert.doesNotMatch(rejectedControls, /https:\/\//);
});

test('Telegram diagnostic codes use a closed project allowlist and reject token-shaped values', () => {
  const { buildFinalSummary } = require('../src/qeeq/telegramSummary');
  const secrets = [
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'github_pat_11AA_secret_token_value',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
    'AKIAIOSFODNN7EXAMPLE',
    'arbitrary_token_value'
  ];
  const text = buildFinalSummary({
    run_status: 'partial', quality_status: 'warning',
    errors: [{ code: 'execution_failed' }, { code: 'navigation_timeout' }, ...secrets.map(code => ({ code }))],
    quality: { quality_errors: ['price_unverified', 'empty_result', 'location_id_drift', ...secrets] }
  });
  for (const code of ['execution_failed', 'navigation_timeout', 'price_unverified', 'empty_result', 'location_id_drift']) {
    assert.match(text, new RegExp(code));
  }
  for (const secret of secrets) assert.doesNotMatch(text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Telegram plan failure works without payload and bounds sanitized error text to 300 characters', () => {
  const { buildPlanFailureSummary } = require('../src/qeeq/telegramSummary');
  const hostileMessage = `invalid\u0000 matrix\u001b[31m\u202E::error:: https://user:URL-PASSWORD@example.test/path?ticket=SESSION ${'x'.repeat(400)}`;
  const text = buildPlanFailureSummary(new Error(hostileMessage), {
    reportUrl: 'https://example.test/report#bad',
    artifactUrl: 'https://example.test/artifact',
    runUrl: 'https://github.com/example/actions/runs/2'
  });
  assert.match(text, /^QEEQ plan failure\n/);
  const errorLine = text.split('\n').find(line => line.startsWith('Błąd: '));
  assert.ok(errorLine);
  assert.ok([...errorLine.slice('Błąd: '.length)].length <= 300);
  assert.match(errorLine, /invalid matrix/);
  assert.doesNotMatch(text, /SESSION|URL-PASSWORD|ticket|\u001b|\u202E|::error::/);
  assert.match(text, /Artefakt: https:\/\/example\.test\/artifact/);
  assert.match(text, /Run GitHub Actions: https:\/\/github\.com\/example\/actions\/runs\/2/);
  assert.doesNotThrow(() => buildPlanFailureSummary({ message: { toString: null } }, null));
});

test('Telegram summary argument parser has exact modes and rejects ambiguous arguments', () => {
  const summary = require('../src/qeeq/telegramSummary');
  assert.deepEqual(Object.keys(summary).sort(), ['buildFinalSummary', 'buildPlanFailureSummary', 'parseSummaryArgs']);
  assert.deepEqual(summary.parseSummaryArgs(['--help']), { help: true });
  assert.deepEqual(summary.parseSummaryArgs(['--mode=final-summary', '--input=result.json', '--report-url=https://example.test/report']), {
    mode: 'final-summary', input: 'result.json', reportUrl: 'https://example.test/report'
  });
  assert.deepEqual(summary.parseSummaryArgs(['--mode=plan-failure', '--error=invalid matrix', '--run-url=https://example.test/run']), {
    mode: 'plan-failure', error: 'invalid matrix', runUrl: 'https://example.test/run'
  });
  for (const argv of [
    [], ['--help', '--mode=final-summary'], ['--wat=yes'], ['positional'], ['--mode'],
    ['--mode=other'], ['--mode=final-summary'], ['--mode=plan-failure'],
    ['--mode=final-summary', '--input=a', '--input=b'],
    ['--mode=final-summary', '--input=a', '--error=bad'],
    ['--mode=plan-failure', '--error=bad', '--input=a'],
    ['--mode=plan-failure', '--error=bad', '--report-url=https://example.test/report'],
    ['--mode=plan-failure', '--error=bad', '--artifact-url=https://example.test/artifact']
  ]) assert.throws(() => summary.parseSummaryArgs(argv));
});

test('Telegram summary CLI prints exactly one sanitized message and plan failure reads no payload', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const modulePath = path.resolve(__dirname, '../src/qeeq/telegramSummary.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-telegram-'));
  const input = path.join(directory, 'canonical.json');
  try {
    fs.writeFileSync(input, JSON.stringify({ run_status: 'success', quality_status: 'pass', expected_checks: 1, completed_checks: 1, failed_checks: 0, quality: { verified_public_offer_count: 2, unverified_offer_count: 0 } }));
    const final = spawnSync(process.execPath, [modulePath, '--mode=final-summary', `--input=${input}`, '--artifact-url=https://example.test/artifact'], { encoding: 'utf8' });
    assert.equal(final.status, 0, final.stderr);
    assert.equal(final.stderr, '');
    assert.equal(final.stdout, `${final.stdout.trimEnd()}\n`);
    assert.equal((final.stdout.match(/QEEQ scrape summary/g) || []).length, 1);

    fs.unlinkSync(input);
    const plan = spawnSync(process.execPath, [modulePath, '--mode=plan-failure', '--error=invalid%0Amatrix', '--run-url=https://example.test/run'], { encoding: 'utf8' });
    assert.equal(plan.status, 0, plan.stderr);
    assert.equal(plan.stderr, '');
    assert.equal((plan.stdout.match(/QEEQ plan failure/g) || []).length, 1);
    assert.equal(plan.stdout, `${plan.stdout.trimEnd()}\n`);

    const help = spawnSync(process.execPath, [modulePath, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.equal((help.stdout.match(/Usage:/g) || []).length, 1);
    assert.equal(spawnSync(process.execPath, [modulePath, '--wat=yes'], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('smoke workflow is bounded to KTW two-day output and has no Pages or Telegram', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-smoke.yml', 'utf8');
  assert.match(yaml, /Katowice/);
  assert.match(yaml, /durations-days=2/);
  assert.match(yaml, /npm test/);
  assert.match(yaml, /Europe\/Warsaw/);
  assert.match(yaml, /retention-days:\s*7/);
  assert.match(yaml, /set \+e/);
  assert.match(yaml, /if:\s*always\(\)/);
  assert.doesNotMatch(yaml, /deploy-pages|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID/);
});

test('daily workflow is planner-driven gated and preserves all required outputs', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  for (const required of [
    'QEEQ_FULL_SCHEDULE_ENABLED', 'QEEQ_BENCHMARK_STAGE', 'QEEQ_P50_SCENARIO_SECONDS',
    'QEEQ_P95_SCENARIO_SECONDS', 'QEEQ_MAX_BROWSER_MINUTES', 'QEEQ_MAX_PARALLEL',
    'QEEQ_TARGET_CHUNK_MINUTES', 'QEEQ_PAGES_ENABLED', 'Europe/Warsaw', 'set +e',
    'expected-scenario-keys.json', 'output/qeeq-results.csv', 'qeeq-results-latest.json',
    'qeeq-report.html', 'qeeq-summary.xlsx', 'quality-summary.json', 'run-manifest.json'
  ]) assert.match(yaml, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(yaml, /SCHEDULE_ROLLING_DAYS:\s*["']60["']/);
  assert.match(yaml, /SCHEDULE_DURATIONS:\s*["']2,3,4,5,6,7,8,9,10,11,12,13,14["']/);
  assert.match(yaml, /notify-plan-failure:/);
  assert.match(yaml, /final-status:/);
  assert.match(yaml, /max-parallel:/);
  assert.doesNotMatch(yaml, /max-parallel:\s*2(?:\s|$)/);
  assert.match(yaml, /retention-days:\s*7/);
  assert.match(yaml, /retention-days:\s*30/);
  assert.match(yaml, /pages:\s*write/);
  assert.match(yaml, /id-token:\s*write/);
  assert.match(yaml, /actions\/configure-pages@/);
  assert.match(yaml, /actions\/upload-pages-artifact@/);
  assert.match(yaml, /actions\/deploy-pages@/);
  assert.match(yaml, /environment:[\s\S]*name:\s*github-pages/);
  assert.match(yaml, /npm run qeeq:plan/);
  assert.match(yaml, /--expected-keys-file=expected-scenario-keys\.json/);
  assert.doesNotMatch(yaml, /\beval\b/);
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

test('workflow planner partitions every full-run date into at most 256 consecutive chunks', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const plan = buildWorkflowPlan({
    eventName: 'schedule', timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], fullEnabled: true, benchmarkStage: 4,
    p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, averageOffersPerScenario: 49,
    averageArtifactBytesPerScenario: 70359, maxParallel: 3, targetChunkMinutes: 60,
    maxBrowserMinutes: 3000, now: new Date('2026-08-20T10:00:00+02:00')
  });
  assert.equal(plan.scenario_count, 7020);
  assert.equal(plan.should_run, true);
  assert.ok(plan.matrix.include.length <= 256);
  const dates = plan.matrix.include.flatMap(chunk => chunk.start_dates.split(','));
  assert.equal(dates.length, 60);
  assert.equal(new Set(dates).size, 60);
  assert.equal(plan.max_parallel, 3);
  assert.ok(plan.chunk_timeout_minutes > 0);
  assert.equal(plan.matrix.include[0].start_dates.split(',')[0], '2026-08-21');
  assert.equal(plan.expected_scenario_keys.length, 7020);
  assert.equal(plan.matrix.include.every((chunk, index) => chunk.chunk_id === `chunk-${String(index + 1).padStart(3, '0')}`), true);
});

test('stage three can produce a full plan-only estimate without enabling production', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const plan = buildWorkflowPlan({
    eventName: 'workflow_dispatch', planOnly: true, acknowledgeExpandedRun: true,
    timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], fullEnabled: false, benchmarkStage: 3,
    p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, averageOffersPerScenario: 49,
    averageArtifactBytesPerScenario: 70359, maxParallel: 3, targetChunkMinutes: 60,
    maxBrowserMinutes: 100, now: new Date('2026-08-20T10:00:00+02:00')
  });
  assert.equal(plan.plan_only, true);
  assert.equal(plan.should_run, false);
  assert.equal(plan.scenario_count, 7020);
  assert.equal(plan.budget_ok, false);
  assert.ok(plan.estimated_browser_minutes > 100);
});

test('workflow planner cannot bypass the full-run gate browser budget or hard cap', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const full = {
    eventName: 'workflow_dispatch', planOnly: false, timeZone: 'Europe/Warsaw',
    locations: defaultLocationCities(), rollingDays: 60, durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14],
    benchmarkStage: 4, p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, averageOffersPerScenario: 49,
    averageArtifactBytesPerScenario: 70359, maxParallel: 3,
    targetChunkMinutes: 60, maxBrowserMinutes: 3000, acknowledgeExpandedRun: true,
    now: new Date('2026-08-20T10:00:00+02:00')
  };
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: false }), /QEEQ_FULL_SCHEDULE_ENABLED=true/);
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: true, benchmarkStage: 3 }), /QEEQ_BENCHMARK_STAGE=4/);
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: true, maxBrowserMinutes: 100 }), /browser-minute budget/);
  assert.throws(() => buildWorkflowPlan({ ...full, fullEnabled: true, rollingDays: 61 }), /exceeds hard cap 7020/);
});

test('manual workflow gates expanded requests and ignores unsafe dispatch parallelism', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const common = {
    eventName: 'workflow_dispatch', timeZone: 'Europe/Warsaw', locations: ['Katowice'],
    rollingDays: 10, durationsDays: [2], fullEnabled: false, benchmarkStage: 4,
    p50ScenarioSeconds: 2, p95ScenarioSeconds: 4, averageOffersPerScenario: 5.5,
    averageArtifactBytesPerScenario: 1234, maxParallel: 3, manualMaxParallel: 99,
    targetChunkMinutes: 10, maxBrowserMinutes: 20, now: new Date('2026-08-20T10:00:00+02:00')
  };
  assert.throws(() => buildWorkflowPlan(common), /acknowledge_expanded_run=true/);
  const expanded = buildWorkflowPlan({ ...common, acknowledgeExpandedRun: true });
  assert.equal(expanded.scenario_count, 10);
  assert.equal(expanded.max_parallel, 3);
  const safe = buildWorkflowPlan({
    eventName: 'workflow_dispatch', timeZone: 'Europe/Warsaw', locations: ['Katowice'], rollingDays: 1,
    durationsDays: [2], manualMaxParallel: 99, now: new Date('2026-08-20T10:00:00+02:00')
  });
  assert.equal(safe.should_run, true);
  assert.equal(safe.max_parallel, 1);
  assert.equal(safe.matrix.include.length, 1);
});

test('workflow planner rejects missing or invalid measured values for executing expanded runs', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const base = {
    eventName: 'workflow_dispatch', timeZone: 'Europe/Warsaw', locations: ['Katowice'], rollingDays: 10,
    durationsDays: [2], acknowledgeExpandedRun: true, benchmarkStage: 4, p50ScenarioSeconds: 2,
    p95ScenarioSeconds: 4, averageOffersPerScenario: 5.5, averageArtifactBytesPerScenario: 1234,
    maxParallel: 3, targetChunkMinutes: 10, maxBrowserMinutes: 20,
    now: new Date('2026-08-20T10:00:00+02:00')
  };
  for (const [field, value] of [
    ['p50ScenarioSeconds', 0], ['p95ScenarioSeconds', Infinity], ['maxParallel', 1.5],
    ['targetChunkMinutes', -1], ['maxBrowserMinutes', NaN]
  ]) assert.throws(() => buildWorkflowPlan({ ...base, [field]: value }), /positive finite|positive integer/);
  assert.throws(() => buildWorkflowPlan({ ...base, p50ScenarioSeconds: 5, p95ScenarioSeconds: 4 }), /p95.*p50/);
  assert.throws(() => buildWorkflowPlan({ ...base, timeZone: 'UTC' }), /Europe\/Warsaw/);
});

test('disabled schedule is a successful non-running plan and date partition validates its boundary', () => {
  const { buildWorkflowPlan, partitionDates } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  assert.deepEqual(partitionDates(['2026-08-21', '2026-08-22', '2026-08-23'], 2), [
    ['2026-08-21', '2026-08-22'], ['2026-08-23']
  ]);
  assert.throws(() => partitionDates(['2026-08-21'], 0), /positive integer/);
  const plan = buildWorkflowPlan({
    eventName: 'schedule', timeZone: 'Europe/Warsaw', locations: defaultLocationCities(),
    rollingDays: 60, durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], fullEnabled: false,
    benchmarkStage: 0, now: new Date('2026-08-20T10:00:00+02:00')
  });
  assert.equal(plan.should_run, false);
  assert.equal(plan.scenario_count, 7020);
  assert.deepEqual(plan.matrix, { include: [] });
  assert.match(plan.summary, /disabled/i);
});

test('workflow planner CLI writes atomic plan expected keys and injection-safe GitHub outputs', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-workflow-plan-'));
  const script = path.resolve(__dirname, '../src/qeeq/workflowPlan.js');
  const planPath = path.join(directory, 'plan.json');
  const keysPath = path.join(directory, 'expected.json');
  const outputsPath = path.join(directory, 'github-output.txt');
  try {
    const result = spawnSync(process.execPath, [script,
      '--event-name=workflow_dispatch', '--time-zone=Europe/Warsaw', '--locations=Katowice',
      '--rolling-days=1', '--durations-days=2', '--manual-max-parallel=1',
      `--output=${planPath}`, `--expected-keys-output=${keysPath}`, `--github-output=${outputsPath}`
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    const outputs = fs.readFileSync(outputsPath, 'utf8');
    assert.equal(plan.scenario_count, 1);
    assert.deepEqual(keys, plan.expected_scenario_keys);
    assert.match(outputs, /^should_run=true$/m);
    assert.match(outputs, /^matrix=\{"include":\[/m);
    assert.doesNotMatch(outputs, /\r|%0A|::/);
    assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
    const bad = spawnSync(process.execPath, [script, '--event-name=workflow_dispatch', '--locations=Katowice%0Aowned=true'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.doesNotMatch(`${bad.stdout}${bad.stderr}`, /owned=true/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('enabled scheduled runs require stage four even below the full matrix', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const input = {
    eventName: 'schedule', timeZone: 'Europe/Warsaw', locations: ['Katowice'], rollingDays: 10,
    durationsDays: [2], fullEnabled: true, benchmarkStage: 3, p50ScenarioSeconds: 2,
    p95ScenarioSeconds: 4, averageOffersPerScenario: 5.5, averageArtifactBytesPerScenario: 1234,
    maxParallel: 2, targetChunkMinutes: 10, maxBrowserMinutes: 20,
    now: new Date('2026-08-20T10:00:00+02:00')
  };
  assert.throws(() => buildWorkflowPlan(input), /QEEQ_BENCHMARK_STAGE=4/);
});

test('workflow planner rejects duplicate catalog aliases and non-calendar partition dates', () => {
  const { buildWorkflowPlan, partitionDates } = require('../src/qeeq/workflowPlan');
  assert.throws(() => buildWorkflowPlan({
    eventName: 'workflow_dispatch', timeZone: 'Europe/Warsaw', locations: ['Katowice', 'katowice'],
    rollingDays: 1, durationsDays: [2], now: new Date('2026-08-20T10:00:00+02:00')
  }), /locations must not contain duplicates/);
  assert.throws(() => partitionDates(['2026-02-31'], 1), /valid consecutive YYYY-MM-DD/);
  assert.throws(() => partitionDates(['2026-08-22', '2026-08-21'], 1), /valid consecutive YYYY-MM-DD/);
});

test('daily final status maps every infrastructure job failure to code one', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  const finalStatus = yaml.slice(yaml.indexOf('  final-status:'));
  for (const result of ['PLAN_RESULT', 'SCRAPE_RESULT', 'MERGE_RESULT', 'PAGES_RESULT', 'NOTIFY_RESULT']) {
    assert.match(finalStatus, new RegExp(`${result}:`));
  }
  assert.match(finalStatus, /failure\|cancelled/);
  assert.match(finalStatus, /0\|1\|2\) exit "\$MERGED_CODE"/);
});

test('plan-failure notification has no install dependency and uses only the pure summary builder', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  const start = yaml.indexOf('  notify-plan-failure:');
  const section = yaml.slice(start, yaml.indexOf('  scrape:', start));
  assert.ok(start >= 0);
  assert.doesNotMatch(section, /npm ci|npm install|cache:\s*npm/);
  assert.match(section, /node src\/qeeq\/telegramSummary\.js --mode=plan-failure/);
  assert.doesNotMatch(section, /QEEQ plan failure/);
  assert.deepEqual([...section.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]).sort(), [
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'
  ]);
});

test('merge CLI turns an empty chunk tree plus authoritative keys into canonical missing scenarios', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-empty-chunks-'));
  const inputDir = path.join(directory, 'downloaded-parts');
  const expectedFile = path.join(directory, 'expected.json');
  const outputJson = path.join(directory, 'output', 'qeeq-results-latest.json');
  const outputCsv = path.join(directory, 'output', 'qeeq-results.csv');
  const mergeScript = path.resolve(__dirname, '../src/qeeq/mergeResults.js');
  try {
    fs.mkdirSync(inputDir);
    fs.writeFileSync(expectedFile, JSON.stringify(['katowice-pyrzowice:2026-08-21:2']));
    const result = spawnSync(process.execPath, [mergeScript,
      `--input-dir=${inputDir}`, `--expected-keys-file=${expectedFile}`,
      `--output-json=${outputJson}`, `--output-csv=${outputCsv}`
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(fs.readFileSync(outputJson, 'utf8'));
    assert.equal(payload.run_status, 'failure');
    assert.equal(payload.quality_status, 'fail');
    assert.equal(payload.expected_checks, 1);
    assert.equal(payload.completed_checks, 0);
    assert.equal(payload.failed_checks, 1);
    assert.deepEqual(payload.scenarios, []);
    assert.deepEqual(payload.errors, [{ code: 'missing_chunk_scenario', scenario_key: 'katowice-pyrzowice:2026-08-21:2' }]);
    assert.equal(fs.existsSync(outputCsv), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('daily merge creates an empty chunk tree when no chunk artifact can be downloaded', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-daily.yml', 'utf8');
  const mergeStart = yaml.indexOf('  merge:');
  const merge = yaml.slice(mergeStart, yaml.indexOf('  pages:', mergeStart));
  const downloadStart = merge.indexOf('- name: Download every available chunk');
  const download = merge.slice(downloadStart, merge.indexOf('- name: Download authoritative expected keys', downloadStart));
  assert.match(download, /continue-on-error:\s*true/);
  assert.match(merge, /mkdir -p downloaded-parts/);
  assert.match(merge, /--expected-keys-file=expected-scenario-keys\.json/);
  assert.match(merge, /name: Upload merged reports[\s\S]*if:\s*always\(\)/);
});

test('workflow planner enforces GitHub timeout and parallelism boundaries without clamping', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const base = {
    eventName: 'workflow_dispatch', timeZone: 'Europe/Warsaw', locations: ['Katowice'],
    rollingDays: 10, durationsDays: [2], acknowledgeExpandedRun: true, benchmarkStage: 4,
    p50ScenarioSeconds: 1000, p95ScenarioSeconds: 1400, averageOffersPerScenario: 5.5,
    averageArtifactBytesPerScenario: 1234, maxParallel: 256,
    targetChunkMinutes: 234, maxBrowserMinutes: 1000,
    now: new Date('2026-08-20T10:00:00+02:00')
  };
  const boundary = buildWorkflowPlan(base);
  assert.equal(boundary.chunk_timeout_minutes, 360);
  assert.equal(boundary.max_parallel, 256);
  assert.throws(() => buildWorkflowPlan({ ...base, p95ScenarioSeconds: 1401 }), /chunk timeout.*360/i);
  assert.throws(() => buildWorkflowPlan({ ...base, maxParallel: 257 }), /maxParallel.*at most 256/);
  assert.throws(() => buildWorkflowPlan({ ...base, planOnly: true, p95ScenarioSeconds: 1401 }), /chunk timeout.*360/i);
  assert.throws(() => buildWorkflowPlan({ ...base, planOnly: true, maxParallel: 257 }), /maxParallel.*at most 256/);
});

test('current QEEQ autocomplete title and selected hidden value yield canonical airport identity', () => {
  const { parseAutocompleteIdentity } = require('../src/qeeq/scraper');
  assert.deepEqual(parseAutocompleteIdentity({
    title: 'Port Lotniczy Katowice-Pyrzowice(KTW), Katowice, Województwo śląskie, Polska',
    text: '',
    value: 'pickup_city=2477&pickup_landmark=404260&data_type=airport'
  }), {
    label: 'Port Lotniczy Katowice-Pyrzowice',
    iata: 'KTW',
    city: '2477',
    landmark: '404260',
    dataType: 'airport'
  });
});

test('browser-backed validator accepts a synchronous fresh autocomplete response without submitting', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { validateLiveLocationCatalog } = require('../src/qeeq/validateLocations');
  const fake = createFakeQeeqBrowser({ autocompleteDelayPolls: 0 });
  const result = await validateLiveLocationCatalog(task5Config(), {
    launchBrowser: fake.launchBrowser,
    now: fake.now,
    sleep: fake.sleep
  });
  assert.equal(result.validation_status, 'pass');
  assert.equal(result.validated_airports, 9);
  assert.equal(fake.submitted, false);
});

test('autocomplete resolver waits for the current QEEQ pickup input to render', async () => {
  const { SELECTORS, resolveVisibleAirportMatches } = require('../src/qeeq/scraper');
  let inputVisible = false;
  let popupVisible = false;
  let query = '';
  let sleeps = 0;
  const input = {
    isVisible: async () => inputVisible,
    fill: async value => { query = value; }
  };
  const suggestion = {
    isVisible: async () => true,
    innerText: async () => '',
    getAttribute: async name => name === 'title'
      ? 'Port Lotniczy Katowice-Pyrzowice(KTW), Katowice, Województwo śląskie, Polska'
      : name === 'data-role' ? 'item' : null
  };
  const page = {
    getByText(label) {
      if (label !== 'Odrzuć nieobowiązkowe pliki cookie') {
        return { count: async () => 0, nth() { return this; } };
      }
      return {
        count: async () => 1,
        nth() { return this; },
        isVisible: async () => popupVisible,
        click: async () => { popupVisible = false; }
      };
    },
    locator(selector) {
      if (selector === SELECTORS.pickupInput) return { count: async () => 1, nth: () => input };
      if (selector === SELECTORS.pickupSuggestion) {
        return { count: async () => query ? 1 : 0, nth: () => suggestion };
      }
      throw new Error(`unexpected selector: ${selector}`);
    }
  };
  const matches = await resolveVisibleAirportMatches(page, {
    label: 'Port Lotniczy Katowice-Pyrzowice',
    iata: 'KTW'
  }, {
    timeoutMs: 300,
    sleep: async () => {
      sleeps += 1;
      inputVisible = true;
      popupVisible = true;
    }
  });
  assert.equal(sleeps >= 1, true);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].iata, 'KTW');
  assert.equal(popupVisible, false);
});

test('popup dismissor reports a cookie dialog that rendered after navigation', async () => {
  const { dismissPolishPopups } = require('../src/qeeq/scraper');
  let popupVisible = true;
  const page = {
    getByText(label) {
      if (label !== 'Odrzuć nieobowiązkowe pliki cookie') {
        return { count: async () => 0, nth() { return this; } };
      }
      return {
        count: async () => 1,
        nth() { return this; },
        isVisible: async () => popupVisible,
        click: async () => { popupVisible = false; }
      };
    }
  };
  assert.equal(await dismissPolishPopups(page, 300), true);
  assert.equal(popupVisible, false);
});

test('selected autocomplete uses one deadline across delayed input late popup replacement and fresh retry', async () => {
  const { SELECTORS, resolveSelectedAirportMatches } = require('../src/qeeq/scraper');
  let nowMs = 0;
  let query = '';
  let generation = 0;
  let popupVisible = false;
  let popupClicks = 0;
  let selections = 0;
  const input = {
    isVisible: async () => nowMs >= 100,
    fill: async value => { query = value; }
  };
  const suggestionCollection = {
    count: async () => query ? 1 : 0,
    nth: () => {
      const locatorGeneration = generation;
      return {
        isVisible: async () => locatorGeneration === generation,
        innerText: async () => '',
        getAttribute: async name => name === 'title'
          ? 'Port Lotniczy Katowice-Pyrzowice(KTW), Katowice, Województwo śląskie, Polska'
          : name === 'data-role' ? 'item' : null,
        click: async () => {
          if (popupVisible || locatorGeneration !== generation) throw new Error('element is intercepted or stale');
          selections += 1;
        }
      };
    }
  };
  let firstSuggestionRead = true;
  const page = {
    getByText(label) {
      if (label !== 'Odrzuć nieobowiązkowe pliki cookie') {
        return { count: async () => 0, nth() { return this; } };
      }
      return {
        count: async () => 1,
        nth() { return this; },
        isVisible: async () => popupVisible,
        click: async () => {
          popupVisible = false;
          popupClicks += 1;
          generation += 1;
        }
      };
    },
    locator(selector) {
      if (selector === SELECTORS.pickupInput) return { count: async () => 1, nth: () => input };
      if (selector === SELECTORS.pickupSuggestion) {
        if (query && firstSuggestionRead) {
          firstSuggestionRead = false;
          popupVisible = true;
        }
        return suggestionCollection;
      }
      if (selector === SELECTORS.pickPlace) {
        return {
          count: async () => 1,
          nth: () => ({ inputValue: async () => 'pickup_city=2477&pickup_landmark=404260&data_type=airport' })
        };
      }
      throw new Error(`unexpected selector: ${selector}`);
    }
  };
  const matches = await resolveSelectedAirportMatches(page, {
    label: 'Port Lotniczy Katowice-Pyrzowice',
    iata: 'KTW'
  }, {
    timeoutMs: 300,
    nowMillis: () => nowMs,
    sleep: async milliseconds => { nowMs += milliseconds; }
  });
  assert.equal(nowMs <= 300, true);
  assert.equal(popupClicks, 1);
  assert.equal(selections, 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].landmark, '404260');
});

test('autocomplete resolver shares one absolute timeout between input and suggestion polling', async () => {
  const { SELECTORS, resolveVisibleAirportMatches } = require('../src/qeeq/scraper');
  let nowMs = 0;
  const input = { isVisible: async () => nowMs >= 200, fill: async () => {} };
  const page = {
    getByText() { return { count: async () => 0, nth() { return this; } }; },
    locator(selector) {
      if (selector === SELECTORS.pickupInput) return { count: async () => 1, nth: () => input };
      if (selector === SELECTORS.pickupSuggestion) return { count: async () => 0, nth() { throw new Error('no suggestion'); } };
      throw new Error(`unexpected selector: ${selector}`);
    }
  };
  const matches = await resolveVisibleAirportMatches(page, { label: 'Port Lotniczy Katowice-Pyrzowice', iata: 'KTW' }, {
    timeoutMs: 300,
    nowMillis: () => nowMs,
    sleep: async milliseconds => { nowMs += milliseconds; }
  });
  assert.deepEqual(matches, []);
  assert.equal(nowMs <= 300, true);
});

test('current QEEQ LI date controls select scoped Warsaw dates without editing spans or submitting', async () => {
  const { SELECTORS, setSearchParameters } = require('../src/qeeq/scraper');
  const values = {
    [SELECTORS.pickupDateValue]: '2026-09-20',
    [SELECTORS.pickupTimeValue]: '10:00',
    [SELECTORS.returnDateValue]: '2026-09-21',
    [SELECTORS.returnTimeValue]: '10:00'
  };
  const selected = [];
  let activeDate = null;
  let fillAttempts = 0;
  let popupVisible = true;
  let submitClicks = 0;
  const empty = { count: async () => 0, nth() { return this; }, first() { return this; } };
  const collection = items => ({
    count: async () => items.length,
    nth: index => items[index],
    first: () => items[0]
  });
  const dateControl = name => ({
    isVisible: async () => true,
    evaluate: async callback => callback({ tagName: 'LI' }),
    click: async () => { activeDate = name; },
    fill: async () => { fillAttempts += 1; throw new Error('LI is not editable'); }
  });
  const currentValue = (text, visible) => ({
    isVisible: async () => visible,
    inputValue: async () => { throw new Error('SPAN is not an input'); },
    innerText: async () => text,
    fill: async () => { fillAttempts += 1; throw new Error('SPAN is not editable'); },
    selectOption: async () => { fillAttempts += 1; throw new Error('SPAN is not a select'); }
  });
  const hidden = selector => ({ inputValue: async () => values[selector] });
  const day = value => ({
    isVisible: async () => true,
    innerText: async () => value,
    getAttribute: async name => name === 'class' ? 'pmu-button' : null,
    click: async () => {
      const selector = activeDate === 'pickup' ? SELECTORS.pickupDateValue : SELECTORS.returnDateValue;
      values[selector] = `2026-08-${value}`;
      selected.push(activeDate);
    }
  });
  const august = {
    isVisible: async () => true,
    locator: selector => selector === '.pmu-days .pmu-button' ? collection([day('22'), day('24')]) : empty
  };
  const months = {
    filter: ({ hasText }) => hasText === 'Sierpień, 2026' ? collection([august]) : empty
  };
  const page = {
    getByText(label) {
      if (label !== 'Odrzuć nieobowiązkowe pliki cookie') return empty;
      return collection([{
        isVisible: async () => popupVisible,
        click: async () => { popupVisible = false; }
      }]);
    },
    getByLabel() { return empty; },
    locator(selector) {
      if (selector === SELECTORS.pickupDate) return collection([dateControl('pickup')]);
      if (selector === SELECTORS.returnDate) return collection([dateControl('return')]);
      if (selector === SELECTORS.pickupTime) return collection([currentValue('10:00', true)]);
      if (selector === SELECTORS.returnTime) return collection([currentValue('10:00', true)]);
      if (selector === SELECTORS.driverAge) return collection([currentValue('30-60', true)]);
      if (selector === SELECTORS.residence) return collection([currentValue('PL', false)]);
      if (Object.hasOwn(values, selector)) return collection([hidden(selector)]);
      if (selector === SELECTORS.sameLocation) return empty;
      if (selector === '.pmu-instance:visible') return months;
      if (selector === '.pmu-next:visible') return empty;
      if (selector === SELECTORS.submit) return collection([{ click: async () => { submitClicks += 1; } }]);
      throw new Error(`unexpected selector: ${selector}`);
    }
  };

  await setSearchParameters(page, {
    pickupDate: '2026-08-22',
    pickupTime: '10:00',
    dropoffDate: '2026-08-24',
    dropoffTime: '10:00'
  }, { driverAge: '30-60', residenceCountryCode: 'PL' });

  assert.deepEqual(selected, ['pickup', 'return']);
  assert.equal(values[SELECTORS.pickupDateValue], '2026-08-22');
  assert.equal(values[SELECTORS.returnDateValue], '2026-08-24');
  assert.equal(fillAttempts, 0);
  assert.equal(submitClicks, 0);
  assert.equal(popupVisible, false);
});

test('current QEEQ LI time control uses the accessible half-hour slider and verifies hidden time', async () => {
  const { SELECTORS, setSearchParameters } = require('../src/qeeq/scraper');
  const values = {
    [SELECTORS.pickupDateValue]: '2026-08-22',
    [SELECTORS.pickupTimeValue]: '09:30',
    [SELECTORS.returnDateValue]: '2026-08-24',
    [SELECTORS.returnTimeValue]: '10:00'
  };
  const empty = { count: async () => 0, nth() { return this; }, first() { return this; } };
  const collection = items => ({ count: async () => items.length, nth: index => items[index], first: () => items[0] });
  const hidden = selector => ({ inputValue: async () => values[selector] });
  let sliderValue = 19;
  const pickupHandle = {
    isVisible: async () => true,
    press: async key => {
      if (key === 'Home') sliderValue = 0;
      if (key === 'ArrowRight') sliderValue += 1;
      values[SELECTORS.pickupTimeValue] = `${String(Math.floor(sliderValue / 2)).padStart(2, '0')}:${sliderValue % 2 ? '30' : '00'}`;
    }
  };
  const passiveHandle = { isVisible: async () => true, press: async () => { throw new Error('wrong time slider'); } };
  const profile = value => ({
    isVisible: async () => true,
    inputValue: async () => { throw new Error('SPAN is not an input'); },
    innerText: async () => value
  });
  const page = {
    getByText() { return empty; },
    getByLabel() { return empty; },
    locator(selector) {
      if (Object.hasOwn(values, selector)) return collection([hidden(selector)]);
      if (selector === SELECTORS.pickupTime) return collection([{
        isVisible: async () => true,
        evaluate: async callback => callback({ tagName: 'LI' }),
        click: async () => {}
      }]);
      if (selector === SELECTORS.timeSlider) return collection([pickupHandle, passiveHandle]);
      if (selector === SELECTORS.sameLocation) return empty;
      if (selector === SELECTORS.driverAge) return collection([profile('30-60')]);
      if (selector === SELECTORS.residence) return collection([profile('PL')]);
      throw new Error(`unexpected selector: ${selector}`);
    }
  };

  await setSearchParameters(page, {
    pickupDate: '2026-08-22', pickupTime: '10:00',
    dropoffDate: '2026-08-24', dropoffTime: '10:00'
  }, { driverAge: '30-60', residenceCountryCode: 'PL' });

  assert.equal(values[SELECTORS.pickupTimeValue], '10:00');
  assert.equal(sliderValue, 20);
});

test('current QEEQ reserve href yields only the exact fabricated id bid pair', () => {
  const { parseReserveBusinessIdentity } = require('../src/qeeq/scraper');
  assert.deepEqual(parseReserveBusinessIdentity({
    href: '/car/booking?_vv_=SAFE_VIEW&bid=SAFE_BID&clid=SAFE_CLIENT&id=SAFE_ID&list_discount_type=SAFE_DISCOUNT'
  }), { id: 'SAFE_ID', bid: 'SAFE_BID' });
  assert.deepEqual(parseReserveBusinessIdentity({ id: 'LEGACY_ID', bid: 'LEGACY_BID', href: 'not a URL' }), {
    id: 'LEGACY_ID', bid: 'LEGACY_BID'
  });
  assert.deepEqual(parseReserveBusinessIdentity({ href: '/car/booking?clid=SAFE_CLIENT' }), { id: null, bid: null });
  assert.doesNotMatch(JSON.stringify(parseReserveBusinessIdentity({
    href: '/car/booking?bid=SAFE_BID&clid=SAFE_CLIENT&id=SAFE_ID'
  })), /clid|SAFE_CLIENT|href/);
});

test('separate numeric Diamond row does not taint a verified public displayed total', () => {
  const { normalizePriceCandidate } = require('../src/qeeq/utils');
  const result = normalizePriceCandidate({
    displayedText: 'Cena 119 zł', discountType: null,
    memberText: 'Cena Diamentowa 98 zł',
    rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2
  });
  assert.equal(result.total_price, 119);
  assert.equal(result.daily_price, 59.5);
  assert.equal(result.conditional_offer_total, null);
  assert.equal(result.conditional_offer_type, null);
  assert.equal(result.conditional_member_total, 98);
  assert.equal(result.conditional_member_daily, 49);
  assert.equal(result.price_tier, 'public');
  assert.equal(result.price_verified, true);
  assert.equal(result.conditional_price_verified, true);
});

test('provider observer combines later supported response within one bounded lifetime', async () => {
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ responseSequence: [
    { payload: { data: { list: [], shops: [] } }, url: 'https://www.qeeq.pl/car-api/search/list?page=1' },
    { payload: apiFixture, url: 'https://www.qeeq.pl/car-api/search/list?page=2', emitDelayMs: 10 }
  ] });
  const boundedConfig = task5Config({ apiObservationTimeoutMs: 1000 });
  const outcome = await new QeeqScraper(boundedConfig, {
    launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep
  }).runScenario(task5Scenario());
  assert.equal(outcome.status, 'success');
  assert.equal(outcome.offers[0].provider_name, 'CARWIZ');
  assert.equal(outcome.quality_errors.includes('provider_unresolved'), false);
  assert.equal(fake.responseListeners, 0);
  assert.equal(fake.clockMs <= boundedConfig.apiObservationTimeoutMs, true);
});

test('cross-response provider merge deduplicates repeats but preserves conflicting ambiguity', () => {
  const { mergeObservedProviderMetadata, resolveProviderForOffer } = require('../src/qeeq/scraper');
  const payload = (shopId, providerName) => ({ data: {
    list: [{ meal_list: [{ id: 'SAFE_ID', bid: 'SAFE_BID', pickup_shop: shopId }] }],
    shops: [{ id: shopId, name: providerName }]
  } });
  const snapshot = { businessId: 'SAFE_ID', businessBid: 'SAFE_BID' };
  const repeated = mergeObservedProviderMetadata([payload('SAFE_SHOP', 'SAFE PROVIDER'), payload('SAFE_SHOP', 'SAFE PROVIDER')]);
  assert.equal(resolveProviderForOffer(snapshot, repeated).providerName, 'SAFE PROVIDER');
  const conflicting = mergeObservedProviderMetadata([payload('SAFE_SHOP_A', 'SAFE A'), payload('SAFE_SHOP_B', 'SAFE B')]);
  assert.equal(resolveProviderForOffer(snapshot, conflicting).quality_error, 'provider_ambiguous');
});

test('provider observer ignores a supported response received after its absolute deadline', async () => {
  const { observeListResponses } = require('../src/qeeq/scraper');
  let nowMs = 0;
  let responseHandler = null;
  let detached = false;
  const page = {
    on(event, handler) { if (event === 'response') responseHandler = handler; },
    off(event, handler) { if (event === 'response' && handler === responseHandler) detached = true; }
  };
  const response = pageNumber => ({
    url: () => `https://www.qeeq.pl/car-api/search/list?page=${pageNumber}`,
    request: () => ({ method: () => 'GET' }),
    json: async () => ({ data: { list: [], shops: [] } })
  });
  const observation = observeListResponses(page, 100, () => nowMs);
  nowMs = 50;
  responseHandler(response(1));
  nowMs = 101;
  responseHandler(response(2));
  const result = await observation.finish();
  assert.equal(result.payloads.length, 1);
  assert.equal(detached, true);
});

test('README documents safety gate outputs and verification commands', () => {
  const fs = require('node:fs');
  const readme = fs.readFileSync('README.md', 'utf8');
  for (const required of ['QEEQ_FULL_SCHEDULE_ENABLED', 'QEEQ_BENCHMARK_STAGE', 'QEEQ_P95_SCENARIO_SECONDS', 'QEEQ_MAX_BROWSER_MINUTES', 'QEEQ_PAGES_ENABLED', '7020', 'npm.cmd test', 'qeeq-location-validation.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx', 'quality-summary.json', 'run-manifest.json', 'newcomer_coupon', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
    assert.match(readme, new RegExp(required.replace('.', '\\.')));
  }
});

test('non-PLN price markers stay unverified and retain unexpected currency evidence', () => {
  const fixture = require('./fixtures/qeeq-expanded-group-ktw.json');
  const apiFixture = require('./fixtures/qeeq-search-list-ktw.json');
  const { parseObservedListPayload, parseOfferSnapshot } = require('../src/qeeq/scraper');
  const { buildRootPayload, buildScenarioPayload } = require('../src/qeeq/run');
  const { normalizePriceCandidate } = require('../src/qeeq/utils');
  const providers = parseObservedListPayload(apiFixture);
  const context = { rentalDays: 2, vehicle: fixture.vehicle };

  for (const currency of ['EUR', 'CHF']) {
    const offer = parseOfferSnapshot({
      ...fixture.offer,
      displayedAmount: `Cena 119 ${currency}`,
      diamondAmount: null,
      discountType: null,
      rentalPeriodText: 'łącznie za 2 dni'
    }, context, providers);
    assert.equal(offer.record_type, 'offer');
    assert.equal(offer.currency, currency);
    assert.equal(offer.total_price, null);
    assert.equal(offer.price_verified, false);
    assert.deepEqual(offer.quality_errors, ['unexpected_currency']);

    const scenario = buildScenarioPayload({
      scenario: { key: `ktw:${currency}`, airport: { key: 'katowice-pyrzowice', iata: 'KTW' }, rentalDays: 2 },
      outcome: { status: 'success', offers: [offer], groups: [], quality_errors: [] }
    });
    const root = buildRootPayload({ expected_checks: 1, scenarios: [scenario] });
    assert.equal(root.quality.verified_public_offer_count, 0);
    assert.deepEqual(root.quality.quality_errors, ['unexpected_currency']);
    assert.equal(root.quality_status, 'fail');
  }

  const direct = normalizePriceCandidate({
    displayedText: 'Cena 119 EUR', rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2
  });
  assert.equal(direct.currency, 'EUR');
  assert.equal(direct.price_verified, false);
  assert.deepEqual(direct.quality_errors, ['unexpected_currency']);

  const fallback = normalizePriceCandidate({
    displayedText: 'Cena 119', fallbackCurrency: 'EUR', rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2
  });
  assert.equal(fallback.currency, 'EUR');
  assert.equal(fallback.price_verified, false);
  assert.deepEqual(fallback.quality_errors, ['unexpected_currency']);
});

test('closed groups without a visible expansion control become quality diagnostics', async () => {
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const fake = createFakeQeeqBrowser({ loadMoreCounts: [3] });
  const outcome = await new QeeqScraper(task5Config(), {
    launchBrowser: fake.launchBrowser, now: fake.now, sleep: fake.sleep
  }).runScenario(task5Scenario());

  assert.equal(outcome.offers.length, 1);
  assert.equal(outcome.quality_errors.includes('group_expansion_timeout'), true);
  assert.deepEqual(outcome.groups[1].quality_errors, ['group_expansion_timeout']);
  assert.deepEqual(outcome.groups[2].quality_errors, ['group_expansion_timeout']);
  const { buildRootPayload, buildScenarioPayload } = require('../src/qeeq/run');
  const canonical = buildScenarioPayload({ scenario: task5Scenario(), outcome: {
    ...outcome,
    offers: [{ record_type: 'offer', provider_name: 'PUBLIC', total_price: 119, daily_price: 59.5, currency: 'PLN', price_tier: 'public', price_verified: true }]
  } });
  const root = buildRootPayload({ expected_checks: 1, scenarios: [canonical] });
  assert.equal(root.quality_status, 'warning');
  assert.equal(root.quality.quality_errors.includes('group_expansion_timeout'), true);
});

test('visible anchors with unreadable snapshots become deterministic group diagnostics', async () => {
  const { SELECTORS, extractResults } = require('../src/qeeq/scraper');
  const empty = { count: async () => 0, isVisible: async () => false };
  const text = value => {
    const locator = { count: async () => 1, isVisible: async () => true, innerText: async () => value };
    locator.nth = () => locator;
    return locator;
  };
  const unreadableAnchor = {
    count: async () => 1,
    isVisible: async () => true,
    locator: () => empty
  };
  const anchors = {
    count: async () => 1,
    isVisible: async () => true,
    nth: () => unreadableAnchor
  };
  const group = {
    locator: selector => {
      if (selector === SELECTORS.vehicleName) return text('Unreadable vehicle');
      if (selector === SELECTORS.supplierButton) return empty;
      if (selector === SELECTORS.reserveAnchor) return anchors;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    evaluate: async () => true
  };
  const page = {
    locator: selector => {
      assert.equal(selector, SELECTORS.group);
      return { count: async () => 1, nth: () => group };
    }
  };

  const result = await extractResults(
    page, { rentalDays: 2 }, task5Config(), new Map(),
    'https://www.qeeq.pl/car/search', '2026-08-21T00:00:00.000Z', async () => {}
  );
  assert.deepEqual(result.qualityErrors, ['price_unverified']);
  assert.deepEqual(result.groups[0].quality_errors, ['price_unverified']);
  assert.deepEqual(result.offers, []);
});

test('scenario failures write bounded sanitized artifacts before cleanup and preserve the primary error', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { createFakeQeeqBrowser } = require('./fixtures/fake-qeeq-browser');
  const { QeeqScraper } = require('../src/qeeq/scraper');
  const root = fs.mkdtempSync(path.join(process.cwd(), 'output', 'qeeq-failure-artifacts-'));
  const artifactsDir = path.relative(process.cwd(), root);
  const order = [];
  const fake = createFakeQeeqBrowser({
    contextCloseError: 'context_close_failed',
    browserCloseError: 'browser_close_failed'
  });
  const launchBrowser = async () => {
    const browser = await fake.launchBrowser();
    const originalNewContext = browser.newContext;
    const originalBrowserClose = browser.close;
    browser.newContext = async options => {
      const context = await originalNewContext(options);
      const originalNewPage = context.newPage;
      const originalContextClose = context.close;
      context.newPage = async () => {
        const page = await originalNewPage();
        const originalGoto = page.goto.bind(page);
        page.screenshot = async () => {
          order.push('screenshot');
          return Buffer.from('SAFE_PNG_BYTES');
        };
        page.evaluate = async () => 'Visible text UNLABELED_SECRET_123456789012345678901234567890';
        page.goto = async url => {
          await originalGoto(url);
          for (let index = 0; index < 60; index += 1) {
            for (const listener of page.listeners.get('console') || []) {
              listener({ type: () => 'error', text: () => `console ${index} id=CONSOLE_SECRET_${index} https://www.qeeq.pl/car/search?ticket=URL_SECRET_${index}` });
            }
          }
          for (const listener of page.listeners.get('requestfailed') || []) {
            listener({
              method: () => 'GET',
              url: () => 'bid:REQUEST_SECRET',
              failure: () => ({ errorText: 'ticket=FAILURE_SECRET Cookie: sid=COOKIE_SECRET' })
            });
          }
          const error = new Error('failed ticket=ERROR_SECRET bid:BUSINESS_SECRET Authorization: Bearer AUTH_SECRET');
          error.code = 'scenario_failed';
          throw error;
        };
        return page;
      };
      context.close = async () => {
        order.push('context-close');
        return originalContextClose();
      };
      return context;
    };
    browser.close = async () => {
      order.push('browser-close');
      return originalBrowserClose();
    };
    return browser;
  };

  try {
    const scenario = { ...task5Scenario(), key: 'id=SCENARIO_SECRET&bid=SCENARIO_BUSINESS_SECRET' };
    const outcome = await new QeeqScraper(task5Config({ artifactsDir }), {
      launchBrowser, now: fake.now, sleep: fake.sleep
    }).runScenario(scenario);

    assert.equal(outcome.status, 'failure');
    assert.equal(outcome.error_code, 'scenario_failed');
    assert.equal(order.indexOf('screenshot') < order.indexOf('context-close'), true);
    assert.equal(order.indexOf('context-close') < order.indexOf('browser-close'), true);
    assert.equal(fake.contextCloseAttempts, 1);
    assert.equal(fake.browserCloseAttempts, 1);
    assert.equal(Array.isArray(outcome.artifacts), true);
    assert.equal(outcome.artifacts.length, 3);

    const files = outcome.artifacts.map(relative => path.resolve(relative));
    const errorPath = files.find(file => file.endsWith('error.json'));
    const logPath = files.find(file => file.endsWith('browser.log'));
    const screenshotPath = files.find(file => file.endsWith('screenshot.png'));
    assert.ok(errorPath && logPath && screenshotPath);
    assert.equal(fs.readFileSync(screenshotPath, 'utf8'), 'SAFE_PNG_BYTES');
    assert.equal(fs.readdirSync(path.dirname(errorPath)).some(name => name.endsWith('.tmp')), false);
    assert.equal(fs.readdirSync(path.dirname(errorPath)).some(name => name.includes('dom')), false);

    const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(logLines.length <= 50, true);
    const text = files.filter(file => !file.endsWith('.png')).map(file => fs.readFileSync(file, 'utf8')).join('\n');
    for (const secret of ['SCENARIO_SECRET', 'SCENARIO_BUSINESS_SECRET', 'CONSOLE_SECRET', 'URL_SECRET', 'REQUEST_SECRET', 'FAILURE_SECRET', 'COOKIE_SECRET', 'ERROR_SECRET', 'BUSINESS_SECRET', 'AUTH_SECRET', 'UNLABELED_SECRET']) {
      assert.doesNotMatch(text, new RegExp(secret));
    }
    assert.doesNotMatch(text, /[?&](?:id|bid|clid|_vv_|fpt|ticket|ts)=|cookie|authorization|bearer/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(errorPath, 'utf8')).error_code, 'scenario_failed');
    assert.equal((fake.pages[0].listeners.get('console') || []).length, 0);
    assert.equal((fake.pages[0].listeners.get('requestfailed') || []).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safe visible DOM and stable current URL are recorded with safe artifact references', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { createFailureArtifactSession } = require('../src/qeeq/diagnostics');
  const root = fs.mkdtempSync(path.join(process.cwd(), 'output', 'qeeq-safe-artifacts-'));
  const listeners = new Map();
  const page = {
    on: (event, listener) => listeners.set(event, listener),
    off: event => listeners.delete(event),
    url: () => 'https://www.qeeq.pl/car/search?id=SESSION_SECRET&ticket=TICKET_SECRET#fragment',
    screenshot: async () => Buffer.from('SAFE_SCREENSHOT'),
    evaluate: async () => 'Katowice KTW Public price 119 PLN Automatic'
  };
  try {
    const session = createFailureArtifactSession(
      { artifactsDir: path.relative(process.cwd(), root) },
      { key: 'katowice-pyrzowice:2026-08-22:2' },
      0,
      () => new Date('2026-08-21T01:02:03.000Z')
    );
    session.attach(page);
    const references = await session.capture(Object.assign(new Error('safe failure'), { code: 'scenario_failed' }));
    const files = references.map(reference => path.resolve(reference));
    const errorPath = files.find(file => file.endsWith('error.json'));
    const domPath = files.find(file => file.endsWith('sanitized-dom.html'));
    assert.ok(errorPath && domPath);
    const envelope = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
    assert.equal(envelope.current_url, 'https://www.qeeq.pl/car/search');
    assert.deepEqual(envelope.files.sort(), ['browser.log', 'sanitized-dom.html', 'screenshot.png']);
    assert.equal(envelope.files.every(file => path.basename(file) === file), true);
    const dom = fs.readFileSync(domPath, 'utf8');
    assert.match(dom, /Katowice KTW Public price 119 PLN Automatic/);
    assert.doesNotMatch(dom, /SESSION_SECRET|TICKET_SECRET|[?&#]|<script|href=|src=/i);
    assert.equal(listeners.size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HTML redacts credential headers and QEEQ location identifiers in untrusted diagnostics', () => {
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const secrets = ['TOPSECRET', 'COOKIESECRET', 'CITYSECRET'];
  const html = buildHtmlReport({
    run_status: 'partial',
    quality_status: 'warning',
    quality: {
      quality_errors: [
        `Authorization: Bearer ${secrets[0]} Cookie: session=${secrets[1]} qeeq_city_id=${secrets[2]}`,
        'location_id_drift'
      ]
    },
    scenarios: []
  });

  for (const secret of secrets) assert.doesNotMatch(html, new RegExp(secret));
  assert.doesNotMatch(html, /Authorization|Cookie|qeeq_city_id/i);
  assert.match(html, /location_id_drift/);
  assert.match(html, /\[redacted\]/);
});

test('full workflow plans require measured capacity inputs and emit deterministic volume estimates', () => {
  const { buildWorkflowPlan } = require('../src/qeeq/workflowPlan');
  const { defaultLocationCities } = require('../src/qeeq/locations');
  const base = {
    eventName: 'workflow_dispatch', planOnly: true, acknowledgeExpandedRun: true,
    timeZone: 'Europe/Warsaw', locations: defaultLocationCities(), rollingDays: 60,
    durationsDays: [2,3,4,5,6,7,8,9,10,11,12,13,14], benchmarkStage: 4,
    p50ScenarioSeconds: 15, p95ScenarioSeconds: 25, maxParallel: 3,
    targetChunkMinutes: 60, maxBrowserMinutes: 3000,
    now: new Date('2026-08-20T10:00:00+02:00')
  };

  assert.throws(() => buildWorkflowPlan(base), /averageOffersPerScenario.*positive finite/);
  assert.throws(() => buildWorkflowPlan({ ...base, averageOffersPerScenario: 49 }), /averageArtifactBytesPerScenario.*positive finite/);
  for (const [field, value] of [
    ['averageOffersPerScenario', 0], ['averageOffersPerScenario', Infinity],
    ['averageArtifactBytesPerScenario', -1], ['averageArtifactBytesPerScenario', NaN]
  ]) {
    assert.throws(() => buildWorkflowPlan({
      ...base, averageOffersPerScenario: 49, averageArtifactBytesPerScenario: 70359, [field]: value
    }), /positive finite/);
  }

  const plan = buildWorkflowPlan({
    ...base, averageOffersPerScenario: 49, averageArtifactBytesPerScenario: 70359
  });
  assert.equal(plan.scenario_count, 7020);
  assert.equal(plan.matrix.include.length, 60);
  assert.equal(plan.chunk_timeout_minutes, 84);
  assert.equal(plan.average_offers_per_scenario, 49);
  assert.equal(plan.average_artifact_bytes_per_scenario, 70359);
  assert.equal(plan.estimated_offer_volume, 343980);
  assert.equal(plan.estimated_artifact_bytes, 493920180);
});

test('workflow planner CLI exposes measured capacity inputs in JSON console and GitHub outputs', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qeeq-capacity-plan-'));
  const script = path.resolve(__dirname, '../src/qeeq/workflowPlan.js');
  const githubOutput = path.join(directory, 'github-output.txt');
  try {
    const args = [
      '--event-name=workflow_dispatch', '--locations=Katowice', '--rolling-days=10', '--durations-days=2',
      '--acknowledge-expanded-run=true', '--benchmark-stage=4', '--p50-scenario-seconds=2',
      '--p95-scenario-seconds=4', '--average-offers-per-scenario=5.5',
      '--average-artifact-bytes-per-scenario=1234', '--max-parallel=2', '--target-chunk-minutes=10',
      '--max-browser-minutes=20', `--github-output=${githubOutput}`
    ];
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    const outputs = fs.readFileSync(githubOutput, 'utf8');
    assert.equal(stdout.average_offers_per_scenario, 5.5);
    assert.equal(stdout.average_artifact_bytes_per_scenario, 1234);
    assert.equal(stdout.estimated_offer_volume, 55);
    assert.equal(stdout.estimated_artifact_bytes, 12340);
    for (const expected of [
      'average_offers_per_scenario=5.5', 'average_artifact_bytes_per_scenario=1234',
      'estimated_offer_volume=55', 'estimated_artifact_bytes=12340'
    ]) assert.match(outputs, new RegExp(`^${expected}$`, 'm'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('smoke acceptance requires canonical success pass and a resolved verified public PLN offer', () => {
  const { assertSmokeAcceptance } = require('../src/qeeq/smokeAcceptance');
  const offer = {
    provider_name: 'CARWIZ', price_tier: 'public', price_verified: true,
    total_price: 119, currency: 'PLN'
  };
  const accepted = {
    schema_version: 1, provider: 'qeeq.pl', run_status: 'success', quality_status: 'pass',
    scenarios: [{ offers: [offer] }]
  };
  assert.deepEqual(assertSmokeAcceptance(accepted), { verified_public_pln_offer_count: 1 });

  for (const payload of [
    { ...accepted, run_status: 'partial' },
    { ...accepted, quality_status: 'warning' },
    { ...accepted, scenarios: [] },
    { ...accepted, scenarios: [{ offers: [{ ...offer, provider_name: '   ' }] }] },
    { ...accepted, scenarios: [{ offers: [{ ...offer, price_tier: 'conditional' }] }] },
    { ...accepted, scenarios: [{ offers: [{ ...offer, price_verified: false }] }] },
    { ...accepted, scenarios: [{ offers: [{ ...offer, total_price: Infinity }] }] },
    { ...accepted, scenarios: [{ offers: [{ ...offer, currency: 'EUR' }] }] }
  ]) assert.throws(() => assertSmokeAcceptance(payload), /Smoke acceptance failed/);
});

test('smoke workflow evaluates canonical acceptance but uploads diagnostics before final failure', () => {
  const fs = require('node:fs');
  const yaml = fs.readFileSync('.github/workflows/qeeq-smoke.yml', 'utf8');
  const acceptance = yaml.indexOf('name: Evaluate canonical smoke acceptance');
  const upload = yaml.indexOf('name: Upload smoke diagnostics');
  const finalStatus = yaml.indexOf('name: Final status');
  assert.ok(acceptance >= 0 && acceptance < upload && upload < finalStatus);
  assert.match(yaml.slice(acceptance, upload), /continue-on-error:\s*true/);
  assert.match(yaml.slice(acceptance, upload), /node src\/qeeq\/smokeAcceptance\.js --input=output\/qeeq-smoke\.json/);
  assert.match(yaml.slice(upload, finalStatus), /if:\s*always\(\)/);
  assert.match(yaml.slice(finalStatus), /ACCEPTANCE_OUTCOME:/);
  assert.match(yaml.slice(finalStatus), /\$ACCEPTANCE_OUTCOME.*success/);
});

test('canonical build and merge preserve only safe failure artifact refs and group diagnostics', () => {
  const crypto = require('node:crypto');
  const { buildScenarioPayload } = require('../src/qeeq/run');
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const key = 'katowice-pyrzowice:2026-08-22:2';
  const scenarioHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const safeBase = `failure/${scenarioHash}/attempt-0/20260821T010203000Z`;
  const scenario = buildScenarioPayload({
    scenario: {
      key,
      airport: { key: 'katowice-pyrzowice', iata: 'KTW' },
      pickupDate: '2026-08-22', pickupTime: '10:00',
      dropoffDate: '2026-08-24', dropoffTime: '10:00', rentalDays: 2
    },
    config: { artifactsDir: 'artifacts/qeeq' },
    outcome: {
      status: 'failure', error_code: 'scenario_failed', errors: [{ code: 'scenario_failed' }],
      groups: [{ record_type: 'group', vehicle_name: 'Unreadable', price_verified: false, rental_days: 2, parsing_source: 'dom', quality_errors: ['price_unverified', 'ticket=SECRET'] }],
      offers: [], quality_errors: ['price_unverified'],
      artifacts: [
        `artifacts/qeeq/${safeBase}/error.json`,
        `artifacts/qeeq/${safeBase}/screenshot.png`,
        'C:/absolute/error.json',
        'artifacts/qeeq/../outside/error.json',
        'artifacts/qeeq/failure/0123456789abcdef/attempt-0/20260821T010203000Z/error.json?ticket=SECRET',
        'artifacts/qeeq/failure/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/attempt-0/20260821T010203000Z/error.json',
        'artifacts/qeeq/id=BUSINESS_SECRET/error.json'
      ]
    }
  });

  assert.deepEqual(scenario.artifact_refs, [`${safeBase}/error.json`, `${safeBase}/screenshot.png`]);
  assert.deepEqual(scenario.groups[0].quality_errors, ['execution_failed', 'price_unverified']);
  assert.doesNotMatch(JSON.stringify(scenario.artifact_refs), /artifacts\/qeeq|BUSINESS_SECRET|SECRET|ticket|\.\.|[?#]/i);

  const merged = mergePayloads([{
    file: 'part.json',
    payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [scenario], errors: [] }
  }]);
  assert.deepEqual(merged.scenarios[0].artifact_refs, scenario.artifact_refs);
  assert.deepEqual(merged.scenarios[0].groups[0].quality_errors, scenario.groups[0].quality_errors);
});

test('one verified-public predicate rejects blank providers nonpositive totals non-PLN and groups', () => {
  const { buildRootPayload } = require('../src/qeeq/run');
  const { isVerifiedPublicOffer, rankVerifiedPublicOffers } = require('../src/qeeq/utils');
  const valid = {
    record_type: 'offer', provider_name: 'PUBLIC', currency: 'PLN',
    price_tier: 'public', price_verified: true, total_price: 119
  };
  assert.equal(isVerifiedPublicOffer(valid), true);
  assert.deepEqual(rankVerifiedPublicOffers([valid]), [valid]);

  const rejected = [
    { ...valid, provider_name: '' },
    { ...valid, provider_name: '   ' },
    { ...valid, total_price: 0 },
    { ...valid, total_price: -1 },
    { ...valid, currency: 'EUR' },
    { ...valid, record_type: 'group' }
  ];
  for (const offer of rejected) {
    assert.equal(isVerifiedPublicOffer(offer), false);
    assert.deepEqual(rankVerifiedPublicOffers([offer]), []);
    const payload = buildRootPayload({
      expected_checks: 1,
      scenarios: [{ key: 'a', status: 'success', errors: [], quality_errors: [], offers: [offer] }]
    });
    assert.equal(payload.quality.verified_public_offer_count, 0);
    assert.notEqual(payload.quality_status, 'pass');
  }

  const canonicalWithoutRecordType = { ...valid };
  delete canonicalWithoutRecordType.record_type;
  assert.equal(isVerifiedPublicOffer(canonicalWithoutRecordType), true);
});

test('shared diagnostics redact unlabelled opaque tokens in HTML and failure files', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { sanitizeDiagnosticText } = require('../src/qeeq/utils');
  const { buildHtmlReport } = require('../src/qeeq/reportHtml');
  const { createFailureArtifactSession } = require('../src/qeeq/diagnostics');
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const diagnostic = `location_id_drift ${token}`;

  const clean = sanitizeDiagnosticText(diagnostic);
  assert.match(clean, /location_id_drift/);
  assert.doesNotMatch(clean, new RegExp(token));
  assert.match(clean, /\[redacted\]/);

  const html = buildHtmlReport({
    run_status: 'success', quality_status: 'warning',
    quality: { quality_errors: [diagnostic] }, scenarios: []
  });
  assert.match(html, /location_id_drift/);
  assert.doesNotMatch(html, new RegExp(token));

  const root = fs.mkdtempSync(path.join(process.cwd(), 'output', 'qeeq-token-artifacts-'));
  const listeners = new Map();
  const page = {
    on: (event, listener) => listeners.set(event, listener),
    off: event => listeners.delete(event),
    url: () => 'https://www.qeeq.pl/car/search',
    screenshot: async () => Buffer.from('SAFE_SCREENSHOT'),
    evaluate: async () => `Visible ${token}`
  };
  try {
    const session = createFailureArtifactSession(
      { artifactsDir: path.relative(process.cwd(), root) }, { key: 'safe' }, 0,
      () => new Date('2026-08-21T01:02:03.000Z')
    );
    session.attach(page);
    listeners.get('console')({ type: () => 'error', text: () => diagnostic });
    const refs = await session.capture(Object.assign(new Error(diagnostic), { code: 'scenario_failed' }));
    assert.equal(refs.some(ref => ref.endsWith('sanitized-dom.html')), false);
    const written = refs.filter(ref => !ref.endsWith('.png')).map(ref => fs.readFileSync(path.resolve(ref), 'utf8')).join('\n');
    assert.match(written, /location_id_drift/);
    assert.doesNotMatch(written, new RegExp(token));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('multiple explicit currency markers never become verified PLN prices', () => {
  const { normalizePriceCandidate, rankVerifiedPublicOffers } = require('../src/qeeq/utils');
  const base = { rentalPeriodText: 'łącznie za 2 dni', rentalDays: 2 };
  const cases = [
    { displayedText: 'Cena 119 zł (30 EUR)', expectedCurrency: 'EUR' },
    { displayedText: '119 PLN / 30 USD', expectedCurrency: 'USD' },
    { displayedText: '119 EUR / 30 zł', expectedCurrency: 'EUR' },
    { displayedText: 'Cena 119 zł', memberText: 'Cena Diamentowa 98 zł (24 EUR)', expectedCurrency: 'EUR' }
  ];

  for (const fixture of cases) {
    const result = normalizePriceCandidate({ ...base, ...fixture });
    assert.equal(result.currency, fixture.expectedCurrency);
    assert.equal(result.total_price, null);
    assert.equal(result.price_verified, false);
    assert.equal(result.conditional_price_verified, false);
    assert.deepEqual(result.quality_errors, ['unexpected_currency']);
    assert.deepEqual(rankVerifiedPublicOffers([{
      record_type: 'offer', provider_name: 'PUBLIC', ...result
    }]), []);
  }

  const pln = normalizePriceCandidate({ ...base, displayedText: 'Cena 119 zł' });
  assert.equal(pln.currency, 'PLN');
  assert.equal(pln.total_price, 119);
  assert.equal(pln.price_verified, true);
  const uppercasePln = normalizePriceCandidate({ ...base, displayedText: 'CENA 119 ZŁ' });
  assert.equal(uppercasePln.currency, 'PLN');
  assert.equal(uppercasePln.total_price, 119);
  assert.equal(uppercasePln.price_verified, true);
});

test('direct CSV export drops normalized business identifier keys', () => {
  const { toCsv } = require('../src/qeeq/utils');
  const csv = toCsv([{
    safe: 'ok', bid: 'BID_SECRET', businessId: 'ID_SECRET',
    businessBid: 'BUSINESS_BID_SECRET', business_bid: 'SNAKE_SECRET'
  }]);
  assert.equal(csv, '"safe"\n"ok"');
  assert.doesNotMatch(csv, /BID_SECRET|ID_SECRET|BUSINESS_BID_SECRET|SNAKE_SECRET|business/i);
});

test('root quality includes safe group diagnostics beside a valid public offer', () => {
  const { buildRootPayload } = require('../src/qeeq/run');
  const valid = {
    record_type: 'offer', provider_name: 'PUBLIC', currency: 'PLN',
    price_tier: 'public', price_verified: true, conditional_price_verified: false,
    total_price: 119
  };
  const payload = buildRootPayload({
    expected_checks: 1,
    scenarios: [{
      key: 'group-diagnostic', status: 'success', errors: [], quality_errors: [], offers: [valid],
      groups: [{ record_type: 'group', quality_errors: ['price_unverified', 'ticket=SECRET'] }]
    }]
  });

  assert.equal(payload.quality_status, 'warning');
  assert.equal(payload.quality.quality_errors.includes('price_unverified'), true);
  assert.equal(payload.quality.quality_errors.includes('execution_failed'), true);
  assert.doesNotMatch(JSON.stringify(payload.quality.quality_errors), /SECRET|ticket/i);
});

test('root quality diagnoses malformed offers without warning on a valid member total', () => {
  const { buildRootPayload } = require('../src/qeeq/run');
  const valid = {
    record_type: 'offer', provider_name: 'PUBLIC', currency: 'PLN',
    price_tier: 'public', price_verified: true, conditional_price_verified: false,
    total_price: 119
  };
  const member = {
    record_type: 'offer', provider_name: 'MEMBER PROVIDER', currency: 'PLN',
    price_tier: 'member', price_verified: false, conditional_price_verified: true,
    conditional_member_total: 98
  };
  const rootFor = offer => buildRootPayload({
    expected_checks: 1,
    scenarios: [{ key: 'offer-diagnostic', status: 'success', errors: [], quality_errors: [], groups: [], offers: [valid, offer] }]
  });

  const memberPayload = rootFor(member);
  assert.equal(memberPayload.quality_status, 'pass');
  assert.deepEqual(memberPayload.quality.quality_errors, []);

  const blankProvider = rootFor({ ...valid, provider_name: '   ' });
  assert.equal(blankProvider.quality_status, 'warning');
  assert.deepEqual(blankProvider.quality.quality_errors, ['provider_unresolved']);

  for (const total_price of [0, -1, NaN, Infinity, undefined]) {
    const malformed = rootFor({ ...valid, provider_name: 'MALFORMED', total_price });
    assert.equal(malformed.quality_status, 'warning');
    assert.deepEqual(malformed.quality.quality_errors, ['price_unverified']);
  }

  const contradictory = rootFor({
    ...member, price_verified: true, total_price: null
  });
  assert.equal(contradictory.quality_status, 'warning');
  assert.deepEqual(contradictory.quality.quality_errors, ['price_unverified']);

  const foreign = rootFor({ ...valid, provider_name: 'FOREIGN', currency: 'EUR' });
  assert.deepEqual(foreign.quality.quality_errors, ['unexpected_currency']);
});

test('merge rejects price-verified offers that fail the verified-public contract', () => {
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const baseOffer = {
    record_type: 'offer', provider_name: 'PUBLIC', currency: 'PLN',
    price_tier: 'public', price_verified: true, conditional_price_verified: false,
    total_price: 119
  };
  const payloadFor = offer => ({
    schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1,
    scenarios: [{
      key: 'merge-contract', status: 'success', groups: [], offers: [offer], errors: [], quality_errors: [], artifact_refs: []
    }],
    errors: []
  });

  for (const offer of [
    { ...baseOffer, total_price: 0 },
    { ...baseOffer, total_price: -1 },
    { ...baseOffer, total_price: null },
    { ...baseOffer, currency: 'EUR' },
    { ...baseOffer, price_tier: 'member', conditional_price_verified: true, conditional_member_total: 98 }
  ]) {
    assert.throws(
      () => mergePayloads([{ file: 'part.json', payload: payloadFor(offer) }]),
      /price_verified.*verified-public contract/
    );
  }
});

test('canonical artifact refs are bound to the deterministic scenario hash through merge', () => {
  const crypto = require('node:crypto');
  const { buildScenarioPayload } = require('../src/qeeq/run');
  const { mergePayloads } = require('../src/qeeq/mergeResults');
  const { scenarioArtifactRef } = require('../src/qeeq/utils');
  const key = 'katowice-pyrzowice:2026-08-22:2';
  const expectedHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const timestamp = '20260821T010203000Z';
  const validRef = `failure/${expectedHash}/attempt-0/${timestamp}/error.json`;
  const hostileRef = `failure/0000000000000000/attempt-0/${timestamp}/error.json`;
  assert.equal(scenarioArtifactRef(key), expectedHash);

  const scenario = buildScenarioPayload({
    scenario: { key, airport: { key: 'katowice-pyrzowice', iata: 'KTW' }, rentalDays: 2 },
    config: { artifactsDir: 'artifacts/qeeq' },
    outcome: {
      status: 'failure', errors: [{ code: 'scenario_failed' }], groups: [], offers: [], quality_errors: [],
      artifacts: [`artifacts/qeeq/${validRef}`, `artifacts/qeeq/${hostileRef}`]
    }
  });
  assert.deepEqual(scenario.artifact_refs, [validRef]);

  const merged = mergePayloads([{
    file: 'part.json',
    payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [scenario], errors: [] }
  }]);
  assert.deepEqual(merged.scenarios[0].artifact_refs, [validRef]);

  const tainted = { ...scenario, artifact_refs: [hostileRef] };
  const hostileMerged = mergePayloads([{
    file: 'hostile.json',
    payload: { schema_version: 1, provider: 'qeeq.pl', expected_scenarios: 1, expected_checks: 1, scenarios: [tainted], errors: [] }
  }]);
  assert.deepEqual(hostileMerged.scenarios[0].artifact_refs, []);
});
