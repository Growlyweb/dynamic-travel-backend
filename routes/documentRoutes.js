const express = require('express');
const router = express.Router();

const partnerController = require('../controllers/partnerController');
const partnerService = require('../services/partnerService');
const { authenticate } = require('../middleware/authMiddleware');
const { checkOwnership } = require('../middleware/ownershipMiddleware');
const validate = require('../middleware/validationMiddleware');
const { documentParam } = require('../validations/partner.validation');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/documents. Business documents are NOT served from a public folder:
// the file is streamed only after the caller proves they may see it.
//
//   ADMIN                         : any partner's documents
//   STAFF with DOCUMENT_VIEW      : any partner's documents
//   B2B                           : only their own partner's documents
//   everyone else / other partner : 404 (same as "does not exist")

router.get(
  '/partners/:partnerId/:docId',
  authenticate,
  validate({ params: documentParam }),
  checkOwnership({
    load: (req) => partnerService.findById(req.params.partnerId),
    isOwner: (partner, user) => user.role === ROLES.B2B && String(partner._id) === user.partnerId,
    staffPermission: PERMISSIONS.DOCUMENT_VIEW
  }),
  partnerController.downloadDocument
);

module.exports = router;
