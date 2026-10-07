const express = require('express');
const router = express.Router();
const membershipController = require('../controllers/membershipController');

router.get('/memberships', membershipController.getMemberships);
router.get('/membership-plans', membershipController.getPlans);
router.get('/membership-stats', membershipController.getStats);

module.exports = router;
