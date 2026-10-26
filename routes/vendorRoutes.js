const express = require('express');
const router = express.Router();

const controller = require('../controllers/vendorController');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/vendor.validation');
const asyncHandler = require('../utils/asyncHandler');
const { ensureChartIfEmpty } = require('../services/accounting/chart');
const { PERMISSIONS } = require('../config/rbac');

// Mounted at /api/vendors. Internal users only. Reading needs VENDOR_VIEW, creating vendors, bills and payments needs
// VENDOR_MANAGE, voiding a bill or a payment needs ACCOUNTS_VOID. An admin always passes.
router.use(authenticate);
router.use(asyncHandler(async (req, res, next) => {
  await ensureChartIfEmpty();
  next();
}));

const view = requirePermission(PERMISSIONS.VENDOR_VIEW);
const manage = requirePermission(PERMISSIONS.VENDOR_MANAGE);
const voider = requirePermission(PERMISSIONS.ACCOUNTS_VOID);

router.get('/bills', view, validate({ query: schemas.listBills }), controller.listBills);
router.post('/bills', manage, validate({ body: schemas.createBill }), controller.createBill);
router.post('/bills/:id/void', voider, validate({ params: schemas.idParam, body: schemas.voidBody }), controller.voidBill);

router.get('/payments', view, validate({ query: schemas.listPayments }), controller.listPayments);
router.post('/payments', manage, validate({ body: schemas.createPayment }), controller.createPayment);
router.post('/payments/:id/void', voider, validate({ params: schemas.idParam, body: schemas.voidBody }), controller.voidPayment);

router.get('/', view, validate({ query: schemas.listVendors }), controller.listVendors);
router.post('/', manage, validate({ body: schemas.createVendor }), controller.createVendor);
router.get('/:id', view, validate({ params: schemas.idParam }), controller.getVendor);
router.patch('/:id', manage, validate({ params: schemas.idParam, body: schemas.updateVendor }), controller.updateVendor);

module.exports = router;
