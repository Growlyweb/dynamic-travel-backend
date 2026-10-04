const env = require('../config/env');

const COOKIE_NAME = 'refreshToken';

// The refresh cookie is only ever sent to /api/auth, never to business routes.
const baseOptions = () => ({
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: env.cookie.sameSite,
  domain: env.cookie.domain,
  path: '/api/auth'
});

const setRefreshCookie = (res, token, expiresAt) => {
  res.cookie(COOKIE_NAME, token, { ...baseOptions(), expires: expiresAt });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(COOKIE_NAME, baseOptions());
};

// Web clients use the cookie. Mobile clients send "X-Client-Type: mobile" and
// receive / send the refresh token in the JSON body instead.
const isMobileClient = (req) => String(req.headers['x-client-type'] || '').toLowerCase() === 'mobile';

const readRefreshToken = (req) => (req.body && req.body.refreshToken) || (req.cookies && req.cookies[COOKIE_NAME]) || null;

module.exports = { setRefreshCookie, clearRefreshCookie, isMobileClient, readRefreshToken };
