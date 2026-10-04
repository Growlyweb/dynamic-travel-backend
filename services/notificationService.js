const env = require('../config/env');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');

// All outbound wording lives here. Each function builds a message and hands it to utils/mailer.js
// (one EmailJS template renders every kind). Never put passwords or tokens in a log line.

const otpExpiry = () => new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000);

const verificationOtp = (user, code) =>
  mailer.send({
    to: user.email,
    toName: user.name,
    subject: 'Verify your email',
    otp: code,
    expiresAt: otpExpiry(),
    message: `Your verification code is ${code}. It expires in ${env.otp.expiresMinutes} minutes. If you did not create an account, ignore this email.`
  });

const passwordResetOtp = (user, code) =>
  mailer.send({
    to: user.email,
    toName: user.name,
    subject: 'Reset your password',
    otp: code,
    expiresAt: otpExpiry(),
    message: `Your password reset code is ${code}. It expires in ${env.otp.expiresMinutes} minutes. If you did not request this, you can ignore this email and your password will stay the same.`
  });

const staffInvite = (user, token) => {
  const link = `${env.appUrl}/setup-account?token=${token}`;
  return mailer.send({
    to: user.email,
    toName: user.name,
    subject: `You have been invited to ${env.mail.appName}`,
    expiresAt: new Date(Date.now() + env.staffInviteExpiresHours * 60 * 60 * 1000),
    message: `An administrator created an account for you. Set your password here: ${link} . The link expires in ${env.staffInviteExpiresHours} hours and works once.`
  });
};

const passwordChanged = (user) =>
  mailer.send({
    to: user.email,
    toName: user.name,
    subject: 'Your password was changed',
    message: 'Your password was just changed and you were signed out of your other devices. If this was not you, reset your password immediately and contact support.'
  });

const partnerDecision = (user, partner, decision, note) =>
  mailer.send({
    to: user.email,
    toName: user.name,
    subject: `Your business account is ${decision.toLowerCase().replace('_', ' ')}`,
    message: `The review of ${partner.companyName} is now: ${decision}.${note ? ` Note from the reviewer: ${note}` : ''}`
  });

// For notifications that must not fail the request that triggered them.
// Returns true when sent, false (and logs) when delivery failed.
const trySend = async (sendFn) => {
  try {
    await sendFn();
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to send email');
    return false;
  }
};

module.exports = { verificationOtp, passwordResetOtp, staffInvite, passwordChanged, partnerDecision, trySend };
