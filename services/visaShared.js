const VisaApplication = require('../models/VisaApplication');
const User = require('../models/User');
const { bypassesPermissions } = require('../config/rbac');
const ApiError = require('../utils/ApiError');

// Small helpers every visa service needs.

const findApplication = async (id) => {
  const application = await VisaApplication.findById(id);
  if (!application) throw new ApiError(404, 'Visa application not found.', { code: 'APPLICATION_NOT_FOUND' });
  return application;
};

// The name that goes on a timeline entry or a note. The token only carries the id, so the name is read here.
const actorOf = async (user) => {
  const found = await User.findById(user.id).select('name').lean();
  return { id: user.id, name: found ? found.name : 'Staff' };
};

// Adds a timeline entry to an application that is about to be saved.
//   visibility: "internal" staff only, "customer" or "both" can be shown to the applicant.
const addTimeline = (application, { event, message = '', visibility = 'internal', actor }) => {
  application.timeline.push({ event, message, visibility, by: actor ? actor.name : 'System', byUserId: actor ? actor.id : undefined });
  application.markModified('timeline');
};

// ADMIN passes every check, STAFF needs the key in their permission list (the same rule as requirePermission).
const hasPermission = (user, permission) => bypassesPermissions(user.role) || (user.permissions || []).includes(permission);

module.exports = { findApplication, actorOf, addTimeline, hasPermission };
