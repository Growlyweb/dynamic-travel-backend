const applications = require('../services/visaApplicationService');
const statusService = require('../services/visaStatusService');
const payments = require('../services/visaPaymentService');
const documents = require('../services/visaDocumentService');
const passport = require('../services/visaPassportService');
const { presentApplication } = require('../services/visaPresenter');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// Every route answers with the application as the dashboard reads it (services/visaPresenter.js).
const reply = (res, status, message, application) => sendResponse(res, status, true, message, presentApplication(application));

exports.dashboard = asyncHandler(async (req, res) => {
  const data = await applications.dashboard();
  sendResponse(res, 200, true, 'Visa dashboard overview fetched.', { ...data, recent: data.recent.map((item) => presentApplication(item, { list: true })) });
});

exports.staff = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Staff fetched.', await applications.staffLookup(req.query)));

exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await applications.list(req.query);
  sendResponse(res, 200, true, 'Visa applications fetched.', items.map((item) => presentApplication(item, { list: true })), meta);
});

exports.get = asyncHandler(async (req, res) => reply(res, 200, 'Visa application fetched.', await applications.get(req.params.id)));
exports.create = asyncHandler(async (req, res) => reply(res, 201, 'Visa application created.', await applications.create(req.user, req.body, contextOf(req))));
exports.update = asyncHandler(async (req, res) => reply(res, 200, 'Visa application updated.', await applications.update(req.user, req.params.id, req.body, contextOf(req))));
exports.changeStatus = asyncHandler(async (req, res) => {
  await statusService.changeStatus(req.user, req.params.id, req.body, contextOf(req));
  reply(res, 200, 'Status changed.', await applications.get(req.params.id));
});
exports.addNote = asyncHandler(async (req, res) => reply(res, 201, 'Note added.', await applications.addNote(req.user, req.params.id, req.body)));

// ---- payments
exports.addPayment = asyncHandler(async (req, res) => {
  await payments.add(req.user, req.params.id, req.body, contextOf(req));
  reply(res, 201, 'Payment recorded.', await applications.get(req.params.id));
});
exports.voidPayment = asyncHandler(async (req, res) => {
  await payments.voidPayment(req.user, req.params.id, req.params.paymentId, req.body, contextOf(req));
  reply(res, 200, 'Payment voided.', await applications.get(req.params.id));
});

// ---- documents
exports.uploadDocument = asyncHandler(async (req, res) => {
  const { document } = await documents.upload(req.user, req.params.id, req.file, req.body, contextOf(req));
  const { storagePath, ...visible } = document.toJSON();
  sendResponse(res, 201, true, 'Document uploaded.', visible);
});
exports.reviewDocument = asyncHandler(async (req, res) => {
  await documents.review(req.user, req.params.id, req.params.docId, req.body, contextOf(req));
  reply(res, 200, 'Document reviewed.', await applications.get(req.params.id));
});
exports.removeDocument = asyncHandler(async (req, res) => {
  await documents.remove(req.user, req.params.id, req.params.docId, contextOf(req));
  reply(res, 200, 'Document deleted.', await applications.get(req.params.id));
});

// The file is sent only to a signed in user with VISA_VIEW and DOCUMENT_VIEW. It is never rendered as a web page:
// `nosniff` stops the browser from guessing a type, and `sandbox` blocks scripts if one still opens it.
exports.downloadDocument = asyncHandler(async (req, res) => {
  const { document, stream } = await documents.open(req.params.id, req.params.docId);
  res.set({
    'Content-Type': document.mimeType,
    'Content-Length': document.size,
    'Content-Disposition': `inline; filename="${document.originalName.replace(/["\\]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store'
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

// ---- passport
exports.updatePassport = asyncHandler(async (req, res) => {
  await passport.update(req.user, req.params.id, req.body, contextOf(req));
  reply(res, 200, 'Passport updated.', await applications.get(req.params.id));
});
