const service = require('../services/visaPublicService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

// GET /api/visa/public/status/link/:ref
exports.checkLink = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Link checked.', await service.checkLink(req.params.ref)));

// POST /api/visa/public/status/otp
exports.requestCode = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'A code has been sent.', await service.requestCode(req.body, contextOf(req))));

// POST /api/visa/public/status/verify
exports.verifyCode = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Visa status fetched.', await service.verifyCode(req.body)));
