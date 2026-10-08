const tourCategoryService = require('../services/tourCategoryService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// GET /api/tour-categories
exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await tourCategoryService.list(req.query, req.user);
  sendResponse(res, 200, true, 'Categories fetched.', items, meta);
});

// GET /api/tour-categories/:id   (this API's id, or the old frontend id such as cat_beach)
exports.get = asyncHandler(async (req, res) => {
  const category = await tourCategoryService.get(req.params.id, req.user);
  sendResponse(res, 200, true, 'Category fetched.', category);
});

// POST /api/tour-categories   (201 for a new category, 200 with the existing one for a name that is taken)
exports.create = asyncHandler(async (req, res) => {
  const { category, created } = await tourCategoryService.create(req.user, req.body, contextOf(req));
  if (created) return sendResponse(res, 201, true, 'Category created.', category);
  return sendResponse(res, 200, true, 'A category with this name already exists.', category);
});

// DELETE /api/tour-categories/:id
exports.remove = asyncHandler(async (req, res) => {
  const category = await tourCategoryService.deactivate(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Category removed.', category);
});
