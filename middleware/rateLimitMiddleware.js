const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

// In-memory counters: fine for one process. Behind several instances, pass a shared
// `store` (e.g. rate-limit-redis) to makeLimiter. Off under test unless a test turns it on
// (env.rateLimitEnabled), so ordinary suites are not throttled.
//
// Key choices:
//   byEmail : IP + email from the body. An attacker cannot lock a victim out from another IP,
//             and one IP cannot hammer a single account.
//   byUser  : the signed-in user id (put the limiter AFTER authenticate). Stops a stolen access
//             token from guessing a password at the general rate.
//   neither : IP only.
// Every 429 carries a Retry-After header and the RateLimit-* headers.

const makeLimiter = ({ windowMs, limit, message, byEmail = false, byUser = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.rateLimitEnabled,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip);
      if (byUser && req.user) return `user:${req.user.id}`;
      if (!byEmail) return ip;
      const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `${ip}|${email}`;
    },
    message: { success: false, message, code: 'RATE_LIMITED' }
  });

const MINUTES_15 = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// General API limiter
const apiLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 300,
  message: 'Too many requests. Please try again later.'
});

// Login: 10 per 15 minutes per IP + email
const loginLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 10,
  byEmail: true,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

// Firebase sign-in has no email in the body, so this is per IP.
const firebaseLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 30,
  message: 'Too many sign-in attempts. Please try again later.'
});

// OTP verify / resend / reset-password: 5 per 15 minutes per IP + email
const otpLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 5,
  byEmail: true,
  message: 'Too many attempts. Please wait 15 minutes and try again.'
});

// Forgot password: 3 per hour per IP + email
const forgotPasswordLimiter = makeLimiter({
  windowMs: HOUR,
  limit: 3,
  byEmail: true,
  message: 'Too many password reset requests. Please try again in an hour.'
});

// Register: 10 per hour per IP
const registerLimiter = makeLimiter({
  windowMs: HOUR,
  limit: 10,
  message: 'Too many registrations from this address. Please try again later.'
});

// Change password: 5 per 15 minutes per signed-in user. It asks for the current password, so
// it is a password-guessing target for anyone holding a stolen access token.
const changePasswordLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 5,
  byUser: true,
  message: 'Too many password change attempts. Please try again in 15 minutes.'
});

const refreshLimiter = makeLimiter({
  windowMs: MINUTES_15,
  limit: 30,
  message: 'Too many token refresh requests. Please try again later.'
});

module.exports = {
  apiLimiter,
  loginLimiter,
  firebaseLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  changePasswordLimiter,
  refreshLimiter
};
