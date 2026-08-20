const locationCatalog = require('./locations.json');

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
  if (String(liveAirport.iata).toUpperCase() !== catalogAirport.iata) {
    return { useLiveIds: false, error: { code: 'location_iata_mismatch', expected: catalogAirport.iata, actual: liveAirport.iata } };
  }
  if (normalizeLocationKey(liveAirport.label) !== normalizeLocationKey(catalogAirport.label)) {
    return { useLiveIds: false, error: { code: 'location_label_mismatch', expected: catalogAirport.label, actual: liveAirport.label } };
  }
  if (String(liveAirport.type) !== String(catalogAirport.type)) {
    return { useLiveIds: false, error: { code: 'location_type_mismatch', expected: catalogAirport.type, actual: liveAirport.type } };
  }
  if (normalizeLocationKey(liveAirport.dataType) !== normalizeLocationKey(catalogAirport.dataType)) {
    return { useLiveIds: false, error: { code: 'location_data_type_mismatch', expected: catalogAirport.dataType, actual: liveAirport.dataType } };
  }
  const drifted = String(liveAirport.city) !== catalogAirport.cityId || String(liveAirport.landmark) !== catalogAirport.landmarkId;
  return {
    useLiveIds: true,
    cityId: String(liveAirport.city),
    landmarkId: String(liveAirport.landmark),
    qualityWarning: drifted ? { code: 'location_id_drift', expectedCityId: catalogAirport.cityId, actualCityId: String(liveAirport.city), expectedLandmarkId: catalogAirport.landmarkId, actualLandmarkId: String(liveAirport.landmark) } : null
  };
}

module.exports = { catalogEntryForLocation, compareLiveAirport, defaultLocationCities, expectedAirportCount, locationCatalog, normalizeLocationKey };
