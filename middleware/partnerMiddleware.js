const { APPROVAL_STATUS } = require('../config/constants');
const Partner = require('../models/Partner');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// B2B users can log in as soon as their email is verified, but operational APIs
// (passports, pickups, commission, withdrawals, invoices...) need an APPROVED partner.
// Mount after authenticate + requireRole(B2B). Sets req.partner.
const requireApprovedPartner = asyncHandler(async (req, res, next) => {
  const partner = req.user.partnerId ? await Partner.findById(req.user.partnerId) : null;

  if (!partner || partner.approvalStatus !== APPROVAL_STATUS.APPROVED) {
    throw new ApiError(403, 'Your business account has not been approved yet.', { code: 'PARTNER_NOT_APPROVED' });
  }

  req.partner = partner;
  next();
});

module.exports = { requireApprovedPartner };
