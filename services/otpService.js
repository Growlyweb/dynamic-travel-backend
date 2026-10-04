const env = require('../config/env');
const OtpToken = require('../models/OtpToken');
const { hashValue, safeEqual, generateOtp, generateToken } = require('../utils/crypto');

// Two kinds of one-time secret, both stored hashed, single use, and self-expiring:
//   code  : 6-digit OTP the user types (email verification, password reset).
//           Checked against a specific user, with a capped number of attempts.
//   link  : long random token placed in an emailed link (staff invite).
//           Looked up by its hash; 256 bits, so no attempt counter is needed.

const codeHash = (userId, purpose, code) => hashValue(`${userId}:${purpose}:${code}`);

// Replaces any earlier unused code for the same user and purpose.
const issueCode = async (userId, purpose, meta = {}) => {
  const code = generateOtp();

  await OtpToken.deleteMany({ userId, purpose, usedAt: null });
  await OtpToken.create({
    userId,
    purpose,
    tokenHash: codeHash(userId, purpose, code),
    expiresAt: new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000),
    requestMeta: meta
  });

  return code;
};

// True when the previous code was issued too recently (resend throttle).
const isCoolingDown = async (userId, purpose) => {
  if (!env.otp.resendCooldownSeconds) return false;

  const latest = await OtpToken.findOne({ userId, purpose }).sort({ createdAt: -1 }).select('createdAt');
  return Boolean(latest && Date.now() - latest.createdAt.getTime() < env.otp.resendCooldownSeconds * 1000);
};

// The attempt counter is bumped atomically BEFORE comparing, so parallel guesses cannot
// exceed the limit. `consume: false` only checks (used by verify-reset-token).
const verifyCode = async (userId, purpose, code, { consume = true } = {}) => {
  const record = await OtpToken.findOneAndUpdate(
    {
      userId,
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: env.otp.maxAttempts }
    },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } }
  );

  if (!record || !safeEqual(record.tokenHash, codeHash(userId, purpose, code))) return false;
  if (!consume) return true;

  const used = await OtpToken.updateOne({ _id: record._id, usedAt: null }, { usedAt: new Date() });
  return used.modifiedCount === 1;
};

const issueLinkToken = async (userId, purpose, ttlHours) => {
  const raw = generateToken(32);

  await OtpToken.deleteMany({ userId, purpose, usedAt: null });
  await OtpToken.create({
    userId,
    purpose,
    tokenHash: hashValue(raw),
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  });

  return raw;
};

// Atomically marks the token used and returns it, or null when invalid / expired / already used.
const consumeLinkToken = (purpose, raw) =>
  OtpToken.findOneAndUpdate(
    { tokenHash: hashValue(raw), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
    { new: true }
  );

module.exports = { issueCode, isCoolingDown, verifyCode, issueLinkToken, consumeLinkToken };
