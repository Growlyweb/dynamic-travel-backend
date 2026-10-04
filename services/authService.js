const bcrypt = require('bcryptjs');

const env = require('../config/env');
const rbac = require('../config/rbac');
const { ROLES, USER_STATUS, AUTH_PROVIDERS, OTP_PURPOSE, AUDIT_ACTIONS } = require('../config/constants');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const firebaseService = require('./firebaseService');
const notificationService = require('./notificationService');
const otpService = require('./otpService');
const partnerService = require('./partnerService');
const tokenService = require('./tokenService');

// Business rules for authentication. No req/res in here: controllers pass plain values and a
// `context` ({ ip, userAgent }). Anything that returns `session` returns { accessToken, refreshToken, ... }.

const INVALID_CREDENTIALS = 'Invalid credentials';
const INVALID_CODE = 'Invalid or expired code.';

// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
let dummyHash;
const getDummyHash = async () => {
  if (!dummyHash) dummyHash = await bcrypt.hash('not-a-real-password', env.bcryptCost);
  return dummyHash;
};

const hashPassword = (password) => bcrypt.hash(password, env.bcryptCost);

// "selfRegister" in config/rbac.json: set it to false to close sign-up for a role without a code change.
const assertRegistrationOpen = (role) => {
  if (!rbac.canSelfRegister(role)) {
    throw new ApiError(403, 'Registration is not open for this account type.', { code: 'REGISTRATION_CLOSED' });
  }
};

const assertEmailAndPhoneFree = async ({ email, phone }) => {
  const clauses = [{ email }];
  if (phone) clauses.push({ phone });

  const existing = await User.findOne({ $or: clauses }).select('email phone');
  if (!existing) return;

  if (existing.email === email) {
    throw new ApiError(409, 'An account with this email already exists.', { code: 'EMAIL_TAKEN' });
  }
  throw new ApiError(409, 'An account with this phone number already exists.', { code: 'PHONE_TAKEN' });
};

const assertCanLogin = (user) => {
  if (user.status === USER_STATUS.ACTIVE) return;

  if (user.status === USER_STATUS.PENDING) {
    throw new ApiError(403, 'Account not active. Verify your email to continue.', { code: 'EMAIL_NOT_VERIFIED' });
  }
  throw new ApiError(403, 'Account not active.', { code: 'ACCOUNT_NOT_ACTIVE' });
};

const sendEmailVerification = async (user, context) => {
  const code = await otpService.issueCode(user._id, OTP_PURPOSE.EMAIL_VERIFY, context);
  return notificationService.trySend(() => notificationService.verificationOtp(user, code));
};

const startSession = async (user, context, meta) => {
  user.lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { lastLoginAt: user.lastLoginAt });

  const session = await tokenService.issueSession(user, context);
  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.LOGIN,
    ip: context.ip,
    meta
  });
  return session;
};

// ---------------------------------------------------------------- registration

// The role is fixed here. The request body is never consulted for it.
const registerB2C = async ({ name, email, phone, password }, context = {}) => {
  assertRegistrationOpen(ROLES.B2C);
  await assertEmailAndPhoneFree({ email, phone });

  const user = await User.create({
    name,
    email,
    phone,
    passwordHash: await hashPassword(password),
    role: ROLES.B2C,
    status: USER_STATUS.PENDING,
    authProvider: AUTH_PROVIDERS.LOCAL
  });

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.REGISTER,
    ip: context.ip,
    meta: { role: ROLES.B2C }
  });

  const otpSent = await sendEmailVerification(user, context);
  return { user, otpSent };
};

// `files` is multer's { tradeLicense: [file], businessCard: [file], otherDocuments: [file...] }.
// A trade license is required; a business card is optional. If anything below fails, the error
// middleware deletes the files multer already saved.
const registerB2B = async (data, files = {}, context = {}) => {
  const { name, email, phone, password } = data;

  assertRegistrationOpen(ROLES.B2B);
  if (!files.tradeLicense || files.tradeLicense.length === 0) {
    throw new ApiError(422, 'Trade license document is required.', {
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'tradeLicense', message: 'Trade license document is required.' }]
    });
  }

  await assertEmailAndPhoneFree({ email, phone });
  if (await partnerService.licenseTaken(data.licenseNo)) {
    throw new ApiError(409, 'A business with this license number is already registered.', { code: 'LICENSE_TAKEN' });
  }

  const user = await User.create({
    name,
    email,
    phone,
    passwordHash: await hashPassword(password),
    role: ROLES.B2B,
    status: USER_STATUS.PENDING,
    authProvider: AUTH_PROVIDERS.LOCAL
  });

  let partner;
  try {
    partner = await partnerService.createForUser(user._id, data, files);
    user.partnerId = partner._id;
    await user.save();
  } catch (err) {
    // No transactions on a standalone MongoDB: undo by hand so no half-registered account remains.
    if (partner) await partnerService.discard(partner._id);
    await User.deleteOne({ _id: user._id });
    throw err;
  }

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.REGISTER,
    resource: `partner:${partner._id}`,
    ip: context.ip,
    meta: { role: ROLES.B2B }
  });

  const otpSent = await sendEmailVerification(user, context);
  return { user, partner, otpSent };
};

// ---------------------------------------------------------------- email verification

const verifyEmail = async ({ email, otp }, context = {}) => {
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(400, INVALID_CODE, { code: 'INVALID_CODE' });

  const valid = await otpService.verifyCode(user._id, OTP_PURPOSE.EMAIL_VERIFY, otp);
  if (!valid) throw new ApiError(400, INVALID_CODE, { code: 'INVALID_CODE' });

  user.emailVerified = true;
  // Only a PENDING account is activated. A suspended or blocked account stays that way.
  if (user.status === USER_STATUS.PENDING) user.status = USER_STATUS.ACTIVE;
  await user.save();

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.EMAIL_VERIFIED,
    ip: context.ip
  });

  assertCanLogin(user);
  return { user, session: await startSession(user, context, { via: 'email-otp' }) };
};

// Always succeeds from the caller's point of view, so it cannot be used to find registered emails.
const resendVerificationOtp = async ({ email }, context = {}) => {
  const user = await User.findOne({ email });
  if (!user || user.status !== USER_STATUS.PENDING || user.emailVerified) return;
  if (await otpService.isCoolingDown(user._id, OTP_PURPOSE.EMAIL_VERIFY)) return;

  await sendEmailVerification(user, context);
};

// ---------------------------------------------------------------- login / refresh / logout

const login = async ({ email, password }, context = {}) => {
  const user = await User.findOne({ email }).select('+passwordHash');

  const hash = user && user.passwordHash ? user.passwordHash : await getDummyHash();
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !user.passwordHash || !passwordMatches) {
    if (user) {
      await auditService.record({
        actorUserId: user._id,
        targetUserId: user._id,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        result: 'FAILURE',
        ip: context.ip
      });
    }
    // Same message whether the email exists, has no password, or the password is wrong.
    throw new ApiError(401, INVALID_CREDENTIALS, { code: 'INVALID_CREDENTIALS' });
  }

  assertCanLogin(user);
  return { user, session: await startSession(user, context, { via: 'password' }) };
};

// B2C sign-in with Firebase (Google, phone, email link...). Firebase proves WHO the person is;
// we then issue our own access + refresh tokens, so every request goes through one authenticate step.
const loginWithFirebase = async ({ idToken }, context = {}) => {
  const decoded = await firebaseService.verifyIdToken(idToken);

  // Only the configured sign-in methods (Google by default). Firebase email and password is not one of
  // them: a customer who wants a password registers through this API instead.
  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  if (!env.firebase.allowedProviders.includes(provider)) {
    throw new ApiError(403, 'This sign-in method is not supported. Continue with Google, or register with your email and password.', {
      code: 'FIREBASE_PROVIDER_NOT_ALLOWED'
    });
  }

  const email = decoded.email ? String(decoded.email).toLowerCase() : undefined;
  const emailVerified = Boolean(email && decoded.email_verified);
  const phone = decoded.phone_number || undefined;

  if (!emailVerified && !phone) {
    throw new ApiError(403, 'Verify your email or phone with Firebase before signing in.', {
      code: 'FIREBASE_UNVERIFIED'
    });
  }

  let user = await User.findOne({ firebaseUid: decoded.uid });

  if (!user && emailVerified) {
    const existing = await User.findOne({ email }).select('+passwordHash');

    if (existing) {
      // Firebase may only be linked to a B2C account. Staff, admins and businesses use passwords.
      if (existing.role !== ROLES.B2C) {
        throw new ApiError(409, 'This email belongs to a different account type. Sign in with your password.', {
          code: 'ACCOUNT_TYPE_MISMATCH'
        });
      }

      // Pre-hijack defence: if the email was registered with a password but never verified, whoever
      // registered it does not own the address. Drop that password and every session it created.
      if (!existing.emailVerified) {
        existing.passwordHash = undefined;
        await tokenService.invalidateUserTokens(existing);
      }

      existing.firebaseUid = decoded.uid;
      user = existing;
    }
  }

  if (!user) {
    assertRegistrationOpen(ROLES.B2C); // a first Google sign-in creates a customer, so it follows the same switch
    user = await User.create({
      name: decoded.name || (email ? email.split('@')[0] : 'Traveller'),
      email: emailVerified ? email : undefined,
      phone,
      role: ROLES.B2C,
      status: USER_STATUS.ACTIVE,
      emailVerified,
      phoneVerified: Boolean(phone),
      authProvider: AUTH_PROVIDERS.FIREBASE,
      firebaseUid: decoded.uid
    });
    await auditService.record({
      actorUserId: user._id,
      targetUserId: user._id,
      action: AUDIT_ACTIONS.REGISTER,
      ip: context.ip,
      meta: { role: ROLES.B2C, provider: AUTH_PROVIDERS.FIREBASE }
    });
  } else {
    if (emailVerified) user.emailVerified = true;
    if (user.status === USER_STATUS.PENDING) user.status = USER_STATUS.ACTIVE;
    await user.save();
  }

  assertCanLogin(user);
  return {
    user,
    session: await startSession(user, context, {
      via: 'firebase',
      signInProvider: decoded.firebase && decoded.firebase.sign_in_provider
    })
  };
};

const refresh = (rawRefreshToken, context = {}) => tokenService.rotateRefreshToken(rawRefreshToken, context);

// Revokes the presented refresh session, or every session when allDevices is set.
const logout = async (userId, { refreshToken, allDevices = false } = {}, context = {}) => {
  if (allDevices) {
    const user = await User.findById(userId);
    if (user) await tokenService.invalidateUserTokens(user);
  } else if (refreshToken) {
    await tokenService.revokeSession(refreshToken, userId);
  }

  await auditService.record({
    actorUserId: userId,
    targetUserId: userId,
    action: AUDIT_ACTIONS.LOGOUT,
    ip: context.ip,
    meta: { allDevices }
  });
};

// ---------------------------------------------------------------- passwords

// Sets a new password and kills every older session and token.
const applyNewPassword = async (user, newPassword) => {
  user.passwordHash = await hashPassword(newPassword);
  await tokenService.invalidateUserTokens(user); // saves the user too
};

// Always succeeds from the caller's point of view. Delivery happens in the background so response
// time does not reveal whether the account exists.
const forgotPassword = async ({ email }, context = {}) => {
  const user = await User.findOne({ email, status: USER_STATUS.ACTIVE });
  if (!user) return;
  if (await otpService.isCoolingDown(user._id, OTP_PURPOSE.PASSWORD_RESET)) return;

  const code = await otpService.issueCode(user._id, OTP_PURPOSE.PASSWORD_RESET, context);
  notificationService.trySend(() => notificationService.passwordResetOtp(user, code));
};

// Checks the code without using it up (the client calls reset-password next).
const verifyResetCode = async ({ email, otp }) => {
  const user = await User.findOne({ email, status: USER_STATUS.ACTIVE });
  const valid = user && (await otpService.verifyCode(user._id, OTP_PURPOSE.PASSWORD_RESET, otp, { consume: false }));
  if (!valid) throw new ApiError(400, INVALID_CODE, { code: 'INVALID_CODE' });
};

const resetPassword = async ({ email, otp, newPassword }, context = {}) => {
  const user = await User.findOne({ email, status: USER_STATUS.ACTIVE });
  const valid = user && (await otpService.verifyCode(user._id, OTP_PURPOSE.PASSWORD_RESET, otp));
  if (!valid) throw new ApiError(400, INVALID_CODE, { code: 'INVALID_CODE' });

  await applyNewPassword(user, newPassword);

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    ip: context.ip
  });
  notificationService.trySend(() => notificationService.passwordChanged(user));
};

// Logged-in password change. Other devices are signed out; this device gets a fresh session.
const changePassword = async (userId, { currentPassword, newPassword }, context = {}) => {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new ApiError(404, 'Account not found.');

  if (!user.passwordHash) {
    throw new ApiError(400, 'This account has no password yet. Use "forgot password" to set one.', {
      code: 'NO_PASSWORD_SET'
    });
  }
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError(401, 'Current password is incorrect.', { code: 'WRONG_PASSWORD' });
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new ApiError(400, 'New password must be different from your current password.');
  }

  await applyNewPassword(user, newPassword);

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    ip: context.ip
  });
  if (user.email) notificationService.trySend(() => notificationService.passwordChanged(user));

  return tokenService.issueSession(user, context);
};

// Staff / admin accounts created by an Admin finish here: the invite link carries the token.
const setupAccount = async ({ token, password }, context = {}) => {
  const invite = await otpService.consumeLinkToken(OTP_PURPOSE.STAFF_INVITE, token);
  if (!invite) throw new ApiError(400, 'This invitation link is invalid or has expired.', { code: 'INVALID_INVITE' });

  const user = await User.findById(invite.userId).select('+passwordHash');
  if (!user || user.status !== USER_STATUS.PENDING || user.passwordHash) {
    throw new ApiError(400, 'This invitation link is invalid or has expired.', { code: 'INVALID_INVITE' });
  }

  user.passwordHash = await hashPassword(password);
  user.emailVerified = true; // the invite went to this address, so opening it proves ownership
  user.status = USER_STATUS.ACTIVE;
  await user.save();

  await auditService.record({
    actorUserId: user._id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
    ip: context.ip,
    meta: { via: 'invite' }
  });

  return user;
};

module.exports = {
  registerB2C,
  registerB2B,
  verifyEmail,
  resendVerificationOtp,
  login,
  loginWithFirebase,
  refresh,
  logout,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  changePassword,
  setupAccount,
  hashPassword
};
