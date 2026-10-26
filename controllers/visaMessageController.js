const service = require('../services/visaMessageService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// ---- templates
exports.listTemplates = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listTemplates(req.query);
  sendResponse(res, 200, true, 'Message templates fetched.', items, meta);
});
exports.createTemplate = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Template created.', await service.createTemplate(req.user, req.body, contextOf(req))));
exports.updateTemplate = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Template updated.', await service.updateTemplate(req.user, req.params.id, req.body, contextOf(req))));
exports.removeTemplate = asyncHandler(async (req, res) => {
  await service.removeTemplate(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Template deleted.');
});

// ---- messages
exports.listMessages = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listMessages(req.query);
  sendResponse(res, 200, true, 'Messages fetched.', items, meta);
});
exports.send = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Message created.', await service.send(req.user, req.params.id, req.body, contextOf(req))));
exports.mark = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Message updated.', await service.mark(req.user, req.params.id, req.body, contextOf(req))));
exports.resend = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Email sent again.', await service.resend(req.user, req.params.id, contextOf(req))));
