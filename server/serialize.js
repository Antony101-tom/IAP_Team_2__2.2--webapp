// The API contract (openapi.yaml) says a medication's optional text fields are strings,
// not null. So when a field is empty it is left out of the response instead of sent as null.
const OPTIONAL_TEXT_FIELDS = ['form', 'category', 'unit', 'branch', 'sku'];

function cleanMedication(row) {
  const out = { ...row };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (out[field] === null || out[field] === undefined) delete out[field];
  }
  return out;
}

module.exports = { cleanMedication };
