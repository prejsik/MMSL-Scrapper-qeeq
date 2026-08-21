const { isVerifiedPublicOffer } = require('./utils');

function normalizeProviderName(value) {
  return String(value || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
}

const MM_ALIASES = new Set(['mm cars rental', 'mm car rental', 'mm service lease polska']);

function isMmCarsProvider(value) {
  return MM_ALIASES.has(normalizeProviderName(value));
}

function compareOffers(left, right) {
  return left.total_price - right.total_price
    || normalizeProviderName(left.provider_name).localeCompare(normalizeProviderName(right.provider_name), 'en')
    || String(left.vehicle_name || '').localeCompare(String(right.vehicle_name || ''), 'en');
}

function rankVerifiedProviders(offers) {
  const cheapest = new Map();
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!isVerifiedPublicOffer(offer)) continue;
    const key = normalizeProviderName(offer.provider_name);
    const current = cheapest.get(key);
    if (!current || compareOffers(offer, current) < 0) cheapest.set(key, offer);
  }
  return [...cheapest.values()].sort(compareOffers);
}

function buildScenarioMarketView(scenario = {}) {
  const rankedProviders = rankVerifiedProviders(scenario.offers);
  const mmIndex = rankedProviders.findIndex(offer => isMmCarsProvider(offer.provider_name));
  return {
    ranked_providers: rankedProviders,
    top_3_providers: rankedProviders.slice(0, 3),
    mm_cars_rental: mmIndex >= 0 ? rankedProviders[mmIndex] : null,
    mm_provider_rank: mmIndex >= 0 ? mmIndex + 1 : null,
    cheaper_provider_count: mmIndex >= 0 ? mmIndex : null,
    verified_provider_count: rankedProviders.length
  };
}

module.exports = { normalizeProviderName, isMmCarsProvider, rankVerifiedProviders, buildScenarioMarketView };
