const CustomTourRequest = require('../models/CustomTourRequest');
const { AUDIT_ACTIONS, CUSTOM_REQUEST_STATUS: STATUS, ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const { isTourManager } = require('./tourAccess');

// Where a request may go next. CANCELLED is final.
const NEXT = {
  [STATUS.NEW]: [STATUS.IN_REVIEW, STATUS.CANCELLED],
  [STATUS.IN_REVIEW]: [STATUS.QUOTED, STATUS.CANCELLED],
  [STATUS.QUOTED]: [STATUS.IN_REVIEW, STATUS.CONFIRMED, STATUS.CANCELLED],
  [STATUS.CONFIRMED]: [STATUS.CANCELLED],
  [STATUS.CANCELLED]: []
};

const notFound = () => new ApiError(404, 'Custom tour request not found.');

// A customer reaches only their own requests; a tour manager reaches all of them.
// Someone else's request answers exactly like one that does not exist.
const loadFor = async (user, id) => {
  const request = await CustomTourRequest.findById(id);
  if (!request || (!isTourManager(user) && String(request.userId) !== user.id)) throw notFound();
  return request;
};

// The sender is the signed-in customer. The owner is never read from the body.
const create = async (user, data, context = {}) => {
  const request = await CustomTourRequest.create({ ...data, userId: user.id });
  await auditService.record({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.CUSTOM_TOUR_REQUESTED,
    targetUserId: user.id,
    resource: `custom-tour:${request._id}`,
    ip: context.ip
  });
  return request;
};

const list = async (user, query) => {
  const { page, limit, skip } = paginate(query);
  const manager = isTourManager(user);

  const filter = manager ? {} : { userId: user.id };
  if (query.status) filter.status = query.status;
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ customer: pattern }, { destination: pattern }];
  }

  const find = CustomTourRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  if (manager) find.populate('userId', 'name email phone');

  const [items, total] = await Promise.all([find, CustomTourRequest.countDocuments(filter)]);
  return { items, meta: buildMeta(total, page, limit) };
};

const get = async (user, id) => {
  const request = await loadFor(user, id);
  if (isTourManager(user)) await request.populate('userId', 'name email phone');
  return request;
};

// Managers move a request along NEXT. A customer may only cancel their own request, and only while it is NEW.
const setStatus = async (user, id, { status, note }, context = {}) => {
  const request = await loadFor(user, id);
  const manager = isTourManager(user);

  if (!manager) {
    const mayCancel = user.role === ROLES.B2C && status === STATUS.CANCELLED && request.status === STATUS.NEW;
    if (!mayCancel) throw new ApiError(403, 'You can only cancel your own request, and only while it is new.', { code: 'FORBIDDEN' });
  }
  if (!NEXT[request.status].includes(status)) {
    throw new ApiError(409, `A request that is ${request.status} cannot become ${status}.`, { code: 'INVALID_TRANSITION' });
  }

  const from = request.status;
  request.status = status;
  if (manager) {
    request.reviewedBy = user.id;
    request.reviewedAt = new Date();
    if (note !== undefined) request.reviewNote = note;
  }
  await request.save();

  await auditService.record({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.CUSTOM_TOUR_STATUS_CHANGED,
    targetUserId: request.userId,
    resource: `custom-tour:${request._id}`,
    ip: context.ip,
    meta: { from, to: status }
  });
  return request;
};

module.exports = { create, list, get, setStatus, NEXT };
