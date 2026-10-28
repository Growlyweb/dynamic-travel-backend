const service = require('../services/visaQuotationService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const contextOf = require('../utils/requestContext');

exports.partners = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Partners fetched.', await service.partnerLookup(req.query)));

exports.list = asyncHandler(async (req, res) => {
  const { items, meta } = await service.list(req.query);
  sendResponse(res, 200, true, 'Quotations fetched.', items.map(service.present), meta);
});
exports.get = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Quotation fetched.', service.present(await service.get(req.params.id))));
exports.create = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Quotation created.', service.present(await service.create(req.user, req.body, contextOf(req)))));
exports.update = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Quotation updated.', service.present(await service.update(req.user, req.params.id, req.body, contextOf(req)))));
exports.changeStatus = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Quotation status changed.', service.present(await service.changeStatus(req.user, req.params.id, req.body, contextOf(req)))));
exports.remove = asyncHandler(async (req, res) => {
  await service.remove(req.user, req.params.id, contextOf(req));
  sendResponse(res, 200, true, 'Quotation deleted.');
});
