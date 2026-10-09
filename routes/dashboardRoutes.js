const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Mounted at /api/dashboard
router.get('/overview', dashboardController.getOverview);
router.get('/visa-trend', dashboardController.getVisaTrend);
router.get('/tour-trend', dashboardController.getTourTrend);
router.get('/recent-applications', dashboardController.getRecentApplications);
router.get('/recent-activities', dashboardController.getRecentActivities);

module.exports = router;
