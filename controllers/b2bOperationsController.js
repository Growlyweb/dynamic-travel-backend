const b2bOpsService = require('../services/b2bOperationsService');
const Partner = require('../models/Partner');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

/* ── Pickups ── */

exports.createPickup = asyncHandler(async (req, res) => {
  const pickup = await b2bOpsService.createPickup(req.user, req.body);
  sendResponse(res, 201, true, 'Pickup request created successfully.', pickup);
});

exports.listPickups = asyncHandler(async (req, res) => {
  const query = { ...req.query };
  // If user is B2B partner, force tenant isolation
  if (req.user.role === ROLES.B2B) {
    const partner = await Partner.findOne({ userId: req.user._id });
    query.partnerId = partner ? partner._id : null;
  }
  const result = await b2bOpsService.listPickups(query);
  sendResponse(res, 200, true, 'Pickup requests fetched successfully.', result.items, result.meta);
});

exports.updatePickup = asyncHandler(async (req, res) => {
  const updated = await b2bOpsService.updatePickup(req.user, req.params.id, req.body);
  sendResponse(res, 200, true, 'Pickup request updated successfully.', updated);
});

/* ── Commissions ── */

exports.getCommissions = asyncHandler(async (req, res) => {
  const partnerId = req.user.role === ROLES.B2B ? null : req.query.partnerId;
  const result = await b2bOpsService.getPartnerCommissions(req.user, partnerId);
  sendResponse(res, 200, true, 'Commissions data fetched successfully.', result);
});

/* ── Withdrawals ── */

exports.createWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await b2bOpsService.createWithdrawal(req.user, req.body);
  sendResponse(res, 201, true, 'Withdrawal request submitted successfully.', withdrawal);
});

exports.listWithdrawals = asyncHandler(async (req, res) => {
  const query = { ...req.query };
  if (req.user.role === ROLES.B2B) {
    const partner = await Partner.findOne({ userId: req.user._id });
    query.partnerId = partner ? partner._id : null;
  }
  const result = await b2bOpsService.listWithdrawals(query);
  sendResponse(res, 200, true, 'Withdrawals fetched successfully.', result.items, result.meta);
});

exports.reviewWithdrawal = asyncHandler(async (req, res) => {
  const updated = await b2bOpsService.reviewWithdrawal(req.user, req.params.id, req.body);
  sendResponse(res, 200, true, 'Withdrawal request reviewed successfully.', updated);
});
