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

const b2bOps = require('../../controllers/b2bOperationsController');
const opSchemas = require('../../validations/b2bOperations.validation');

router.post('/pickups', validate({ body: opSchemas.createPickup }), b2bOps.createPickup);
router.get('/pickups', validate({ query: opSchemas.listOperations }), b2bOps.listPickups);
router.get('/commissions', b2bOps.getCommissions);
router.post('/withdrawals', validate({ body: opSchemas.createWithdrawal }), b2bOps.createWithdrawal);
router.get('/withdrawals', validate({ query: opSchemas.listOperations }), b2bOps.listWithdrawals);

module.exports = router;
