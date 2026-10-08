const MembershipPlan = require('../models/MembershipPlan');
const Membership = require('../models/Membership');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const auditService = require('./auditService');

// "Gold", "gold" and "  GOLD  " are the same name.
const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const DUPLICATE = () => new ApiError(409, 'Another plan already uses this name.', { code: 'PLAN_NAME_TAKEN' });
const notFound = () => new ApiError(404, 'Plan not found.');

// Every plan, inactive ones included, in sortOrder. The dashboard hides inactive plans itself where needed.
const list = async ({ search } = {}) => {
  const filter = search ? { name: { $regex: escapeRegex(search), $options: 'i' } } : {};
  const items = await MembershipPlan.find(filter).sort({ sortOrder: 1, createdAt: 1 });
  return { items, total: items.length };
};

const nextSortOrder = async () => {
  const last = await MembershipPlan.findOne().sort({ sortOrder: -1 }).select('sortOrder');
  return last ? last.sortOrder + 1 : 1;
};

const create = async (actor, data, context = {}) => {
  let plan;
  try {
    plan = await MembershipPlan.create({ ...data, nameKey: keyOf(data.name), sortOrder: await nextSortOrder() });
  } catch (err) {
    if (err.code === 11000) throw DUPLICATE(); // same name, even if two requests arrived together
    throw err;
  }
  await auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.MEMBERSHIP_PLAN_CREATED, resource: `membership-plan:${plan._id}`, ip: context.ip });
  return plan;
};

// Sold memberships keep their own copy of the plan (planSnapshot), so nothing here touches them.
const update = async (actor, id, data, context = {}) => {
  const plan = await MembershipPlan.findById(id);
  if (!plan) throw notFound();

  plan.set({ ...data, nameKey: keyOf(data.name) });
  try {
    await plan.save();
  } catch (err) {
    if (err.code === 11000) throw DUPLICATE();
    throw err;
  }
  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_PLAN_UPDATED,
    resource: `membership-plan:${plan._id}`,
    ip: context.ip,
    meta: { fields: Object.keys(data) } // names only, never prices or text
  });
  return plan;
};

// Flips isActive. An inactive plan cannot be sold, but sold memberships carry on.
const toggle = async (actor, id, context = {}) => {
  const plan = await MembershipPlan.findById(id);
  if (!plan) throw notFound();

  plan.isActive = !plan.isActive;
  await plan.save();
  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_PLAN_TOGGLED,
    resource: `membership-plan:${plan._id}`,
    ip: context.ip,
    meta: { isActive: plan.isActive }
  });
  return plan;
};

// A plan any membership ever used (a soft-deleted one included) cannot be deleted: its history points at it.
const remove = async (actor, id, context = {}) => {
  const plan = await MembershipPlan.findById(id);
  if (!plan) throw notFound();

  if (await Membership.exists({ planId: plan._id })) {
    throw new ApiError(409, 'This plan has memberships. Deactivate it instead of deleting it.', { code: 'PLAN_IN_USE' });
  }
  await plan.deleteOne();
  await auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.MEMBERSHIP_PLAN_DELETED, resource: `membership-plan:${id}`, ip: context.ip });
  return { success: true, id: String(id) };
};

module.exports = { list, create, update, toggle, remove, keyOf };
