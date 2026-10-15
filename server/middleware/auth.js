const jwt = require('jsonwebtoken');

function signToken(accountType, id) {
  return jwt.sign({ accountType, id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Builds middleware that requires "Authorization: Bearer <token>" from a logged-in
// account of the given type. The id comes from the signed token, never from the
// request body, so one account can't act as another.
function requireAccount(accountType, label, idProp) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: `Please log in as a ${label} first.` });
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.accountType !== accountType) {
        return res.status(403).json({ error: `Only ${label} accounts can do this.` });
      }
      req[idProp] = payload.id;
      next();
    } catch {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
  };
}

const requirePharmacy = requireAccount('pharmacy', 'pharmacy', 'pharmacyId'); // sets req.pharmacyId
const requireUser = requireAccount('user', 'patient', 'userId'); // sets req.userId

// For the medication write endpoints defined in openapi.yaml, which take no token:
//  - no token                -> allowed, exactly as the contract describes
//                               (unless REQUIRE_LOGIN_FOR_WRITES=true, see .env.example)
//  - a pharmacy token        -> allowed, and the pharmacy can only touch its own medications
//  - a bad / patient token   -> 401 / 403
function optionalPharmacy(req, res, next) {
  if (!req.headers.authorization) {
    if (process.env.REQUIRE_LOGIN_FOR_WRITES === 'true') {
      return res.status(401).json({ error: 'Please log in as a pharmacy first.' });
    }
    return next();
  }
  return requirePharmacy(req, res, next);
}

module.exports = { signToken, requirePharmacy, requireUser, optionalPharmacy };
