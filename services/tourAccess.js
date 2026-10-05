const { APPROVAL_STATUS, ROLES } = require('../config/constants');
const { PERMISSIONS, bypassesPermissions, canHavePermissions } = require('../config/rbac');
const Partner = require('../models/Partner');
const ApiError = require('../utils/ApiError');

// Who may do what in the tour module. One place, so a route and a service never disagree.

// An admin, or staff an admin gave TOUR_MANAGE to. They see drafts and archived tours, the B2B price
// and every custom request, and they are the only ones who change tours, categories and request status.
const isTourManager = (user) =>
  Boolean(user) &&
  (bypassesPermissions(user.role) || (canHavePermissions(user.role) && user.permissions.includes(PERMISSIONS.TOUR_MANAGE)));

// What this caller may see. `user` is req.user, or undefined for an anonymous visitor.
const viewerOf = async (user) => {
  if (!user) return { isManager: false, canSeeB2bPrice: false };

  const isManager = isTourManager(user);
  if (isManager) return { isManager, canSeeB2bPrice: true };

  // The partner price is for approved agencies only, not for a B2B user still waiting for approval.
  if (user.role === ROLES.B2B && user.partnerId) {
    const partner = await Partner.findById(user.partnerId).select('approvalStatus');
    return { isManager: false, canSeeB2bPrice: Boolean(partner) && partner.approvalStatus === APPROVAL_STATUS.APPROVED };
  }
  return { isManager: false, canSeeB2bPrice: false };
};

// Route guard: a B2C customer (who is limited to their own requests in the service) or a tour manager.
const requireCustomerOrManager = (req, res, next) => {
  if (req.user && (req.user.role === ROLES.B2C || isTourManager(req.user))) return next();
  return next(new ApiError(403, 'Forbidden', { code: 'FORBIDDEN' }));
};

module.exports = { isTourManager, viewerOf, requireCustomerOrManager };
