const jwt = require('jsonwebtoken');
const env = require('../config/env');
const VisaApplication = require('../models/VisaApplication');
const VisaStatusCode = require('../models/VisaStatusCode');
const VisaStatusConfig = require('../models/VisaStatusConfig');
const { SYSTEM_STATUSES, systemStatus } = require('../config/visa');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { hashValue, safeEqual, generateOtp } = require('../utils/crypto');
const notificationService = require('./notificationService');

// The public status check. Nobody is signed in, so the proof is a code sent to the email address on the application.
//  1. requestCode: reference + email. The answer is always the same, so nobody can find out which numbers exist.
//  2. verifyCode:  reference + email + code. Returns the status and a short token for refreshing it.
//  3. getStatus:   reference + token. The same status again, without a new code.
// The view never contains money, staff names, internal notes, contact data or passport numbers.

const TOKEN_MINUTES = 15;
const AUDIENCE = 'visa-status';
const GENERIC_SENT = 'If the details match an application, a code has been sent to its email address.';
// The same answer whether or not the application exists, so nothing here tells an outsider which numbers are real.
const sentAnswer = () => ({ sent: true, message: GENERIC_SENT, resendInSeconds: env.otp.resendCooldownSeconds });
const BAD_CODE = () => new ApiError(400, 'The code is invalid or has expired.', { code: 'INVALID_CODE' });

const codeHash = (applicationId, code) => hashValue(`${applicationId}:VISA_STATUS:${code}`);

// The reference is the application number. Case and spaces do not matter, the email is compared in lower case.
const findApplication = ({ reference, email }) =>
  VisaApplication.findOne({ number: String(reference).trim().toUpperCase(), 'applicant.email': String(email).trim().toLowerCase() });

const isCoolingDown = async (applicationId) => {
  if (!env.otp.resendCooldownSeconds) return false;
  const latest = await VisaStatusCode.findOne({ application: applicationId }).sort({ createdAt: -1 }).select('createdAt');
  return Boolean(latest && Date.now() - latest.createdAt.getTime() < env.otp.resendCooldownSeconds * 1000);
};

const requestCode = async ({ reference, email }, meta = {}) => {
  const application = await findApplication({ reference, email });
  if (!application || !application.applicant.email || (await isCoolingDown(application._id))) return sentAnswer();

  const code = generateOtp();
  await VisaStatusCode.deleteMany({ application: application._id, usedAt: null });
  await VisaStatusCode.create({
    application: application._id,
    tokenHash: codeHash(application._id, code),
    expiresAt: new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000),
    requestMeta: meta
  });

  try {
    await notificationService.visaStatusCode({ email: application.applicant.email, name: application.applicant.fullName }, code);
  } catch (err) {
    // The answer stays the same: the person must not learn whether the number exists or whether mail failed.
    logger.error({ err }, 'Failed to send a visa status code');
  }
  return sentAnswer();
};

// The counter goes up before the comparison, so parallel guesses cannot beat the limit of 5.
const consumeCode = async (application, code) => {
  const record = await VisaStatusCode.findOneAndUpdate(
    { application: application._id, usedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: env.otp.maxAttempts } },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } }
  );
  if (!record || !safeEqual(record.tokenHash, codeHash(application._id, code))) return false;
  const used = await VisaStatusCode.updateOne({ _id: record._id, usedAt: null }, { usedAt: new Date() });
  return used.modifiedCount === 1;
};

const signToken = (application) =>
  jwt.sign({ sub: String(application._id), ref: application.number }, env.jwt.accessSecret, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    expiresIn: `${TOKEN_MINUTES}m`
  });

// ------------------------------------------------------------------ the view

// The five stages of the storefront page, plus the stops that replace one of them.
const STAGES = ['submitted', 'processing', 'approved', 'ready', 'collected'];

const KEY_BY_CATEGORY = { in_progress: 'processing', action_required: 'docs_required', success: 'approved', failed: 'rejected', cancelled: 'cancelled' };

// A system status maps through config/visaStatuses.json. A status staff added maps through its category.
const publicKey = (status, config) => {
  if (status === 'action_required') return 'docs_required';
  const system = systemStatus(status);
  if (system) return system.publicStage;
  return KEY_BY_CATEGORY[config ? config.category : 'in_progress'];
};

const present = async (application) => {
  const configs = await VisaStatusConfig.find({ key: { $in: [...new Set([application.status, ...application.statusHistory.map((h) => h.status)])] } }).lean();
  const configOf = Object.fromEntries(configs.map((config) => [config.key, config]));
  const nameOf = (key) => (configOf[key] ? configOf[key].displayName : (systemStatus(key) || {}).displayName || key);
  const messageOf = (key) => (configOf[key] ? configOf[key].customerMessage : (systemStatus(key) || {}).customerMessage) || '';

  // The first time the file reached each stage.
  const events = { submitted: application.createdAt };
  application.statusHistory.forEach(({ status, at }) => {
    const key = publicKey(status, configOf[status]);
    if (STAGES.includes(key) && (!events[key] || at < events[key])) events[key] = at;
  });

  const key = publicKey(application.status, configOf[application.status]);
  const timeline = application.timeline
    .filter((entry) => entry.visibility === 'both' || entry.visibility === 'customer')
    .sort((a, b) => b.at - a.at)
    .map(({ at, event, message }) => ({ at, event, message }));

  return {
    applicationNo: application.number,
    status: key,
    statusLabel: nameOf(application.status),
    message: messageOf(application.status),
    applicant: { fullName: application.applicant.fullName },
    country: { name: application.countryName },
    visaType: application.visaTypeName,
    entryType: application.service.entries,
    submittedAt: application.createdAt,
    events,
    stages: STAGES,
    actionRequired: application.actionRequired ? { message: application.actionRequired.message, requestedAt: application.actionRequired.requestedAt } : null,
    rejectionReason: application.status === 'rejected' && application.rejection ? application.rejection.customerReason : null,
    documents: application.documents.map(({ type, status, reviewNote }) => ({ type, status, reviewNote: status === 'rejected' ? reviewNote : '' })),
    passport: application.passportRequirement === 'physical_required' ? { submissionMethod: application.passportSubmissionMethod, status: application.passportStatus } : null,
    timeline
  };
};

const verifyCode = async ({ reference, email, code }) => {
  const application = await findApplication({ reference, email });
  if (!application || !(await consumeCode(application, code))) throw BAD_CODE();
  return { ...(await present(application)), accessToken: signToken(application), expiresInSeconds: TOKEN_MINUTES * 60 };
};

const getStatus = async (reference, token) => {
  let payload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret, { algorithms: ['HS256'], audience: AUDIENCE });
  } catch {
    throw new ApiError(401, 'Your session has expired. Ask for a new code.', { code: 'TOKEN_INVALID' });
  }
  // The token opens that one application only.
  if (payload.ref !== String(reference).trim().toUpperCase()) throw new ApiError(401, 'Your session has expired. Ask for a new code.', { code: 'TOKEN_INVALID' });
  const application = await VisaApplication.findById(payload.sub);
  if (!application) throw new ApiError(401, 'Your session has expired. Ask for a new code.', { code: 'TOKEN_INVALID' });
  return present(application);
};

module.exports = { requestCode, verifyCode, getStatus, STAGES, SYSTEM_STATUSES };
