const notificationService = require('../services/inAppNotificationService');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/notifications
exports.list = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const result = await notificationService.list(userId, req.query);
  sendResponse(
    res,
    200,
    true,
    'Notifications fetched successfully.',
    result.items,
    { ...result.meta, unreadCount: result.unreadCount }
  );
});

// POST /api/notifications
exports.create = asyncHandler(async (req, res) => {
  const recipient = req.body.recipient || req.user._id || req.user.id;
  const data = await notificationService.createNotification({ ...req.body, recipient });
  sendResponse(res, 201, true, 'Notification created successfully.', data);
});

// PATCH /api/notifications/:id
exports.markAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const read = req.body && typeof req.body.read === 'boolean' ? req.body.read : true;
  const data = await notificationService.markAsRead(userId, req.params.id, read);
  sendResponse(res, 200, true, 'Notification status updated.', data);
});

// POST /api/notifications/mark-all-read
exports.markAllRead = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const data = await notificationService.markAllRead(userId);
  sendResponse(res, 200, true, 'All notifications marked as read.', data);
});

// DELETE /api/notifications/:id
exports.deleteNotification = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const data = await notificationService.deleteNotification(userId, req.params.id);
  sendResponse(res, 200, true, 'Notification deleted.', data);
});
