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
