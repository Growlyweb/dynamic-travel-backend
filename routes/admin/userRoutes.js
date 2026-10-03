const express = require('express');
const router = express.Router();

const adminUserController = require('../../controllers/adminUserController');
const validate = require('../../middleware/validationMiddleware');
const schemas = require('../../validations/user.validation');

// Mounted at /api/admin (auth + ADMIN role already applied by routes/admin/index.js)

// Roles and permissions (read from config/rbac.json)
router.get('/rbac', adminUserController.getRbac);

// Users
router.get('/users', validate({ query: schemas.listUsers }), adminUserController.listUsers);
router.post('/users', validate({ body: schemas.createUser }), adminUserController.createUser);
router.get('/users/:id', validate({ params: schemas.idParam }), adminUserController.getUser);
router.delete('/users/:id', validate({ params: schemas.idParam }), adminUserController.deleteUser);

router.patch(
  '/users/:id/status',
  validate({ params: schemas.idParam, body: schemas.updateStatus }),
  adminUserController.updateStatus
);
router.patch(
  '/users/:id/role',
  validate({ params: schemas.idParam, body: schemas.updateRole }),
  adminUserController.updateRole
);
router.patch(
  '/users/:id/permissions',
  validate({ params: schemas.idParam, body: schemas.updatePermissions }),
  adminUserController.updatePermissions
);
router.post(
  '/users/:id/resend-invite',
  validate({ params: schemas.idParam }),
  adminUserController.resendInvite
);

// Staff
router.post('/staff', validate({ body: schemas.createStaff }), adminUserController.createStaff);

// Audit trail
router.get('/audit-logs', validate({ query: schemas.listAuditLogs }), adminUserController.listAuditLogs);

module.exports = router;
