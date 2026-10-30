const express = require('express');
const router = express.Router();

const b2bOps = require('../controllers/b2bOperationsController');
const { authenticate } = require('../middleware/authMiddleware');
const { requirePermission, requireRole } = require('../middleware/authorizeMiddleware');
const validate = require('../middleware/validationMiddleware');
const schemas = require('../validations/b2bOperations.validation');
const { ROLES } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');

router.use(authenticate);

/* ── Pickups ── */
router.post('/pickups', validate({ body: schemas.createPickup }), b2bOps.createPickup);
router.get('/pickups', validate({ query: schemas.listOperations }), b2bOps.listPickups);
router.patch(
  '/pickups/:id',
  requirePermission(PERMISSIONS.B2B_MANAGE),
  validate({ params: schemas.idParam, body: schemas.updatePickupStatus }),
  b2bOps.updatePickup
);

/* ── Commissions ── */
router.get('/commissions', b2bOps.getCommissions);

/* ── Withdrawals ── */
router.post(
  '/withdrawals',
  requireRole(ROLES.B2B),
  validate({ body: schemas.createWithdrawal }),
  b2bOps.createWithdrawal
);
router.get('/withdrawals', validate({ query: schemas.listOperations }), b2bOps.listWithdrawals);
router.patch(
  '/withdrawals/:id/review',
  requirePermission(PERMISSIONS.B2B_MANAGE),
  validate({ params: schemas.idParam, body: schemas.reviewWithdrawal }),
  b2bOps.reviewWithdrawal
);

module.exports = router;
