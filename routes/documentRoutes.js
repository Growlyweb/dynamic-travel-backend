const express = require('express');
const router = express.Router();

const partnerController = require('../controllers/partnerController');
const documentVaultController = require('../controllers/documentVaultController');
const partnerService = require('../services/partnerService');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const { checkOwnership } = require('../middleware/ownershipMiddleware');
const validate = require('../middleware/validationMiddleware');
const { documentParam } = require('../validations/partner.validation');
const { listDocuments, updateDocumentStatus, idParam } = require('../validations/document.validation');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/documents. All routes require valid auth.
router.use(authenticate);

// Global Document Vault (Internal Admin/Staff)
router.get(
  '/',
  requirePermission(PERMISSIONS.DOCUMENTS_VIEW),
  validate({ query: listDocuments }),
  documentVaultController.listDocuments
);

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.DOCUMENT_VERIFY),
  validate({ params: idParam, body: updateDocumentStatus }),
  documentVaultController.updateStatus
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENT_VERIFY),
  validate({ params: idParam, body: updateDocumentStatus }),
  documentVaultController.updateStatus
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENTS_MANAGE),
  validate({ params: idParam }),
  documentVaultController.deleteDocument
);

// Specific partner document download stream
router.get(
  '/partners/:partnerId/:docId',
  validate({ params: documentParam }),
  checkOwnership({
    load: (req) => partnerService.findById(req.params.partnerId),
    isOwner: (partner, user) => user.role === ROLES.B2B && String(partner._id) === user.partnerId,
    staffPermission: PERMISSIONS.DOCUMENT_VIEW
  }),
  partnerController.downloadDocument
);

module.exports = router;
