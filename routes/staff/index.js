const express = require('express');
const router = express.Router();

const profileController = require('../../controllers/profileController');
const partnerController = require('../../controllers/partnerController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../../middleware/authorizeMiddleware');
const validate = require('../../middleware/validationMiddleware');
const { updateProfile } = require('../../validations/profile.validation');
const { listPartners, reviewDocument, reviewParam } = require('../../validations/partner.validation');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');

// Mounted at /api/staff. STAFF only, and each feature needs the matching permission
// that an admin assigned. Staff get nothing by default.
router.use(authenticate, requireRole(ROLES.STAFF));

router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: updateProfile }), profileController.updateProfile);

// Read-only partner list. Pattern to copy for the real staff features:
//   router.get('/assigned-records', requirePermission(PERMISSIONS.VISA_VIEW), ...)
router.get(
  '/partners',
  requirePermission(PERMISSIONS.B2B_VIEW),
  validate({ query: listPartners }),
  partnerController.listPartners
);

// Verify or reject a partner's uploaded document
router.patch(
  '/partners/:id/documents/:docId',
  requirePermission(PERMISSIONS.DOCUMENT_VERIFY),
  validate({ params: reviewParam, body: reviewDocument }),
  partnerController.reviewDocument
);

module.exports = router;
