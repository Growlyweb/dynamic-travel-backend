const { z } = require('zod');
const { idParam, pagination, search } = require('./common');

const listNotifications = z.object({
  ...pagination,
  search,
  type: z.enum(['visa', 'b2b', 'tour', 'system', 'marketing']).optional(),
  unreadOnly: z.coerce.boolean().optional()
});

const createNotification = z.object({
  recipient: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid recipient user ID').optional(),
  type: z.enum(['visa', 'b2b', 'tour', 'system', 'marketing']).default('system'),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(2000),
  link: z.string().trim().max(500).optional(),
  metadata: z.record(z.any()).optional()
});

const updateNotification = z.object({
  read: z.boolean().optional()
});

module.exports = {
  listNotifications,
  createNotification,
  updateNotification,
  idParam
};
