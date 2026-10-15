// Shared helpers for "near me" queries (used by the public pharmacy and medication routes).

// Parses ?lat=&lng=&radius_km= . Returns { errors, hasPosition, lat, lng, radiusKm }.
// lat and lng must be given together; radius_km needs them.
function parseGeoQuery(query) {
  const errors = [];
  const given = (v) => v !== undefined && v !== '';
  let lat = null;
  let lng = null;
  let radiusKm = null;

  if (given(query.lat) !== given(query.lng)) {
    errors.push('lat and lng must be given together');
  } else if (given(query.lat)) {
    lat = Number(query.lat);
    lng = Number(query.lng);
    if (!(lat >= -90 && lat <= 90)) errors.push('lat must be a number between -90 and 90');
    if (!(lng >= -180 && lng <= 180)) errors.push('lng must be a number between -180 and 180');
  }

  if (given(query.radius_km)) {
    radiusKm = Number(query.radius_km);
    if (!(radiusKm > 0 && radiusKm <= 500)) errors.push('radius_km must be a number greater than 0 and at most 500');
    if (!given(query.lat)) errors.push('radius_km needs lat and lng');
  }

  return { errors, hasPosition: errors.length === 0 && lat !== null, lat, lng, radiusKm };
}

// Parses ?limit= (default 100, maximum 500).
function parseLimit(query) {
  const raw = query.limit;
  if (raw === undefined || raw === '') return { limit: 100, error: null };
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return { limit: 100, error: 'limit must be a whole number from 1 to 500' };
  }
  return { limit, error: null };
}

// Great-circle (haversine) distance in km between a point and p.latitude/p.longitude.
// Plain SQL that PostgreSQL (and so Supabase) understands, rounded to 2 decimals.
// Pass lat, lat, lng as the three parameters. Because PostgreSQL does not let a query filter on a
// column alias in the same SELECT, callers wrap the query and filter/sort on distance_km outside.
const DISTANCE_SQL = `ROUND((6371 * 2 * ASIN(LEAST(1, SQRT(
    POWER(SIN(RADIANS(p.latitude - CAST(? AS double precision)) / 2), 2) +
    COS(RADIANS(CAST(? AS double precision))) * COS(RADIANS(p.latitude)) *
    POWER(SIN(RADIANS(p.longitude - CAST(? AS double precision)) / 2), 2)
))))::numeric, 2)`;

module.exports = { parseGeoQuery, parseLimit, DISTANCE_SQL };
