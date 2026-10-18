const { ROLES, AUDIT_ACTIONS } = require('../config/constants');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const partnerService = require('./partnerService');
const membershipService = require('./membershipService');

// "My own profile" for every role. The user id always comes from the verified token (req.user.id),
// never from the URL or body, so one person can only ever read or change their own record.

const get = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'Account not found.');

  const partner = user.role === ROLES.B2B ? await partnerService.getByUserId(user._id) : null;
  return { user, partner };
};

// Only whitelisted fields reach here (see validations/profile.validation.js).
const update = async (userId, { name, phone, address, businessType }) => {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'Account not found.');

  if (name !== undefined) user.name = name;
  if (phone !== undefined && phone !== user.phone) {
    user.phone = phone;
    user.phoneVerified = false; // a new number has not been verified yet
  }
  await user.save();
  // A customer's memberships keep a copy of their name and phone for display and search. Keep it current.
  if (user.role === ROLES.B2C && (name !== undefined || phone !== undefined)) await membershipService.syncCustomerDetails(user);

  let partner = null;
  if (user.role === ROLES.B2B) {
    partner = await partnerService.updateContact(user._id, { address, businessType });
  }

  return { user, partner };
};

// ADMIN editing another person's name or phone. Only an admin reaches this (the route is behind
// requireRole(ADMIN)), and only the same two fields a person may edit about themselves. The email,
// role, status and permissions have their own admin actions, or none. Logged with the field names
// (not the values) so the audit trail holds no personal data.
const adminUpdateUser = async (admin, id, data, context = {}) => {
  const result = await update(id, { name: data.name, phone: data.phone });

  await auditService.record({
    actorUserId: admin.id,
    targetUserId: result.user._id,
    action: AUDIT_ACTIONS.PROFILE_UPDATED,
    ip: context.ip,
    meta: { fields: ['name', 'phone'].filter((field) => data[field] !== undefined) }
  });

  return result;
};

module.exports = { get, update, adminUpdateUser };
