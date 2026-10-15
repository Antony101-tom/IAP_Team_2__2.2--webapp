// The logged-in session lives in sessionStorage so it is per-tab: you can be
// logged in as a pharmacy in one tab and a patient in another, side by side.
// Accounts, medications and trackers are no longer stored in the browser at all;
// they live in the Supabase database behind the Express API (see server/).
//
// A session looks like: { id, type: 'user' | 'pharmacy', name, email, token }
// `token` is the signed login token the API returns; src/utils/api.js sends it
// with every request that needs a login.
const SESSION_KEY = 'meditrac_session';

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setSession({ id, type, name, email, token }) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, type, name, email, token }));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// True when someone is logged in as the given account type.
export function isLoggedInAs(type) {
  const session = getSession();
  return !!(session && session.type === type && session.token);
}
