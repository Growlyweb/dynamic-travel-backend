const express = require('express');
const router = express.Router();

const profileController = require('../../controllers/profileController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authorizeMiddleware');
const validate = require('../../middleware/validationMiddleware');
const { updateProfile } = require('../../validations/profile.validation');
const { ROLES } = require('../../config/constants');

// Mounted at /api/b2c. B2C users only. Handlers use req.user.id, never an id from the body.
router.use(authenticate, requireRole(ROLES.B2C));

router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: updateProfile }), profileController.updateProfile);

// Add applications, documents, tours, flight inquiries and notifications here.
// For single records use checkOwnership (middleware/ownershipMiddleware.js) so a traveller
// can only ever open their own: isOwner: (record, user) => String(record.userId) === user.id

module.exports = router;
