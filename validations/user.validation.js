const { z } = require('zod');
const { ROLES, USER_STATUS } = require('../config/constants');
const { ALL_PERMISSIONS, INVITABLE_ROLES } = require('../config/rbac');
const { email, optionalPhone, name, password, objectId, idParam, pagination, search } = require('./common');
const templates = require('../config/roleTemplates');

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

const roleIds = z.array(objectId).min(1, 'Choose at least one role.').max(20);

const templateKey = z.enum(Object.keys(templates.TEMPLATES), 'Unknown template.');

const createUser = z.object({
  name,
  email,
  phone: optionalPhone,
  // Optional: with a password the account is active at once, without one an invite link is emailed.
  password: password.optional(),
  role: z.enum(INTERNAL_ROLES, `Role must be ${INTERNAL_ROLES_TEXT}.`),
  permissions: permissions.optional(),
  roleIds: roleIds.optional()
});

const createStaff = z.object({
  name,
  email,
  phone: optionalPhone,
  // Optional: with a password the account is active at once, without one an invite link is emailed.
  password: password.optional(),
  permissions: permissions.optional(),
  roleIds: roleIds.optional()
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

const roleName = z.string('Name is required.').trim().min(2, 'Name must be at least 2 characters.').max(60, 'Name must be at most 60 characters.');
const roleDescription = z.string().trim().max(300, 'Description must be at most 300 characters.');

const createRole = z.object({
  name: roleName,
  description: roleDescription.optional(),
  templateKey: templateKey.optional(),
  // Left out: the template's defaults. A role with neither starts empty.
  permissions: permissions.optional()
});

const updateRoleDefinition = z.object({
  name: roleName.optional(),
  description: roleDescription.optional(),
  templateKey: templateKey.nullable().optional(),
  permissions: permissions.optional()
});

const assignRoles = z.object({ roleIds });

const convertPermissions = z.object({ name: roleName, description: roleDescription.optional() });

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
  createRole,
  updateRoleDefinition,
  assignRoles,
  convertPermissions,
  listAuditLogs
};
