const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function formatUtcDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDateCell(value) {
  if (value instanceof Date) return formatUtcDate(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatUtcDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (validIsoDate(trimmed)) return trimmed;
    const match = /^(\d{4}-\d{2}-\d{2})T/.exec(trimmed);
    if (match && validIsoDate(match[1]) && !Number.isNaN(Date.parse(trimmed))) return match[1];
  }
  return null;
}

function validateConfig(config) {
  const integerFields = ['headerRow', 'dataStartRow', 'durationMinRow', 'durationMaxRow'];
  if (!config || typeof config !== 'object' || Array.isArray(config)
      || typeof config.worksheet !== 'string' || !config.worksheet.trim()
      || integerFields.some(key => !Number.isInteger(config[key]) || config[key] <= 0)
      || !config.columns || typeof config.columns !== 'object' || Array.isArray(config.columns)
      || ['group', 'zone', 'pickupStartDate', 'rateStart'].some(key => !Number.isInteger(config.columns[key]) || config.columns[key] <= 0)
      || !Array.isArray(config.excludedGroups) || config.excludedGroups.some(value => typeof value !== 'string' || !value.trim())
      || !config.groupRateAdjustmentsPlnDay || typeof config.groupRateAdjustmentsPlnDay !== 'object'
      || Array.isArray(config.groupRateAdjustmentsPlnDay)
      || Object.entries(config.groupRateAdjustmentsPlnDay).some(([group, value]) => !group.trim() || !Number.isFinite(value))
      || !Number.isFinite(config.minExcelChangePlnDay) || config.minExcelChangePlnDay < 0) {
    throw new Error('Invalid QEEQ Excel rate update config');
  }
  return config;
}

function durationBands(sheet, config) {
  const bands = [];
  for (let column = config.columns.rateStart; column <= sheet.columnCount; column += 1) {
    const minimum = sheet.getRow(config.durationMinRow).getCell(column).value;
    const maximum = sheet.getRow(config.durationMaxRow).getCell(column).value;
    if (minimum == null && maximum == null) continue;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)
        || !Number.isInteger(minimum) || !Number.isInteger(maximum)
        || minimum <= 0 || maximum < minimum) {
      throw new Error(`Invalid duration header in column ${column}`);
    }
    bands.push({ column, minimum, maximum });
  }
  if (bands.length === 0) throw new Error('Worksheet duration headers are missing');
  return bands;
}

function durationColumn(sheet, duration, config) {
  if (!Number.isInteger(duration) || duration <= 0) return null;
  const matches = durationBands(sheet, validateConfig(config))
    .filter(band => duration >= band.minimum && duration <= band.maximum);
  if (matches.length > 1) throw new Error(`Duration ${duration} matches multiple worksheet columns`);
  return matches[0]?.column ?? null;
}

function validateRecommendationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.schema_version !== 1 || payload.provider !== 'qeeq.pl'
      || !Array.isArray(payload.decisions) || !Array.isArray(payload.import_recommendations)) {
    throw new Error('Invalid QEEQ pricing recommendations payload');
  }
  for (const decision of payload.decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)
        || !Array.isArray(decision.tariff_zones)
        || !['increase', 'decrease', 'hold', 'review'].includes(decision.import_action)) {
      throw new Error('Invalid QEEQ pricing decision');
    }
  }
  const keys = new Set();
  for (const recommendation of payload.import_recommendations) {
    if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)
        || !['increase', 'decrease'].includes(recommendation.import_action)
        || recommendation.calibration_status !== 'approved'
        || recommendation.data_quality_status !== 'complete'
        || !Number.isFinite(recommendation.suggested_rate_pln_day)
        || recommendation.suggested_rate_pln_day <= 0
        || !validIsoDate(recommendation.pickup_date)
        || !Number.isInteger(recommendation.rental_days) || recommendation.rental_days <= 0
        || !Array.isArray(recommendation.tariff_zones) || recommendation.tariff_zones.length === 0
        || recommendation.tariff_zones.some(zone => typeof zone !== 'string' || !/^[A-Z0-9_-]{1,32}$/.test(zone))) {
      throw new Error('Active import recommendations require an approved finite positive rate and mapped inputs');
    }
    const uniqueZones = [...new Set(recommendation.tariff_zones.map(zone => zone.trim()))];
    if (uniqueZones.length !== recommendation.tariff_zones.length) throw new Error('Duplicate recommendation key');
    for (const zone of uniqueZones) {
      const key = `${zone}|${recommendation.pickup_date}|${recommendation.rental_days}`;
      if (keys.has(key)) throw new Error(`Duplicate recommendation key: ${key}`);
      keys.add(key);
    }
  }
  return payload;
}

function workbookSheet(workbook, config) {
  const sheet = workbook.getWorksheet(config.worksheet);
  if (!sheet) throw new Error(`Worksheet not found: ${config.worksheet}`);
  const requiredHeaders = [config.columns.group, config.columns.zone, config.columns.pickupStartDate, config.columns.rateStart];
  if (requiredHeaders.some(column => sheet.getRow(config.headerRow).getCell(column).value == null)) {
    throw new Error('Worksheet headers are missing');
  }
  durationBands(sheet, config);
  return sheet;
}

function summaryFromPayload(payload) {
  return {
    applied_count: 0,
    held_count: payload.decisions.filter(item => item.import_action === 'hold').length,
    review_count: payload.decisions.filter(item => item.import_action === 'review').length,
    skipped_count: 0,
    unmapped_count: payload.decisions.filter(item => item.tariff_zones.length === 0).length,
    unmatched_count: 0,
    unmatched_targets: [],
    changed_cells: []
  };
}

function invalidateFormulaCaches(sheet) {
  sheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      if (!cell.formula) return;
      const { result, ...formulaValue } = cell.value;
      cell.value = formulaValue;
    });
  });
}

function applyRecommendationsToWorkbook(workbook, payload, suppliedConfig) {
  const config = validateConfig(suppliedConfig);
  validateRecommendationPayload(payload);
  const sheet = workbookSheet(workbook, config);
  const excluded = new Set(config.excludedGroups.map(value => value.trim()));
  const operations = [];
  const summary = summaryFromPayload(payload);
  const recordUnmatched = (recommendation, zone) => {
    summary.unmatched_targets.push({
      tariff_zone: zone,
      pickup_date: recommendation.pickup_date,
      rental_days: recommendation.rental_days
    });
  };

  for (const recommendation of payload.import_recommendations) {
    const column = durationColumn(sheet, recommendation.rental_days, config);
    if (column === null) {
      recommendation.tariff_zones.forEach(zone => recordUnmatched(recommendation, zone));
      continue;
    }
    for (const targetZone of recommendation.tariff_zones) {
      let matchingRows = 0;
      for (let rowNumber = config.dataStartRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const zone = String(row.getCell(config.columns.zone).value || '').trim();
        const date = normalizeDateCell(row.getCell(config.columns.pickupStartDate).value);
        if (zone !== targetZone || date !== recommendation.pickup_date) continue;
        matchingRows += 1;
        const group = String(row.getCell(config.columns.group).value || '').trim();
        if (excluded.has(group)) {
          summary.skipped_count += 1;
          continue;
        }
        const adjustment = config.groupRateAdjustmentsPlnDay[group] ?? 0;
        const newRate = recommendation.suggested_rate_pln_day + adjustment;
        const cell = row.getCell(column);
        if (!Number.isFinite(newRate) || newRate <= 0 || !Number.isFinite(cell.value)) {
          throw new Error(`Invalid rate cell or adjusted recommendation at ${cell.address}`);
        }
        if (Math.abs(newRate - cell.value) < config.minExcelChangePlnDay) {
          summary.skipped_count += 1;
          continue;
        }
        operations.push({ cell, oldRate: cell.value, newRate });
      }
      if (matchingRows === 0) recordUnmatched(recommendation, targetZone);
    }
  }

  summary.unmatched_targets.sort((left, right) => left.pickup_date.localeCompare(right.pickup_date)
    || left.rental_days - right.rental_days
    || left.tariff_zone.localeCompare(right.tariff_zone));
  summary.unmatched_count = summary.unmatched_targets.length;

  for (const operation of operations) {
    operation.cell.value = operation.newRate;
    summary.changed_cells.push({
      cell: operation.cell.address,
      old_rate_pln_day: operation.oldRate,
      new_rate_pln_day: operation.newRate
    });
  }
  summary.applied_count = operations.length;
  if (operations.length > 0) {
    invalidateFormulaCaches(sheet);
    workbook.calcProperties.fullCalcOnLoad = true;
  }
  for (const other of workbook.worksheets.filter(item => item.name !== config.worksheet)) {
    workbook.removeWorksheet(other.id);
  }
  return summary;
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

function requireRegularFile(filePath, label) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be an existing regular file`);
  return absolute;
}

function assertDistinctPaths(paths) {
  const identities = paths.map(pathIdentity);
  if (new Set(identities).size !== identities.length) throw new Error('Workbook, JSON, and summary paths must be distinct');
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error });
  }
}

function tempPath(target, extension) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp${extension}`);
}

async function writeWorkbookAtomic(workbook, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = tempPath(target, '.xlsx');
  try {
    await workbook.xlsx.writeFile(temporary);
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeJsonAtomic(value, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = tempPath(target, '.json');
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function generateImportWorkbook({ workbookPath, recommendationsPath, configPath, outputPath, summaryPath }) {
  const workbookInput = requireRegularFile(workbookPath, 'Baseline workbook');
  const recommendationsInput = requireRegularFile(recommendationsPath, 'Recommendations');
  const configInput = requireRegularFile(configPath, 'Excel updater config');
  const output = path.resolve(outputPath);
  const summaryOutput = path.resolve(summaryPath);
  assertDistinctPaths([workbookInput, recommendationsInput, configInput, output, summaryOutput]);
  const payload = validateRecommendationPayload(readJson(recommendationsInput, 'Recommendations'));
  const config = validateConfig(readJson(configInput, 'Excel updater config'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookInput);
  const summary = applyRecommendationsToWorkbook(workbook, payload, config);
  await writeWorkbookAtomic(workbook, output);
  writeJsonAtomic(summary, summaryOutput);
  return summary;
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const result = {};
  const allowed = new Set(['workbook', 'recommendations', 'config', 'output', 'summary']);
  for (const argument of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown option: ${argument}`);
    if (Object.hasOwn(result, match[1])) throw new Error(`Duplicate option: --${match[1]}`);
    result[match[1]] = match[2];
  }
  if ([...allowed].some(key => !result[key])) throw new Error('Expected workbook, recommendations, config, output, and summary options');
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node src/qeeq/updateExcelRates.js --workbook=<baseline.xlsx> --recommendations=<recommendations.json> --config=<layout.json> --output=<import.xlsx> --summary=<summary.json>');
    return 0;
  }
  await generateImportWorkbook({
    workbookPath: args.workbook,
    recommendationsPath: args.recommendations,
    configPath: args.config,
    outputPath: args.output,
    summaryPath: args.summary
  });
  return 0;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('QEEQ Excel rate update failed.');
    process.exitCode = 1;
  });
}

module.exports = {
  applyRecommendationsToWorkbook,
  durationColumn,
  generateImportWorkbook,
  main,
  normalizeDateCell
};
