const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { rankVerifiedPublicOffers, sanitizeDiagnosticText } = require('./utils');

const SHEET_NAMES = ['Overview', 'Top 3', 'By airport', 'By duration', 'Providers', 'Details', 'Data quality'];
const PLN_FORMAT = '#,##0.00 "PLN"';
const NUMBER_FORMAT = '#,##0.00';
const INTEGER_FORMAT = '#,##0';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const STATUS_COLORS = { green: 'FF70AD47', yellow: 'FFFFC000', red: 'FFC00000' };
const FORBIDDEN_DIAGNOSTIC = /(^|[?&#,;\s])(id|clid|_vv_|fpt|ticket|ts|qeeq_fpt|qeeq_city_id|qeeq_landmark_id|authorization|cookie)\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^&?#,;\s<>]+)/gi;

const DETAIL_COLUMNS = [
  'Scenario key', 'Status', 'City', 'Airport key', 'IATA', 'Pickup at', 'Drop-off at', 'Rental days',
  'Provider', 'Vehicle', 'Category', 'Transmission', 'Seats', 'Doors', 'Luggage',
  'Provider rating', 'Rating count', 'Deposit amount', 'Deposit currency', 'Public discounted total',
  'Public total', 'Public daily', 'Conditional type', 'Conditional offer total', 'Conditional offer daily',
  'Diamond/member total', 'Diamond/member daily', 'Reference price', 'Reference currency', 'Currency', 'Price tier', 'Price scope',
  'Public price verified', 'Conditional price verified', 'Parsing source', 'Captured at', 'Source'
];

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function primitiveText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function safeText(value) {
  if (typeof value !== 'string') return null;
  const redacted = sanitizeDiagnosticText(value)
    .replace(FORBIDDEN_DIAGNOSTIC, (_, separator, field) => `${separator}${field}=[redacted]`)
    .replace(/\b(?:qeeq_city_id|qeeq_landmark_id|cookie|authorization)=\[redacted\]/gi, '[redacted]');
  return /^[=+\-@]/.test(redacted) ? `'${redacted}` : redacted;
}

function safeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value).slice(1).map(Number);
  const [year, month, day, hour, minute, second] = dateParts;
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return null;
  const date = parts
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0, Number((parts[7] || '').padEnd(3, '0') || 0)))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeSource(value) {
  return value === 'https://www.qeeq.pl/car/search' ? value : null;
}

function safeScenarioKey(value) {
  const key = safeText(value);
  return key && key.length <= 200 ? key : null;
}

function scenarioObjects(payload) {
  return arrayOf(isPlainObject(payload) ? payload.scenarios : null).filter(isPlainObject);
}

function buildDetailRows(payload = {}) {
  return scenarioObjects(payload).flatMap(scenario => arrayOf(scenario.offers).filter(isPlainObject).map(offer => ({
    'Scenario key': safeScenarioKey(scenario.key),
    Status: safeText(scenario.status),
    City: safeText(scenario.requested_city),
    'Airport key': safeText(scenario.airport_key),
    IATA: safeText(scenario.iata),
    'Pickup at': safeDate(scenario.pickup_at),
    'Drop-off at': safeDate(scenario.dropoff_at),
    'Rental days': finite(scenario.rental_days ?? offer.rental_days),
    Provider: safeText(offer.provider_name),
    Vehicle: safeText(offer.vehicle_name),
    Category: safeText(offer.vehicle_category),
    Transmission: safeText(offer.transmission),
    Seats: finite(offer.seats),
    Doors: finite(offer.doors),
    Luggage: finite(offer.luggage),
    'Provider rating': finite(offer.provider_rating),
    'Rating count': finite(offer.provider_rating_count),
    'Deposit amount': finite(offer.deposit_amount),
    'Deposit currency': safeText(offer.deposit_currency),
    'Public discounted total': finite(offer.public_discounted_total),
    'Public total': finite(offer.total_price),
    'Public daily': finite(offer.daily_price),
    'Conditional type': safeText(offer.conditional_offer_type),
    'Conditional offer total': finite(offer.conditional_offer_total),
    'Conditional offer daily': finite(offer.conditional_offer_daily),
    'Diamond/member total': finite(offer.conditional_member_total),
    'Diamond/member daily': finite(offer.conditional_member_daily),
    'Reference price': finite(offer.reference_price),
    'Reference currency': safeText(offer.reference_currency),
    Currency: safeText(offer.currency),
    'Price tier': safeText(offer.price_tier),
    'Price scope': safeText(offer.price_scope),
    'Public price verified': offer.price_verified === true,
    'Conditional price verified': offer.conditional_price_verified === true,
    'Parsing source': safeText(offer.parsing_source),
    'Captured at': safeDate(offer.captured_at),
    Source: safeSource(offer.source_search_url)
  })));
}

function compareText(left, right) {
  const a = primitiveText(left);
  const b = primitiveText(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatSheet(sheet, formats = {}) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const lastColumn = Math.max(sheet.columnCount, 1);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(sheet.rowCount, 1), column: lastColumn } };
  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (let index = 1; index <= lastColumn; index += 1) {
    const column = sheet.getColumn(index);
    const values = [primitiveText(column.header), ...column.values.slice(2)
      .map(value => value instanceof Date ? 'yyyy-mm-dd hh:mm' : primitiveText(value))
      .filter(value => typeof value === 'string')];
    column.width = Math.min(32, Math.max(10, ...values.map(value => value.length + 2)));
    if (formats[column.header]) column.numFmt = formats[column.header];
    column.alignment = { vertical: 'top', wrapText: true };
  }
  sheet.properties.defaultRowHeight = 18;
  sheet.showGridLines = false;
}

function addObjectRows(sheet, columns, rows, formats = {}) {
  sheet.columns = columns.map(header => ({ header, key: header }));
  rows.forEach(row => sheet.addRow(row));
  formatSheet(sheet, formats);
}

function validPublicOffer(offer) {
  return isPlainObject(offer) && offer.price_tier === 'public' && offer.price_verified === true && Number.isFinite(offer.total_price);
}

function topRows(payload) {
  return scenarioObjects(payload).flatMap(scenario => rankVerifiedPublicOffers(arrayOf(scenario.offers).filter(isPlainObject))
    .slice(0, 3)
    .map((offer, index) => ({
      'Scenario key': safeScenarioKey(scenario.key),
      Position: index + 1,
      IATA: safeText(scenario.iata || scenario.airport_key),
      'Pickup at': safeDate(scenario.pickup_at),
      'Rental days': finite(scenario.rental_days),
      Provider: safeText(offer.provider_name),
      Vehicle: safeText(offer.vehicle_name),
      'Public total': finite(offer.total_price),
      'Public daily': finite(offer.daily_price),
      Currency: safeText(offer.currency)
    })));
}

function aggregateRows(payload, dimension, label) {
  const groups = new Map();
  for (const scenario of scenarioObjects(payload)) {
    const key = dimension(scenario);
    if (key === null || key === undefined || key === '') continue;
    const name = typeof key === 'string' ? safeText(key) : primitiveText(key);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, { scenarios: 0, offers: 0, verified: 0, totals: [] });
    const group = groups.get(name);
    group.scenarios += 1;
    const offers = arrayOf(scenario.offers).filter(isPlainObject);
    group.offers += offers.length;
    const publicOffers = offers.filter(validPublicOffer);
    group.verified += publicOffers.length;
    group.totals.push(...publicOffers.map(offer => offer.total_price));
  }
  return [...groups.entries()].sort((a, b) => compareText(a[0], b[0])).map(([key, value]) => ({
    [label]: label === 'Rental days' ? Number(key) : key,
    Scenarios: value.scenarios,
    Offers: value.offers,
    'Verified public offers': value.verified,
    'Minimum public total': value.totals.length ? Math.min(...value.totals) : null
  }));
}

function providerRows(payload) {
  const groups = new Map();
  for (const scenario of scenarioObjects(payload)) {
    for (const offer of arrayOf(scenario.offers).filter(isPlainObject)) {
      const provider = safeText(offer.provider_name);
      if (!provider) continue;
      if (!groups.has(provider)) groups.set(provider, { offers: 0, verified: 0, conditional: 0, totals: [] });
      const group = groups.get(provider);
      group.offers += 1;
      if (validPublicOffer(offer)) {
        group.verified += 1;
        group.totals.push(offer.total_price);
      }
      if (offer.conditional_price_verified === true) group.conditional += 1;
    }
  }
  return [...groups.entries()].sort((a, b) => compareText(a[0], b[0])).map(([provider, value]) => ({
    Provider: provider,
    Offers: value.offers,
    'Verified public offers': value.verified,
    'Verified conditional offers': value.conditional,
    'Minimum public total': value.totals.length ? Math.min(...value.totals) : null
  }));
}

function diagnosticRows(payload) {
  const root = isPlainObject(payload) ? payload : {};
  const diagnostics = new Map();
  const add = (severity, codeValue, scenarioValue, token) => {
    const rawCode = typeof codeValue === 'string' ? codeValue : '';
    const code = safeText(codeValue);
    if (!code) return;
    const key = safeScenarioKey(scenarioValue);
    if (!diagnostics.has(code)) diagnostics.set(code, { severity, occurrences: new Set(), scenarios: new Set(), rawCodes: new Set() });
    const entry = diagnostics.get(code);
    if (severity === 'Error') entry.severity = 'Error';
    entry.occurrences.add(key ? `${severity}:${rawCode}:${key}` : token);
    entry.rawCodes.add(rawCode);
    if (key) entry.scenarios.add(key);
  };
  for (const scenario of scenarioObjects(root)) {
    const key = safeScenarioKey(scenario.key);
    arrayOf(scenario.errors).filter(isPlainObject).forEach((error, index) => add('Error', error.code, key, `error:${key}:${safeText(error.code)}:${index}`));
    arrayOf(scenario.quality_errors).forEach((code, index) => add('Warning', code, key, `quality:${key}:${safeText(code)}:${index}`));
  }
  arrayOf(root.errors).filter(isPlainObject).forEach((error, index) => add('Error', error.code, error.scenario_key, `root-error:${safeScenarioKey(error.scenario_key)}:${safeText(error.code)}:${index}`));
  arrayOf(isPlainObject(root.quality) ? root.quality.quality_errors : null).forEach((code, index) => {
    const safeCode = safeText(code);
    const rawCode = typeof code === 'string' ? code : '';
    if (!diagnostics.get(safeCode)?.rawCodes.has(rawCode)) add('Warning', code, null, `root-quality:${safeCode}:${index}`);
  });
  return [...diagnostics.entries()].sort((a, b) => compareText(a[0], b[0])).map(([code, entry]) => ({
    Severity: entry.severity,
    Code: code,
    Count: entry.occurrences.size,
    'Affected scenario keys': [...entry.scenarios].sort(compareText).join(', ')
  }));
}

function statusFill(status, type) {
  const value = (safeText(status) || '').toLowerCase();
  const color = type === 'run'
    ? (value === 'success' ? 'green' : value === 'partial' ? 'yellow' : 'red')
    : (value === 'pass' ? 'green' : value === 'warning' ? 'yellow' : 'red');
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_COLORS[color] } };
}

async function buildWorkbook(payload = {}) {
  const root = isPlainObject(payload) ? payload : {};
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QEEQ scraper';
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = true;

  const overview = workbook.addWorksheet('Overview');
  addObjectRows(overview, ['Metric', 'Value'], [
    { Metric: 'Run status', Value: safeText(root.run_status) || 'failure' },
    { Metric: 'Quality status', Value: safeText(root.quality_status) || 'fail' },
    { Metric: 'Expected checks', Value: finite(root.expected_checks) ?? 0 },
    { Metric: 'Completed checks', Value: finite(root.completed_checks) ?? 0 },
    { Metric: 'Failed checks', Value: finite(root.failed_checks) ?? 0 },
    { Metric: 'Verified public offers', Value: finite(root.quality?.verified_public_offer_count) ?? 0 },
    { Metric: 'Unverified offers', Value: finite(root.quality?.unverified_offer_count) ?? 0 }
  ], { Value: INTEGER_FORMAT });
  overview.getCell('B2').fill = statusFill(root.run_status, 'run');
  overview.getCell('B3').fill = statusFill(root.quality_status, 'quality');
  overview.getCell('B2').font = overview.getCell('B3').font = { bold: true, color: { argb: 'FFFFFFFF' } };

  addObjectRows(workbook.addWorksheet('Top 3'), ['Scenario key', 'Position', 'IATA', 'Pickup at', 'Rental days', 'Provider', 'Vehicle', 'Public total', 'Public daily', 'Currency'], topRows(root), {
    Position: INTEGER_FORMAT, 'Pickup at': DATE_FORMAT, 'Rental days': INTEGER_FORMAT, 'Public total': PLN_FORMAT, 'Public daily': PLN_FORMAT
  });
  addObjectRows(workbook.addWorksheet('By airport'), ['Airport', 'Scenarios', 'Offers', 'Verified public offers', 'Minimum public total'], aggregateRows(root, scenario => scenario.iata || scenario.airport_key, 'Airport'), {
    Scenarios: INTEGER_FORMAT, Offers: INTEGER_FORMAT, 'Verified public offers': INTEGER_FORMAT, 'Minimum public total': PLN_FORMAT
  });
  addObjectRows(workbook.addWorksheet('By duration'), ['Rental days', 'Scenarios', 'Offers', 'Verified public offers', 'Minimum public total'], aggregateRows(root, scenario => scenario.rental_days, 'Rental days'), {
    'Rental days': INTEGER_FORMAT, Scenarios: INTEGER_FORMAT, Offers: INTEGER_FORMAT, 'Verified public offers': INTEGER_FORMAT, 'Minimum public total': PLN_FORMAT
  });
  addObjectRows(workbook.addWorksheet('Providers'), ['Provider', 'Offers', 'Verified public offers', 'Verified conditional offers', 'Minimum public total'], providerRows(root), {
    Offers: INTEGER_FORMAT, 'Verified public offers': INTEGER_FORMAT, 'Verified conditional offers': INTEGER_FORMAT, 'Minimum public total': PLN_FORMAT
  });
  addObjectRows(workbook.addWorksheet('Details'), DETAIL_COLUMNS, buildDetailRows(root), {
    'Pickup at': DATE_FORMAT, 'Drop-off at': DATE_FORMAT, 'Captured at': DATE_FORMAT, 'Rental days': INTEGER_FORMAT,
    Seats: INTEGER_FORMAT, Doors: INTEGER_FORMAT, Luggage: INTEGER_FORMAT, 'Provider rating': NUMBER_FORMAT,
    'Rating count': INTEGER_FORMAT, 'Deposit amount': NUMBER_FORMAT, 'Public discounted total': PLN_FORMAT,
    'Public total': PLN_FORMAT, 'Public daily': PLN_FORMAT, 'Conditional offer total': PLN_FORMAT,
    'Conditional offer daily': PLN_FORMAT, 'Diamond/member total': PLN_FORMAT, 'Diamond/member daily': PLN_FORMAT,
    'Reference price': NUMBER_FORMAT
  });
  const quality = workbook.addWorksheet('Data quality');
  const qualityRows = diagnosticRows(root);
  addObjectRows(quality, ['Severity', 'Code', 'Count', 'Affected scenario keys'], qualityRows, { Count: INTEGER_FORMAT });
  qualityRows.forEach((row, index) => {
    quality.getRow(index + 2).getCell(1).fill = statusFill(row.Severity === 'Error' ? 'fail' : 'warning', 'quality');
    quality.getRow(index + 2).getCell(1).font = { bold: true, color: { argb: row.Severity === 'Error' ? 'FFFFFFFF' : 'FF000000' } };
  });

  if (workbook.worksheets.map(sheet => sheet.name).join('|') !== SHEET_NAMES.join('|')) throw new Error('Unexpected XLSX sheet layout');
  return workbook;
}

function pathIdentity(filePath) {
  let cursor = path.resolve(filePath);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonical = path.join(fs.realpathSync.native(cursor), ...suffix);
  return process.platform === 'win32' ? canonical.toLocaleLowerCase('en-US') : canonical;
}

async function generateWorkbookFromFile(inputPath, outputPath) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  if (pathIdentity(input) === pathIdentity(output)) throw new Error('Input and output paths must differ');
  const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
  const workbook = await buildWorkbook(payload);
  const directory = path.dirname(output);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(output)}.${crypto.randomUUID()}.tmp`);
  try {
    await workbook.xlsx.writeFile(temporary);
    fs.renameSync(temporary, output);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the write/rename failure; cleanup was best-effort.
    }
    throw error;
  }
  return output;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node src/qeeq/reportXlsx.js <input.json> <output.xlsx>');
    return 0;
  }
  if (argv.length !== 2 || argv.some(value => typeof value !== 'string' || !value)) throw new Error('Expected input and output paths');
  await generateWorkbookFromFile(argv[0], argv[1]);
  return 0;
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(() => {
    console.error('QEEQ XLSX report failed.');
    process.exitCode = 1;
  });
}

module.exports = { buildDetailRows, buildWorkbook, generateWorkbookFromFile };
