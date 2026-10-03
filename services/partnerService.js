const path = require('path');

const Partner = require('../models/Partner');
const User = require('../models/User');
const { APPROVAL_STATUS, AUDIT_ACTIONS, DOCUMENT_TYPE } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const { PRIVATE_ROOT } = require('../utils/file');
const auditService = require('./auditService');
const notificationService = require('./notificationService');

const MAX_DOCUMENTS = 10;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The multipart field a file was sent in decides its document type.
const FIELD_TO_TYPE = {
  tradeLicense: DOCUMENT_TYPE.TRADE_LICENSE,
  businessCard: DOCUMENT_TYPE.BUSINESS_CARD,
  otherDocuments: DOCUMENT_TYPE.OTHER
};

// Maps multer's { fieldName: [file] } to Partner.documents entries.
// storagePath is relative to PRIVATE_ROOT.
const toDocuments = (filesByField = {}) =>
  Object.entries(FIELD_TO_TYPE).flatMap(([field, type]) =>
    (filesByField[field] || []).map((file) => ({
      type,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath: path.relative(PRIVATE_ROOT, file.path)
    }))
  );

const countFiles = (filesByField = {}) => Object.values(filesByField).reduce((sum, group) => sum + group.length, 0);

const licenseTaken = async (licenseNo) => Boolean(await Partner.exists({ licenseNo }));

const createForUser = (userId, data, files) =>
  Partner.create({
    userId,
    companyName: data.companyName,
    licenseNo: data.licenseNo,
    businessType: data.businessType || '',
    address: data.address || '',
    documents: toDocuments(files)
  });

const list = async (query) => {
  const { page, limit, skip } = paginate(query);

  const filter = {};
  if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ companyName: pattern }, { licenseNo: pattern }];
  }

  const [items, total] = await Promise.all([
    Partner.find(filter)
      .populate('userId', 'name email phone status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Partner.countDocuments(filter)
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

// Plain lookup (null when missing) for the ownership middleware.
const findById = (id) => Partner.findById(id);

const getById = async (id) => {
  const partner = await Partner.findById(id).populate('userId', 'name email phone status');
  if (!partner) throw new ApiError(404, 'Partner not found.');
  return partner;
};

// Admin review. Approval opens operational access; it never touches User.status.
const decide = async (partnerId, admin, { decision, note = '' }, context = {}) => {
  const partner = await Partner.findById(partnerId);
  if (!partner) throw new ApiError(404, 'Partner not found.');

  if (
    decision === APPROVAL_STATUS.APPROVED &&
    !partner.documents.some((doc) => doc.type === DOCUMENT_TYPE.TRADE_LICENSE)
  ) {
    throw new ApiError(409, 'A partner cannot be approved without a trade license document.', {
      code: 'TRADE_LICENSE_MISSING'
    });
  }

  const previous = partner.approvalStatus;
  partner.approvalStatus = decision;
  partner.reviewedBy = admin.id;
  partner.reviewedAt = new Date();
  partner.reviewNote = note;
  await partner.save();

  let action = AUDIT_ACTIONS.B2B_STATUS_CHANGED;
  if (decision === APPROVAL_STATUS.APPROVED) action = AUDIT_ACTIONS.B2B_APPROVED;
  if (decision === APPROVAL_STATUS.REJECTED) action = AUDIT_ACTIONS.B2B_REJECTED;

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: partner.userId,
    action,
    resource: `partner:${partner._id}`,
    ip: context.ip,
    meta: { from: previous, to: decision }
  });

  const owner = await User.findById(partner.userId);
  if (owner && owner.email) {
    await notificationService.trySend(() => notificationService.partnerDecision(owner, partner, decision, note));
  }

  return partner;
};

// ADMIN editing an agency's business record (company name, license number, business type, address).
// The owner can only change the last two; an admin, as the reviewer, may change all four. Logged with
// the field names only.
const adminUpdate = async (admin, partnerId, data, context = {}) => {
  const partner = await Partner.findById(partnerId);
  if (!partner) throw new ApiError(404, 'Partner not found.');

  const fields = ['companyName', 'licenseNo', 'businessType', 'address'].filter((field) => data[field] !== undefined);
  fields.forEach((field) => {
    partner[field] = data[field];
  });
  await partner.save(); // a duplicate license number is rejected by the unique index (409)

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: partner.userId,
    action: AUDIT_ACTIONS.PROFILE_UPDATED,
    resource: `partner:${partner._id}`,
    ip: context.ip,
    meta: { fields }
  });

  return partner;
};

// Marks one uploaded document VERIFIED or REJECTED. Used by admins and by staff holding DOCUMENT_VERIFY.
// This is separate from approving the partner: the partner decision is still an admin's call.
const reviewDocument = async (partnerId, docId, actor, { status, note = '' }, context = {}) => {
  const partner = await Partner.findById(partnerId);
  const doc = partner && partner.documents.id(docId);
  if (!doc) throw new ApiError(404, 'Document not found.');

  const previous = doc.status;
  doc.status = status;
  doc.reviewedBy = actor.id;
  doc.reviewedAt = new Date();
  doc.reviewNote = note;
  await partner.save();

  await auditService.record({
    actorUserId: actor.id,
    targetUserId: partner.userId,
    action: AUDIT_ACTIONS.DOCUMENT_REVIEWED,
    resource: `partner:${partner._id}:document:${doc._id}`,
    ip: context.ip,
    meta: { type: doc.type, from: previous, to: status }
  });

  return partner.documents;
};

// B2B owners can add documents while their application is open or after a rejection.
// Once approved (or suspended) the file set is frozen: a change would need a fresh review.
const EDITABLE_STATES = [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.UNDER_REVIEW, APPROVAL_STATUS.REJECTED];

const addDocuments = async (partnerId, files) => {
  const partner = await Partner.findById(partnerId);
  if (!partner) throw new ApiError(404, 'Partner not found.');

  if (!EDITABLE_STATES.includes(partner.approvalStatus)) {
    throw new ApiError(409, 'Documents cannot be changed after approval. Contact support.', {
      code: 'DOCUMENTS_LOCKED'
    });
  }

  if (partner.documents.length + countFiles(files) > MAX_DOCUMENTS) {
    throw new ApiError(409, `A partner can have at most ${MAX_DOCUMENTS} documents.`);
  }

  partner.documents.push(...toDocuments(files));
  await partner.save();
  return partner;
};

// Loads one document INCLUDING its private storage path. Callers must have passed ownership checks.
const getDocumentFile = async (partnerId, docId) => {
  const partner = await Partner.findById(partnerId).select('+documents.storagePath');
  const doc = partner && partner.documents.id(docId);
  if (!doc) throw new ApiError(404, 'Document not found.');
  return doc;
};

const getByUserId = async (userId) => {
  const partner = await Partner.findOne({ userId });
  if (!partner) throw new ApiError(404, 'Partner profile not found.');
  return partner;
};

const updateContact = async (userId, { address, businessType }) => {
  const partner = await getByUserId(userId);
  if (address !== undefined) partner.address = address;
  if (businessType !== undefined) partner.businessType = businessType;
  await partner.save();
  return partner;
};

// Used when a registration fails half way. The uploaded files are removed by the error middleware.
const discard = (partnerId) => Partner.deleteOne({ _id: partnerId });

module.exports = {
  licenseTaken,
  createForUser,
  countFiles,
  list,
  findById,
  getById,
  decide,
  adminUpdate,
  reviewDocument,
  addDocuments,
  getDocumentFile,
  getByUserId,
  updateContact,
  discard
};
