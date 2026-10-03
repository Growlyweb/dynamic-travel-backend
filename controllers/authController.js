const authService = require('../services/authService');
const profileService = require('../services/profileService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');
const ApiError = require('../utils/ApiError');
const {
  setRefreshCookie,
  clearRefreshCookie,
  isMobileClient,
  readRefreshToken
} = require('../utils/authCookie');

// Controllers are thin: pull values out of req, call ONE service, send the response.

// Web clients get the refresh token as an httpOnly cookie. Mobile clients (header
// "X-Client-Type: mobile") get it in the JSON body instead.
const sendSession = (req, res, statusCode, message, { user, session }) => {
  const data = { accessToken: session.accessToken, expiresIn: session.accessExpiresIn };
  if (user) data.user = user;

  if (isMobileClient(req)) {
    data.refreshToken = session.refreshToken;
  } else {
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  }

  return sendResponse(res, statusCode, true, message, data);
};

// POST /api/auth/register  (B2C)
exports.registerB2C = asyncHandler(async (req, res) => {
  const { user, otpSent } = await authService.registerB2C(req.body, contextOf(req));
  sendResponse(res, 201, true, 'Account created. Enter the verification code we emailed you.', { user, otpSent });
});

// POST /api/auth/b2b/register  (multipart: tradeLicense (required), businessCard, otherDocuments)
exports.registerB2B = asyncHandler(async (req, res) => {
  const { user, partner, otpSent } = await authService.registerB2B(req.body, req.files || {}, contextOf(req));
  sendResponse(
    res,
    201,
    true,
    'Business account created. Verify your email; an administrator will then review your application.',
    { user, partner, otpSent }
  );
});

// POST /api/auth/verify-otp
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { user, session } = await authService.verifyEmail(req.body, contextOf(req));
  sendSession(req, res, 200, 'Email verified.', { user, session });
});

// POST /api/auth/resend-otp
exports.resendOtp = asyncHandler(async (req, res) => {
  await authService.resendVerificationOtp(req.body, contextOf(req));
  sendResponse(res, 200, true, 'If that account is waiting for verification, a new code was sent.');
});

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { user, session } = await authService.login(req.body, contextOf(req));
  sendSession(req, res, 200, 'Login successful.', { user, session });
});

// POST /api/auth/firebase  (B2C)
exports.firebaseLogin = asyncHandler(async (req, res) => {
  const { user, session } = await authService.loginWithFirebase(req.body, contextOf(req));
  sendSession(req, res, 200, 'Login successful.', { user, session });
});

// POST /api/auth/refresh
exports.refresh = asyncHandler(async (req, res) => {
  const token = readRefreshToken(req);
  if (!token) throw new ApiError(401, 'Session expired.', { code: 'SESSION_EXPIRED' });

  try {
    const { user, session } = await authService.refresh(token, contextOf(req));
    sendSession(req, res, 200, 'Token refreshed.', { user, session });
  } catch (err) {
    if (err.statusCode === 401) clearRefreshCookie(res);
    throw err;
  }
});

// POST /api/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(
    req.user.id,
    { refreshToken: readRefreshToken(req), allDevices: req.body.allDevices === true },
    contextOf(req)
  );
  clearRefreshCookie(res);
  sendResponse(res, 200, true, 'Logged out.');
});

// POST /api/auth/forgot-password
exports.forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body, contextOf(req));
  sendResponse(res, 200, true, 'If an account exists for that email, a reset code was sent.');
});

// POST /api/auth/verify-reset-token
exports.verifyResetToken = asyncHandler(async (req, res) => {
  await authService.verifyResetCode(req.body);
  sendResponse(res, 200, true, 'Code is valid.');
});

// POST /api/auth/reset-password
exports.resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body, contextOf(req));
  clearRefreshCookie(res);
  sendResponse(res, 200, true, 'Password reset. Please log in with your new password.');
});

// POST /api/auth/change-password
exports.changePassword = asyncHandler(async (req, res) => {
  const session = await authService.changePassword(req.user.id, req.body, contextOf(req));
  sendSession(req, res, 200, 'Password updated. Your other devices were signed out.', { session });
});

// POST /api/auth/setup-account  (invited staff / admin sets the first password)
exports.setupAccount = asyncHandler(async (req, res) => {
  await authService.setupAccount(req.body, contextOf(req));
  sendResponse(res, 200, true, 'Account activated. You can now log in.');
});

// GET /api/auth/me
exports.me = asyncHandler(async (req, res) => {
  const { user, partner } = await profileService.get(req.user.id);
  sendResponse(res, 200, true, 'Current user profile.', { user, ...(partner ? { partner } : {}) });
});
