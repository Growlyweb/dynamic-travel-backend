// PLACEHOLDER: phone OTP delivery is undecided (see documentation/ToDo.md).
//
// Email OTPs go through utils/mailer.js (EmailJS). For phone there are two options:
//   1. Firebase Phone Auth for B2C: the client verifies the number with Firebase and
//      POST /api/auth/firebase marks phoneVerified. No server-side SMS needed.
//   2. A server-side SMS gateway (Twilio or a local BD provider): implement `send` below
//      and add verify-phone / resend-phone-otp routes on top of services/otpService.js.
//
// Until a provider is chosen this throws, so nothing silently pretends to send an SMS.
const send = async () => {
  throw new Error('SMS provider is not configured. See utils/sms.js and documentation/ToDo.md.');
};

module.exports = { send };
