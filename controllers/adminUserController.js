const userService = require('../services/userService');
const auditService = require('../services/auditService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');
const { ROLES } = require('../config/constants');
const rbac = require('../config/rbac');

// Admin account management. Mounted behind authenticate + requireRole(ADMIN).

// GET /api/admin/rbac   (roles and permissions as defined in config/rbac.json, for admin screens)
exports.getRbac = asyncHandler(async (req, res) => {
  sendResponse(res, 200, true, 'Roles and permissions fetched.', rbac.describe());
});

// GET /api/admin/users
exports.listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await userService.list(req.query);
  sendResponse(res, 200, true, 'Users fetched.', items, meta);
});

// GET /api/admin/users/:id
exports.getUser = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.params.id);
  sendResponse(res, 200, true, 'User fetched.', user);
});

// POST /api/admin/users   (creates ADMIN or STAFF and emails an invite)
exports.createUser = asyncHandler(async (req, res) => {
  const { user, inviteSent } = await userService.createInternal(req.user, req.body, contextOf(req));
  sendResponse(res, 201, true, 'Account created and invitation sent.', { user, inviteSent });
});

// POST /api/admin/staff   (same, but always STAFF)
exports.createStaff = asyncHandler(async (req, res) => {
  const { user, inviteSent } = await userService.createInternal(
    req.user,
    { ...req.body, role: ROLES.STAFF },
    contextOf(req)
  );
  sendResponse(res, 201, true, 'Staff account created and invitation sent.', { user, inviteSent });
});

// POST /api/admin/users/:id/resend-invite
exports.resendInvite = asyncHandler(async (req, res) => {
  const { user, inviteSent } = await userService.resendInvite(req.user, req.params.id);
  sendResponse(res, 200, true, 'Invitation sent again.', { user, inviteSent });
});

// PATCH /api/admin/users/:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const user = await userService.updateStatus(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, 'Account status updated.', user);
});

// PATCH /api/admin/users/:id/role
exports.updateRole = asyncHandler(async (req, res) => {
  const user = await userService.updateRole(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, 'Role updated.', user);
});

// PATCH /api/admin/users/:id/permissions
exports.updatePermissions = asyncHandler(async (req, res) => {
  const user = await userService.updatePermissions(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, 'Permissions updated.', user);
});

// DELETE /api/admin/users/:id   (soft delete: the account becomes INACTIVE)
exports.deleteUser = asyncHandler(async (req, res) => {
  await userService.remove(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Account deactivated.');
});

// GET /api/admin/audit-logs
exports.listAuditLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await auditService.list(req.query);
  sendResponse(res, 200, true, 'Audit logs fetched.', items, meta);
});
