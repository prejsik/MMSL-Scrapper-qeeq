const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isVerifiedPublicOffer, sanitizeDiagnosticText } = require('./utils');
const { buildScenarioMarketView } = require('./marketView');
const { classifyMmAvailability } = require('./mmAvailability');

const STABLE_SEARCH_URL = 'https://www.qeeq.pl/car/search';
const FORBIDDEN_DIAGNOSTIC = /(^|[?&#,;\s])(id|clid|_vv_|fpt|ticket|ts|qeeq_fpt|qeeq_city_id|qeeq_landmark_id|authorization|cookie)\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^&?#,;\s<>]+)/gi;

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
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

function scenarioPickupDate(scenario) {
  return typeof scenario?.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : '';
}

function dailyPrice(offer, rentalDays) {
  if (Number.isFinite(offer?.daily_price)) return offer.daily_price;
  if (!Number.isFinite(offer?.total_price) || !Number.isFinite(rentalDays) || rentalDays <= 0) return null;
  return Math.round((offer.total_price / rentalDays) * 100) / 100;
}

function marketProviderCells(offer, scenario) {
  if (!offer) return '<td class="provider-cell muted">—</td><td class="price-cell muted">—</td>';
  return `<td class="provider-cell"><span class="provider-name" data-top-provider="${escapeHtml(display(offer.provider_name, ''))}">${escapeHtml(display(offer.provider_name))}</span><span class="vehicle-name">${escapeHtml(display(offer.vehicle_name))}</span></td><td class="price-cell">${priceCell(dailyPrice(offer, scenario.rental_days), offer.currency)}</td>`;
}

function mmStatusBadge(availability) {
  const states = {
    present: ['mm-present', 'MM dostępne'],
    confirmed_missing: ['mm-missing', 'Brak MM — pełne dane'],
    incomplete: ['mm-incomplete', 'Nie można potwierdzić — niepełne dane']
  };
  const [className, label] = states[availability] || states.incomplete;
  return `<span class="status-badge ${className}">${label}</span>`;
}

function marketScenario(scenario, availability) {
  const view = buildScenarioMarketView(scenario);
  const [top1, top2, top3] = view.top_3_providers;
  const mm = view.mm_cars_rental;
  const airport = display(scenario?.iata || scenario?.airport_key, '');
  const pickupDate = scenarioPickupDate(scenario);
  const source = top1?.source_search_url || top2?.source_search_url || top3?.source_search_url || mm?.source_search_url;
  return `<article class="market-scenario" data-key="${escapeHtml(display(scenario?.key, ''))}" data-airport="${escapeHtml(airport)}" data-pickup-date="${escapeHtml(pickupDate)}" data-duration="${escapeHtml(display(scenario?.rental_days, ''))}" data-status="${escapeHtml(display(scenario?.status, ''))}" data-mm-availability="${escapeHtml(availability)}">
    <h3>${escapeHtml(display(pickupDate))} · ${escapeHtml(display(scenario?.rental_days))} dni</h3>
    <p class="scenario-meta">${escapeHtml(display(scenario?.requested_city))} · ${escapeHtml(display(airport))} · status: ${escapeHtml(display(scenario?.status))}</p>
    <div class="table-wrap"><table class="market-table" aria-label="Porównanie cen dla ${escapeHtml(display(pickupDate))}, ${escapeHtml(display(scenario?.rental_days))} dni"><thead><tr><th scope="col">Lotnisko</th><th scope="col">Top 1 firma</th><th scope="col">Top 1 PLN/d</th><th scope="col">Top 2 firma</th><th scope="col">Top 2 PLN/d</th><th scope="col">Top 3 firma</th><th scope="col">Top 3 PLN/d</th><th scope="col">MM PLN/d</th><th scope="col">Pozycja MM</th><th scope="col">Tańsi dostawcy</th><th scope="col">Status danych</th><th scope="col">Źródło</th></tr></thead><tbody><tr>
      <td class="location-cell">${escapeHtml(display(airport))}</td>
      ${marketProviderCells(top1, scenario)}${marketProviderCells(top2, scenario)}${marketProviderCells(top3, scenario)}
      <td class="price-cell mm-price">${priceCell(dailyPrice(mm, scenario?.rental_days), mm?.currency)}</td>
      <td class="number-cell">${escapeHtml(display(view.mm_provider_rank))}</td><td class="number-cell">${escapeHtml(display(view.cheaper_provider_count))}</td>
      <td class="status-cell">${mmStatusBadge(availability)}</td><td>${safeSourceLink(source)}</td>
    </tr></tbody></table></div>
  </article>`;
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
  return `<article class="scenario" data-key="${escapeHtml(display(scenario?.key, ''))}" data-airport="${escapeHtml(airport)}" data-pickup-date="${escapeHtml(pickupDate)}" data-duration="${escapeHtml(display(scenario?.rental_days, ''))}" data-status="${escapeHtml(display(scenario?.status, ''))}">
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
  const mmAvailability = classifyMmAvailability(root);
  const mmAvailabilityByDate = new Map(mmAvailability.dates.map(item => [item.pickup_date, item.status]));
  const marketScenarios = scenarios.map(scenario => {
    const pickupDate = scenarioPickupDate(scenario);
    const fallback = buildScenarioMarketView(scenario).mm_cars_rental ? 'present' : 'incomplete';
    return marketScenario(scenario, mmAvailabilityByDate.get(pickupDate) || fallback);
  });
  const qualityWarnings = unique([
    ...arrayOf(root.quality?.quality_errors),
    ...scenarios.flatMap(scenario => arrayOf(scenario.quality_errors)),
    ...arrayOf(root.errors).map(error => error?.code)
  ].map(safeDiagnostic));
  const expected = Number.isInteger(root.expected_checks) && root.expected_checks >= 0 ? root.expected_checks : scenarios.length;
  const completed = Number.isInteger(root.completed_checks) && root.completed_checks >= 0 ? root.completed_checks : scenarios.filter(scenario => scenario.status === 'success').length;
  const failed = Number.isInteger(root.failed_checks) && root.failed_checks >= 0 ? root.failed_checks : Math.max(expected - completed, 0);
  const needsWarning = root.run_status !== 'success' || root.quality_status !== 'pass';
  const verifiedOffers = Number.isInteger(root.quality?.verified_public_offer_count)
    ? root.quality.verified_public_offer_count
    : allOffers.filter(isVerifiedPublicOffer).length;
  const generatedAt = display(root.completed_at || root.started_at);

  const styles = `:root {
  color-scheme:dark;
  --bg: #0c1015;
  --panel: #121820;
  --panel-raised: #18212b;
  --line: #34404d;
  --text: #edf2f7;
  --muted: #a9b4c0;
  --focus: #79b8ff;
  --yellow-bg: #caa300;
  --yellow-text: #253040;
  --orange-bg: #d96b00;
  --red-bg: #c62828;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; font-variant-numeric: tabular-nums; }
main { max-width: 1800px; margin: 0 auto; }
h1 { margin: 0 0 6px; font-size: 24px; }
h2 { margin: 0 0 6px; font-size: 17px; }
h3 { margin: 0 0 4px; font-size: 16px; }
.meta, .scenario-meta, .section-note { color: var(--muted); font-size: 13px; }
.meta { margin-bottom: 16px; }
.quality-banner { margin: 0 0 14px; padding: 10px 12px; border: 2px solid #4f8f66; background: #153021; color: #d9f8e4; font-size: 13px; }
.quality-warning { border-color: #f0a020; background: #3a2807; color: #fff1c7; }
.quality-failure { border-color: #ff5c5c; background: #3b1010; color: #ffd6d6; }
.summary { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0 0 14px; color: var(--muted); font-size: 13px; }
.summary strong { color: var(--text); }
.legend-panel, .details-panel { margin: 0 0 14px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
.legend-panel > summary, .details-panel > summary { cursor: pointer; padding: 9px 12px; color: var(--text); font-size: 13px; font-weight: 650; }
.legend { display: flex; flex-wrap: wrap; gap: 10px 16px; padding: 0 12px 12px; color: var(--muted); font-size: 13px; }
.warnings ul { margin: 0; padding: 0 30px 12px; overflow-wrap: anywhere; }
.status-badge { display: inline-block; max-width: 100%; padding: 3px 8px; border-radius: 4px; color: #fff; font-weight: 700; white-space: normal; }
.mm-present { background: var(--yellow-bg); color: var(--yellow-text); }
.mm-missing { background: var(--red-bg); }
.mm-incomplete { background: var(--orange-bg); }
.compact-filter-toggle { display: none; }
.toolbar { position: sticky; top: 0; z-index: 15; display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin: 0 0 18px; padding: 12px; border: 1px solid var(--line); border-radius: 4px; background: rgba(12,16,21,.94); backdrop-filter: blur(8px); }
.toolbar label { color: var(--muted); font-size: 12px; }
.toolbar select { display: block; min-width: 130px; min-height: 36px; margin-top: 4px; padding: 6px 8px; border: 1px solid #596273; border-radius: 4px; background: var(--panel); color: var(--text); }
button { min-height: 36px; padding: 7px 12px; border: 1px solid #667284; border-radius: 4px; background: var(--panel-raised); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
button:hover { background: #243140; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.results-status { min-height: 16px; margin: -8px 0 18px; color: var(--muted); font-size: 12px; }
.market-overview { margin: 0 0 28px; }
.market-scenario { margin: 0 0 30px; padding-top: 8px; border-top: 1px solid var(--line); }
.scenario-meta { margin: 0 0 9px; }
.table-wrap { overflow: auto; }
table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); background: var(--panel); }
.market-table { table-layout: fixed; }
th, td { padding: 6px 7px; border: 1px solid var(--line); text-align: left; vertical-align: middle; overflow-wrap: anywhere; line-height: 1.25; }
th { background: #171e27; color: var(--text); font-size: 11px; font-weight: 700; }
td { color: var(--text); font-size: 12px; font-weight: 500; }
tbody tr:hover td { background-color: #18212b; }
.market-table th:nth-child(1) { width: 7%; }
.market-table th:nth-child(2), .market-table th:nth-child(4), .market-table th:nth-child(6) { width: 10%; }
.market-table th:nth-child(3), .market-table th:nth-child(5), .market-table th:nth-child(7), .market-table th:nth-child(8) { width: 7%; }
.market-table th:nth-child(9), .market-table th:nth-child(10) { width: 7%; }
.market-table th:nth-child(11) { width: 15%; }
.market-table th:nth-child(12) { width: 6%; }
.price-cell, .number-cell { text-align: right; white-space: nowrap; }
.location-cell { color: #d7e2ee; font-weight: 700; }
.provider-name, .vehicle-name { display: block; }
.vehicle-name, .price-state { margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 400; }
.mm-price { background: #3b3307; color: #fff1a8; font-weight: 700; }
.muted { color: var(--muted); }
a { color: #79b8ff; }
.details-panel { margin-top: 10px; }
.details-content { padding: 0 12px 12px; }
.details-content .scenario { margin: 12px 0 24px; }
.details-content .scenario > p { color: var(--muted); }
.details-content table { min-width: 2400px; }
.empty-state { margin: 20px 0; padding: 24px; border: 1px dashed #596273; border-radius: 4px; color: var(--muted); text-align: center; }
@media (max-width: 1220px) {
  body { padding: 10px; }
  h1 { font-size: 21px; }
  .compact-filter-toggle { display: block; width: 100%; margin-bottom: 10px; text-align: left; }
  .toolbar { position: static; padding: 10px; }
  body.filters-collapsed .toolbar { display: none; }
  .toolbar label { flex: 1 1 145px; min-width: 0; }
  .toolbar select { width: 100%; min-width: 0; }
  .results-status { margin-top: 0; }
  .market-table, .market-table tbody, .market-table tr, .market-table td { display: block; width: 100%; }
  .market-table { border: 0; background: transparent; }
  .market-table thead { display: none; }
  .market-table tbody { display: grid; gap: 10px; }
  .market-table tr { border: 1px solid var(--line); background: var(--panel); }
  .market-table td { display: grid; grid-template-columns: minmax(108px,38%) 1fr; gap: 8px; padding: 7px 9px; border: 0; border-bottom: 1px solid #3d434b; text-align: left; white-space: normal; }
  .market-table td:last-child { border-bottom: 0; }
  .market-table td::before { color: var(--muted); font-weight: 400; }
  .market-table td:nth-child(1)::before { content: "Lotnisko"; }
  .market-table td:nth-child(2)::before { content: "Top 1 firma"; }
  .market-table td:nth-child(3)::before { content: "Top 1 PLN/d"; }
  .market-table td:nth-child(4)::before { content: "Top 2 firma"; }
  .market-table td:nth-child(5)::before { content: "Top 2 PLN/d"; }
  .market-table td:nth-child(6)::before { content: "Top 3 firma"; }
  .market-table td:nth-child(7)::before { content: "Top 3 PLN/d"; }
  .market-table td:nth-child(8)::before { content: "MM PLN/d"; }
  .market-table td:nth-child(9)::before { content: "Pozycja MM"; }
  .market-table td:nth-child(10)::before { content: "Tańsi dostawcy"; }
  .market-table td:nth-child(11)::before { content: "Status danych"; }
  .market-table td:nth-child(12)::before { content: "Źródło"; }
}`;
  const script = `(()=>{const ids=['airport','pickup-date','duration','transmission','provider','status'];const scenarioIds=['airport','pickup-date','duration','status'];const offerIds=['transmission','provider'];const controls=Object.fromEntries(ids.map(id=>[id,document.getElementById('filter-'+id)]));const key=id=>id==='pickup-date'?'pickupDate':id;const matches=(element,id)=>!controls[id]||!controls[id].value||element.dataset[key(id)]===controls[id].value;const offerMatches=row=>offerIds.every(id=>matches(row,id));const hasOfferMatch=article=>!offerIds.some(id=>controls[id]&&controls[id].value)||Array.from(article.querySelectorAll('tr.filterable-offer')).some(offerMatches);const scenarioMatches=element=>scenarioIds.every(id=>matches(element,id));const articleMatches=article=>scenarioMatches(article)&&hasOfferMatch(article);const detailArticles=Array.from(document.querySelectorAll('article.scenario'));const detailsByKey=new Map(detailArticles.map(article=>[article.dataset.key,article]));const marketMatches=article=>scenarioMatches(article)&&(!offerIds.some(id=>controls[id]&&controls[id].value)||Boolean(detailsByKey.get(article.dataset.key)&&hasOfferMatch(detailsByKey.get(article.dataset.key))));const resultsStatus=document.getElementById('results-status');const emptyState=document.getElementById('empty-state');const apply=()=>{let visible=0;document.querySelectorAll('article.market-scenario').forEach(article=>{article.hidden=!marketMatches(article);if(!article.hidden)visible+=1});detailArticles.forEach(article=>{article.hidden=!articleMatches(article)});document.querySelectorAll('tr.filterable-offer').forEach(row=>{row.hidden=!ids.every(id=>matches(row,id))});if(resultsStatus)resultsStatus.textContent='Widoczne scenariusze: '+visible;if(emptyState)emptyState.hidden=visible!==0};Object.values(controls).filter(Boolean).forEach(control=>control.addEventListener('change',apply));const reset=document.getElementById('reset-filters');if(reset)reset.addEventListener('click',()=>{Object.values(controls).filter(Boolean).forEach(control=>{control.value=''});apply()});const toggle=document.getElementById('toggle-filters');const toolbar=document.getElementById('report-filters');if(toggle&&toolbar){const setCollapsed=value=>{if(document.body)document.body.classList.toggle('filters-collapsed',value);toggle.setAttribute('aria-expanded',String(!value));toggle.textContent=value?'Pokaż filtry':'Ukryj filtry'};toggle.addEventListener('click',()=>setCollapsed(!document.body.classList.contains('filters-collapsed')));if(typeof window!=='undefined'&&window.matchMedia&&window.matchMedia('(max-width: 1220px)').matches)setCollapsed(true)}apply()})();`;
  const csp = `default-src 'none'; style-src ${hashDirective(styles)}; script-src ${hashDirective(script)}; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const warningText = needsWarning ? 'Raport częściowy lub z ostrzeżeniami — dane wymagają weryfikacji.' : 'Raport kompletny — jakość danych zaliczona.';
  const qualityClass = root.quality_status === 'fail' || root.run_status === 'failure' ? ' quality-failure' : needsWarning ? ' quality-warning' : '';

  return `<!doctype html>
  <html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>Raport QEEQ</title><style>${styles}</style></head>
<body><main>
  <h1>Kontrola cen QEEQ</h1>
  <div class="meta">Wygenerowano: ${escapeHtml(generatedAt)} · QEEQ.pl</div>
  <header id="status-banner" class="quality-banner${qualityClass}"><strong>${escapeHtml(warningText)}</strong> Run: ${escapeHtml(display(root.run_status))} · Jakość: ${escapeHtml(display(root.quality_status))}</header>
  <div class="summary" aria-label="Podsumowanie raportu"><span>Scenariusze: <strong>${scenarios.length}</strong></span><span>Oczekiwane: <strong>${expected}</strong></span><span>Ukończone: <strong>${completed}</strong></span><span>Nieudane: <strong>${failed}</strong></span><span>Zweryfikowane oferty: <strong>${verifiedOffers}</strong></span><span>Daty bez MM: <strong>${mmAvailability.confirmed_missing_dates.length}</strong></span><span>Daty z niepełnymi danymi: <strong>${mmAvailability.incomplete_dates.length}</strong></span></div>
  <details class="legend-panel"><summary>Legenda oznaczeń</summary><div class="legend"><span>${mmStatusBadge('present')} oferta MM znaleziona</span><span>${mmStatusBadge('confirmed_missing')} komplet kontroli bez MM</span><span>${mmStatusBadge('incomplete')} brak pełnego potwierdzenia</span></div></details>
  ${qualityWarnings.length ? `<details class="legend-panel warnings"><summary>Ostrzeżenia jakości (${qualityWarnings.length})</summary><ul>${qualityWarnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
  <button class="compact-filter-toggle" id="toggle-filters" type="button" aria-expanded="true" aria-controls="report-filters">Ukryj filtry</button>
  <nav id="report-filters" class="toolbar" aria-label="Filtry">
    <label>Lotnisko<select id="filter-airport">${optionList(scenarios.map(scenario => scenario.iata || scenario.airport_key))}</select></label>
    <label>Data odbioru<select id="filter-pickup-date">${optionList(scenarios.map(scenario => typeof scenario.pickup_at === 'string' ? scenario.pickup_at.slice(0, 10) : null))}</select></label>
    <label>Długość<select id="filter-duration">${optionList(scenarios.map(scenario => scenario.rental_days))}</select></label>
    <label>Skrzynia<select id="filter-transmission">${optionList(allOffers.map(offer => offer.transmission))}</select></label>
    <label>Dostawca<select id="filter-provider">${optionList(allOffers.map(offer => offer.provider_name))}</select></label>
    <label>Status<select id="filter-status">${optionList(scenarios.map(scenario => scenario.status))}</select></label>
    <button id="reset-filters" type="button">Wyczyść filtry</button>
  </nav>
  <div class="results-status" id="results-status" role="status" aria-live="polite"></div>
  <div class="empty-state" id="empty-state" hidden>Brak wyników dla wybranych filtrów.</div>
  <section id="top3" class="market-overview"><h2>Top 3 zweryfikowanych cen publicznych i MM Cars Rental</h2><p class="section-note">Najtańsza zweryfikowana oferta każdego dostawcy; ceny dzienne.</p>${marketScenarios.length ? marketScenarios.join('') : '<p class="empty-state">Brak scenariuszy.</p>'}</section>
  <details id="details" class="details-panel"><summary>Pełne szczegóły (${scenarios.length})</summary><div class="details-content">${scenarios.length ? scenarios.map(scenarioDetails).join('') : '<p class="empty-state">Brak scenariuszy.</p>'}</div></details>
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
