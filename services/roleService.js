const { AUDIT_ACTIONS } = require('../config/constants');
const { canHavePermissions } = require('../config/rbac');
const templates = require('../config/rbac');
const Role = require('../models/Role');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');

// Roles are named permission sets made from templates (config/rbac.json).
// A person's permissions are the union of their roles and the old per-person list. A change applies on the next
// request, because the access check reads the roles every time.

const NO_ACCESS_NAME = 'No access yet';

const notFound = () => new ApiError(404, 'Role not found.', { code: 'ROLE_NOT_FOUND' });
const locked = () => new ApiError(409, 'This role is built in and cannot be changed.', { code: 'ROLE_LOCKED' });

const present = (role, userCount) => ({
  id: String(role._id),
  name: role.name,
  description: role.description,
  permissions: role.permissions,
  templateKey: role.templateKey,
  system: role.system,
  ...(userCount === undefined ? {} : { userCount }),
  createdAt: role.createdAt,
  updatedAt: role.updatedAt
});

// The built-in role for people whose access is decided later. Safe to call many times.
const ensureSystemRoles = async () => {
  const existing = await Role.findOne({ nameKey: NO_ACCESS_NAME.toLowerCase() });
  if (existing) return existing;
  try {
    return await Role.create({
      name: NO_ACCESS_NAME,
      description: templates.TEMPLATES[templates.SYSTEM_TEMPLATE].description,
      permissions: [],
      templateKey: templates.SYSTEM_TEMPLATE,
      system: true
    });
  } catch (err) {
    if (err.code === 11000) return Role.findOne({ nameKey: NO_ACCESS_NAME.toLowerCase() });
    throw err;
  }
};

const startingPermissions = ({ permissions, templateKey }) => {
  if (permissions) return permissions;
  if (templateKey) return templates.TEMPLATES[templateKey].defaults;
  return [];
};

const countUsers = () => User.aggregate([{ $unwind: '$roles' }, { $group: { _id: '$roles', count: { $sum: 1 } } }]);

const list = async () => {
  await ensureSystemRoles();
  const roles = await Role.find().sort({ system: -1, name: 1 });
  const counts = Object.fromEntries((await countUsers()).map((row) => [String(row._id), row.count]));
  return roles.map((role) => present(role, counts[String(role._id)] || 0));
};

const getById = async (id) => {
  const role = await Role.findById(id);
  if (!role) throw notFound();
  const [{ count } = { count: 0 }] = await User.aggregate([{ $match: { roles: role._id } }, { $count: 'count' }]);
  return present(role, count);
};

const saveName = async (role) => {
  try {
    await role.save();
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'A role with this name already exists.', { code: 'ROLE_NAME_TAKEN' });
    throw err;
  }
};

const create = async (admin, { name, description = '', templateKey, permissions }, context = {}) => {
  const role = new Role({
    name,
    description,
    templateKey: templateKey || null,
    permissions: templates.withDependencies(startingPermissions({ permissions, templateKey }))
  });
  await saveName(role);

  await auditService.record({
    actorUserId: admin.id,
    action: AUDIT_ACTIONS.ROLE_CREATED,
    resource: String(role._id),
    ip: context.ip,
    meta: { name: role.name, templateKey: role.templateKey, permissions: role.permissions }
  });
  return present(role, 0);
};

const update = async (admin, id, { name, description, permissions, templateKey }, context = {}) => {
  const role = await Role.findById(id);
  if (!role) throw notFound();
  if (role.system) throw locked();

  const before = { name: role.name, description: role.description, permissions: role.permissions, templateKey: role.templateKey };
  if (name !== undefined) role.name = name;
  if (description !== undefined) role.description = description;
  if (templateKey !== undefined) role.templateKey = templateKey;
  if (permissions !== undefined) role.permissions = templates.withDependencies(permissions);
  await saveName(role);

  await auditService.record({
    actorUserId: admin.id,
    action: AUDIT_ACTIONS.ROLE_UPDATED,
    resource: String(role._id),
    ip: context.ip,
    meta: { before, after: { name: role.name, description: role.description, permissions: role.permissions, templateKey: role.templateKey } }
  });
  return getById(role._id);
};

const remove = async (admin, id, context = {}) => {
  const role = await Role.findById(id);
  if (!role) throw notFound();
  if (role.system) throw locked();

  const inUse = await User.countDocuments({ roles: role._id });
  if (inUse) {
    throw new ApiError(409, `${inUse} ${inUse === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`, {
      code: 'ROLE_IN_USE'
    });
  }
  await role.deleteOne();

  await auditService.record({
    actorUserId: admin.id,
    action: AUDIT_ACTIONS.ROLE_DELETED,
    resource: String(role._id),
    ip: context.ip,
    meta: { name: role.name, permissions: role.permissions }
  });
};

const loadRoles = async (roleIds) => {
  const unique = [...new Set(roleIds.map(String))];
  const roles = await Role.find({ _id: { $in: unique } });
  if (roles.length !== unique.length) throw new ApiError(400, 'One of the roles does not exist.', { code: 'ROLE_NOT_FOUND' });
  return roles;
};

// The permissions of a person: their roles plus the old list. Only roles that can hold permissions have any.
const effectivePermissions = async (user) => {
  if (!canHavePermissions(user.role)) return [];
  const roles = user.roles && user.roles.length ? await Role.find({ _id: { $in: user.roles } }).select('permissions').lean() : [];
  return [...new Set([...(user.permissions || []), ...roles.flatMap((role) => role.permissions)])];
};

// Id and name of each role a person holds, for the screens.
const rolesOf = async (user) => {
  if (!user.roles || !user.roles.length) return [];
  const roles = await Role.find({ _id: { $in: user.roles } }).select('name system').sort({ name: 1 });
  return roles.map((role) => ({ id: String(role._id), name: role.name, system: role.system }));
};

const assertCanHoldRoles = (target) => {
  if (!canHavePermissions(target.role)) {
    throw new ApiError(409, 'Only staff accounts use roles. Admins can do everything.', { code: 'PERMISSIONS_NOT_ASSIGNABLE' });
  }
};

// Replaces the roles of one staff member. Nobody changes their own, so nobody can widen their own access.
const assignRoles = async (admin, userId, roleIds, context = {}) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found.');
  if (String(admin.id) === String(user._id)) throw new ApiError(409, 'You cannot change your own roles.', { code: 'SELF_CHANGE' });
  assertCanHoldRoles(user);

  const roles = await loadRoles(roleIds);
  const previous = await Role.find({ _id: { $in: user.roles } }).select('name');
  const before = await effectivePermissions(user);

  user.roles = roles.map((role) => role._id);
  await user.save();
  const after = await effectivePermissions(user);
  await user.populate('roles', 'name system');

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.USER_ROLES_CHANGED,
    ip: context.ip,
    meta: { from: previous.map((role) => role.name), to: roles.map((role) => role.name), added: after.filter((key) => !before.includes(key)), removed: before.filter((key) => !after.includes(key)) }
  });
  return user;
};

// Turns the old per-person list into a role and gives that role to the person.
const convertPermissions = async (admin, userId, { name, description }, context = {}) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found.');
  if (String(admin.id) === String(user._id)) throw new ApiError(409, 'You cannot change your own roles.', { code: 'SELF_CHANGE' });
  assertCanHoldRoles(user);
  if (!user.permissions.length) throw new ApiError(409, 'This person has no individual permissions to turn into a role.', { code: 'NOTHING_TO_CONVERT' });

  const role = await create(admin, { name, description, permissions: user.permissions }, context);
  user.roles = [...user.roles, role.id];
  user.permissions = [];
  await user.save();

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.USER_ROLES_CHANGED,
    ip: context.ip,
    meta: { convertedToRole: role.name, permissions: role.permissions }
  });
  return { user, role };
};

// A staff account created without a role gets the built-in "No access yet", so the person has none by accident.
const defaultRoleIds = async (roleIds) => {
  if (roleIds && roleIds.length) return (await loadRoles(roleIds)).map((role) => role._id);
  return [(await ensureSystemRoles())._id];
};

module.exports = { ensureSystemRoles, list, getById, create, update, remove, effectivePermissions, rolesOf, assignRoles, convertPermissions, defaultRoleIds, present, NO_ACCESS_NAME };
