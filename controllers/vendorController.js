const service = require('../services/vendorService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

exports.listVendors = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listVendors(req.query);
  sendResponse(res, 200, true, 'Vendors fetched.', items, meta);
});
exports.getVendor = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Vendor fetched.', await service.getVendor(req.params.id)));
exports.createVendor = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Vendor created.', await service.createVendor(req.user, req.body)));
exports.updateVendor = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Vendor updated.', await service.updateVendor(req.user, req.params.id, req.body)));

exports.listBills = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listBills(req.query);
  sendResponse(res, 200, true, 'Vendor bills fetched.', items, meta);
});
exports.createBill = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Vendor bill saved.', await service.createBill(req.user, req.body)));
exports.voidBill = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Vendor bill voided.', await service.voidBill(req.user, req.params.id, req.body)));

exports.listPayments = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listPayments(req.query);
  sendResponse(res, 200, true, 'Vendor payments fetched.', items, meta);
});
exports.createPayment = asyncHandler(async (req, res) => sendResponse(res, 201, true, 'Vendor payment saved.', await service.createPayment(req.user, req.body)));
exports.voidPayment = asyncHandler(async (req, res) => sendResponse(res, 200, true, 'Vendor payment voided.', await service.voidPayment(req.user, req.params.id, req.body)));
