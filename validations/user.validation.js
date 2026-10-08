const { z } = require('zod');
const { ROLES, USER_STATUS } = require('../config/constants');
const { ALL_PERMISSIONS, INVITABLE_ROLES } = require('../config/rbac');
const { email, phone, name, idParam, pagination, search } = require('./common');

const permissions = z.array(z.enum(ALL_PERMISSIONS, 'Unknown permission.')).max(ALL_PERMISSIONS.length);

// Roles an Admin may create directly ("invitable" in config/rbac.json). B2B and B2C self-register.
const INTERNAL_ROLES = INVITABLE_ROLES;
const INTERNAL_ROLES_TEXT = INVITABLE_ROLES.join(' or ');

const listUsers = z.object({
  ...pagination,
  search,
  role: z.enum(Object.values(ROLES)).optional(),
  status: z.enum(Object.values(USER_STATUS)).optional()
});

const createUser = z.object({
  name,
  email,
  phone: phone.optional(),
  password: z.string().min(6, 'Password must be at least 6 characters.').optional(),
  role: z.enum(INTERNAL_ROLES, `Role must be ${INTERNAL_ROLES_TEXT}.`),
  permissions: permissions.optional()
});

const createStaff = z.object({
  name,
  email,
  phone: phone.optional(),
  password: z.string().min(6, 'Password must be at least 6 characters.').optional(),
  permissions: permissions.optional()
});

// PENDING is not settable: it only means "email not verified yet".
const updateStatus = z.object({
  status: z.enum(
    [USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED, USER_STATUS.BLOCKED, USER_STATUS.INACTIVE],
    'Invalid status.'
  ),
  reason: z.string().trim().max(300).optional()
});

const updateRole = z.object({
  role: z.enum(INTERNAL_ROLES, `Role must be ${INTERNAL_ROLES_TEXT}.`),
  permissions: permissions.optional()
});

const updatePermissions = z.object({ permissions });

const listAuditLogs = z.object({
  ...pagination,
  action: z.string().trim().max(60).optional(),
  actorUserId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  targetUserId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional()
});

module.exports = {
  idParam,
  listUsers,
  createUser,
  createStaff,
  updateStatus,
  updateRole,
  updatePermissions,
  listAuditLogs
};
