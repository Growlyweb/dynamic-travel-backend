const { ROLES } = require('../config/constants');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const partnerService = require('./partnerService');

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

  let partner = null;
  if (user.role === ROLES.B2B) {
    partner = await partnerService.updateContact(user._id, { address, businessType });
  }

  return { user, partner };
};

module.exports = { get, update };
