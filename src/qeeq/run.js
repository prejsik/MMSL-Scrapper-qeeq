const { catalogEntryForLocation } = require('./locations');

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function scenarioKey(scenario) {
  return `${scenario.airport.key}:${scenario.pickupDate}:${scenario.rentalDays}`;
}

function assertScenarioLimit(count, maxScenarios) {
  if (count > maxScenarios) throw new Error(`Scenario count ${count} exceeds maxScenarios ${maxScenarios}`);
}

function pickupDates(config, now) {
  if (config.startDates.length) return config.startDates;
  const tomorrow = addDays(dateInTimeZone(now, config.timeZone), 1);
  return Array.from({ length: config.rollingDays }, (_, index) => addDays(tomorrow, index));
}

function expandScenarios(config, now = new Date()) {
  const dates = pickupDates(config, now);
  const airports = config.locations.flatMap(location => {
    const entry = catalogEntryForLocation(location);
    if (!entry) throw new Error(`Unknown QEEQ location: ${location}`);
    return entry.airports.map(airport => ({ ...airport, city: entry.city }));
  });
  const count = airports.length * dates.length * config.durationsDays.length;
  assertScenarioLimit(count, config.maxScenarios);

  return airports.flatMap(airport => dates.flatMap(pickupDate => config.durationsDays.map(rentalDays => {
    const scenario = {
      airport,
      pickupDate,
      dropoffDate: addDays(pickupDate, rentalDays),
      pickupTime: config.pickupTime,
      dropoffTime: config.dropoffTime,
      rentalDays
    };
    return { ...scenario, key: scenarioKey(scenario) };
  })));
}

module.exports = { assertScenarioLimit, expandScenarios, scenarioKey };
