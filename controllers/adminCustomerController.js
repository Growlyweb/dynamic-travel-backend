const customerService = require('../services/customerService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/admin/customers
exports.listCustomers = asyncHandler(async (req, res) => {
  const result = await customerService.listCustomers(req.query);
  sendResponse(res, 200, true, 'Customers fetched successfully.', result.items, result.meta);
});

// GET /api/admin/customers/:id
exports.getCustomer = asyncHandler(async (req, res) => {
  const data = await customerService.getCustomerById(req.params.id);
  sendResponse(res, 200, true, 'Customer details fetched successfully.', data);
});

// PATCH /api/admin/customers/:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const data = await customerService.updateCustomerStatus(req.user, req.params.id, req.body.status);
  sendResponse(res, 200, true, 'Customer status updated successfully.', data);
});
