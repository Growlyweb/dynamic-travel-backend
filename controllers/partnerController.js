const path = require('path');

const partnerService = require('../services/partnerService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');
const ApiError = require('../utils/ApiError');
const { PRIVATE_ROOT, isInside } = require('../utils/file');

// ---------- Admin / Staff (read) ----------

// GET /api/admin/b2b   and   GET /api/staff/partners
exports.listPartners = asyncHandler(async (req, res) => {
  const { items, meta } = await partnerService.list(req.query);
  sendResponse(res, 200, true, 'Partners fetched.', items, meta);
});

// GET /api/admin/b2b/:id
exports.getPartner = asyncHandler(async (req, res) => {
  const partner = await partnerService.getById(req.params.id);
  sendResponse(res, 200, true, 'Partner fetched.', partner);
});

// PATCH /api/admin/b2b/:id   (an admin edits an agency's business record)
exports.updatePartner = asyncHandler(async (req, res) => {
  const partner = await partnerService.adminUpdate(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, 'Partner updated.', partner);
});

// PATCH /api/admin/b2b/:id/approval
exports.decide = asyncHandler(async (req, res) => {
  const partner = await partnerService.decide(req.params.id, req.user, req.body, contextOf(req));
  sendResponse(res, 200, true, `Partner status is now ${partner.approvalStatus}.`, partner);
});

// PATCH /api/admin/b2b/:id/documents/:docId   and   PATCH /api/staff/partners/:id/documents/:docId
exports.reviewDocument = asyncHandler(async (req, res) => {
  const documents = await partnerService.reviewDocument(
    req.params.id,
    req.params.docId,
    req.user,
    req.body,
    contextOf(req)
  );
  sendResponse(res, 200, true, 'Document reviewed.', documents);
});

// ---------- B2B owner ----------

// GET /api/b2b/documents
exports.listMyDocuments = asyncHandler(async (req, res) => {
  const partner = await partnerService.getByUserId(req.user.id);
  sendResponse(res, 200, true, 'Documents fetched.', partner.documents);
});

// POST /api/b2b/documents   (multipart: tradeLicense, businessCard, otherDocuments)
exports.addMyDocuments = asyncHandler(async (req, res) => {
  const files = req.files || {};
  if (partnerService.countFiles(files) === 0) {
    throw new ApiError(422, 'Upload at least one document.', { code: 'VALIDATION_ERROR' });
  }

  const partner = await partnerService.addDocuments(req.user.partnerId, files);
  sendResponse(res, 201, true, 'Documents uploaded.', partner.documents);
});

// GET /api/b2b/overview   (approved partners only)
exports.overview = asyncHandler(async (req, res) => {
  const { companyName, approvalStatus } = req.partner;
  sendResponse(res, 200, true, 'Partner overview.', { companyName, approvalStatus });
});

// ---------- Private document download ----------

// GET /api/documents/partners/:partnerId/:docId
// Ownership was already verified by checkOwnership; req.resource is the Partner.
exports.downloadDocument = asyncHandler(async (req, res, next) => {
  const doc = await partnerService.getDocumentFile(req.resource._id, req.params.docId);

  const absolute = path.resolve(PRIVATE_ROOT, doc.storagePath);
  if (!isInside(PRIVATE_ROOT, absolute)) throw new ApiError(404, 'Document not found.');

  res.setHeader('Cache-Control', 'private, no-store');
  // "attachment" so the browser downloads instead of rendering the file in our origin.
  res.download(absolute, doc.originalName, (err) => {
    if (err && !res.headersSent) next(new ApiError(404, 'Document not found.'));
  });
});
