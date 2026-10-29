const VisaApplication = require('../models/VisaApplication');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const VisaStatusCode = require('../models/VisaStatusCode');
const VisaStatusConfig = require('../models/VisaStatusConfig');
const { SYSTEM_STATUSES, systemStatus } = require('../config/visa');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { hashValue, safeEqual, generateOtp } = require('../utils/crypto');
const notificationService = require('./notificationService');
const { VISA_FILES } = require('./visaShared');

// The public status check, as the storefront page uses it (nobody is signed in):
//  1. checkLink: is this application number a real link?
//  2. requestCode: number + passport + phone must all match. A code goes to the email on the application.
//  3. verifyCode: number + passport + phone + code. Returns the status in the page's shape.
// Five wrong codes lock the link for 15 minutes. The result never contains money, staff names, internal notes or the
// full passport and phone (they are masked).

const LOCK_SECONDS = 15 * 60;

const NOT_FOUND = () => new ApiError(404, 'We could not find an application matching these details.', { code: 'NOT_FOUND' });
const UNAVAILABLE = () => new ApiError(503, 'Visa status lookup is not available right now.', { code: 'SERVICE_UNAVAILABLE' });

const codeHash = (applicationId, code) => hashValue(`${applicationId}:VISA_STATUS:${code}`);

const refKey = (ref) => String(ref).trim().toUpperCase();
// Capital letters and digits only, the same key the duplicate rule uses.
const passportKey = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
// "+880 1712-345678" and "01712345678" are one number: compare the last ten digits.
const phoneKey = (value) => String(value).replace(/\D/g, '').slice(-10);

// The public page is for visa files only: a ticket, hotel or tour file is never found here.
const findByLink = (ref) => VisaApplication.findOne({ number: refKey(ref), serviceType: VISA_FILES });

// The application, only when the passport and the phone both match.
const findMatch = async ({ ref, passportNo, phone }) => {
  const application = await findByLink(ref);
  if (!application) return null;
  const sameMobile = phoneKey(application.applicant.mobile) === phoneKey(phone) && phoneKey(phone).length >= 7;
  return application.passport.numberKey === passportKey(passportNo) && sameMobile ? application : null;
};

const checkLink = async (ref) => ({ valid: Boolean(await VisaApplication.exists({ number: refKey(ref), serviceType: VISA_FILES })) });

const lockOf = async (applicationId) => {
  const locked = await VisaStatusCode.findOne({ application: applicationId, lockedUntil: { $gt: new Date() } }).select('lockedUntil');
  return locked ? Math.ceil((locked.lockedUntil.getTime() - Date.now()) / 1000) : 0;
};

const assertNotLocked = async (applicationId) => {
  const wait = await lockOf(applicationId);
  if (wait) throw new ApiError(429, 'Too many wrong codes. Please try again later.', { code: 'TOO_MANY_ATTEMPTS', retryAfter: wait });
};

const requestCode = async ({ ref, passportNo, phone }, meta = {}) => {
  const application = await findMatch({ ref, passportNo, phone });
  if (!application) throw NOT_FOUND();
  await assertNotLocked(application._id);

  // There is no SMS provider yet, so the code goes by email. Without an address there is nowhere to send it.
  if (!application.applicant.email) throw UNAVAILABLE();

  const resend = env.otp.resendCooldownSeconds;
  const latest = resend ? await VisaStatusCode.findOne({ application: application._id }).sort({ createdAt: -1 }).select('createdAt') : null;
  const sinceLast = latest ? (Date.now() - latest.createdAt.getTime()) / 1000 : Infinity;
  if (sinceLast < resend) return { resendInSeconds: Math.ceil(resend - sinceLast) };

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
    logger.error({ err }, 'Failed to send a visa status code');
    await VisaStatusCode.deleteMany({ application: application._id, usedAt: null });
    throw UNAVAILABLE();
  }
  return { resendInSeconds: resend };
};

// The counter goes up before the comparison, so parallel guesses cannot beat the limit of 5.
const consumeCode = async (application, code) => {
  const record = await VisaStatusCode.findOneAndUpdate(
    { application: application._id, usedAt: null, lockedUntil: null, attempts: { $lt: env.otp.maxAttempts } },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } }
  );
  if (!record) throw new ApiError(400, 'The code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' });
  if (record.expiresAt <= new Date()) throw new ApiError(400, 'The code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' });

  if (safeEqual(record.tokenHash, codeHash(application._id, code))) {
    const used = await VisaStatusCode.updateOne({ _id: record._id, usedAt: null }, { usedAt: new Date() });
    if (used.modifiedCount === 1) return;
    throw new ApiError(400, 'The code has expired. Ask for a new one.', { code: 'OTP_EXPIRED' });
  }

  if (record.attempts >= env.otp.maxAttempts) {
    const lockedUntil = new Date(Date.now() + LOCK_SECONDS * 1000);
    // The record is kept until the lock ends, so the lock outlives the code.
    await VisaStatusCode.updateOne({ _id: record._id }, { lockedUntil, expiresAt: lockedUntil });
    throw new ApiError(429, 'Too many wrong codes. Please try again later.', { code: 'TOO_MANY_ATTEMPTS', retryAfter: LOCK_SECONDS });
  }
  throw new ApiError(400, 'The code is not correct.', { code: 'INVALID_OTP' });
};

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

// BR1234567 becomes BR****67. +8801712345671 becomes +880*******71.
const mask = (value) => {
  const text = String(value).replace(/\s+/g, '');
  return text.length <= 6 ? '*'.repeat(text.length) : `${text.slice(0, text.startsWith('+') ? 4 : 2)}${'*'.repeat(text.length - (text.startsWith('+') ? 6 : 4))}${text.slice(-2)}`;
};

const entryLabel = (entries) => ({ single: 'Single Entry', double: 'Double Entry', multiple: 'Multiple Entry' }[entries] || entries);

const present = async (application) => {
  const keys = [...new Set([application.status, ...application.statusHistory.map((h) => h.status)])];
  const [configs, country, type] = await Promise.all([
    VisaStatusConfig.find({ key: { $in: keys } }).lean(),
    VisaCountry.findById(application.country).select('code').lean(),
    VisaType.findById(application.visaType).select('processingTime').lean()
  ]);
  const configOf = Object.fromEntries(configs.map((config) => [config.key, config]));

  // The first time the file reached each stage, and the last time it reached a stop (documents required, rejected, ...).
  const events = { submitted: application.createdAt };
  application.statusHistory.forEach(({ status, at }) => {
    const key = publicKey(status, configOf[status]);
    if (STAGES.includes(key)) {
      if (!events[key] || at < events[key]) events[key] = at;
    } else if (!events[key] || at > events[key]) events[key] = at;
  });

  return {
    status: publicKey(application.status, configOf[application.status]),
    applicant: { fullName: application.applicant.fullName, passportNo: mask(application.passport.number), phone: mask(application.applicant.mobile) },
    country: { code: String((country && country.code) || '').toLowerCase(), name: application.countryName },
    visaType: application.visaTypeName,
    entryType: entryLabel(application.service.entries),
    applicationNo: application.number,
    submittedAt: application.createdAt,
    processingTime: (type && type.processingTime) || '',
    events
  };
};

const verifyCode = async ({ ref, passportNo, phone, otp }) => {
  const application = await findMatch({ ref, passportNo, phone });
  if (!application) throw NOT_FOUND();
  await assertNotLocked(application._id);
  await consumeCode(application, otp);
  return present(application);
};

module.exports = { checkLink, requestCode, verifyCode, STAGES, SYSTEM_STATUSES, mask };
