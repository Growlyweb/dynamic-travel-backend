const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');

// Writing an audit record must never break the request that caused it.
// Never pass passwords or raw tokens in `meta`.
const record = async ({ actorUserId, action, targetUserId, resource = '', result = 'SUCCESS', ip = '', meta }) => {
  try {
    await AuditLog.create({ actorUserId, action, targetUserId, resource, result, ip, meta });
  } catch (err) {
    logger.error({ err }, `Failed to write audit log (${action})`);
  }
};

const list = async (query) => {
  const { page, limit, skip } = paginate(query);

  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.actorUserId) filter.actorUserId = query.actorUserId;
  if (query.targetUserId) filter.targetUserId = query.targetUserId;

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter)
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

module.exports = { record, list };
