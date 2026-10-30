const express = require('express');
const router = express.Router();

const adminCustomerController = require('../../controllers/adminCustomerController');
const { authenticate } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../middleware/authorizeMiddleware');
const validate = require('../../middleware/validationMiddleware');
const schemas = require('../../validations/customer.validation');
const { PERMISSIONS } = require('../../config/rbac');

router.use(authenticate);

// Mounted at /api/admin/customers and /api/customers
router.get('/', requirePermission(PERMISSIONS.B2C_VIEW), validate({ query: schemas.listCustomers }), adminCustomerController.listCustomers);
router.get('/:id', requirePermission(PERMISSIONS.B2C_VIEW), validate({ params: schemas.idParam }), adminCustomerController.getCustomer);
router.patch('/:id/status', requirePermission(PERMISSIONS.USER_MANAGE), validate({ params: schemas.idParam, body: schemas.updateCustomerStatus }), adminCustomerController.updateStatus);

module.exports = router;
