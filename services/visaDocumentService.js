const VisaChecklist = require('../models/VisaChecklist');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const settingService = require('./settingService');
const storageService = require('./storageService');
const { findApplication, actorOf, addTimeline } = require('./visaShared');

const audit = (user, action, application, context, meta) =>
  auditService.record({ actorUserId: user.id, action, resource: `visa-application:${application._id}`, ip: context.ip, meta });

// The checklist line a file is uploaded for, when the caller names one. It can lower the size limit for that line.
const checklistItemOf = async (application, checklistItemId) => {
  if (!checklistItemId) return null;
  const checklist = await VisaChecklist.findOne({ country: application.country, visaType: application.visaType, applicantType: application.applicant.applicantType });
  const item = checklist && checklist.items.id(checklistItemId);
  if (!item) throw new ApiError(422, 'This checklist item does not exist for the application.', { code: 'CHECKLIST_ITEM_NOT_FOUND' });
  return item;
};

// Stores an uploaded file on the application. The limits come from the settings (10 MB, PDF/JPG/PNG/WEBP, 5 files per
// item by default), and the real file type is checked from the file's own bytes.
const upload = async (user, id, file, { type, checklistItemId }, context = {}) => {
  const application = await findApplication(id);
  const limits = await settingService.get('visa.documents');
  const item = await checklistItemOf(application, checklistItemId);

  const same = application.documents.filter((document) => document.type.toLowerCase() === type.toLowerCase() && document.status !== 'rejected');
  if (same.length >= limits.maxFilesPerItem) {
    throw new ApiError(409, `At most ${limits.maxFilesPerItem} files can be kept for "${type}". Delete one first.`, { code: 'TOO_MANY_FILES' });
  }

  const saved = await storageService.saveUpload(`visa/${application._id}`, file, {
    maxSizeMb: item ? Math.min(limits.maxSizeMb, item.maxSizeMb) : limits.maxSizeMb,
    allowedTypes: limits.allowedTypes
  });

  const actor = await actorOf(user);
  try {
    application.documents.push({ type, checklistItem: item ? item._id : undefined, ...saved, uploadedBy: actor.id, uploadedByName: actor.name });
    addTimeline(application, { event: 'Document Uploaded', message: `${type}: ${saved.originalName}`, visibility: 'both', actor });
    await application.save();
  } catch (err) {
    await storageService.remove(saved.storagePath);
    throw err;
  }

  await audit(user, AUDIT_ACTIONS.VISA_DOCUMENT_UPLOADED, application, context, { type });
  return { application, document: application.documents[application.documents.length - 1] };
};

const documentOf = (application, docId) => {
  const document = application.documents.id(docId);
  if (!document) throw new ApiError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' });
  return document;
};

// The file itself. Only the controller behind VISA_VIEW and DOCUMENT_VIEW calls this.
const open = async (id, docId) => {
  const application = await findApplication(id);
  const document = documentOf(application, docId);
  if (!(await storageService.exists(document.storagePath))) throw new ApiError(404, 'The file is no longer stored.', { code: 'FILE_MISSING' });
  return { document, stream: storageService.stream(document.storagePath) };
};

// Verify, reject (the note is for the applicant) or put back to pending.
const review = async (user, id, docId, { status, reviewNote }, context = {}) => {
  const application = await findApplication(id);
  const document = documentOf(application, docId);
  const actor = await actorOf(user);

  document.status = status;
  document.reviewNote = reviewNote || '';
  document.reviewedBy = actor.id;
  document.reviewedAt = new Date();

  if (status !== 'pending') {
    const label = status === 'verified' ? 'Document Verified' : 'Document Rejected';
    addTimeline(application, { event: label, message: `${document.type}${reviewNote ? `: ${reviewNote}` : ''}`, visibility: 'both', actor });
  }
  await application.save();
  await audit(user, AUDIT_ACTIONS.VISA_DOCUMENT_REVIEWED, application, context, { documentId: String(document._id), status });
  return { application, document };
};

const remove = async (user, id, docId, context = {}) => {
  const application = await findApplication(id);
  const document = documentOf(application, docId);
  const actor = await actorOf(user);
  const { storagePath, type, originalName } = document;

  application.documents.pull(document._id);
  addTimeline(application, { event: 'Document Deleted', message: `${type}: ${originalName}`, visibility: 'internal', actor });
  await application.save();
  await storageService.remove(storagePath);
  await audit(user, AUDIT_ACTIONS.VISA_DOCUMENT_DELETED, application, context, { type });
  return application;
};

module.exports = { upload, open, review, remove };
