const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureDir, sanitizeSourceUrl } = require('./utils');

const CSV_HEADERS = [
  'scenario_key','scenario_status','requested_city','airport_key','iata','qeeq_city_id','qeeq_landmark_id',
  'pickup_at','dropoff_at','rental_days','driver_age','residence','vehicle_name','vehicle_category',
  'transmission','seats','doors','luggage','provider_name','provider_rating','provider_rating_count',
  'deposit_amount','deposit_currency','public_discounted_total','total_price','daily_price',
  'conditional_offer_total','conditional_offer_daily','conditional_offer_type',
  'conditional_member_total','conditional_member_daily','reference_price','currency','price_label',
  'price_tier','price_scope','price_verified','conditional_price_verified',
  'parsing_source','source_search_url','captured_at'
];
const AUX_MANIFEST_FILES = ['qeeq-results-latest.json', 'qeeq-results.csv', 'qeeq-report.html', 'qeeq-summary.xlsx'];

function csvValue(value) {
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  const text = String(safe ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function offerRows(payload = {}) {
  return (payload.scenarios || []).flatMap(scenario => (scenario.offers || [])
    .filter(offer => offer?.record_type !== 'group' && offer?.provider_name)
    .map(offer => ({
      scenario_key: scenario.key ?? null,
      scenario_status: scenario.status ?? null,
      requested_city: scenario.requested_city ?? null,
      airport_key: scenario.airport_key ?? null,
      iata: scenario.iata ?? null,
      qeeq_city_id: scenario.qeeq_city_id ?? null,
      qeeq_landmark_id: scenario.qeeq_landmark_id ?? null,
      pickup_at: scenario.pickup_at ?? null,
      dropoff_at: scenario.dropoff_at ?? null,
      rental_days: scenario.rental_days ?? offer.rental_days ?? null,
      driver_age: scenario.driver_age ?? null,
      residence: scenario.residence ?? null,
      ...offer,
      source_search_url: sanitizeSourceUrl(offer.source_search_url ?? scenario.source_search_url)
    })));
}

function buildCsv(payload = {}) {
  const rows = offerRows(payload);
  return [CSV_HEADERS.join(','), ...rows.map(row => CSV_HEADERS.map(header => csvValue(row[header])).join(','))].join('\n');
}

function writeCsvReport(outputPath, payload) {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, `${buildCsv(payload)}\n`, 'utf8');
}

function errorCodes(payload = {}) {
  const codes = [...(payload.errors || []).map(error => error?.code), ...(payload.quality?.quality_errors || [])]
    .filter(code => typeof code === 'string' && /^[a-z0-9_:-]+$/i.test(code));
  return Object.fromEntries([...new Set(codes)].sort().map(code => [code, codes.filter(item => item === code).length]));
}

function buildQualitySummary(payload = {}) {
  return {
    schema_version: 1,
    provider: 'qeeq.pl',
    run_status: payload.run_status ?? 'failure',
    quality_status: payload.quality_status ?? 'fail',
    expected_checks: payload.expected_checks ?? 0,
    completed_checks: payload.completed_checks ?? 0,
    failed_checks: payload.failed_checks ?? 0,
    verified_public_offer_count: payload.quality?.verified_public_offer_count ?? 0,
    unverified_offer_count: payload.quality?.unverified_offer_count ?? 0,
    error_codes: errorCodes(payload)
  };
}

function buildRunManifest(payload = {}, generatedFiles = []) {
  return {
    schema_version: 1,
    provider: 'qeeq.pl',
    run_status: payload.run_status ?? 'failure',
    quality_status: payload.quality_status ?? 'fail',
    completed_at: payload.completed_at ?? null,
    files: generatedFiles.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
  };
}

function descriptor(filePath, outputDir) {
  const bytes = fs.statSync(filePath).size;
  return {
    path: path.relative(outputDir, filePath).replace(/\\/g, '/'),
    bytes,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  };
}

function writeAtomicJson(outputPath, value) {
  const directory = path.dirname(outputPath);
  ensureDir(directory);
  const tempPath = path.join(directory, `.${path.basename(outputPath)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function writeAuxiliaryReports(outputDir, payload, generatedFiles) {
  const qualityPath = path.join(outputDir, 'quality-summary.json');
  const manifestPath = path.join(outputDir, 'run-manifest.json');
  writeAtomicJson(qualityPath, buildQualitySummary(payload));
  writeAtomicJson(manifestPath, buildRunManifest(payload, generatedFiles));
  return { qualityPath, manifestPath };
}

function printResultsTable(payload) {
  console.table(offerRows(payload).map(row => ({
    scenario_key: row.scenario_key,
    provider_name: row.provider_name,
    vehicle_name: row.vehicle_name,
    total_price: row.total_price,
    currency: row.currency,
    price_verified: row.price_verified
  })));
}

function printSummary(payload) {
  console.log(JSON.stringify(buildQualitySummary(payload)));
}

function parseAuxArgs(argv) {
  const args = {};
  for (const argument of argv) {
    if (argument === '--help') {
      args.help = true;
      continue;
    }
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match) throw new Error(`Unknown option: ${argument}`);
    args[match[1]] = match[2];
  }
  for (const key of Object.keys(args)) {
    if (!['input', 'output-quality', 'output-manifest', 'manifest-files', 'help'].includes(key)) throw new Error(`Unknown option: --${key}`);
  }
  return args;
}

function printAuxHelp() {
  console.log('Usage: node src/qeeq/report.js --input=output/qeeq-results-latest.json --output-quality=output/quality-summary.json --output-manifest=output/run-manifest.json --manifest-files=output/qeeq-results-latest.json,output/qeeq-results.csv,output/qeeq-report.html,output/qeeq-summary.xlsx');
}

function main(argv = process.argv.slice(2)) {
  const args = parseAuxArgs(argv);
  if (args.help !== undefined) {
    printAuxHelp();
    return 0;
  }
  for (const key of ['input', 'output-quality', 'output-manifest', 'manifest-files']) {
    if (!args[key]) throw new Error(`Missing required option: --${key}`);
  }
  const inputPath = path.resolve(args.input);
  const qualityPath = path.resolve(args['output-quality']);
  const manifestPath = path.resolve(args['output-manifest']);
  const outputDir = path.dirname(manifestPath);
  const files = args['manifest-files'].split(',').map(item => path.resolve(item));
  const fileNames = files.map(file => path.basename(file));
  if (files.length !== AUX_MANIFEST_FILES.length || new Set(fileNames).size !== files.length
    || fileNames.some(name => !AUX_MANIFEST_FILES.includes(name))) {
    throw new Error('manifest-files must contain the exact QEEQ JSON, CSV, HTML, and XLSX files');
  }
  if (path.dirname(qualityPath) !== outputDir || files.some(file => path.dirname(file) !== outputDir)) {
    throw new Error('All manifest inputs and outputs must use the common output directory');
  }
  const jsonMember = files.find(file => path.basename(file) === 'qeeq-results-latest.json');
  if (inputPath !== jsonMember) throw new Error('input must exactly match the JSON manifest member');
  if (qualityPath === manifestPath || files.includes(qualityPath) || files.includes(manifestPath)) {
    throw new Error('Auxiliary report outputs cannot collide with manifest inputs or each other');
  }
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Missing manifest input: ${file}`);
  }
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const descriptors = files.map(file => descriptor(file, outputDir));
  writeAtomicJson(qualityPath, buildQualitySummary(payload));
  writeAtomicJson(manifestPath, buildRunManifest(payload, descriptors));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ auxiliary report failed.');
    process.exitCode = 1;
  }
}

module.exports = {
  AUX_MANIFEST_FILES,
  CSV_HEADERS,
  buildCsv,
  buildQualitySummary,
  buildRunManifest,
  main,
  printResultsTable,
  printSummary,
  writeAtomicJson,
  writeAuxiliaryReports,
  writeCsvReport
};
