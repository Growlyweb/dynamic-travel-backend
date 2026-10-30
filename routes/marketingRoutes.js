const express = require('express');
const router = express.Router();
const marketingController = require('../controllers/marketingController');
const { authenticate } = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/authorizeMiddleware');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/marketing.validation');

// Guard all marketing routes: authentication + ADMIN or STAFF with report permissions
router.use(authenticate, requireRole(ROLES.ADMIN, ROLES.STAFF));

router.get('/overview', marketingController.getOverview);
router.get('/customers', validate({ query: schemas.listMarketingCustomers }), marketingController.getCustomers);
router.get('/customers/all', marketingController.getAllCustomers);

router.post('/send-sms', validate({ body: schemas.sendSingleSms }), marketingController.sendSms);
router.post('/send-email', validate({ body: schemas.sendSingleEmail }), marketingController.sendEmail);
router.post('/campaigns', validate({ body: schemas.sendBulkCampaign }), marketingController.sendBulkCampaign);
router.post('/campaigns/:id/retry', validate({ params: schemas.idParam }), marketingController.retryCampaign);

router.post('/templates', validate({ body: schemas.saveTemplate }), marketingController.saveTemplate);
router.delete('/templates/:id', validate({ params: schemas.idParam }), marketingController.deleteTemplate);

module.exports = router;
