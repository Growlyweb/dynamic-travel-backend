const env = require('../config/env');
const { ROLES, USER_STATUS, OTP_PURPOSE, AUDIT_ACTIONS } = require('../config/constants');
const { INVITABLE_ROLES, canHavePermissions } = require('../config/rbac');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const otpService = require('./otpService');
const tokenService = require('./tokenService');

// Admin-side account management. `admin` is req.user ({ id, role, ... }); `context` is { ip }.
// Every change here is audit-logged.

// Roles an admin can create and move between ("invitable" in config/rbac.json).
const INTERNAL_ROLES = INVITABLE_ROLES;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findOrFail = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'User not found.');
  return user;
};

// Keeps the platform from locking itself out: at least one other ACTIVE admin must remain.
const assertNotLastAdmin = async (target) => {
  if (target.role !== ROLES.ADMIN || target.status !== USER_STATUS.ACTIVE) return;

  const others = await User.countDocuments({
    role: ROLES.ADMIN,
    status: USER_STATUS.ACTIVE,
    _id: { $ne: target._id }
  });
  if (others === 0) {
    throw new ApiError(409, 'This is the last active admin. Create or activate another admin first.', {
      code: 'LAST_ADMIN'
    });
  }
};

const assertNotSelf = (admin, target, what) => {
  if (String(admin.id) === String(target._id)) {
    throw new ApiError(409, `You cannot change your own ${what}.`, { code: 'SELF_CHANGE' });
  }
};

const list = async (query) => {
  const { page, limit, skip } = paginate(query);

  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

const getById = (id) => findOrFail(id);

const sendInvite = async (user) => {
  const token = await otpService.issueLinkToken(user._id, OTP_PURPOSE.STAFF_INVITE, env.staffInviteExpiresHours);
  return notificationService.trySend(() => notificationService.staffInvite(user, token));
};

const bcrypt = require('bcryptjs');

// Creates an internal (ADMIN or STAFF) account. If a password is provided, it hashes it,
// verifies the account and activates it immediately. Otherwise an invite link is sent.
const createInternal = async (admin, { name, email, phone, role, password, permissions = [] }, context = {}) => {
  if (!INTERNAL_ROLES.includes(role)) {
    throw new ApiError(400, `Only ${INTERNAL_ROLES.join(' and ')} accounts can be created by an admin.`);
  }

  const clauses = [{ email }];
  if (phone) clauses.push({ phone });
  if (await User.exists({ $or: clauses })) {
    throw new ApiError(409, 'An account with this email or phone number already exists.');
  }

  const passwordHash = password ? await bcrypt.hash(password, env.bcryptCost) : undefined;

  const user = await User.create({
    name,
    email,
    phone,
    role,
    passwordHash,
    emailVerified: true,
    permissions: canHavePermissions(role) ? permissions : [],
    status: USER_STATUS.ACTIVE
  });

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.USER_CREATED,
    ip: context.ip,
    meta: { role, permissions: user.permissions }
  });

  let inviteSent = false;
  if (!password) {
    inviteSent = await sendInvite(user);
  }
  return { user, inviteSent };
};

const resendInvite = async (admin, id) => {
  const user = await findOrFail(id);
  const waitingForSetup = user.status === USER_STATUS.PENDING && !user.emailVerified && INTERNAL_ROLES.includes(user.role);
  if (!waitingForSetup) throw new ApiError(409, 'This account is not waiting for an invitation.');

  return { user, inviteSent: await sendInvite(user) };
};

const updateStatus = async (admin, id, { status, reason }, context = {}) => {
  const user = await findOrFail(id);
  assertNotSelf(admin, user, 'status');

  // Activation is earned by verifying (OTP or invite link), never granted over the top of that.
  if (status === USER_STATUS.ACTIVE && !user.emailVerified && !user.phoneVerified) {
    throw new ApiError(409, 'This account has not been verified yet. It becomes active when the user verifies.', {
      code: 'NOT_VERIFIED'
    });
  }
  if (user.status === status) return user;
  if (status !== USER_STATUS.ACTIVE) await assertNotLastAdmin(user);

  const previous = user.status;
  user.status = status;
  await user.save();

  // A non-active account must lose access immediately, not when its tokens run out.
  if (status !== USER_STATUS.ACTIVE) await tokenService.invalidateUserTokens(user);

  let action = AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED;
  if (status === USER_STATUS.SUSPENDED) action = AUDIT_ACTIONS.ACCOUNT_SUSPENDED;
  if (status === USER_STATUS.ACTIVE) action = AUDIT_ACTIONS.ACCOUNT_ACTIVATED;

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action,
    ip: context.ip,
    meta: { from: previous, to: status, reason }
  });

  return user;
};

// Soft delete: the record stays for the audit trail, access ends.
const remove = (admin, id, context) =>
  updateStatus(admin, id, { status: USER_STATUS.INACTIVE, reason: 'Deleted by admin' }, context);

// Only between the invitable roles. B2B and B2C are what the person registered as, not a promotion path.
const updateRole = async (admin, id, { role, permissions }, context = {}) => {
  const user = await findOrFail(id);
  assertNotSelf(admin, user, 'role');

  if (!INTERNAL_ROLES.includes(user.role)) {
    throw new ApiError(409, 'The role of B2B and B2C accounts cannot be changed.', { code: 'ROLE_LOCKED' });
  }
  if (user.role === role) return user;
  if (role !== ROLES.ADMIN) await assertNotLastAdmin(user);

  const previous = { role: user.role, permissions: user.permissions };
  user.role = role;
  user.permissions = canHavePermissions(role) ? permissions || [] : [];
  await user.save();
  await tokenService.invalidateUserTokens(user);

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.ROLE_CHANGED,
    ip: context.ip,
    meta: { from: previous.role, to: role, permissions: user.permissions }
  });

  return user;
};

const updatePermissions = async (admin, id, { permissions }, context = {}) => {
  const user = await findOrFail(id);

  if (!canHavePermissions(user.role)) {
    throw new ApiError(409, 'This role does not use a permission list.', { code: 'PERMISSIONS_NOT_ASSIGNABLE' });
  }

  const previous = user.permissions;
  user.permissions = [...new Set(permissions)];
  await user.save();

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: user._id,
    action: AUDIT_ACTIONS.PERMISSION_CHANGED,
    ip: context.ip,
    meta: { from: previous, to: user.permissions }
  });

  return user;
};

module.exports = {
  list,
  getById,
  createInternal,
  resendInvite,
  updateStatus,
  remove,
  updateRole,
  updatePermissions
};
