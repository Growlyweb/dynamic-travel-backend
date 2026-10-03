// What services need to know about the caller's connection, without ever seeing req/res.
// req.ip is the real client IP only when TRUST_PROXY matches the proxies in front of the app.
const contextOf = (req) => ({
  ip: req.ip || '',
  userAgent: req.get('user-agent') || ''
});

module.exports = contextOf;
