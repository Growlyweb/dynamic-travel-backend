const service = require('../services/visaPublicService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const contextOf = require('../utils/requestContext');

// POST /api/visa/public/status/code
exports.requestCode = asyncHandler(async (req, res) => {
  const { message, ...data } = await service.requestCode(req.body, contextOf(req));
  sendResponse(res, 200, true, message, data);
});

// POST /api/visa/public/status/verify
exports.verifyCode = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa status fetched.', await service.verifyCode(req.body)));

// GET /api/visa/public/status/:reference   (header X-Status-Token)
exports.getStatus = asyncHandler(async (req, res) => {
  const token = req.get('x-status-token');
  if (!token) throw new ApiError(401, 'Your session has expired. Ask for a new code.', { code: 'TOKEN_INVALID' });
  sendResponse(res, 200, true, 'Visa status fetched.', await service.getStatus(req.params.reference, token));
});
