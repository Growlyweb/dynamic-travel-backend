const Membership = require('../models/Membership');
const MembershipPlan = require('../models/MembershipPlan');
const User = require('../models/User');
const { AUDIT_ACTIONS, MEMBERSHIP_STATUS: STATUS, PAYMENT_STATUS, ROLES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const auditService = require('./auditService');
const dates = require('./membershipDates');

const ALREADY_ACTIVE = 'Customer already has an active membership - cancel or wait for expiry first.';

// ---------------------------------------------------------------- effective status (rule R4)
//
// A membership stops giving benefits the moment its end date passes, whether or not the nightly job has run.
// So a STORED "active" with an end date in the past is reported as "expired". Every list, filter, count and stat
// goes through these, never through the raw stored status.

// What leaves the API: the effective status and daysLeft, which is computed on every read and never stored.
const serialize = (doc, now = new Date()) => {
  const m = doc.toJSON();
  const lapsed = m.status === STATUS.ACTIVE && new Date(m.endDate) < now;
  return { ...m, status: lapsed ? STATUS.EXPIRED : m.status, daysLeft: dates.daysLeft(m.endDate, now) };
};

// The same rule as a database filter, for one effective status.
const effectiveFilter = (status, now) => {
  switch (status) {
    case STATUS.ACTIVE:
      return { status: STATUS.ACTIVE, endDate: { $gte: now } };
    case STATUS.EXPIRED:
      return { $or: [{ status: STATUS.EXPIRED }, { status: STATUS.ACTIVE, endDate: { $lt: now } }] };
    default:
      return { status };
  }
};

// Deleted memberships are invisible everywhere except in revenue.
const visible = { isDeleted: false };

const notFound = () => new ApiError(404, 'Membership not found.');

// ---------------------------------------------------------------- reading

// Newest start date first. `customerId` limits the list to one customer (the customer's own view, or an admin
// looking at one customer). Returns { items, total } with no pagination, as the dashboard expects.
const list = async (query = {}, { customerId, forCustomer = false } = {}) => {
  const now = new Date();
  const filter = { ...visible };
  const and = [];

  if (customerId) filter.customerId = customerId;
  if (query.planId) filter.planId = query.planId;
  if (query.status) and.push(effectiveFilter(query.status, now));
  if (query.expiringIn !== undefined) {
    // daysLeft counts up, so 0 <= daysLeft <= N means the end is at most N whole days away.
    and.push(effectiveFilter(STATUS.ACTIVE, now), { endDate: { $lte: new Date(now.getTime() + Number(query.expiringIn) * dates.DAY_MS) } });
  }
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
    and.push({ $or: [{ customerName: pattern }, { customerPhone: pattern }, { customerEmail: pattern }] });
  }
  if (and.length) filter.$and = and;

  const docs = await Membership.find(filter).sort({ startDate: -1, _id: -1 });
  let items = docs.map((doc) => serialize(doc, now));
  // The cancel reason is the admin's internal note.
  if (forCustomer) items = items.map(({ cancelReason, ...rest }) => rest);
  return { items, total: items.length };
};

// An admin looking at one customer's history. A customer that does not exist is a 404.
const historyOf = async (customerId) => {
  if (!(await User.exists({ _id: customerId }))) throw new ApiError(404, 'Customer not found');
  const { items } = await list({}, { customerId });
  return { items }; // this answer has items only, no total (the dashboard's customer page does not read one)
};

// The customer's membership that gives benefits right now, or null. The customer profile and the booking module
// both use this.
const getActiveMembership = async (customerId, now = new Date()) => {
  const doc = await Membership.findOne({ customerId, ...visible, ...effectiveFilter(STATUS.ACTIVE, now) }).sort({ endDate: -1 });
  return doc ? serialize(doc, now) : null;
};

// The discount a membership gives on one booking, worked out from the snapshot (never from the live plan).
// `type` is 'tour' or 'visa', `amount` the price before discount in BDT.
const membershipDiscount = (membership, type, amount) => {
  const snapshot = membership.planSnapshot;
  const percent = type === 'visa' ? snapshot.visaDiscountPercent : snapshot.tourDiscountPercent;
  let discount = (amount * percent) / 100;
  if (snapshot.maxDiscountAmount) discount = Math.min(discount, snapshot.maxDiscountAmount); // per-booking cap
  return Math.round(discount * 100) / 100;
};

// ---------------------------------------------------------------- writing (admin and MEMBERSHIP_MANAGE staff)

const pickSnapshot = (plan) => ({
  name: plan.name,
  durationValue: plan.durationValue,
  durationUnit: plan.durationUnit,
  price: plan.price,
  tourDiscountPercent: plan.tourDiscountPercent,
  visaDiscountPercent: plan.visaDiscountPercent,
  maxDiscountAmount: plan.maxDiscountAmount
});

// Admin assigns a plan to a B2C customer and records the payment, in this order.
const create = async (actor, { customerId, planId, paymentMethod, trxId, startDate }, context = {}) => {
  const customer = await User.findById(customerId);
  if (!customer) throw new ApiError(404, 'Customer not found');
  if (customer.role !== ROLES.B2C) throw new ApiError(400, 'Membership is only for B2C customers', { code: 'NOT_B2C' });

  const plan = await MembershipPlan.findById(planId);
  if (!plan || !plan.isActive) throw new ApiError(400, 'Plan not available', { code: 'PLAN_NOT_AVAILABLE' });

  const now = new Date();
  // Flip this customer's lapsed memberships first, so an expired one never blocks a renewal.
  await Membership.updateMany({ customerId, status: STATUS.ACTIVE, endDate: { $lt: now } }, { status: STATUS.EXPIRED });
  if (await Membership.exists({ customerId, ...visible, ...effectiveFilter(STATUS.ACTIVE, now) })) {
    throw new ApiError(409, ALREADY_ACTIVE, { code: 'ALREADY_ACTIVE' });
  }

  const start = (startDate ? dates.parseDay(startDate) : dates.today(now)).toDate();
  let doc;
  try {
    doc = await Membership.create({
      customerId: customer._id,
      customerName: customer.name,
      customerEmail: customer.email || '',
      customerPhone: customer.phone || '',
      planId: plan._id,
      planSnapshot: pickSnapshot(plan),
      startDate: start,
      endDate: dates.calcEndDate(start, plan),
      // A start date in the future is still active on creation, as the dashboard does.
      status: STATUS.ACTIVE,
      source: 'admin',
      // The amount always comes from the plan, never from the request. The payment was already received.
      payment: { method: paymentMethod, amount: plan.price, trxId: trxId || '', status: PAYMENT_STATUS.PAID, paidAt: now }
    });
  } catch (err) {
    // Two admins at the same moment: the unique index lets only one through.
    if (err.code === 11000) throw new ApiError(409, ALREADY_ACTIVE, { code: 'ALREADY_ACTIVE' });
    throw err;
  }

  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
    targetUserId: customer._id,
    resource: `membership:${doc._id}`,
    ip: context.ip,
    meta: { planId: String(plan._id) }
  });
  return serialize(doc, now);
};

const load = async (id) => {
  const doc = await Membership.findOne({ _id: id, ...visible });
  if (!doc) throw notFound();
  return doc;
};

// Active or pending memberships can be cancelled. The payment status is not touched: refunds are handled by hand.
const cancel = async (actor, id, { reason } = {}, context = {}) => {
  const doc = await load(id);
  const effective = serialize(doc).status;
  if (effective !== STATUS.ACTIVE && effective !== STATUS.PENDING) {
    throw new ApiError(409, 'Only active or pending memberships can be cancelled.', { code: 'INVALID_STATE' });
  }

  doc.status = STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelReason = reason || '';
  await doc.save();

  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_CANCELLED,
    targetUserId: doc.customerId,
    resource: `membership:${doc._id}`,
    ip: context.ip
  });
  return serialize(doc);
};

// Only an effectively active membership can be extended. Adds whole days to the current end date.
const extend = async (actor, id, { days }, context = {}) => {
  const doc = await load(id);
  if (serialize(doc).status !== STATUS.ACTIVE) {
    throw new ApiError(409, 'Only active memberships can be extended.', { code: 'INVALID_STATE' });
  }

  doc.endDate = dates.addDays(doc.endDate, days);
  await doc.save();

  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_EXTENDED,
    targetUserId: doc.customerId,
    resource: `membership:${doc._id}`,
    ip: context.ip,
    meta: { days }
  });
  return serialize(doc);
};

// Soft delete: the membership leaves lists, counts and the one-active rule, but its payment still counts in revenue.
const remove = async (actor, id, context = {}) => {
  const doc = await load(id);
  doc.isDeleted = true;
  doc.deletedAt = new Date();
  await doc.save();

  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_DELETED,
    targetUserId: doc.customerId,
    resource: `membership:${doc._id}`,
    ip: context.ip
  });
  return { success: true, id: String(doc._id) };
};

// ---------------------------------------------------------------- upkeep

// Saves the real status of lapsed memberships (rule R5). The API is correct without it, so this only keeps the
// stored data honest. It is safe to run any number of times, and from several servers at once.
const expireLapsed = async (now = new Date()) => {
  const result = await Membership.updateMany({ status: STATUS.ACTIVE, endDate: { $lt: now } }, { status: STATUS.EXPIRED });
  return result.modifiedCount;
};

// When a customer changes their name or phone, the copies kept on their memberships follow.
const syncCustomerDetails = async (user) => {
  await Membership.updateMany({ customerId: user._id }, { customerName: user.name || '', customerPhone: user.phone || '', customerEmail: user.email || '' });
};

module.exports = {
  serialize,
  effectiveFilter,
  list,
  historyOf,
  getActiveMembership,
  membershipDiscount,
  create,
  cancel,
  extend,
  remove,
  expireLapsed,
  syncCustomerDetails
};
