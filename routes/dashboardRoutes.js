const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/authorizeMiddleware');
const { ROLES } = require('../config/constants');

// Mounted at /api/dashboard. Internal users only: the admin dashboard shows platform-wide numbers.
router.use(authenticate, requireRole(ROLES.ADMIN, ROLES.STAFF));

router.get('/overview', dashboardController.getOverview);
router.get('/visa-trend', dashboardController.getVisaTrend);
router.get('/tour-trend', dashboardController.getTourTrend);
router.get('/recent-applications', dashboardController.getRecentApplications);
router.get('/recent-activities', dashboardController.getRecentActivities);

module.exports = router;
