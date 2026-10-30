const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');

const list = async (userId, { page = 1, limit = 20, search = '', type = '', unreadOnly = false } = {}) => {
  const query = { recipient: userId };

  if (type) {
    query.type = type;
  }

  if (unreadOnly) {
    query.read = false;
  }

  if (search && search.trim()) {
    const escaped = escapeRegex(search.trim());
    query.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { body: { $regex: escaped, $options: 'i' } }
    ];
  }

  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
  const safeLimit = Math.min(100, Math.max(1, limit));

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ recipient: userId, read: false })
  ]);

  const formattedItems = items.map((doc) => ({
    id: String(doc._id),
    _id: doc._id,
    type: doc.type,
    title: doc.title,
    body: doc.body,
    link: doc.link,
    read: doc.read,
    readAt: doc.readAt,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }));

  return {
    items: formattedItems,
    unreadCount,
    meta: {
      page: Number(page),
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1
    }
  };
};

const markAsRead = async (userId, notificationId, read = true) => {
  const notification = await Notification.findOne({ _id: notificationId, recipient: userId });
  if (!notification) {
    throw new ApiError(404, 'Notification not found.');
  }

  notification.read = Boolean(read);
  notification.readAt = notification.read ? new Date() : null;
  await notification.save();

  return {
    id: String(notification._id),
    read: notification.read,
    readAt: notification.readAt
  };
};

const markAllRead = async (userId) => {
  const now = new Date();
  const result = await Notification.updateMany(
    { recipient: userId, read: false },
    { $set: { read: true, readAt: now } }
  );

  return {
    markedCount: result.modifiedCount || 0
  };
};

const createNotification = async ({ recipient, type = 'system', title, body, link = '', metadata = {} }) => {
  const doc = await Notification.create({
    recipient,
    type,
    title,
    body,
    link,
    metadata
  });

  return doc;
};

const deleteNotification = async (userId, notificationId) => {
  const result = await Notification.deleteOne({ _id: notificationId, recipient: userId });
  if (result.deletedCount === 0) {
    throw new ApiError(404, 'Notification not found.');
  }
  return { success: true };
};

module.exports = {
  list,
  markAsRead,
  markAllRead,
  createNotification,
  deleteNotification
};
