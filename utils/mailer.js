const env = require('../config/env');
const logger = require('./logger');

// One outbound email function. The wording lives in services/notificationService.js.
//
// Variables a template can use (set "To Email" to {{to_email}} or {{email}}):
//   {{to_email}} {{email}}      recipient address
//   {{to_name}}  {{name}}       recipient name
//   {{subject}}  {{title}}      subject line
//   {{message}}                 the full sentence(s) for this email (includes the code, when there is one)
//   {{otp}}      {{passcode}}   the one-time code, empty when the email has none
//   {{time}}                    clock time the code or link stops working, e.g. "12:48 PM GMT+6"
//   {{app_name}}
// If "To Email" is empty EmailJS answers "422 The recipients address is empty".
//
// Templates: EMAILJS_TEMPLATE_ID is used for every email. If EMAILJS_OTP_TEMPLATE_ID is also set, emails
// that carry a code use that one instead, so an OTP-only template and a general one can live together.
//
// Providers (env.mail.provider):
//   emailjs : real delivery through the EmailJS REST API
//   console : prints the email to the server log (development only)
//   memory  : keeps emails in `outbox` so tests can read the OTP

const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const REQUEST_TIMEOUT_MS = 10000;

const outbox = [];

// "12:48 PM GMT+6" in the platform's time zone.
const formatTime = (date) =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: env.timezone,
    timeZoneName: 'short'
  }).format(date);

const buildParams = ({ to, toName = '', subject, message, otp = '', expiresAt }) => ({
  to_email: to,
  to_name: toName,
  subject,
  message,
  otp,
  app_name: env.mail.appName,
  // Aliases, so templates built from EmailJS's defaults or from a code-email layout work unchanged.
  email: to,
  name: toName,
  title: subject,
  passcode: otp,
  time: expiresAt ? formatTime(expiresAt) : ''
});

// The exact body sent to EmailJS (exported so it can be tested without a network call).
const buildEmailJsPayload = (params) => {
  const { serviceId, templateId, publicKey, privateKey } = env.mail.emailjs;
  const useOtpTemplate = Boolean(params.otp && env.mail.otpTemplateId);

  return {
    service_id: serviceId,
    template_id: useOtpTemplate ? env.mail.otpTemplateId : templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: params
  };
};

const sendViaEmailJs = async (params) => {
  const response = await fetch(EMAILJS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify(buildEmailJsPayload(params))
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`EmailJS responded ${response.status}: ${detail}`);
  }
};

// Throws if delivery fails. Callers decide whether that is fatal for the request.
const send = async (email) => {
  const params = buildParams(email);

  switch (env.mail.provider) {
    case 'emailjs':
      return sendViaEmailJs(params);
    case 'memory':
      outbox.push({ ...params, sentAt: new Date() });
      return undefined;
    default:
      // Development fallback so the flow can be tried before EmailJS is configured.
      logger.info(`[mail:console] to=${params.to_email} subject="${params.subject}" otp=${params.otp || '-'}\n${params.message}`);
      return undefined;
  }
};

module.exports = { send, outbox, buildParams, buildEmailJsPayload };
