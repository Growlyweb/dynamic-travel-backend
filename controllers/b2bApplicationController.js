const b2bAppService = require('../services/b2bApplicationService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/b2b/applications
exports.listApplications = asyncHandler(async (req, res) => {
  const result = await b2bAppService.listApplications(req.user, req.query);
  sendResponse(res, 200, true, 'Applications fetched successfully.', result.items, result.meta);
});

// POST /api/b2b/applications
exports.createApplication = asyncHandler(async (req, res) => {
  const application = await b2bAppService.createApplication(req.user, req.body);
  sendResponse(res, 201, true, 'Application submitted successfully.', application);
});

// GET /api/b2b/applications/:id
exports.getApplication = asyncHandler(async (req, res) => {
  const application = await b2bAppService.getApplication(req.user, req.params.id);
  sendResponse(res, 200, true, 'Application details fetched successfully.', application);
});
