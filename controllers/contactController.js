const Inquiry = require('../models/Inquiry');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// POST /api/contact - Public contact submission
exports.submitContact = asyncHandler(async (req, res) => {
  const { fullName, email, contactNumber, subject, message } = req.body || {};

  if (!fullName || !fullName.trim()) {
    throw new ApiError(422, 'Full Name is required.');
  }
  if (!email || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, 'A valid Email Address is required.');
  }
  if (!contactNumber || !contactNumber.trim()) {
    throw new ApiError(422, 'Contact Number is required.');
  }
  if (!subject || !subject.trim()) {
    throw new ApiError(422, 'Subject is required.');
  }
  if (!message || !message.trim()) {
    throw new ApiError(422, 'Message cannot be empty.');
  }

  const inquiry = await Inquiry.create({
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    contactNumber: contactNumber.trim(),
    subject: subject.trim(),
    message: message.trim(),
  });

  sendResponse(
    res,
    201,
    true,
    'Your message has been received. Our team will contact you shortly.',
    { id: inquiry._id, createdAt: inquiry.createdAt }
  );
});

// GET /api/contact - Internal staff/admin inquiry list
exports.listContactInquiries = asyncHandler(async (req, res) => {
  const inquiries = await Inquiry.find().sort({ createdAt: -1 }).limit(100).lean();
  sendResponse(res, 200, true, 'Inquiries retrieved.', inquiries);
});
