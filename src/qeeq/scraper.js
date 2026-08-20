const { normalizePriceCandidate, parseMoney, rankVerifiedPublicOffers } = require('./utils');

function buildOfferBusinessKey(id, bid) {
  if (id === null || id === undefined || bid === null || bid === undefined) return null;
  return JSON.stringify([String(id), String(bid)]);
}

function canonicalProviderName(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  return normalized.toLocaleUpperCase('en-US') === 'CARWIZ' ? 'CARWIZ' : normalized;
}

function parseObservedListPayload(payload) {
  const providerMetadata = new Map();
  const shops = Array.isArray(payload?.data?.shops) ? payload.data.shops : [];
  const shopById = new Map(shops.map(shop => [String(shop.id), shop]));
  const groups = Array.isArray(payload?.data?.list) ? payload.data.list : [];

  for (const group of groups) {
    const meals = Array.isArray(group?.meal_list) ? group.meal_list : [];
    for (const meal of meals) {
      const key = buildOfferBusinessKey(meal?.id, meal?.bid);
      if (key === null) continue;
      const shop = shopById.get(String(meal.pickup_shop));
      const candidates = providerMetadata.get(key) || [];
      candidates.push({
        providerName: canonicalProviderName(shop?.name),
        providerScore: Number.isFinite(Number(shop?.score)) ? Number(shop.score) : null,
        pickupShopId: meal.pickup_shop,
        bestPriceInfo: meal.best_price_info ?? null,
        diamondPriceInfo: meal.diamond_price_info ?? null,
        originPriceInfo: meal.origin_price_info ?? null
      });
      providerMetadata.set(key, candidates);
    }
  }

  return providerMetadata;
}

function resolveProviderForOffer(snapshot, providerMetadata) {
  const key = buildOfferBusinessKey(snapshot?.businessId, snapshot?.businessBid);
  const candidates = key === null ? [] : providerMetadata?.get(key) || [];
  if (candidates.length === 0) return { quality_error: 'provider_unresolved' };
  if (candidates.length !== 1) return { quality_error: 'provider_ambiguous' };
  return candidates[0];
}

function parseGroupSnapshot(snapshot, context = {}) {
  return {
    record_type: 'group',
    vehicle_name: snapshot?.vehicleName ?? null,
    price_verified: false,
    rental_days: context.rentalDays ?? null,
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
  const provider = resolveProviderForOffer(snapshot, providerMetadata);
  if (provider.quality_error) {
    return {
      ...parseGroupSnapshot(context.vehicle, context),
      provider_rating: parseRating(snapshot?.ratingText),
      deposit_amount: parseDeposit(snapshot?.depositText),
      quality_errors: [provider.quality_error]
    };
  }

  const domDiscountType = snapshot?.discountType || null;
  const apiDiscountType = provider.bestPriceInfo?.discount_type || null;
  const discountMismatch = Boolean(domDiscountType && apiDiscountType && domDiscountType !== apiDiscountType);
  const price = normalizePriceCandidate({
    displayedText: snapshot?.displayedAmount,
    discountType: domDiscountType || apiDiscountType || (discountMismatch ? 'conditional' : null),
    memberText: snapshot?.diamondAmount,
    rentalPeriodText: snapshot?.rentalPeriodText,
    rentalDays: context.rentalDays,
    fallbackCurrency: 'PLN'
  });

  const result = {
    record_type: 'offer',
    vehicle_name: context.vehicle?.vehicleName ?? null,
    provider_name: provider.providerName,
    provider_rating: parseRating(snapshot?.ratingText),
    deposit_amount: parseDeposit(snapshot?.depositText),
    deposit_currency: 'PLN',
    ...price,
    reference_price: snapshot?.referencePriceText ? parseMoney(snapshot.referencePriceText, 'PLN') : null,
    currency: 'PLN',
    rental_days: context.rentalDays ?? null,
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
