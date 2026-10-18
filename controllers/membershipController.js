const membershipService = require('../services/membershipService');
const reportService = require('../services/membershipReportService');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// Same answer shapes as the plan controller: the dashboard's spec, not the usual envelope.

// GET /api/memberships
exports.list = asyncHandler(async (req, res) => {
  res.json(await membershipService.list(req.query));
});

// POST /api/memberships
exports.create = asyncHandler(async (req, res) => {
  res.status(201).json(await membershipService.create(req.user, req.body, contextOf(req)));
});

// PATCH /api/memberships/:id/cancel
exports.cancel = asyncHandler(async (req, res) => {
  res.json(await membershipService.cancel(req.user, req.params.id, req.body, contextOf(req)));
});

// PATCH /api/memberships/:id/extend
exports.extend = asyncHandler(async (req, res) => {
  res.json(await membershipService.extend(req.user, req.params.id, req.body, contextOf(req)));
});

// DELETE /api/memberships/:id
exports.remove = asyncHandler(async (req, res) => {
  res.json(await membershipService.remove(req.user, req.params.id, contextOf(req)));
});

// GET /api/customers/:customerId/memberships
exports.historyOf = asyncHandler(async (req, res) => {
  res.json(await membershipService.historyOf(req.params.customerId));
});

// GET /api/b2c/memberships   (a customer's own; the id comes from the token, never from the URL)
exports.listOwn = asyncHandler(async (req, res) => {
  res.json(await membershipService.list(req.query, { customerId: req.user.id, forCustomer: true }));
});

// GET /api/membership-stats
exports.stats = asyncHandler(async (req, res) => {
  res.json(await reportService.stats());
});

// GET /api/membership-report/periods
exports.periods = asyncHandler(async (req, res) => {
  res.json(await reportService.periods(req.query));
});
