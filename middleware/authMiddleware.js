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

module.exports = { authenticate };
