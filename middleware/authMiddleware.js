const { USER_STATUS } = require('../config/constants');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const tokenService = require('../services/tokenService');

// WHO are you? Verifies the access token, reloads the user from the database (so role, status and
// permission changes apply immediately), checks status + tokenVersion, then sets req.user.
//
//   req.user = { id, role, status, partnerId, permissions }
//
// Use on every protected route. Run authorize / ownership checks AFTER it.
const authenticate = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (!/^Bearer$/i.test(scheme || '') || !token) {
    throw new ApiError(401, 'Authentication required.', { code: 'AUTH_REQUIRED' });
  }

  const payload = tokenService.verifyAccessToken(token);

  const user = await User.findById(payload.sub).select('role status tokenVersion partnerId permissions');
  if (!user || user.tokenVersion !== payload.tv) {
    throw new ApiError(401, 'Session expired.', { code: 'SESSION_EXPIRED' });
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'Account not active.', { code: 'ACCOUNT_NOT_ACTIVE' });
  }

  req.user = {
    id: String(user._id),
    role: user.role,
    status: user.status,
    partnerId: user.partnerId ? String(user.partnerId) : null,
    permissions: user.permissions
  };
  next();
});

// For public routes whose answer depends on who is asking (the B2B price, drafts). No token means an
// anonymous visitor. A token that is present but wrong is still refused with 401, never treated as anonymous.
const optionalAuthenticate = (req, res, next) => {
  res.vary('Authorization');
  // No header, or a header with nothing after "Bearer " (what Postman sends for an empty variable), claims
  // nobody, so the caller is anonymous. Any actual token is still verified, and a bad one is a 401.
  if (!/^\s*(Bearer)?\s*$/i.test(req.headers.authorization || '')) return authenticate(req, res, next);
  return next();
};

module.exports = { authenticate, optionalAuthenticate };
