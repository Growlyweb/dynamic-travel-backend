const marketingService = require('../services/marketingService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/marketing/overview
exports.getOverview = asyncHandler(async (req, res) => {
  const data = await marketingService.getOverview();
  sendResponse(res, 200, true, 'Marketing overview fetched successfully.', data);
});

// GET /api/marketing/customers
exports.getCustomers = asyncHandler(async (req, res) => {
  const data = await marketingService.getCustomers(req.query);
  sendResponse(res, 200, true, 'Marketing customers fetched successfully.', data);
});

// GET /api/marketing/customers/all
exports.getAllCustomers = asyncHandler(async (req, res) => {
  const data = await marketingService.getAllCustomers(req.query);
  sendResponse(res, 200, true, 'All marketing customers fetched successfully.', data);
});

// POST /api/marketing/send-sms
exports.sendSms = asyncHandler(async (req, res) => {
  const data = await marketingService.sendSms(req.body, req.user);
  sendResponse(res, 200, true, 'SMS campaign created.', data);
});

// POST /api/marketing/send-email
exports.sendEmail = asyncHandler(async (req, res) => {
  const data = await marketingService.sendEmail(req.body, req.user);
  sendResponse(res, 200, true, 'Email campaign created.', data);
});

// POST /api/marketing/campaigns
exports.sendBulkCampaign = asyncHandler(async (req, res) => {
  const data = await marketingService.sendBulkCampaign(req.body, req.user);
  sendResponse(res, 201, true, 'Campaign initiated successfully.', data);
});

// POST /api/marketing/campaigns/:id/retry
exports.retryCampaign = asyncHandler(async (req, res) => {
  const data = await marketingService.retryFailedCampaign(req.params.id);
  sendResponse(res, 200, true, 'Campaign retried successfully.', data);
});

// POST /api/marketing/templates
exports.saveTemplate = asyncHandler(async (req, res) => {
  const data = await marketingService.saveTemplate(req.body, req.user);
  sendResponse(res, 200, true, 'Template saved successfully.', data);
});

// DELETE /api/marketing/templates/:id
exports.deleteTemplate = asyncHandler(async (req, res) => {
  const data = await marketingService.deleteTemplate(req.params.id);
  sendResponse(res, 200, true, 'Template deleted successfully.', data);
});
