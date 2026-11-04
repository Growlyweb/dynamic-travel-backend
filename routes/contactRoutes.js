const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authorizeMiddleware');
const { ROLES } = require('../config/constants');

// Public route to submit inquiries
router.post('/', contactController.submitContact);

// Admin/Staff route to view inquiries
router.get('/', authenticate, requireRole(ROLES.ADMIN, ROLES.STAFF), contactController.listContactInquiries);

module.exports = router;
