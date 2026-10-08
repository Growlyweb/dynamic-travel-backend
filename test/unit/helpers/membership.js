const request = require('supertest');
const app = require('../../../app');
const Membership = require('../../../models/Membership');
const MembershipPlan = require('../../../models/MembershipPlan');
const dates = require('../../../services/membershipDates');
const { keyOf } = require('../../../services/membershipPlanService');
const { ROLES } = require('../../../config/constants');
const { createUser, createB2B, bearer } = require('./factory');

const DAY = dates.DAY_MS;

// A plan straight in the database (fast path for tests that are not about creating plans).
let counter = 0;
const makePlan = (overrides = {}) => {
  counter += 1;
  const name = overrides.name || `Plan ${counter}`;
  return MembershipPlan.create({
    name,
    nameKey: keyOf(name),
    durationValue: 30,
    durationUnit: 'day',
    price: 900,
    tourDiscountPercent: 5,
    visaDiscountPercent: 5,
    maxDiscountAmount: null,
    sortOrder: counter,
    ...overrides
  });
};

const snapshotOf = (plan) => ({
  name: plan.name,
  durationValue: plan.durationValue,
  durationUnit: plan.durationUnit,
  price: plan.price,
  tourDiscountPercent: plan.tourDiscountPercent,
  visaDiscountPercent: plan.visaDiscountPercent,
  maxDiscountAmount: plan.maxDiscountAmount
});

// A membership straight in the database, with full control of the dates and status.
const makeMembership = (customer, plan, overrides = {}) => {
  const start = overrides.startDate || new Date(Date.now() - 5 * DAY);
  const { payment, ...rest } = overrides;
  return Membership.create({
    customerId: customer._id,
    customerName: customer.name,
    customerEmail: customer.email || '',
    customerPhone: customer.phone || '',
    planId: plan._id,
    planSnapshot: snapshotOf(plan),
    startDate: start,
    endDate: new Date(Date.now() + 25 * DAY),
    status: 'active',
    source: 'admin',
    payment: { method: 'bkash', amount: plan.price, trxId: '', status: 'paid', paidAt: new Date(), ...payment },
    ...rest
  });
};

// The people the module cares about.
const makeActors = async () => ({
  admin: await createUser({ role: ROLES.ADMIN }),
  manager: await createUser({ role: ROLES.STAFF, permissions: ['MEMBERSHIP_MANAGE'] }),
  staff: await createUser({ role: ROLES.STAFF, permissions: ['TOUR_MANAGE', 'USER_VIEW'] }), // no MEMBERSHIP_MANAGE
  customer: await createUser({ role: ROLES.B2C, name: 'Emma Wilson', phone: '+8801712345678' }),
  agency: (await createB2B()).user
});

const send = (method, url, user, body) => {
  const req = request(app)[method](url);
  return (user ? req.set(bearer(user)) : req).send(body);
};

module.exports = { DAY, dates, makePlan, makeMembership, makeActors, send };
