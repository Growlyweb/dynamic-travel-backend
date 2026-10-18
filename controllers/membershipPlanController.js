const planService = require('../services/membershipPlanService');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// The membership routes answer in the shapes of the dashboard's spec, not the { success, message, data } envelope:
// lists are { items, total }, a single answer is the object itself, and delete is { success, id }.

// GET /api/membership-plans
exports.list = asyncHandler(async (req, res) => {
  res.json(await planService.list(req.query));
});

// POST /api/membership-plans
exports.create = asyncHandler(async (req, res) => {
  res.status(201).json(await planService.create(req.user, req.body, contextOf(req)));
});

// PUT /api/membership-plans/:id
exports.update = asyncHandler(async (req, res) => {
  res.json(await planService.update(req.user, req.params.id, req.body, contextOf(req)));
});

// PATCH /api/membership-plans/:id/toggle
exports.toggle = asyncHandler(async (req, res) => {
  res.json(await planService.toggle(req.user, req.params.id, contextOf(req)));
});

// DELETE /api/membership-plans/:id
exports.remove = asyncHandler(async (req, res) => {
  res.json(await planService.remove(req.user, req.params.id, contextOf(req)));
});
