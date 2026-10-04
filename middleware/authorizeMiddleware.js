const { bypassesPermissions, canHavePermissions } = require('../config/rbac');
const ApiError = require('../utils/ApiError');

// WHAT may you do? Both guards must run AFTER authenticate.
// Which roles bypass or hold permissions is decided in config/rbac.json.

const forbidden = () => new ApiError(403, 'Forbidden', { code: 'FORBIDDEN' });

// Allow only the listed roles:  router.use(requireRole(ROLES.ADMIN, ROLES.STAFF))
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

// Require EVERY listed permission:  requirePermission(PERMISSIONS.VISA_UPDATE)
// A role marked "bypassPermissions" (ADMIN) is trusted with everything. A role marked
// "assignablePermissions" (STAFF) needs the keys in user.permissions, so it never inherits admin
// powers by default. Any other role (B2B, B2C) has no permission list at all: a stray value in
// their record must never open a staff route.
const requirePermission =
  (...permissions) =>
  (req, res, next) => {
    if (!req.user) return next(forbidden());
    if (bypassesPermissions(req.user.role)) return next();
    if (!canHavePermissions(req.user.role)) return next(forbidden());

    const allowed = permissions.every((permission) => req.user.permissions.includes(permission));
    if (!allowed) return next(forbidden());
    next();
  };

module.exports = { requireRole, requirePermission };
