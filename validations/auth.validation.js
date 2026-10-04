const { z } = require('zod');
const { email, phone, name, password, otp } = require('./common');

// B2C self-registration. There is deliberately NO role field: the service sets it.
const registerB2C = z.object({
  name,
  email,
  phone: phone.optional(),
  password
});

// B2B registration is multipart/form-data (documents are files), so every value arrives as text.
const registerB2B = z.object({
  name,
  email,
  phone,
  password,
  companyName: z.string('Company name is required.').trim().min(2).max(150),
  licenseNo: z.string('License number is required.').trim().min(2).max(60),
  businessType: z.string().trim().max(80).optional(),
  address: z.string('Address is required.').trim().min(5, 'Address must be at least 5 characters.').max(300)
});

const verifyOtp = z.object({ email, otp });
const resendOtp = z.object({ email });

// Login accepts any non-empty password so a wrong one always fails the same way.
const login = z.object({
  email,
  password: z.string('Password is required.').min(1, 'Password is required.').max(200)
});

const firebaseLogin = z.object({
  idToken: z.string('idToken is required.').min(20, 'idToken is invalid.').max(8192)
});

// Refresh token may also arrive as an httpOnly cookie, so the body field is optional.
const refresh = z.object({ refreshToken: z.string().max(2048).optional() });
const logout = z.object({
  refreshToken: z.string().max(2048).optional(),
  allDevices: z.boolean().optional()
});

const forgotPassword = z.object({ email });
const verifyResetToken = z.object({ email, otp });
const resetPassword = z.object({ email, otp, newPassword: password });

const changePassword = z.object({
  currentPassword: z.string('Current password is required.').min(1).max(200),
  newPassword: password
});

const setupAccount = z.object({
  token: z.string('Token is required.').trim().min(20).max(200),
  password
});

module.exports = {
  registerB2C,
  registerB2B,
  verifyOtp,
  resendOtp,
  login,
  firebaseLogin,
  refresh,
  logout,
  forgotPassword,
  verifyResetToken,
  resetPassword,
  changePassword,
  setupAccount
};
