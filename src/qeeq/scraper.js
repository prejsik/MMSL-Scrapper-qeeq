const { normalizePriceCandidate, parseMoney, rankVerifiedPublicOffers } = require('./utils');

function buildOfferBusinessKey(id, bid) {
  if (id === null || id === undefined || bid === null || bid === undefined) return null;
  const normalizedId = String(id).trim();
  const normalizedBid = String(bid).trim();
  if (!normalizedId || !normalizedBid) return null;
  return JSON.stringify([normalizedId, normalizedBid]);
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

  const result = {
    record_type: 'offer',
    vehicle_name: safeContext.vehicle?.vehicleName ?? null,
    provider_name: provider.providerName,
    provider_rating: parseRating(safeSnapshot.ratingText),
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

module.exports = {
  buildOfferBusinessKey,
  parseObservedListPayload,
  resolveProviderForOffer,
  parseGroupSnapshot,
  parseOfferSnapshot,
  selectTopPublicOffers
};
