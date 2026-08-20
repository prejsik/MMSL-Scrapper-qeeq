const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, parseCliArgs, printHelp } = require('./config');
const { executeRun, exitCodeForPayload } = require('./run');
const { printResultsTable, printSummary, writeAuxiliaryReports, writeCsvReport } = require('./report');

function fileDescriptor(filePath, outputDir) {
  const bytes = fs.statSync(filePath).size;
  return {
    path: path.relative(outputDir, filePath).replace(/\\/g, '/'),
    bytes,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    printHelp();
    return 0;
  }
  const config = loadConfig(argv);
  const args = parseCliArgs(argv);
  const outputCsv = path.resolve(config.outputCsv);
  const outputDir = path.dirname(outputCsv);
  const savePath = path.resolve(args.save || path.join(outputDir, 'qeeq-results-latest.json'));
  const payload = await executeRun({ ...config, savePath });
  writeCsvReport(outputCsv, payload);
  writeAuxiliaryReports(outputDir, payload, [fileDescriptor(savePath, outputDir), fileDescriptor(outputCsv, outputDir)]);
  printResultsTable(payload);
  printSummary(payload);
  process.exitCode = exitCodeForPayload(payload);
  return process.exitCode;
}

if (require.main === module) {
  main().catch(() => {
    console.error('QEEQ run failed.');
    process.exitCode = 1;
  });
}

module.exports = { main };
