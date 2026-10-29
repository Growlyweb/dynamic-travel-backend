const service = require('../services/visaChecklistEntryService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// Mounted by routes/visaRoutes.js under /api/visa/checklist-entries.

exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.list(req.query);
  sendResponse(res, 200, true, 'Visa checklists fetched.', items, meta);
});
exports.get = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa checklist fetched.', await service.get(req.params.id)));
exports.create = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Visa checklist created.', await service.create(req.user, req.body, contextOf(req))));
exports.update = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa checklist updated.', await service.update(req.user, req.params.id, req.body, contextOf(req))));
exports.remove = asyncHandler(async (req, res) => {
  await service.remove(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Visa checklist deleted.');
});
