const fs = require('node:fs');

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const HAS_CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const HAS_BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const FORBIDDEN_VALUE = /\b(?:id|bid|clid|_vv_|fpt|ticket|ts|qeeq_fpt|qeeq_city_id|qeeq_landmark_id)\b\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s&#,;<>]+)/gi;
const FORBIDDEN_HEADER = /\b(?:cookie|authorization)\s*(?:=|:)\s*[^\r\n]*/gi;
const BEARER_VALUE = /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi;
const FORBIDDEN_QUERY_KEYS = new Set([
  'id', 'bid', 'clid', '_vv_', 'fpt', 'ticket', 'ts', 'qeeq_fpt',
  'qeeq_city_id', 'qeeq_landmark_id', 'session', 'session_id', 'token', 'auth', 'cookie'
]);

function objectOrEmpty(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function read(value, key) {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function arrayOf(value) {
  try {
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function status(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
}

function neutralizeText(value, maximum) {
  let text = typeof value === 'string' ? value : '';
  text = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted-url]')
    .replace(FORBIDDEN_HEADER, '[redacted]')
    .replace(BEARER_VALUE, '[redacted]')
    .replace(FORBIDDEN_VALUE, '[redacted]')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(/::/g, ': :')
    .replace(/\$\{\{/g, '$ { {')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, maximum).join('');
}

function safeErrorMessage(error) {
  if (typeof error === 'string') return neutralizeText(error, 300) || 'unknown planning error';
  try {
    return neutralizeText(error?.message, 300) || 'unknown planning error';
  } catch {
    return 'unknown planning error';
  }
}

function safeCodes(values) {
  try {
    const codes = arrayOf(values)
      .map(value => typeof value === 'string' ? value : '')
      .filter(value => /^[a-z][a-z0-9_-]{0,63}$/i.test(value))
      .filter(value => !FORBIDDEN_QUERY_KEYS.has(value.toLocaleLowerCase('en-US')));
    return [...new Set(codes)].sort().slice(0, 5);
  } catch {
    return [];
  }
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || HAS_CONTROL_CHARACTER.test(value) || HAS_BIDI_CONTROL.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
    for (const key of url.searchParams.keys()) {
      if (FORBIDDEN_QUERY_KEYS.has(key.toLocaleLowerCase('en-US'))) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function linkLines(options) {
  const safe = objectOrEmpty(options);
  const reportUrl = safeHttpsUrl(read(safe, 'reportUrl'));
  const artifactUrl = safeHttpsUrl(read(safe, 'artifactUrl'));
  const runUrl = safeHttpsUrl(read(safe, 'runUrl'));
  const primary = reportUrl
    ? { label: 'Raport', url: reportUrl }
    : artifactUrl ? { label: 'Artefakt', url: artifactUrl }
      : runUrl ? { label: 'Run GitHub Actions', url: runUrl } : null;
  const lines = primary ? [`${primary.label}: ${primary.url}`] : [];
  if (runUrl && runUrl !== primary?.url) lines.push(`Run GitHub Actions: ${runUrl}`);
  return lines;
}

function buildFinalSummary(payload, options) {
  const root = objectOrEmpty(payload);
  const quality = objectOrEmpty(read(root, 'quality'));
  const errors = arrayOf(read(root, 'errors'));
  let failureCodes = [];
  try {
    failureCodes = safeCodes(errors.map(error => read(objectOrEmpty(error), 'code')));
  } catch {}
  const qualityCodes = safeCodes(read(quality, 'quality_errors'));
  const lines = [
    'QEEQ scrape summary',
    `Run: ${status(read(root, 'run_status'), ['success', 'partial', 'failure'])}`,
    `Jakość: ${status(read(root, 'quality_status'), ['pass', 'warning', 'fail'])}`,
    `Kontrole: ${nonNegativeInteger(read(root, 'completed_checks'))}/${nonNegativeInteger(read(root, 'expected_checks'))} (nieudane: ${nonNegativeInteger(read(root, 'failed_checks'))})`,
    `Ceny — zweryfikowane: ${nonNegativeInteger(read(quality, 'verified_public_offer_count'))}, niezweryfikowane: ${nonNegativeInteger(read(quality, 'unverified_offer_count'))}`
  ];
  if (failureCodes.length) lines.push(`Błędy: ${failureCodes.join(', ')}`);
  if (qualityCodes.length) lines.push(`Jakość — kody: ${qualityCodes.join(', ')}`);
  return [...lines, ...linkLines(options)].join('\n');
}

function buildPlanFailureSummary(error, options) {
  return [
    'QEEQ plan failure',
    `Błąd: ${safeErrorMessage(error)}`,
    ...linkLines(options)
  ].join('\n');
}

function parseSummaryArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('Arguments must be an array');
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.includes('--help')) throw new Error('--help cannot be combined with other options');

  const names = {
    mode: 'mode', input: 'input', error: 'error',
    'report-url': 'reportUrl', 'artifact-url': 'artifactUrl', 'run-url': 'runUrl'
  };
  const parsed = {};
  const seen = new Set();
  for (const argument of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match || !Object.hasOwn(names, match[1])) throw new Error(`Unknown option: ${argument}`);
    if (seen.has(match[1])) throw new Error(`Duplicate option: --${match[1]}`);
    if (!match[2]) throw new Error(`Missing value for option: --${match[1]}`);
    seen.add(match[1]);
    parsed[names[match[1]]] = match[2];
  }

  if (!['final-summary', 'plan-failure'].includes(parsed.mode)) throw new Error('Missing or invalid --mode');
  if (parsed.mode === 'final-summary') {
    if (!parsed.input) throw new Error('Missing required option: --input');
    if (parsed.error !== undefined) throw new Error('--error is only valid in plan-failure mode');
  } else {
    if (!parsed.error) throw new Error('Missing required option: --error');
    if (parsed.input !== undefined) throw new Error('--input is only valid in final-summary mode');
  }
  return parsed;
}

function usage() {
  return 'Usage: node src/qeeq/telegramSummary.js --mode=final-summary --input=<canonical.json> [--report-url=<https-url>] [--artifact-url=<https-url>] [--run-url=<https-url>] | --mode=plan-failure --error=<message> [--run-url=<https-url>]';
}

function main(argv = process.argv.slice(2)) {
  const args = parseSummaryArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const options = { reportUrl: args.reportUrl, artifactUrl: args.artifactUrl, runUrl: args.runUrl };
  const message = args.mode === 'final-summary'
    ? buildFinalSummary(JSON.parse(fs.readFileSync(args.input, 'utf8')), options)
    : buildPlanFailureSummary(args.error, options);
  process.stdout.write(`${message}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    process.stderr.write('QEEQ Telegram summary failed.\n');
    process.exitCode = 1;
  }
}

module.exports = { buildFinalSummary, buildPlanFailureSummary, parseSummaryArgs };
