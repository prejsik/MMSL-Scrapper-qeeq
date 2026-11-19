const locationCatalog = require('./locations.json');

for (const entry of locationCatalog) {
  for (const airport of entry.airports) {
    if (!Array.isArray(airport.tariffZones)
      || airport.tariffZones.some(zone => typeof zone !== 'string' || !/^[A-Z0-9]+$/.test(zone))
      || new Set(airport.tariffZones).size !== airport.tariffZones.length) {
      throw new Error(`Invalid QEEQ tariff zones for ${airport.iata}`);
    }
  }
}

function normalizeLocationKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function catalogEntryForLocation(value) {
  const key = normalizeLocationKey(value);
  return locationCatalog.find(entry => normalizeLocationKey(entry.city) === key) || null;
}

function defaultLocationCities() {
  return locationCatalog.map(entry => entry.city);
}

function expectedAirportCount(locations) {
  return locations.reduce((sum, value) => {
    const entry = catalogEntryForLocation(value);
    if (!entry) throw new Error(`Unknown QEEQ location: ${value}`);
    return sum + entry.airports.length;
  }, 0);
}

function compareLiveAirport(catalogAirport, liveAirport) {
  if (!liveAirport) {
    return { useLiveIds: false, error: { code: 'location_match_missing', expected: catalogAirport.iata } };
  }
  if (String(liveAirport.iata || '').trim().toUpperCase() !== catalogAirport.iata) {
    return { useLiveIds: false, error: { code: 'location_iata_mismatch', expected: catalogAirport.iata, actual: liveAirport.iata } };
  }
  if (normalizeLocationKey(liveAirport.label) !== normalizeLocationKey(catalogAirport.label)) {
    return { useLiveIds: false, error: { code: 'location_label_mismatch', expected: catalogAirport.label, actual: liveAirport.label } };
  }
  if (liveAirport.type !== null && liveAirport.type !== undefined && String(liveAirport.type) !== String(catalogAirport.type)) {
    return { useLiveIds: false, error: { code: 'location_type_mismatch', expected: catalogAirport.type, actual: liveAirport.type } };
  }
  if (normalizeLocationKey(liveAirport.dataType) !== normalizeLocationKey(catalogAirport.dataType)) {
    return { useLiveIds: false, error: { code: 'location_data_type_mismatch', expected: catalogAirport.dataType, actual: liveAirport.dataType } };
  }
  const cityId = liveAirport.city === null || liveAirport.city === undefined ? '' : String(liveAirport.city).trim();
  const landmarkId = liveAirport.landmark === null || liveAirport.landmark === undefined ? '' : String(liveAirport.landmark).trim();
  if (!cityId || !landmarkId) {
    return { useLiveIds: false, error: { code: 'location_id_missing', expected: catalogAirport.iata } };
  }
  const drifted = cityId !== catalogAirport.cityId || landmarkId !== catalogAirport.landmarkId;
  return {
    useLiveIds: true,
    cityId,
    landmarkId,
    qualityWarning: drifted ? { code: 'location_id_drift', expectedCityId: catalogAirport.cityId, actualCityId: cityId, expectedLandmarkId: catalogAirport.landmarkId, actualLandmarkId: landmarkId } : null
  };
}

module.exports = { catalogEntryForLocation, compareLiveAirport, defaultLocationCities, expectedAirportCount, locationCatalog, normalizeLocationKey };
