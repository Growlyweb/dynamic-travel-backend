const express = require('express');
const router = express.Router();

const planController = require('../controllers/membershipPlanController');
const membershipController = require('../controllers/membershipController');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/membership.validation');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api, so the guards are on each route (a router-wide guard would also catch every other /api URL
// and answer 401 for routes that do not exist). Everything here needs an admin, or staff holding MEMBERSHIP_MANAGE.
// A failed validation answers 400, as the spec asks.
const manage = [authenticate, requirePermission(PERMISSIONS.MEMBERSHIP_MANAGE)];
const check = (parts) => validate(parts, { statusCode: 400 });

// ---- Plans
router.get('/membership-plans', manage, check({ query: schemas.listPlans }), planController.list);
router.post('/membership-plans', manage, check({ body: schemas.createPlan }), planController.create);
router.put('/membership-plans/:id', manage, check({ params: schemas.idParam, body: schemas.updatePlan }), planController.update);
router.patch('/membership-plans/:id/toggle', manage, check({ params: schemas.idParam }), planController.toggle);
router.delete('/membership-plans/:id', manage, check({ params: schemas.idParam }), planController.remove);

// ---- Memberships
router.get('/memberships', manage, check({ query: schemas.listMemberships }), membershipController.list);
router.post('/memberships', manage, check({ body: schemas.createMembership }), membershipController.create);
router.patch('/memberships/:id/cancel', manage, check({ params: schemas.idParam, body: schemas.cancelMembership }), membershipController.cancel);
router.patch('/memberships/:id/extend', manage, check({ params: schemas.idParam, body: schemas.extendMembership }), membershipController.extend);
router.delete('/memberships/:id', manage, check({ params: schemas.idParam }), membershipController.remove);
router.get('/customers/:customerId/memberships', manage, check({ params: schemas.customerParam }), membershipController.historyOf);

// ---- Reports
router.get('/membership-stats', manage, membershipController.stats);
router.get('/membership-report/periods', manage, check({ query: schemas.reportPeriods }), membershipController.periods);

module.exports = router;
