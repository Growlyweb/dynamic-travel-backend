const b2cService = require('../services/b2cService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/b2c/overview
exports.getOverview = asyncHandler(async (req, res) => {
  const data = await b2cService.getOverview(req.user);
  sendResponse(res, 200, true, 'Customer overview fetched.', data);
});

// GET /api/b2c/visa-applications
exports.listVisaApplications = asyncHandler(async (req, res) => {
  const items = await b2cService.listVisaApplications(req.user, req.query);
  sendResponse(res, 200, true, 'Visa applications fetched.', items);
});

// POST /api/b2c/visa-applications
exports.createVisaApplication = asyncHandler(async (req, res) => {
  const data = await b2cService.createVisaApplication(req.user, req.body, req.files);
  sendResponse(res, 201, true, 'Visa application submitted successfully.', data);
});

// GET /api/b2c/tours/bookings
exports.listTourBookings = asyncHandler(async (req, res) => {
  const items = await b2cService.listTourBookings(req.user);
  sendResponse(res, 200, true, 'Tour bookings fetched.', items);
});

// POST /api/b2c/tours/bookings
exports.createTourBooking = asyncHandler(async (req, res) => {
  const booking = await b2cService.createTourBooking(req.user, req.body);
  sendResponse(res, 201, true, 'Tour booked successfully.', booking);
});

// GET /api/b2c/saved
exports.listSavedItems = asyncHandler(async (req, res) => {
  const items = await b2cService.listSavedItems(req.user);
  sendResponse(res, 200, true, 'Saved items fetched.', items);
});

// POST /api/b2c/saved
exports.addSavedItem = asyncHandler(async (req, res) => {
  const item = await b2cService.addSavedItem(req.user, req.body);
  sendResponse(res, 201, true, 'Item saved to wishlist.', item);
});

// DELETE /api/b2c/saved/:id
exports.removeSavedItem = asyncHandler(async (req, res) => {
  const success = await b2cService.removeSavedItem(req.user, req.params.id);
  sendResponse(res, 200, success, success ? 'Item removed from wishlist.' : 'Item not found.');
});
