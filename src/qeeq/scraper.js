const { normalizePriceCandidate, parseMoney, rankVerifiedPublicOffers, sanitizeSourceUrl } = require('./utils');

const SELECTORS = Object.freeze({
  pickupInput: 'input[name="pickup"], .J-pick-up-input',
  pickPlace: 'input[name="pick-place"].J-place-of-pick',
  pickupSuggestion: 'li.auto-com-item[data-role="item"]:visible',
  pickupDate: '.J-os-search-pick-date',
  pickupTime: '.J-os-search-pick-time',
  returnDate: '.J-os-search-return-date',
  returnTime: '.J-os-search-return-time',
  pickupDateValue: 'input[name="from_date_0"]',
  pickupTimeValue: 'input[name="from_date_1"]',
  returnDateValue: 'input[name="to_date_0"]',
  returnTimeValue: 'input[name="to_date_1"]',
  sameLocation: '.J-all-the-place',
  driverAge: '.J-search-age-input',
  residence: '.J-search-region-input',
  submit: '.J-search-submit',
  group: '[class*="car-group-item___"]',
  openGroup: '[class*="car-group-item___"][class*="group-open___"]',
  vehicleName: '[class*="car_name___"]',
  supplierButton: 'button[class*="suppliers-btn"]',
  reserveAnchor: 'a[data-tj="reserve_btn_regular_click_b"]',
  supplierInfo: '.supplier-info',
  supplierRating: '.supplier-info > div:first-child > div:last-child',
  feature: '.car-feature-item',
  priceInfo: '[class*="price-info-root___"]',
  displayedPrice: '[class*="origin-row-price___"]',
  diamondPrice: '[class*="diamond-row___"]',
  referencePrice: '[class*="line-through"], [class*="origin-price-tag"]',
  rentalDays: '[class*="rental-days___"]',
  loadMoreText: 'Pokaż więcej wyników'
});

const TRANSIENT_ERROR_CODES = new Set(['session_expired', 'navigation_timeout', 'results_timeout', 'transient_network']);
const OBSERVED_LIST_PATHS = new Set([
  '/car-api/search/list',
  '/revision/search/getList',
  '/revision/search/getListAsyncInfo',
  '/revision/search/getListExt'
]);
const OFFER_ANCESTOR = 'xpath=ancestor::*[.//*[contains(concat(" ", normalize-space(@class), " "), " supplier-info ")] and .//*[contains(@class, "price-info-root___")]][1]';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function controlledError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function locatorExists(locator) {
  if (!locator || await locator.count() === 0) return false;
  return locator.first().isVisible();
}

async function dismissPolishPopups(page) {
  for (const label of ['Odrzuć nieobowiązkowe pliki cookie', 'OK']) {
    const control = page.getByText(label, { exact: true });
    if (await locatorExists(control)) await control.first().click();
  }
}

async function readSuggestion(locator) {
  const text = normalizeText(await locator.innerText());
  const attributes = {};
  for (const name of ['data-iata', 'iata', 'data-city', 'city', 'data-landmark', 'landmark', 'data-type', 'type', 'data-data-type', 'title']) {
    attributes[name] = await locator.getAttribute(name);
  }
  const iataFromText = /(?:^|[\s(])([A-Z]{3})(?:[\s)]|$)/.exec(text)?.[1] || null;
  return {
    locator,
    label: normalizeText(attributes.title || text.replace(/\s*\([A-Z]{3}\)\s*$/, '')),
    iata: normalizeText(attributes['data-iata'] || attributes.iata || iataFromText).toUpperCase(),
    city: attributes['data-city'] ?? attributes.city,
    landmark: attributes['data-landmark'] ?? attributes.landmark,
    dataType: attributes['data-data-type'] ?? attributes['data-type'],
    type: attributes.type
  };
}

async function visibleAirportSuggestions(page) {
  const suggestions = page.locator(SELECTORS.pickupSuggestion);
  const values = [];
  for (let index = 0; index < await suggestions.count(); index += 1) {
    const suggestion = suggestions.nth(index);
    if (await suggestion.isVisible()) values.push(await readSuggestion(suggestion));
  }
  return values;
}

async function selectVisibleAirport(page, airport) {
  await page.locator(SELECTORS.pickupInput).fill(airport.label || airport.iata);
  const expectedIata = normalizeText(airport.iata).toUpperCase();
  const expectedLabel = normalizeText(airport.label).toLocaleLowerCase('pl-PL');
  const matches = (await visibleAirportSuggestions(page)).filter(item => {
    if (item.iata !== expectedIata) return false;
    return !expectedLabel || item.label.toLocaleLowerCase('pl-PL') === expectedLabel;
  });
  if (matches.length === 0) throw controlledError('location_match_missing');
  if (matches.length !== 1) throw controlledError('location_match_ambiguous');
  await matches[0].locator.click();
  return matches[0];
}

function snapshotOfferSubtree(input = {}) {
  const featureTexts = Array.isArray(input.featureTexts) ? input.featureTexts.map(normalizeText).filter(Boolean) : [];
  const ratingSource = normalizeText(input.supplierRatingText || input.supplierInfoText);
  const ratingMatch = /(\d+(?:[.,]\d+)?)\s*\(\s*(\d+)\s*\)/.exec(ratingSource);
  const numberForLabel = label => {
    const match = featureTexts.map(text => [text, new RegExp(`(\\d+)\\s+${label}`, 'i').exec(text)]).find(([, result]) => result);
    return match ? Number(match[1][1]) : null;
  };
  return {
    ratingText: ratingMatch ? ratingMatch[1].replace(',', '.') : null,
    ratingCountText: ratingMatch ? ratingMatch[2] : null,
    depositText: featureTexts.find(text => /^Depozyt\s*:/i.test(text)) || null,
    transmission: featureTexts.find(text => /^(?:Automatyczna|Manualna)$/i.test(text)) || null,
    seats: numberForLabel('miejsc'),
    doors: numberForLabel('drzwi'),
    luggage: numberForLabel('baga(?:ż|z)'),
    displayedAmount: normalizeText(input.priceText) || null,
    diamondAmount: normalizeText(input.diamondPriceText) || null,
    referencePriceText: normalizeText(input.referencePriceText) || null,
    rentalPeriodText: normalizeText(input.periodText) || null
  };
}

function buildOfferBusinessKey(id, bid) {
  if (id === null || id === undefined || bid === null || bid === undefined) return null;
  const stringId = String(id);
  const stringBid = String(bid);
  if (!stringId.trim() || !stringBid.trim()) return null;
  return JSON.stringify([stringId, stringBid]);
}

function canonicalProviderName(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  if (!normalized) return null;
  return normalized.toLocaleUpperCase('en-US') === 'CARWIZ' ? 'CARWIZ' : normalized;
}

function parseObservedListPayload(payload) {
  const providerMetadata = new Map();
  const shops = Array.isArray(payload?.data?.shops) ? payload.data.shops : [];
  const shopsById = new Map();
  for (const shop of shops) {
    if (!shop || typeof shop !== 'object' || shop.id === null || shop.id === undefined) continue;
    const shopId = String(shop.id);
    const matches = shopsById.get(shopId) || [];
    matches.push(shop);
    shopsById.set(shopId, matches);
  }
  const groups = Array.isArray(payload?.data?.list) ? payload.data.list : [];

  for (const group of groups) {
    const meals = Array.isArray(group?.meal_list) ? group.meal_list : [];
    for (const meal of meals) {
      const key = buildOfferBusinessKey(meal?.id, meal?.bid);
      if (key === null) continue;
      const matchingShops = shopsById.get(String(meal.pickup_shop)) || [];
      const namedShops = matchingShops
        .map(shop => ({ shop, providerName: canonicalProviderName(shop.name) }))
        .filter(match => match.providerName !== null);
      let candidate;
      if (namedShops.length === 0) {
        candidate = { quality_error: 'provider_unresolved' };
      } else if (namedShops.length !== 1) {
        candidate = { quality_error: 'provider_ambiguous' };
      } else {
        const { shop, providerName } = namedShops[0];
        candidate = {
          providerName,
          providerScore: shop.score !== null && shop.score !== undefined && Number.isFinite(Number(shop.score)) ? Number(shop.score) : null,
          pickupShopId: meal.pickup_shop,
          bestPriceInfo: meal.best_price_info ?? null,
          diamondPriceInfo: meal.diamond_price_info ?? null,
          originPriceInfo: meal.origin_price_info ?? null
        };
      }
      const candidates = providerMetadata.get(key) || [];
      candidates.push(candidate);
      providerMetadata.set(key, candidates);
    }
  }

  return providerMetadata;
}

function resolveProviderForOffer(snapshot, providerMetadata) {
  const key = buildOfferBusinessKey(snapshot?.businessId, snapshot?.businessBid);
  if (key === null || !(providerMetadata instanceof Map)) return { quality_error: 'provider_unresolved' };
  const storedCandidates = providerMetadata.get(key);
  const candidates = Array.isArray(storedCandidates) ? storedCandidates : [];
  if (candidates.length === 0) return { quality_error: 'provider_unresolved' };
  if (candidates.length !== 1) return { quality_error: 'provider_ambiguous' };
  const candidate = candidates[0];
  if (candidate?.quality_error) return { quality_error: candidate.quality_error };
  const providerName = canonicalProviderName(candidate?.providerName);
  if (providerName === null) return { quality_error: 'provider_unresolved' };
  return { ...candidate, providerName };
}

function parseGroupSnapshot(snapshot, context = {}) {
  const safeContext = context && typeof context === 'object' ? context : {};
  return {
    record_type: 'group',
    vehicle_name: snapshot?.vehicleName ?? null,
    price_verified: false,
    rental_days: safeContext.rentalDays ?? null,
    parsing_source: 'dom'
  };
}

function parseRating(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseDeposit(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  return parseMoney(text.replace(/^\s*(?:depozyt|deposit)\s*:\s*/i, ''), 'PLN');
}

function parseOfferSnapshot(snapshot, context = {}, providerMetadata = new Map()) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const safeContext = context && typeof context === 'object' ? context : {};
  const provider = resolveProviderForOffer(safeSnapshot, providerMetadata);
  if (provider.quality_error) {
    return {
      ...parseGroupSnapshot(safeContext.vehicle, safeContext),
      provider_rating: parseRating(safeSnapshot.ratingText),
      deposit_amount: parseDeposit(safeSnapshot.depositText),
      quality_errors: [provider.quality_error]
    };
  }

  const domDiscountType = typeof safeSnapshot.discountType === 'string' && safeSnapshot.discountType.trim()
    ? safeSnapshot.discountType.trim()
    : null;
  const rawApiDiscountType = provider.bestPriceInfo?.discount_type;
  const apiDiscountType = typeof rawApiDiscountType === 'string' && rawApiDiscountType.trim()
    ? rawApiDiscountType.trim()
    : null;
  const discountMismatch = Boolean(domDiscountType && apiDiscountType && domDiscountType !== apiDiscountType);
  const effectiveDiscountType = domDiscountType || apiDiscountType;
  const price = normalizePriceCandidate({
    displayedText: safeSnapshot.displayedAmount,
    discountType: effectiveDiscountType,
    memberText: safeSnapshot.diamondAmount,
    rentalPeriodText: safeSnapshot.rentalPeriodText,
    rentalDays: safeContext.rentalDays,
    fallbackCurrency: 'PLN'
  });
  const rawRatingCount = safeSnapshot.ratingCountText;
  const ratingCount = (typeof rawRatingCount === 'string' || typeof rawRatingCount === 'number')
    && String(rawRatingCount).trim()
    && Number.isInteger(Number(rawRatingCount))
    ? Number(rawRatingCount)
    : null;

  const result = {
    record_type: 'offer',
    vehicle_name: safeContext.vehicle?.vehicleName ?? null,
    transmission: safeContext.vehicle?.transmission ?? null,
    seats: safeContext.vehicle?.seats ?? null,
    doors: safeContext.vehicle?.doors ?? null,
    luggage: safeContext.vehicle?.luggage ?? null,
    provider_name: provider.providerName,
    provider_rating: parseRating(safeSnapshot.ratingText),
    provider_rating_count: ratingCount,
    deposit_amount: parseDeposit(safeSnapshot.depositText),
    deposit_currency: 'PLN',
    ...price,
    reference_price: safeSnapshot.referencePriceText ? parseMoney(safeSnapshot.referencePriceText, 'PLN') : null,
    currency: 'PLN',
    rental_days: safeContext.rentalDays ?? null,
    parsing_source: 'hybrid'
  };
  if (discountMismatch) result.quality_errors = ['discount_type_mismatch'];
  return result;
}

function selectTopPublicOffers(offers, limit) {
  const publicOffers = (Array.isArray(offers) ? offers : [])
    .filter(offer => offer?.record_type === 'offer');
  return rankVerifiedPublicOffers(publicOffers).slice(0, Math.max(0, Number(limit) || 0));
}

function shouldRetryScenario(outcome) {
  return Number(outcome?.attempt) === 0 && TRANSIENT_ERROR_CODES.has(outcome?.error_code);
}

function errorCodeFor(error) {
  if (typeof error?.code === 'string' && error.code) return error.code;
  if (error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message || ''))) return 'navigation_timeout';
  return 'scenario_failed';
}

async function setProfileControl(page, primarySelector, label, value) {
  const primary = page.locator(primarySelector);
  const control = await locatorExists(primary) ? primary.first() : page.getByLabel(label, { exact: true }).first();
  if (!await locatorExists(control)) throw controlledError('search_parameter_mismatch');
  try {
    await control.selectOption(value);
  } catch {
    await control.fill(value);
  }
  if (await control.inputValue() !== value) throw controlledError('search_parameter_mismatch');
}

async function setSearchParameters(page, scenario, config) {
  const values = [
    [SELECTORS.pickupDate, SELECTORS.pickupDateValue, scenario.pickupDate],
    [SELECTORS.pickupTime, SELECTORS.pickupTimeValue, scenario.pickupTime],
    [SELECTORS.returnDate, SELECTORS.returnDateValue, scenario.dropoffDate],
    [SELECTORS.returnTime, SELECTORS.returnTimeValue, scenario.dropoffTime]
  ];
  for (const [controlSelector, hiddenSelector, expected] of values) {
    await page.locator(controlSelector).fill(expected);
    const actual = await page.locator(hiddenSelector).inputValue();
    if (actual !== expected) throw controlledError('search_parameter_mismatch');
  }
  const sameLocation = page.locator(SELECTORS.sameLocation);
  if (await locatorExists(sameLocation) && !await sameLocation.first().isChecked()) await sameLocation.first().click();
  await setProfileControl(page, SELECTORS.driverAge, 'Wiek kierowcy', config.driverAge);
  await setProfileControl(page, SELECTORS.residence, 'Kraj zamieszkania', config.residenceCountryCode);
}

function responsePath(response) {
  try {
    return new URL(response.url()).pathname;
  } catch {
    return null;
  }
}

function isObservedListResponse(response) {
  const method = response.request?.().method?.();
  return method === 'GET' && OBSERVED_LIST_PATHS.has(responsePath(response));
}

function supportedListPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && Array.isArray(payload.data?.list) && Array.isArray(payload.data?.shops));
}

function withTimeout(promise, timeoutMs) {
  const timedOut = Symbol('timed-out');
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(timedOut), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timer));
}

function observeListResponses(page) {
  const responses = [];
  const waiters = [];
  const listener = response => {
    if (!isObservedListResponse(response)) return;
    responses.push(response);
    while (waiters.length) waiters.shift()();
  };
  page.on('response', listener);
  return {
    async finish(timeoutMs) {
      const qualityErrors = [];
      let payload = null;
      try {
        if (responses.length === 0) {
          const observation = await withTimeout(new Promise(resolve => waiters.push(resolve)), timeoutMs);
          if (typeof observation === 'symbol') return { payload, qualityErrors };
        }
        for (const response of responses) {
          let candidate;
          try {
            candidate = await withTimeout(response.json(), timeoutMs);
          } catch {
            candidate = null;
          }
          if (typeof candidate === 'symbol') break;
          if (supportedListPayload(candidate)) {
            payload = candidate;
            break;
          }
          qualityErrors.push('network_schema_unrecognized');
        }
      } finally {
        page.off?.('response', listener);
      }
      return { payload, qualityErrors: [...new Set(qualityErrors)] };
    }
  };
}

async function locatorText(locator) {
  return await locatorExists(locator) ? normalizeText(await locator.first().innerText()) : null;
}

async function readOfferSnapshot(anchor) {
  const subtree = anchor.locator(OFFER_ANCESTOR).first();
  if (!await locatorExists(subtree)) return null;
  const featureTexts = await subtree.locator(SELECTORS.feature).allTextContents();
  return {
    ...snapshotOfferSubtree({
      supplierInfoText: await locatorText(subtree.locator(SELECTORS.supplierInfo)),
      supplierRatingText: await locatorText(subtree.locator(SELECTORS.supplierRating)),
      featureTexts,
      priceText: await locatorText(subtree.locator(SELECTORS.displayedPrice)),
      diamondPriceText: await locatorText(subtree.locator(SELECTORS.diamondPrice)),
      referencePriceText: await locatorText(subtree.locator(SELECTORS.referencePrice)),
      periodText: await locatorText(subtree.locator(SELECTORS.rentalDays))
    }),
    businessId: await anchor.getAttribute('id'),
    businessBid: await anchor.getAttribute('bid'),
    discountType: await anchor.getAttribute('list_discount_type')
  };
}

async function expandAllResults(page, config, sleep) {
  const qualityErrors = [];
  const groups = page.locator(SELECTORS.group);
  const maximumIterations = config.maxLoadMoreIterations ?? 20;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const button = page.getByText(SELECTORS.loadMoreText, { exact: true });
    if (!await locatorExists(button)) return qualityErrors;
    const before = await groups.count();
    await button.first().click();
    await sleep(100);
    const after = await groups.count();
    if (after <= before) {
      qualityErrors.push('load_more_stalled');
      return qualityErrors;
    }
  }
  if (await locatorExists(page.getByText(SELECTORS.loadMoreText, { exact: true }))) qualityErrors.push('load_more_limit_reached');
  return qualityErrors;
}

async function extractResults(page, scenario, config, providerMetadata, sourceSearchUrl, capturedAt) {
  const groups = [];
  const offers = [];
  const groupLocators = page.locator(SELECTORS.group);
  const groupCount = await groupLocators.count();
  const groupLimit = Math.min(groupCount, config.maxVehicleGroupsPerScenario ?? 300);
  const offerLimit = config.maxOffersPerScenario ?? 1500;
  const qualityErrors = groupCount > groupLimit ? ['vehicle_group_limit_reached'] : [];

  for (let index = 0; index < groupLimit; index += 1) {
    const groupLocator = groupLocators.nth(index);
    const vehicleName = await locatorText(groupLocator.locator(SELECTORS.vehicleName));
    const supplierButton = groupLocator.locator(SELECTORS.supplierButton);
    let vehicle = { vehicleName, transmission: null, seats: null, doors: null, luggage: null };
    let diagnostic = parseGroupSnapshot(vehicle, scenario);
    if (await locatorExists(supplierButton)) await supplierButton.first().click();

    const anchors = groupLocator.locator(SELECTORS.reserveAnchor);
    for (let offerIndex = 0; offerIndex < await anchors.count(); offerIndex += 1) {
      if (offers.length >= offerLimit) {
        qualityErrors.push('offer_limit_reached');
        break;
      }
      const snapshot = await readOfferSnapshot(anchors.nth(offerIndex));
      if (!snapshot) continue;
      vehicle = {
        vehicleName,
        transmission: snapshot.transmission,
        seats: snapshot.seats,
        doors: snapshot.doors,
        luggage: snapshot.luggage
      };
      diagnostic = parseGroupSnapshot(vehicle, scenario);
      const parsed = parseOfferSnapshot(snapshot, { rentalDays: scenario.rentalDays, vehicle }, providerMetadata);
      if (parsed.record_type === 'offer') {
        offers.push({ ...parsed, source_search_url: sourceSearchUrl, captured_at: capturedAt });
      } else {
        diagnostic = { ...diagnostic, quality_errors: parsed.quality_errors };
        qualityErrors.push(...(parsed.quality_errors || []));
      }
    }
    groups.push(diagnostic);
    if (offers.length >= offerLimit) break;
  }
  return { groups, offers, qualityErrors: [...new Set(qualityErrors)] };
}

async function defaultLaunchBrowser(config) {
  const { chromium } = require('playwright');
  const options = { headless: config.headless !== false };
  if (config.browserExecutablePath) options.executablePath = config.browserExecutablePath;
  return chromium.launch(options);
}

class QeeqScraper {
  constructor(config, deps = {}) {
    const unsupported = Object.keys(deps).filter(name => !['launchBrowser', 'now', 'sleep'].includes(name));
    if (unsupported.length) throw new Error(`Unsupported QeeqScraper dependency override: ${unsupported[0]}`);
    this.config = config || {};
    this.launchBrowser = deps.launchBrowser || (() => defaultLaunchBrowser(this.config));
    this.now = deps.now || (() => new Date());
    this.sleep = deps.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  async runAttempt(scenario, attempt) {
    let browser;
    let context;
    try {
      browser = await this.launchBrowser();
      context = await browser.newContext({ locale: 'pl-PL', timezoneId: this.config.timeZone || 'Europe/Warsaw' });
      const page = await context.newPage();
      page.setDefaultTimeout?.(this.config.resultsTimeoutMs ?? 30000);
      await page.goto(this.config.baseUrl || 'https://www.qeeq.pl', {
        waitUntil: 'domcontentloaded',
        timeout: this.config.navigationTimeoutMs ?? 60000
      });
      await dismissPolishPopups(page);
      await selectVisibleAirport(page, scenario.airport || {});
      await setSearchParameters(page, scenario, this.config);
      await dismissPolishPopups(page);

      const observation = observeListResponses(page);
      await page.locator(SELECTORS.submit).click();
      await page.waitForURL(/\/car\/search\?id=/, { timeout: this.config.resultsTimeoutMs ?? 60000 });
      await page.waitForSelector(SELECTORS.group, { timeout: this.config.resultsTimeoutMs ?? 60000 });
      const sourceSearchUrl = sanitizeSourceUrl(page.url());
      const observed = await observation.finish(this.config.apiObservationTimeoutMs ?? 30000);
      const providerMetadata = observed.payload ? parseObservedListPayload(observed.payload) : new Map();
      const qualityErrors = [...observed.qualityErrors, ...await expandAllResults(page, this.config, this.sleep)];
      const capturedAt = new Date(this.now()).toISOString();
      const extracted = await extractResults(page, scenario, this.config, providerMetadata, sourceSearchUrl, capturedAt);
      qualityErrors.push(...extracted.qualityErrors);
      return {
        key: scenario.key,
        status: 'success',
        attempt,
        groups: extracted.groups,
        offers: extracted.offers,
        errors: [],
        quality_errors: [...new Set(qualityErrors)],
        source_search_url: sourceSearchUrl,
        captured_at: capturedAt
      };
    } finally {
      await context?.close();
      await browser?.close();
    }
  }

  async runScenario(scenario) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let outcome;
      try {
        outcome = await this.runAttempt(scenario, attempt);
      } catch (error) {
        const errorCode = errorCodeFor(error);
        outcome = {
          key: scenario?.key,
          status: 'failure',
          attempt,
          error_code: errorCode,
          groups: [],
          offers: [],
          errors: [{ code: errorCode }],
          quality_errors: []
        };
      }
      if (!shouldRetryScenario(outcome)) return outcome;
    }
    throw new Error('unreachable retry state');
  }

  async run() {
    const { expandScenarios } = require('./run');
    const scenarios = expandScenarios(this.config, new Date(this.now()));
    const outcomes = [];
    for (const scenario of scenarios) outcomes.push(await this.runScenario(scenario));
    return outcomes;
  }
}

module.exports = {
  SELECTORS,
  QeeqScraper,
  buildOfferBusinessKey,
  dismissPolishPopups,
  parseObservedListPayload,
  resolveProviderForOffer,
  parseGroupSnapshot,
  parseOfferSnapshot,
  selectTopPublicOffers,
  shouldRetryScenario,
  snapshotOfferSubtree,
  visibleAirportSuggestions
};
