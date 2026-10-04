const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/authorizeMiddleware');
const { ROLES } = require('../../config/constants');

// Mounted at /api/admin. Everything below requires a valid token AND the ADMIN role,
// so individual admin route files never repeat the guards.
router.use(authenticate, requireRole(ROLES.ADMIN));

router.use('/', require('./userRoutes'));
router.use('/b2b', require('./partnerRoutes'));

// Register new admin feature routers here:
// router.use('/products', require('./productRoutes'));

module.exports = router;
