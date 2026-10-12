// Validation for a pharmacy's optional public details, shared by registration
// (POST /api/auth/register) and profile updates (PATCH /api/pharmacies/me).

const TEXT_LIMITS = { phone: 30, address: 255, opening_hours: 100 };

// Returns { errors, values }. `values` holds only the fields that were actually sent:
// text fields trimmed (an empty string clears the field to null) and, when both are
// present, latitude and longitude as numbers.
function readPharmacyDetails(body) {
  const errors = [];
  const values = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const v = body[field];
    if (v === undefined) continue;
    if (v === null) {
      values[field] = null;
    } else if (typeof v !== 'string') {
      errors.push(`${field} must be a string`);
    } else if (v.trim().length > max) {
      errors.push(`${field} must be at most ${max} characters`);
    } else {
      values[field] = v.trim() === '' ? null : v.trim();
    }
  }

  const hasLat = body.latitude !== undefined && body.latitude !== null;
  const hasLng = body.longitude !== undefined && body.longitude !== null;
  if (hasLat !== hasLng) {
    errors.push('latitude and longitude must be given together');
  } else if (hasLat) {
    const latOk = typeof body.latitude === 'number' && body.latitude >= -90 && body.latitude <= 90;
    const lngOk = typeof body.longitude === 'number' && body.longitude >= -180 && body.longitude <= 180;
    if (!latOk) errors.push('latitude must be a number between -90 and 90');
    if (!lngOk) errors.push('longitude must be a number between -180 and 180');
    if (latOk && lngOk) {
      values.latitude = body.latitude;
      values.longitude = body.longitude;
    }
  }

  return { errors, values };
}

module.exports = { readPharmacyDetails };
