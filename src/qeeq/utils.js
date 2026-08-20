const fs = require('node:fs');
const path = require('node:path');

const MONEY_MARKER = /(?:\b(?:PLN|EUR|USD|GBP)\b|zł|€|\$|£)/i;
const MONEY_AMOUNT = '(?:\\d{1,3}(?:[ .\\u00a0]\\d{3})+|\\d+)(?:[,.]\\d+)?';
const MONEY_CURRENCY = '(?:\\b(?:PLN|EUR|USD|GBP)\\b|zł|€|\\$|£)';
const INVALID_MONEY_LABELS = ['ocena', 'rating', 'depozyt', 'deposit'];
const CONDITIONAL_LABEL = /diament|diamond|member|członk|log\s*in|sign\s*in|zaloguj/i;
const REDACTED_FIELD = /\b(id|clid|_vv_|fpt|ticket|ts|qeeq_fpt)\b\s*=\s*(?:"[^"]*"|'[^']*'|[^\s&#,;"']+)/gi;
const REDACTED_HEADER = /\b(cookie|authorization)\s*(?::|=)\s*[^\r\n]*/gi;
const REDACTED_BEARER = /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi;
const FORBIDDEN_CSV_KEYS = new Set(['id', 'clid', '_vv_', 'fpt', 'ticket', 'ts', 'qeeq_fpt']);

function parseAmount(value) {
  const normalized = value.replace(/[ .\u00a0]/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseMoney(raw, fallbackCurrency, options = {}) {
  if (typeof raw !== 'string' || !raw.trim() || /\d\s*%/.test(raw)) return null;

  const rejectLabels = [...INVALID_MONEY_LABELS, ...(options.rejectLabels || [])];
  if (rejectLabels.some(label => raw.toLocaleLowerCase('pl-PL').includes(String(label).toLocaleLowerCase('pl-PL')))) {
    return null;
  }
  const amountBeforeCurrency = new RegExp(`(${MONEY_AMOUNT})\\s*${MONEY_CURRENCY}`, 'i').exec(raw);
  const currencyBeforeAmount = new RegExp(`${MONEY_CURRENCY}\\s*(${MONEY_AMOUNT})`, 'i').exec(raw);
  const currencyMatch = amountBeforeCurrency || currencyBeforeAmount;
  if (currencyMatch) return parseAmount(currencyMatch[1]);
  if (!fallbackCurrency || MONEY_MARKER.test(raw)) return null;

  const candidates = [...raw.matchAll(new RegExp(MONEY_AMOUNT, 'g'))];
  const amountCandidate = candidates.find(candidate => !/^\s*(?:dni|dzień|dnia)\b/i.test(raw.slice(candidate.index + candidate[0].length)));
  return amountCandidate ? parseAmount(amountCandidate[0]) : null;
}

function hasVerifiedTotalPeriod(rentalPeriodText, rentalDays) {
  if (!Number.isInteger(rentalDays) || rentalDays <= 0 || typeof rentalPeriodText !== 'string') return false;
  const normalized = rentalPeriodText.toLocaleLowerCase('pl-PL');
  return normalized.includes('łącznie')
    && new RegExp(`\\b${rentalDays}\\s*(?:dni|dzień|dnia)\\b`, 'i').test(normalized);
}

function normalizePriceCandidate(input) {
  const rentalDays = input?.rentalDays;
  const verifiedTotal = hasVerifiedTotalPeriod(input?.rentalPeriodText, rentalDays);
  const displayedAmount = parseMoney(input?.displayedText, input?.fallbackCurrency);
  const memberAmount = parseMoney(input?.memberText, input?.fallbackCurrency);
  const isConditional = Boolean(input?.discountType)
    || Object.values(input || {}).some(value => typeof value === 'string' && CONDITIONAL_LABEL.test(value))
    || memberAmount !== null;
  const conditionalOffer = isConditional ? displayedAmount : null;
  const conditionalMember = memberAmount;
  const conditionalVerified = verifiedTotal && (conditionalOffer !== null || conditionalMember !== null);
  const publicVerified = verifiedTotal && !isConditional && displayedAmount !== null;

  return {
    total_price: publicVerified ? displayedAmount : null,
    daily_price: publicVerified ? displayedAmount / rentalDays : null,
    conditional_offer_total: conditionalVerified ? conditionalOffer : null,
    conditional_offer_daily: conditionalVerified && conditionalOffer !== null ? conditionalOffer / rentalDays : null,
    conditional_offer_type: input?.discountType || null,
    conditional_member_total: conditionalVerified ? conditionalMember : null,
    conditional_member_daily: conditionalVerified && conditionalMember !== null ? conditionalMember / rentalDays : null,
    price_tier: publicVerified ? 'public' : (isConditional ? 'conditional' : 'unknown'),
    price_scope: verifiedTotal ? 'total' : 'unknown',
    price_verified: publicVerified,
    conditional_price_verified: conditionalVerified
  };
}

function rankVerifiedPublicOffers(offers) {
  return offers
    .filter(offer => offer.price_tier === 'public' && offer.price_verified === true && Number.isFinite(offer.total_price))
    .slice()
    .sort((left, right) => left.total_price - right.total_price);
}

function sanitizeSourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.replace(/[?#].*$/, '');
  }
}

function sanitizeDiagnosticText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/https?:\/\/[^\s"']+/gi, match => sanitizeSourceUrl(match))
    .replace(REDACTED_HEADER, (_, field) => `${field}=[redacted]`)
    .replace(REDACTED_BEARER, 'Bearer [redacted]')
    .replace(REDACTED_FIELD, (_, field) => `${field}=[redacted]`);
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap(row => Object.keys(row || {}).filter(key => !FORBIDDEN_CSV_KEYS.has(key.toLowerCase()))))];
  const escape = value => {
    const safeValue = typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${String(safeValue ?? '').replace(/"/g, '""')}"`;
  };
  return [headers, ...rows.map(row => headers.map(header => row?.[header]))]
    .map(values => values.map(escape).join(','))
    .join('\n');
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = {
  parseMoney,
  normalizePriceCandidate,
  rankVerifiedPublicOffers,
  sanitizeSourceUrl,
  sanitizeDiagnosticText,
  toCsv,
  ensureDir,
  writeTextFile
};
