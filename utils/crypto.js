const crypto = require('crypto');
const env = require('../config/env');

// Only hashes of OTPs, reset/invite tokens and refresh tokens are stored.
// A keyed hash (HMAC) means a leaked database alone cannot be used to brute-force a 6-digit code.
const hashValue = (value) =>
  crypto.createHmac('sha256', env.tokenHashSecret).update(String(value)).digest('hex');

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// 6-digit numeric code, uniform (no modulo bias).
const generateOtp = () => String(crypto.randomInt(100000, 1000000));

// URL-safe random token for links (staff invite).
const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

module.exports = { hashValue, safeEqual, generateOtp, generateToken };
