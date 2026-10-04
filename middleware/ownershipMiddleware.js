const { bypassesPermissions, canHavePermissions } = require('../config/rbac');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// "Does this record belong to the caller?" A role check alone is never enough:
// a B2B user must not read another partner's data, a B2C user another traveller's.
//
//   router.get('/:id', authenticate, requireRole(ROLES.B2C), checkOwnership({
//     load: (req) => Application.findById(req.params.id),
//     isOwner: (record, user) => String(record.userId) === user.id
//   }), controller.get);
//
// ADMIN (a role that bypasses permissions) always passes. STAFF (a role that holds permissions)
// passes only when `staffPermission` is given and they hold it. B2B / B2C pass only when `isOwner`
// says so. Everyone else gets the same 404 as a missing record, so the response never reveals that
// somebody else's record exists.
//
// The loaded record is placed on req.resource so the controller does not fetch it twice.
const checkOwnership = ({ load, isOwner, staffPermission }) =>
  asyncHandler(async (req, res, next) => {
    const record = await load(req);
    if (!record) throw new ApiError(404, 'Not found');

    const { role, permissions } = req.user;
    const privileged =
      bypassesPermissions(role) ||
      (canHavePermissions(role) && staffPermission && permissions.includes(staffPermission));

    if (!privileged && !isOwner(record, req.user)) throw new ApiError(404, 'Not found');

    req.resource = record;
    next();
  });

module.exports = { checkOwnership };
