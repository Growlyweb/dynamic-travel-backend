const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const {
  loginLimiter,
  firebaseLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  changePasswordLimiter,
  refreshLimiter
} = require('../middleware/rateLimitMiddleware');
const validate = require('../middleware/validationMiddleware');
const { authenticate } = require('../middleware/authMiddleware');
const { uploadPartnerDocuments } = require('../middleware/uploadMiddleware');
const schemas = require('../validations/auth.validation');

// Mounted at /api/auth. Public routes are rate limited and validated; the rest need a token.

// ---- Registration
router.post('/register', registerLimiter, validate({ body: schemas.registerB2C }), authController.registerB2C);

// Multer MUST come first on multipart routes so req.body is parsed before validate().
router.post(
  '/b2b/register',
  registerLimiter,
  uploadPartnerDocuments,
  validate({ body: schemas.registerB2B }),
  authController.registerB2B
);

router.post('/verify-otp', otpLimiter, validate({ body: schemas.verifyOtp }), authController.verifyOtp);
router.post('/resend-otp', otpLimiter, validate({ body: schemas.resendOtp }), authController.resendOtp);

// ---- Sign in
router.post('/login', loginLimiter, validate({ body: schemas.login }), authController.login);
router.post('/firebase', firebaseLimiter, validate({ body: schemas.firebaseLogin }), authController.firebaseLogin);
router.post('/refresh', refreshLimiter, validate({ body: schemas.refresh }), authController.refresh);
router.post('/logout', authenticate, validate({ body: schemas.logout }), authController.logout);

// ---- Forgot / reset password
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: schemas.forgotPassword }),
  authController.forgotPassword
);
router.post(
  '/verify-reset-token',
  otpLimiter,
  validate({ body: schemas.verifyResetToken }),
  authController.verifyResetToken
);
router.post('/reset-password', otpLimiter, validate({ body: schemas.resetPassword }), authController.resetPassword);

// ---- Invited staff / admin sets the first password
router.post('/setup-account', otpLimiter, validate({ body: schemas.setupAccount }), authController.setupAccount);

// ---- Logged in
router.post(
  '/change-password',
  authenticate,
  changePasswordLimiter,
  validate({ body: schemas.changePassword }),
  authController.changePassword
);
router.get('/me', authenticate, authController.me);

module.exports = router;
