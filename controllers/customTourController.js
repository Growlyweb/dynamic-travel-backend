const customTourService = require('../services/customTourService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// POST /api/tours/custom-requests   (B2C only)
exports.create = asyncHandler(async (req, res) => {
  const request = await customTourService.create(req.user, req.body, contextOf(req));
  sendResponse(res, 201, true, 'Your custom tour request was received.', request);
});

// GET /api/tours/custom-requests   (B2C: their own. Tour managers: all)
exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await customTourService.list(req.user, req.query);
  sendResponse(res, 200, true, 'Custom tour requests fetched.', items, meta);
});

// GET /api/tours/custom-requests/:id
exports.get = asyncHandler(async (req, res) => {
  const request = await customTourService.get(req.user, req.params.id);
  sendResponse(res, 200, true, 'Custom tour request fetched.', request);
});

// PATCH /api/tours/custom-requests/:id/status
exports.setStatus = asyncHandler(async (req, res) => {
  const request = await customTourService.setStatus(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, `Request status is now ${request.status}.`, request);
});
