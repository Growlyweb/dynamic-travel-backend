const tourService = require('../services/tourService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// GET /api/tours
exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await tourService.list(req.query, req.user);
  sendResponse(res, 200, true, 'Tours fetched.', items, meta);
});

// GET /api/tours/:id
exports.get = asyncHandler(async (req, res) => {
  const tour = await tourService.get(req.params.id, req.user);
  sendResponse(res, 200, true, 'Tour fetched.', tour);
});

// POST /api/tours
exports.create = asyncHandler(async (req, res) => {
  const tour = await tourService.create(req.user, req.body, contextOf(req));
  sendResponse(res, 201, true, 'Tour created.', tour);
});

// PATCH /api/tours/:id
exports.update = asyncHandler(async (req, res) => {
  const tour = await tourService.update(req.user, req.params.id, req.body, contextOf(req));
  sendResponse(res, 200, true, 'Tour updated.', tour);
});

// DELETE /api/tours/:id   (archives the tour)
exports.remove = asyncHandler(async (req, res) => {
  const tour = await tourService.archive(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Tour archived.', tour);
});
