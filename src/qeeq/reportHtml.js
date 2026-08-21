const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { rankVerifiedPublicOffers, sanitizeDiagnosticText } = require('./utils');

const STABLE_SEARCH_URL = 'https://www.qeeq.pl/car/search';
const FORBIDDEN_DIAGNOSTIC = /(^|[?&#,;\s])(id|clid|_vv_|fpt|ticket|ts|qeeq_fpt|qeeq_city_id|qeeq_landmark_id|authorization|cookie)\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^&?#,;\s<>]+)/gi;

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeDiagnostic(value) {
  const text = typeof value === 'string' ? value : display(value);
  return sanitizeDiagnosticText(text)
    .replace(FORBIDDEN_DIAGNOSTIC, (_, separator, field) => `${separator}${field}=[redacted]`)
    .replace(/\b(?:qeeq_city_id|qeeq_landmark_id|cookie|authorization)=\[redacted\]/gi, '[redacted]');
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'=\u2028\u2029]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '=': '&#61;',
    '\u2028': '&#8232;', '\u2029': '&#8233;'
  })[character]);
}

function display(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function finite(value) {
  return Number.isFinite(value) ? String(value) : '—';
}

function codePointCompare(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== '').map(String))].sort(codePointCompare);
}

function optionList(values) {
  return ['<option value="">Wszystkie</option>', ...unique(values).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)].join('');
}

function safeSourceLink(value) {
  return value === STABLE_SEARCH_URL
    ? `<a href="${STABLE_SEARCH_URL}" target="_blank" rel="noopener noreferrer">QEEQ</a>`
    : '—';
}

function priceCell(value, currency) {
  return `${escapeHtml(finite(value))}${Number.isFinite(value) && currency ? ` ${escapeHtml(currency)}` : ''}`;
}

function topRow(offer, position, scenario) {
  const airport = display(scenario.iata || scenario.airport_key, '');
  const pickupDate = display(typeof scenario.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : '', '');
  return `<tr class="filterable-offer" data-airport="${escapeHtml(airport)}" data-pickup-date="${escapeHtml(pickupDate)}" data-duration="${escapeHtml(display(scenario.rental_days, ''))}" data-transmission="${escapeHtml(display(offer.transmission, ''))}" data-provider="${escapeHtml(display(offer.provider_name, ''))}" data-status="${escapeHtml(display(scenario.status, ''))}">
    <td>${position}</td><td>${escapeHtml(display(scenario.iata || scenario.airport_key))}</td>
    <td>${escapeHtml(display(pickupDate))}</td>
    <td>${escapeHtml(display(scenario.rental_days))}</td><td>${escapeHtml(display(offer.provider_name))}</td>
    <td>${escapeHtml(display(offer.vehicle_name))}</td><td>${priceCell(offer.total_price, offer.currency)}</td>
    <td>${priceCell(offer.daily_price, offer.currency)}</td><td>${safeSourceLink(offer.source_search_url)}</td>
  </tr>`;
}

function offerRow(offer, scenario) {
  const verified = offer.price_verified === true ? 'zweryfikowana' : 'niezweryfikowana';
  const conditionalVerified = offer.conditional_price_verified === true ? 'zweryfikowana' : 'niezweryfikowana';
  const airport = display(scenario.iata || scenario.airport_key, '');
  const pickupDate = display(typeof scenario.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : '', '');
  return `<tr class="filterable-offer" data-airport="${escapeHtml(airport)}" data-pickup-date="${escapeHtml(pickupDate)}" data-duration="${escapeHtml(display(scenario.rental_days, ''))}" data-transmission="${escapeHtml(display(offer.transmission, ''))}" data-provider="${escapeHtml(display(offer.provider_name, ''))}" data-status="${escapeHtml(display(scenario.status, ''))}">
    <td>${escapeHtml(display(offer.provider_name))}</td><td>${escapeHtml(display(offer.vehicle_name))}</td>
    <td>${escapeHtml(display(offer.vehicle_category))}</td><td>${escapeHtml(display(offer.transmission))}</td>
    <td>${escapeHtml(display(offer.seats))}</td><td>${escapeHtml(display(offer.doors))}</td><td>${escapeHtml(display(offer.luggage))}</td>
    <td>${escapeHtml(display(offer.provider_rating))} / ${escapeHtml(display(offer.provider_rating_count))}</td>
    <td>${priceCell(offer.deposit_amount, offer.deposit_currency)}</td>
    <td>${priceCell(offer.total_price, offer.currency)} <span class="price-state">${verified}</span></td>
    <td>${priceCell(offer.daily_price, offer.currency)}</td>
    <td>${priceCell(offer.public_discounted_total, offer.currency)}</td>
    <td>${escapeHtml(display(offer.conditional_offer_type))}</td>
    <td>${priceCell(offer.conditional_offer_total, offer.currency)} <span class="price-state">${conditionalVerified}</span></td>
    <td>${priceCell(offer.conditional_offer_daily, offer.currency)}</td>
    <td>${priceCell(offer.conditional_member_total, offer.currency)}</td><td>${priceCell(offer.conditional_member_daily, offer.currency)}</td>
    <td>${priceCell(offer.reference_price, offer.reference_currency)}</td>
    <td>${escapeHtml(display(offer.price_tier))}</td><td>${escapeHtml(display(offer.price_scope))}</td>
    <td>${escapeHtml(display(offer.price_label))}</td><td>${escapeHtml(display(offer.parsing_source))}</td>
    <td>${escapeHtml(display(offer.captured_at))}</td><td>${safeSourceLink(offer.source_search_url)}</td>
  </tr>`;
}

function scenarioDetails(scenario) {
  const offers = arrayOf(scenario?.offers).filter(offer => offer && typeof offer === 'object');
  const airport = display(scenario?.iata || scenario?.airport_key, '');
  const pickupDate = display(typeof scenario?.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : '', '');
  return `<article class="scenario" data-airport="${escapeHtml(airport)}" data-pickup-date="${escapeHtml(pickupDate)}" data-duration="${escapeHtml(display(scenario?.rental_days, ''))}" data-status="${escapeHtml(display(scenario?.status, ''))}">
    <h3>${escapeHtml(display(scenario?.key, 'Scenariusz bez klucza'))}</h3>
    <p>${escapeHtml(display(scenario?.requested_city))} · ${escapeHtml(display(airport))} · ${escapeHtml(display(pickupDate))} · ${escapeHtml(display(scenario?.rental_days))} dni · status: ${escapeHtml(display(scenario?.status))}</p>
    ${offers.length === 0 ? '<p>Brak ofert.</p>' : `<div class="table-wrap"><table><thead><tr><th>Dostawca</th><th>Pojazd</th><th>Kategoria</th><th>Skrzynia</th><th>Miejsca</th><th>Drzwi</th><th>Bagaż</th><th>Ocena / liczba</th><th>Depozyt</th><th>Cena publiczna</th><th>Publiczna / dzień</th><th>Publiczna ze zniżką</th><th>Typ newcomer/warunkowy</th><th>Cena newcomer/warunkowa</th><th>Warunkowa / dzień</th><th>Cena Diamentowa</th><th>Diamentowa / dzień</th><th>Cena referencyjna</th><th>Poziom ceny</th><th>Zakres ceny</th><th>Etykieta</th><th>Źródło parsowania</th><th>Czas pobrania</th><th>Źródło</th></tr></thead><tbody>${offers.map(offer => offerRow(offer, scenario)).join('')}</tbody></table></div>`}
  </article>`;
}

function hashDirective(value) {
  return `'sha256-${crypto.createHash('sha256').update(value).digest('base64')}'`;
}

function buildHtmlReport(payload = {}) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const scenarios = arrayOf(root.scenarios).filter(scenario => scenario && typeof scenario === 'object');
  const allOffers = scenarios.flatMap(scenario => arrayOf(scenario.offers).filter(offer => offer && typeof offer === 'object'));
  const topRows = scenarios.flatMap(scenario => rankVerifiedPublicOffers(arrayOf(scenario.offers).filter(isPlainObject)).slice(0, 3).map((offer, index) => topRow(offer, index + 1, scenario)));
  const qualityWarnings = unique([
    ...arrayOf(root.quality?.quality_errors),
    ...scenarios.flatMap(scenario => arrayOf(scenario.quality_errors)),
    ...arrayOf(root.errors).map(error => error?.code)
  ].map(safeDiagnostic));
  const expected = Number.isInteger(root.expected_checks) && root.expected_checks >= 0 ? root.expected_checks : scenarios.length;
  const completed = Number.isInteger(root.completed_checks) && root.completed_checks >= 0 ? root.completed_checks : scenarios.filter(scenario => scenario.status === 'success').length;
  const failed = Number.isInteger(root.failed_checks) && root.failed_checks >= 0 ? root.failed_checks : Math.max(expected - completed, 0);
  const needsWarning = root.run_status !== 'success' || root.quality_status !== 'pass';

  const styles = `:root{color-scheme:light;font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}body{margin:0}main{max-width:1440px;margin:auto;padding:24px}.banner{position:sticky;top:0;z-index:5;padding:16px;border-radius:10px;background:#e7f7ed;border:1px solid #7bc693}.banner.warning{background:#fff3cd;border-color:#e4bd51}.counts,.filters{display:flex;gap:12px;flex-wrap:wrap}.counts span,.filters label{background:white;padding:10px;border-radius:8px}.filters{margin:18px 0}.filters label{display:grid;gap:5px}select{min-width:140px;padding:6px}section{margin:24px 0}article{background:white;border:1px solid #dce2ed;border-radius:10px;margin:14px 0;padding:16px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;background:white}th,td{border-bottom:1px solid #e2e7ef;padding:9px;text-align:left;white-space:nowrap}th{background:#eef2f8}.price-state{display:block;color:#596579;font-size:.8rem}.warnings{overflow-wrap:anywhere}.empty{padding:20px;background:white;border-radius:10px}[hidden]{display:none!important}`;
  const script = `(()=>{const ids=['airport','pickup-date','duration','transmission','provider','status'];const scenarioIds=['airport','pickup-date','duration','status'];const offerIds=['transmission','provider'];const controls=Object.fromEntries(ids.map(id=>[id,document.getElementById('filter-'+id)]));const key=id=>id==='pickup-date'?'pickupDate':id;const matches=(element,id)=>!controls[id].value||element.dataset[key(id)]===controls[id].value;const articleMatches=article=>scenarioIds.every(id=>matches(article,id))&&(!offerIds.some(id=>controls[id].value)||Array.from(article.querySelectorAll('tr.filterable-offer')).some(row=>offerIds.every(id=>matches(row,id))));const apply=()=>{document.querySelectorAll('article.scenario').forEach(article=>{article.hidden=!articleMatches(article)});document.querySelectorAll('tr.filterable-offer').forEach(row=>{row.hidden=!ids.every(id=>matches(row,id))})};Object.values(controls).forEach(control=>control.addEventListener('change',apply))})();`;
  const csp = `default-src 'none'; style-src ${hashDirective(styles)}; script-src ${hashDirective(script)}; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const warningText = needsWarning ? 'Raport częściowy lub z ostrzeżeniami — dane wymagają weryfikacji.' : 'Raport kompletny — jakość danych zaliczona.';

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>Raport QEEQ</title><style>${styles}</style></head>
<body><main>
  <header id="status-banner" class="banner${needsWarning ? ' warning' : ''}"><strong>${escapeHtml(warningText)}</strong><div>Run: ${escapeHtml(display(root.run_status))} · Jakość: ${escapeHtml(display(root.quality_status))}</div></header>
  <h1>Raport ofert QEEQ</h1>
  <div class="counts"><span>Oczekiwane: <strong>${expected}</strong></span><span>Ukończone: <strong>${completed}</strong></span><span>Nieudane: <strong>${failed}</strong></span></div>
  <section class="warnings"><h2>Ostrzeżenia jakości</h2>${qualityWarnings.length ? `<ul>${qualityWarnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Brak ostrzeżeń.</p>'}</section>
  <nav class="filters" aria-label="Filtry">
    <label>Lotnisko<select id="filter-airport">${optionList(scenarios.map(scenario => scenario.iata || scenario.airport_key))}</select></label>
    <label>Data odbioru<select id="filter-pickup-date">${optionList(scenarios.map(scenario => typeof scenario.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : null))}</select></label>
    <label>Długość<select id="filter-duration">${optionList(scenarios.map(scenario => scenario.rental_days))}</select></label>
    <label>Skrzynia<select id="filter-transmission">${optionList(allOffers.map(offer => offer.transmission))}</select></label>
    <label>Dostawca<select id="filter-provider">${optionList(allOffers.map(offer => offer.provider_name))}</select></label>
    <label>Status<select id="filter-status">${optionList(scenarios.map(scenario => scenario.status))}</select></label>
  </nav>
  <section id="top3"><h2>Top 3 zweryfikowanych cen publicznych</h2>${topRows.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Lotnisko</th><th>Data</th><th>Dni</th><th>Dostawca</th><th>Pojazd</th><th>Suma</th><th>Dziennie</th><th>Źródło</th></tr></thead><tbody>${topRows.join('')}</tbody></table></div>` : '<p>Brak zweryfikowanych cen publicznych.</p>'}</section>
  <section id="details"><h2>Pełne szczegóły</h2>${scenarios.length ? scenarios.map(scenarioDetails).join('') : '<p class="empty">Brak scenariuszy.</p>'}</section>
</main><script>${script}</script></body></html>\n`;
}

function pathIdentity(filePath) {
  const absolute = path.resolve(filePath);
  let cursor = absolute;
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

function writeHtmlReport(payload, outputPath) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, buildHtmlReport(payload), 'utf8');
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function generateReportFromFile(inputPath, outputPath) {
  const source = path.resolve(inputPath);
  const target = path.resolve(outputPath);
  if (pathIdentity(source) === pathIdentity(target)) throw new Error('HTML output cannot overwrite its JSON input');
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('HTML input must be a regular JSON file');
  const payload = JSON.parse(fs.readFileSync(source, 'utf8'));
  writeHtmlReport(payload, target);
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node src/qeeq/reportHtml.js <input.json> <output.html>');
    return 0;
  }
  if (argv.length !== 2 || argv.some(argument => argument === '--help')) throw new Error('Expected input JSON and output HTML paths');
  generateReportFromFile(argv[0], argv[1]);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch {
    console.error('QEEQ HTML report failed.');
    process.exitCode = 1;
  }
}

module.exports = { escapeHtml, buildHtmlReport, writeHtmlReport, generateReportFromFile };
