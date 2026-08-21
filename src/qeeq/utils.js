const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MONEY_AMOUNT = '(?:\\d{1,3}(?:[ .\\u00a0]\\d{3})+|\\d+)(?:[,.]\\d+)?';
const MONEY_MARKER = '(?:zł|€|\\$|£|(?<![A-Za-z])[A-Za-z]{3}(?![A-Za-z]))';
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const AMBIGUOUS_CURRENCY_WORDS = new Set(['ALL', 'TRY']);
const INVALID_MONEY_LABELS = ['ocena', 'rating', 'depozyt', 'deposit'];
const CONDITIONAL_LABEL = /diament|diamond|member|członk|log\s*in|sign\s*in|zaloguj/i;
const REDACTED_FIELD = /\b(id|bid|clid|_vv_|fpt|ticket|ts|qeeq_fpt)\b\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s&#,;"']+)/gi;
const REDACTED_HEADER = /\b(cookie|authorization)\s*(?::|=)\s*[^\r\n]*/gi;
const REDACTED_BEARER = /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;"']+)/gi;
const FORBIDDEN_CSV_KEYS = new Set(['id', 'bid', 'businessid', 'businessbid', 'clid', 'vv', 'fpt', 'ticket', 'ts', 'qeeqfpt']);

function normalizedFieldName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scenarioArtifactRef(scenarioKey) {
  return crypto.createHash('sha256')
    .update(String(scenarioKey || 'unknown'))
    .digest('hex')
    .slice(0, 16);
}

function parseAmount(value) {
  const normalized = value.replace(/[ .\u00a0]/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function explicitCurrency(raw) {
  return explicitCurrencies(raw)[0] || null;
}

function normalizeCurrencyMarker(marker) {
  if (/^zł$/i.test(marker)) return 'PLN';
  if (marker === '€') return 'EUR';
  if (marker === '$') return 'USD';
  if (marker === '£') return 'GBP';
  const rawMarker = String(marker || '');
  const code = rawMarker.toUpperCase();
  if (AMBIGUOUS_CURRENCY_WORDS.has(code) && rawMarker !== code) return null;
  return ISO_CURRENCIES.has(code) ? code : null;
}

function moneyCurrencyPairs(raw) {
  if (typeof raw !== 'string') return [];
  const pairs = [];
  const patterns = [
    { expression: new RegExp(`(${MONEY_AMOUNT})\\s*(${MONEY_MARKER})`, 'gi'), amountIndex: 1, currencyIndex: 2 },
    { expression: new RegExp(`(${MONEY_MARKER})\\s*(${MONEY_AMOUNT})`, 'gi'), amountIndex: 2, currencyIndex: 1 }
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern.expression)) {
      const currency = normalizeCurrencyMarker(match[pattern.currencyIndex]);
      const amount = parseAmount(match[pattern.amountIndex]);
      if (currency && amount !== null) pairs.push({ index: match.index, amount, currency });
    }
  }
  return pairs.sort((left, right) => left.index - right.index);
}

function explicitCurrencies(raw) {
  return moneyCurrencyPairs(raw).map(pair => pair.currency);
}

function parseMoneyDetails(raw, fallbackCurrency, options = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const rejectLabels = [...INVALID_MONEY_LABELS, ...(options.rejectLabels || [])];
  if (rejectLabels.some(label => raw.toLocaleLowerCase('pl-PL').includes(String(label).toLocaleLowerCase('pl-PL')))) {
    return null;
  }
  const pairs = moneyCurrencyPairs(raw);
  if (pairs.length) {
    return {
      amount: pairs[0].amount,
      currency: pairs[0].currency,
      explicitCurrencies: pairs.map(pair => pair.currency)
    };
  }
  if (/\d\s*%/.test(raw)) return null;
  if (!fallbackCurrency || explicitCurrency(raw)) return null;

  const candidates = [...raw.matchAll(new RegExp(MONEY_AMOUNT, 'g'))];
  const amountCandidate = candidates.find(candidate => !/^\s*(?:dni|dzień|dnia)\b/i.test(raw.slice(candidate.index + candidate[0].length)));
  const amount = amountCandidate ? parseAmount(amountCandidate[0]) : null;
  return amount === null ? null : {
    amount,
    currency: String(fallbackCurrency).toUpperCase(),
    explicitCurrencies: []
  };
}

function parseMoney(raw, fallbackCurrency, options = {}) {
  return parseMoneyDetails(raw, fallbackCurrency, options)?.amount ?? null;
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
  const displayedDetails = parseMoneyDetails(input?.displayedText, input?.fallbackCurrency);
  const memberDetails = parseMoneyDetails(input?.memberText, input?.fallbackCurrency);
  const displayedAmount = displayedDetails?.amount ?? null;
  const memberAmount = memberDetails?.amount ?? null;
  const displayedCurrencies = displayedDetails?.explicitCurrencies || [];
  const memberCurrencies = memberDetails?.explicitCurrencies || [];
  const displayedCurrency = displayedDetails?.currency ?? null;
  const memberCurrency = memberDetails?.currency ?? null;
  const fallbackCurrency = typeof input?.fallbackCurrency === 'string' ? input.fallbackCurrency.toUpperCase() : null;
  const expectedCurrency = 'PLN';
  const unexpectedCurrency = [...displayedCurrencies, ...memberCurrencies, fallbackCurrency]
    .find(currency => currency && currency !== expectedCurrency) || null;
  const ambiguousCurrency = displayedCurrencies.length > 1 || memberCurrencies.length > 1;
  const currencyProblem = Boolean(unexpectedCurrency) || ambiguousCurrency;
  const displayedIsConditional = Boolean(input?.discountType)
    || (typeof input?.displayedText === 'string' && CONDITIONAL_LABEL.test(input.displayedText))
    || (memberAmount === null && typeof input?.memberText === 'string' && CONDITIONAL_LABEL.test(input.memberText));
  const hasConditionalPrice = displayedIsConditional || memberAmount !== null;
  const conditionalOffer = displayedIsConditional ? displayedAmount : null;
  const conditionalMember = memberAmount;
  const conditionalVerified = verifiedTotal && !currencyProblem && (conditionalOffer !== null || conditionalMember !== null);
  const publicVerified = verifiedTotal && !currencyProblem && !displayedIsConditional && displayedAmount !== null;

  return {
    total_price: publicVerified ? displayedAmount : null,
    daily_price: publicVerified ? displayedAmount / rentalDays : null,
    conditional_offer_total: conditionalVerified ? conditionalOffer : null,
    conditional_offer_daily: conditionalVerified && conditionalOffer !== null ? conditionalOffer / rentalDays : null,
    conditional_offer_type: input?.discountType || null,
    conditional_member_total: conditionalVerified ? conditionalMember : null,
    conditional_member_daily: conditionalVerified && conditionalMember !== null ? conditionalMember / rentalDays : null,
    price_tier: publicVerified ? 'public' : (hasConditionalPrice ? 'conditional' : 'unknown'),
    price_scope: verifiedTotal ? 'total' : 'unknown',
    price_verified: publicVerified,
    conditional_price_verified: conditionalVerified,
    currency: unexpectedCurrency || displayedCurrency || memberCurrency || fallbackCurrency || expectedCurrency,
    quality_errors: currencyProblem ? ['unexpected_currency'] : []
  };
}

function isVerifiedPublicOffer(offer) {
  return Boolean(offer && typeof offer === 'object'
    && (offer.record_type == null || offer.record_type === 'offer')
    && typeof offer.provider_name === 'string' && offer.provider_name.trim()
    && offer.currency === 'PLN'
    && offer.price_tier === 'public'
    && offer.price_verified === true
    && Number.isFinite(offer.total_price) && offer.total_price > 0);
}

function isVerifiedConditionalOffer(offer) {
  return Boolean(offer && typeof offer === 'object'
    && offer.conditional_price_verified === true
    && offer.currency === 'PLN'
    && [offer.conditional_offer_total, offer.conditional_member_total]
      .some(value => Number.isFinite(value) && value > 0));
}

function rankVerifiedPublicOffers(offers) {
  return offers
    .filter(isVerifiedPublicOffer)
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
    .replace(REDACTED_FIELD, (_, field) => `${field}=[redacted]`)
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]');
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap(row => Object.keys(row || {}).filter(key => !FORBIDDEN_CSV_KEYS.has(normalizedFieldName(key)))))];
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
  parseMoneyDetails,
  normalizePriceCandidate,
  isVerifiedPublicOffer,
  isVerifiedConditionalOffer,
  rankVerifiedPublicOffers,
  scenarioArtifactRef,
  sanitizeSourceUrl,
  sanitizeDiagnosticText,
  toCsv,
  ensureDir,
  writeTextFile
};
