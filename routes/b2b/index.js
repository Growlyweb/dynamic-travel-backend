const express = require('express');
const router = express.Router();

const profileController = require('../../controllers/profileController');
const partnerController = require('../../controllers/partnerController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authorizeMiddleware');
const { requireApprovedPartner } = require('../../middleware/partnerMiddleware');
const { uploadPartnerDocuments } = require('../../middleware/uploadMiddleware');
const validate = require('../../middleware/validationMiddleware');
const { updateB2BProfile } = require('../../validations/profile.validation');
const { ROLES } = require('../../config/constants');

// Mounted at /api/b2b. B2B users only. Every handler works on req.user's own partner,
// so no id in the URL can point at another partner's data.
router.use(authenticate, requireRole(ROLES.B2B));

// ---- Available while the application is being reviewed
router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: updateB2BProfile }), profileController.updateProfile);

router.get('/documents', partnerController.listMyDocuments);
router.post('/documents', uploadPartnerDocuments, partnerController.addMyDocuments);

// ---- Operational APIs: partner must be APPROVED
// Add passports, pickup requests, commission, withdrawals and invoices below this line.
router.use(requireApprovedPartner);

router.get('/overview', partnerController.overview);

module.exports = router;
