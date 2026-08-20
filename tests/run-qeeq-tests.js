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
