const { buildScenarioMarketView } = require('./marketView');

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function classifyMmAvailability(payload = {}) {
  const options = payload && typeof payload === 'object' ? payload.options || {} : {};
  const scenarios = Array.isArray(payload?.scenarios) ? payload.scenarios : [];
  const dates = [...new Set(Array.isArray(options.start_dates) ? options.start_dates.filter(validDateOnly) : [])].sort();
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

function buildMmAvailabilityAlert(payload = {}) {
  const result = classifyMmAvailability(payload);
  const sections = [];
  if (result.confirmed_missing_dates.length > 0) {
    sections.push(`Brak MM - pelne dane\n${result.confirmed_missing_dates.map(date => `- ${date}`).join('\n')}`);
  }
  if (result.incomplete_dates.length > 0) {
    sections.push(`Nie mozna potwierdzic - niepelne dane\n${result.incomplete_dates.map(date => `- ${date}`).join('\n')}`);
  }
  return sections.join('\n');
}

module.exports = { classifyMmAvailability, buildMmAvailabilityAlert };
