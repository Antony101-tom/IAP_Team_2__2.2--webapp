// Adds the standard "this is going away" headers to a response (Week 13).
//   Deprecation: true              -> this endpoint is deprecated
//   Sunset: <date>                 -> when it will stop working
//   Link: <...>; rel="successor-version" -> where to go instead
function deprecated({ sunset, successor }) {
  return (req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', new Date(sunset).toUTCString());
    res.set('Link', `<${successor}>; rel="successor-version"`);
    next();
  };
}

module.exports = { deprecated };
