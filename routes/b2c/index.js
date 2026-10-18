const express = require('express');
const router = express.Router();

const profileController = require('../../controllers/profileController');
const membershipController = require('../../controllers/membershipController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authorizeMiddleware');
const validate = require('../../middleware/validationMiddleware');
const { updateProfile } = require('../../validations/profile.validation');
const { listOwnMemberships } = require('../../validations/membership.validation');
const { ROLES } = require('../../config/constants');

// Mounted at /api/b2c. B2C users only. Handlers use req.user.id, never an id from the body.
router.use(authenticate, requireRole(ROLES.B2C));

router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: updateProfile }), profileController.updateProfile);

// A customer's own memberships (read-only). The customer is always the one in the token.
router.get('/memberships', validate({ query: listOwnMemberships }, { statusCode: 400 }), membershipController.listOwn);

// Add applications, documents, tours, flight inquiries and notifications here.
// For single records use checkOwnership (middleware/ownershipMiddleware.js) so a traveller
// can only ever open their own: isOwner: (record, user) => String(record.userId) === user.id

module.exports = router;
