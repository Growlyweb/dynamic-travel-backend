const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const env = require('../config/env');
const { USER_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const User = require('../models/User');
const RefreshSession = require('../models/RefreshSession');
const ApiError = require('../utils/ApiError');
const { hashValue } = require('../utils/crypto');
const auditService = require('./auditService');

// Access token : short lived (15m), sent as "Authorization: Bearer ..."
// Refresh token: 7d, stored only as a keyed hash in RefreshSession, rotated on every use.
// Both carry `tv` (tokenVersion). Bumping User.tokenVersion kills every token issued before.
const ALGORITHM = 'HS256';

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion }, env.jwt.accessSecret, {
    algorithm: ALGORITHM,
    expiresIn: env.jwt.accessExpiresIn
  });

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.jwt.accessSecret, { algorithms: [ALGORITHM] });
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired token.', { code: 'TOKEN_INVALID' });
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, env.jwt.refreshSecret, { algorithms: [ALGORITHM] });
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired token.', { code: 'TOKEN_INVALID' });
  }
};

// Creates a RefreshSession and returns both tokens.
const issueSession = async (user, { ip = '', userAgent = '' } = {}) => {
  const accessToken = signAccessToken(user);

  // jti keeps two tokens issued in the same second for the same user from being identical.
  const refreshToken = jwt.sign(
    { sub: String(user._id), tv: user.tokenVersion, jti: crypto.randomUUID() },
    env.jwt.refreshSecret,
    { algorithm: ALGORITHM, expiresIn: env.jwt.refreshExpiresIn }
  );
  const refreshExpiresAt = new Date(jwt.decode(refreshToken).exp * 1000);

  await RefreshSession.create({
    userId: user._id,
    tokenHash: hashValue(refreshToken),
    userAgent: String(userAgent).slice(0, 255),
    ip,
    expiresAt: refreshExpiresAt
  });

  return { accessToken, accessExpiresIn: env.jwt.accessExpiresIn, refreshToken, refreshExpiresAt };
};

const revokeAllSessions = (userId) =>
  RefreshSession.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });

const revokeSession = (rawRefreshToken, userId) =>
  RefreshSession.updateOne(
    { tokenHash: hashValue(rawRefreshToken), userId, revokedAt: null },
    { revokedAt: new Date() }
  );

// Invalidates everything for a user: all refresh sessions and any access token still in flight.
const invalidateUserTokens = async (user) => {
  user.tokenVersion += 1;
  await user.save();
  await revokeAllSessions(user._id);
};

// Refresh with rotation. Presenting an already-used refresh token means it was stolen
// (or replayed), so every session of that user is revoked.
const rotateRefreshToken = async (rawRefreshToken, context = {}) => {
  const payload = verifyRefreshToken(rawRefreshToken);
  const session = await RefreshSession.findOne({ tokenHash: hashValue(rawRefreshToken) });

  const expired = () => new ApiError(401, 'Session expired.', { code: 'SESSION_EXPIRED' });

  if (!session) throw expired();

  const reuseDetected = async () => {
    await revokeAllSessions(session.userId);
    await auditService.record({
      actorUserId: session.userId,
      targetUserId: session.userId,
      action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
      result: 'FAILURE',
      ip: context.ip
    });
    throw expired();
  };

  // Revoked by logout, password change or an earlier theft response: just refuse.
  // Revoked because it was already rotated: somebody is replaying a copy.
  if (session.revokedAt) {
    if (session.rotatedAt) return reuseDetected();
    throw expired();
  }

  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tv) throw expired();
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'Account not active.', { code: 'ACCOUNT_NOT_ACTIVE' });
  }

  // Atomic: of two concurrent requests with the same token, only one wins the rotation.
  const now = new Date();
  const claimed = await RefreshSession.updateOne(
    { _id: session._id, revokedAt: null },
    { revokedAt: now, rotatedAt: now }
  );
  if (claimed.modifiedCount === 0) {
    const latest = await RefreshSession.findById(session._id);
    if (latest && latest.rotatedAt) return reuseDetected();
    throw expired();
  }

  return { user, session: await issueSession(user, context) };
};

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueSession,
  rotateRefreshToken,
  revokeSession,
  revokeAllSessions,
  invalidateUserTokens
};
