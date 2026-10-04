const express = require('express');
const router = express.Router();

const adminUserController = require('../../controllers/adminUserController');
const profileController = require('../../controllers/profileController');
const validate = require('../../middleware/validationMiddleware');
const schemas = require('../../validations/user.validation');
const { adminUpdateUser } = require('../../validations/profile.validation');

// Mounted at /api/admin (auth + ADMIN role already applied by routes/admin/index.js)

// An admin's OWN profile. The person always comes from the token, like the other roles' profile routes.
router.get('/profile', profileController.getProfile);
router.patch('/profile', validate({ body: adminUpdateUser }), profileController.updateProfile);

// Roles and permissions (read from config/rbac.json)
router.get('/rbac', adminUserController.getRbac);

// Users
router.get('/users', validate({ query: schemas.listUsers }), adminUserController.listUsers);
router.post('/users', validate({ body: schemas.createUser }), adminUserController.createUser);
router.get('/users/:id', validate({ params: schemas.idParam }), adminUserController.getUser);
// An admin edits ANOTHER person's name or phone. Nobody else can: every other role is refused (403).
router.patch(
  '/users/:id',
  validate({ params: schemas.idParam, body: adminUpdateUser }),
  adminUserController.updateUser
);
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
