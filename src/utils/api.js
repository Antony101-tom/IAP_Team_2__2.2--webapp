import { getSession, clearSession } from './accounts';

// In development, Vite forwards /api/* to the Express server (see vite.config.js).
// For a production build served from a different address than the API, set
// VITE_API_URL (e.g. https://api.example.com) when building.
const API_BASE = import.meta.env.VITE_API_URL || '';

// Calls the MediTrac API and returns { ok, status, data }.
//   auth: true  -> sends the logged-in account's token; if the server says the
//                  login is missing/expired (401), the session is cleared and the
//                  user is sent back to the register/login page.
// HTTP errors (400, 404, 409 ...) do NOT throw: check `ok`. Only a network failure
// (server not running) throws.
export async function apiFetch(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  // ngrok's free plan answers requests that look like they come from a browser with a warning page instead
  // of your data. This header tells it to skip that page. It is only sent when the API address is an ngrok one.
  if (API_BASE.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const session = getSession();
    if (session && session.token) headers['Authorization'] = `Bearer ${session.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      /* not JSON: handled below */
    }
  }

  if (auth && response.status === 401) {
    clearSession();
    window.location.assign('/register');
  }

  // The MediTrac API always answers with JSON (even for errors). Anything else (a web page, an empty reply)
  // came from somewhere that is not the API: the website's own host because VITE_API_URL is missing or wrong,
  // a hosting service's "waking up" page, or a tunnel's warning page. Say so, instead of a vague failure.
  if (response.status !== 204 && data === null) {
    const waking = [502, 503, 504].includes(response.status);
    return {
      ok: false,
      status: response.status,
      data: {
        error: waking
          ? `The server is starting up or temporarily unavailable (HTTP ${response.status}). Free hosting puts it to sleep when it is not used: wait a minute and try again.`
          : `${API_BASE || window.location.origin} did not answer like the MediTrac API (HTTP ${response.status}). ` +
            'If this website is hosted online, check that VITE_API_URL was set to the API address when the website was built.',
      },
    };
  }

  return { ok: response.ok, status: response.status, data };
}

// Pulls a readable message out of the API's error shapes:
//   { error: '...' }  or  { message: '...', errors: ['...', '...'] }
export function errorMessage(data, fallback = 'Something went wrong. Please try again.') {
  if (!data) return fallback;
  if (Array.isArray(data.errors) && data.errors.length > 0) return data.errors.join('. ');
  return data.error || data.message || fallback;
}

export const SERVER_DOWN_MESSAGE =
  'Could not reach the server. If the API runs on your computer, check that it is running (npm start in the server folder). ' +
  'If it is hosted online it may be asleep: wait a minute and try again, or check the API address (VITE_API_URL).';
