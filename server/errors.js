// Turns an error into readable text for the terminal.
// Some connection failures (for example MySQL is not running, and "localhost" resolves to both
// IPv6 and IPv4) are AggregateErrors whose own `message` is an empty string; the real reasons are
// in `err.errors`. Printing only `err.message` then shows nothing at all.
function describeError(err) {
  if (!err) return 'unknown error';
  const parts = [];
  if (err.message) parts.push(err.message);
  if (Array.isArray(err.errors)) {
    for (const inner of err.errors) {
      if (inner && inner.message && !parts.includes(inner.message)) parts.push(inner.message);
    }
  }
  const text = parts.join('; ') || String(err);
  return err.code && !text.includes(err.code) ? `${err.code}: ${text}` : text;
}

// The error code that best explains a failure, looking inside an AggregateError if needed
function errorCode(err) {
  if (Array.isArray(err.errors)) {
    const inner = err.errors.map((e) => e && e.code);
    for (const preferred of ['ECONNREFUSED', 'ETIMEDOUT']) {
      if (inner.includes(preferred)) return preferred;
    }
  }
  return err.code;
}

module.exports = { describeError, errorCode };
