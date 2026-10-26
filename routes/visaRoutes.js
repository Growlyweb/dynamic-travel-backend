const express = require('express');
const router = express.Router();

const catalog = require('../controllers/visaCatalogController');
const applicationController = require('../controllers/visaApplicationController');
const publicController = require('../controllers/visaPublicController');
const publicSchemas = require('../validations/visaPublic.validation');
const { visaStatusCodeLimiter, visaStatusVerifyLimiter } = require('../middleware/rateLimitMiddleware');
const messageController = require('../controllers/visaMessageController');
const quotationController = require('../controllers/visaQuotationController');
const memoryUpload = require('../middleware/memoryUploadMiddleware');
const appSchemas = require('../validations/visaApplication.validation');
const messageSchemas = require('../validations/visaMessage.validation');
const quotationSchemas = require('../validations/visaQuotation.validation');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/visaCatalog.validation');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/visa. Internal users only. An admin always passes; staff need the permission an admin gave them:
// VISA_VIEW to read, VISA_EDIT to change countries, visa types, checklists and statuses.
// ---------------------------------------------------------------- public status check (no login)
// The applicant proves they own the application with a code sent to the email address on it. See services/visaPublicService.js.
router.post('/public/status/code', visaStatusCodeLimiter, validate({ body: publicSchemas.requestCode }), publicController.requestCode);
router.post('/public/status/verify', visaStatusVerifyLimiter, validate({ body: publicSchemas.verifyCode }), publicController.verifyCode);
router.get('/public/status/:reference', validate({ params: publicSchemas.statusParam }), publicController.getStatus);

router.use(authenticate);

const view = requirePermission(PERMISSIONS.VISA_VIEW);
const edit = requirePermission(PERMISSIONS.VISA_EDIT);

// Countries
router.get('/countries', view, validate({ query: schemas.listCountries }), catalog.listCountries);
router.post('/countries', edit, validate({ body: schemas.createCountry }), catalog.createCountry);
router.get('/countries/:id', view, validate({ params: schemas.idParam }), catalog.getCountry);
router.patch('/countries/:id', edit, validate({ params: schemas.idParam, body: schemas.updateCountry }), catalog.updateCountry);
router.delete('/countries/:id', edit, validate({ params: schemas.idParam }), catalog.removeCountry);

// Visa types
router.get('/types', view, validate({ query: schemas.listTypes }), catalog.listTypes);
router.post('/types', edit, validate({ body: schemas.createType }), catalog.createType);
router.get('/types/:id', view, validate({ params: schemas.idParam }), catalog.getType);
router.patch('/types/:id', edit, validate({ params: schemas.idParam, body: schemas.updateType }), catalog.updateType);
router.delete('/types/:id', edit, validate({ params: schemas.idParam }), catalog.removeType);

// Checklists
router.get('/checklists/:countryId/:visaTypeId/:applicantType', view, validate({ params: schemas.checklistParam }), catalog.getChecklist);
router.put('/checklists/:countryId/:visaTypeId/:applicantType', edit, validate({ params: schemas.checklistParam, body: schemas.saveChecklist }), catalog.saveChecklist);

// Statuses
router.get('/statuses', view, validate({ query: schemas.listStatuses }), catalog.listStatuses);
router.post('/statuses', edit, validate({ body: schemas.createStatus }), catalog.createStatus);
router.patch('/statuses/:id', edit, validate({ params: schemas.idParam, body: schemas.updateStatus }), catalog.updateStatus);
router.delete('/statuses/:id', edit, validate({ params: schemas.idParam }), catalog.removeStatus);

// ---------------------------------------------------------------- applications
// Reading needs VISA_VIEW. Creating, editing, notes, payments and documents need VISA_EDIT. A status change needs
// VISA_UPDATE (checked again inside the status service, which owns the rule). Voiding a payment needs VISA_PAYMENT_VOID.
const update = requirePermission(PERMISSIONS.VISA_UPDATE);

router.get('/dashboard', view, applicationController.dashboard);
router.get('/staff', view, validate({ query: appSchemas.staffLookup }), applicationController.staff);

router.get('/applications', view, validate({ query: appSchemas.listApplications }), applicationController.list);
router.post('/applications', edit, validate({ body: appSchemas.createApplication }), applicationController.create);
router.get('/applications/:id', view, validate({ params: appSchemas.idParam }), applicationController.get);
router.patch('/applications/:id', edit, validate({ params: appSchemas.idParam, body: appSchemas.updateApplication }), applicationController.update);
router.patch('/applications/:id/status', update, validate({ params: appSchemas.idParam, body: appSchemas.changeStatus }), applicationController.changeStatus);
router.post('/applications/:id/notes', edit, validate({ params: appSchemas.idParam, body: appSchemas.addNote }), applicationController.addNote);

// Payments are typed in by hand; the server recalculates the totals.
router.post('/applications/:id/payments', edit, validate({ params: appSchemas.idParam, body: appSchemas.addPayment }), applicationController.addPayment);
router.post(
  '/applications/:id/payments/:paymentId/void',
  requirePermission(PERMISSIONS.VISA_PAYMENT_VOID),
  validate({ params: appSchemas.paymentParam, body: appSchemas.voidPayment }),
  applicationController.voidPayment
);

// Documents. The multipart body is read first so `validate` can see the text fields.
router.post(
  '/applications/:id/documents',
  edit,
  validate({ params: appSchemas.idParam }),
  memoryUpload.single('file'),
  validate({ body: appSchemas.uploadDocument }),
  applicationController.uploadDocument
);
router.get(
  '/applications/:id/documents/:docId/file',
  view,
  requirePermission(PERMISSIONS.DOCUMENT_VIEW),
  validate({ params: appSchemas.documentParam }),
  applicationController.downloadDocument
);
router.patch(
  '/applications/:id/documents/:docId',
  requirePermission(PERMISSIONS.DOCUMENT_VERIFY),
  validate({ params: appSchemas.documentParam, body: appSchemas.reviewDocument }),
  applicationController.reviewDocument
);
router.delete('/applications/:id/documents/:docId', edit, validate({ params: appSchemas.documentParam }), applicationController.removeDocument);

// Passport handling (pickup, office, status)
router.patch(
  '/applications/:id/passport',
  requirePermission(PERMISSIONS.PASSPORT_UPDATE),
  validate({ params: appSchemas.idParam, body: appSchemas.updatePassport }),
  applicationController.updatePassport
);

// ---------------------------------------------------------------- messages
// Email templates send automatically when an application reaches their status. SMS templates prepare a message that
// staff send by hand and then mark as sent (there is no SMS provider yet). Every message is kept in the log.
router.get('/templates', view, validate({ query: messageSchemas.listTemplates }), messageController.listTemplates);
router.post('/templates', edit, validate({ body: messageSchemas.createTemplate }), messageController.createTemplate);
router.patch('/templates/:id', edit, validate({ params: messageSchemas.idParam, body: messageSchemas.updateTemplate }), messageController.updateTemplate);
router.delete('/templates/:id', edit, validate({ params: messageSchemas.idParam }), messageController.removeTemplate);

router.get('/messages', view, validate({ query: messageSchemas.listMessages }), messageController.listMessages);
router.patch('/messages/:id', edit, validate({ params: messageSchemas.idParam, body: messageSchemas.markMessage }), messageController.mark);
router.post('/messages/:id/send', edit, validate({ params: messageSchemas.idParam }), messageController.resend);
router.post('/applications/:id/messages', edit, validate({ params: appSchemas.idParam, body: messageSchemas.sendMessage }), messageController.send);

// ---------------------------------------------------------------- quotations
// Price quotes for B2B partners. The server copies the net price from the visa type and calculates the total.
router.get('/partners', view, validate({ query: quotationSchemas.partnerLookup }), quotationController.partners);
router.get('/quotations', view, validate({ query: quotationSchemas.listQuotations }), quotationController.list);
router.post('/quotations', edit, validate({ body: quotationSchemas.createQuotation }), quotationController.create);
router.get('/quotations/:id', view, validate({ params: quotationSchemas.idParam }), quotationController.get);
router.patch('/quotations/:id', edit, validate({ params: quotationSchemas.idParam, body: quotationSchemas.updateQuotation }), quotationController.update);
router.patch('/quotations/:id/status', edit, validate({ params: quotationSchemas.idParam, body: quotationSchemas.changeStatus }), quotationController.changeStatus);
router.delete('/quotations/:id', edit, validate({ params: quotationSchemas.idParam }), quotationController.remove);

module.exports = router;
