const AuditLog = require('../../models/AuditLog');
const Membership = require('../../models/Membership');
const MembershipPlan = require('../../models/MembershipPlan');
const User = require('../../models/User');
const membershipService = require('../../services/membershipService');
const membershipJob = require('../../services/membershipJob');
const env = require('../../config/env');
const { ROLES } = require('../../config/constants');
const { createUser } = require('./helpers/factory');
const { DAY, dates, makePlan, makeMembership, makeActors, send } = require('./helpers/membership');

const URL = '/api/memberships';
const body = (customer, plan, overrides = {}) => ({ customerId: String(customer._id), planId: String(plan._id), paymentMethod: 'bkash', trxId: 'BKX88231A', ...overrides });
const sell = (user, customer, plan, overrides) => send('post', URL, user, body(customer, plan, overrides));
const lapse = (membership, days = 1) => Membership.updateOne({ _id: membership._id }, { endDate: new Date(Date.now() - days * DAY) });

let actors;
let plan;
beforeEach(async () => {
  actors = await makeActors();
  plan = await makePlan({ name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900 });
});

describe('who may sell and change memberships', () => {
  it('an admin and staff holding MEMBERSHIP_MANAGE can; everyone else is refused and nothing changes', async () => {
    expect((await sell(actors.admin, actors.customer, plan)).status).toBe(201);
    const other = await createUser({ role: ROLES.B2C });
    expect((await sell(actors.manager, other, plan)).status).toBe(201);

    const target = await Membership.findOne({ customerId: actors.customer._id });
    const refused = { 'staff without MEMBERSHIP_MANAGE': actors.staff, 'a customer': actors.customer, 'an agency': actors.agency };
    for (const [who, user] of Object.entries(refused)) {
      const statuses = [
        (await send('get', URL, user)).status,
        (await sell(user, await createUser({ role: ROLES.B2C }), plan)).status,
        (await send('patch', `${URL}/${target._id}/cancel`, user, {})).status,
        (await send('patch', `${URL}/${target._id}/extend`, user, { days: 5 })).status,
        (await send('delete', `${URL}/${target._id}`, user)).status,
        (await send('get', `/api/customers/${actors.customer._id}/memberships`, user)).status,
        (await send('get', '/api/membership-stats', user)).status,
        (await send('get', '/api/membership-report/periods', user)).status
      ];
      expect({ who, statuses }).toEqual({ who, statuses: Array(8).fill(403) });
    }
    for (const [method, url] of [['get', URL], ['post', URL], ['patch', `${URL}/${target._id}/cancel`], ['patch', `${URL}/${target._id}/extend`], ['delete', `${URL}/${target._id}`], ['get', `/api/customers/${actors.customer._id}/memberships`], ['get', '/api/membership-stats'], ['get', '/api/membership-report/periods']]) {
      expect({ url, status: (await send(method, url, null, {})).status }).toEqual({ url, status: 401 });
    }

    const after = await Membership.findById(target._id);
    expect({ status: after.status, deleted: after.isDeleted }).toEqual({ status: 'active', deleted: false });
    expect(await Membership.countDocuments()).toBe(2);
  });
});

describe('assigning a plan to a customer', () => {
  it('saves the membership with a copy of the plan, the amount from the plan, and the customer\'s details', async () => {
    const res = await sell(actors.admin, actors.customer, plan, { trxId: '  BKX88231A  ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      customerId: String(actors.customer._id),
      customerName: 'Emma Wilson',
      customerEmail: actors.customer.email,
      customerPhone: '+8801712345678',
      planId: String(plan._id),
      planSnapshot: { name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null },
      status: 'active',
      source: 'admin',
      payment: { method: 'bkash', amount: 900, trxId: 'BKX88231A', status: 'paid' },
      cancelledAt: null,
      cancelReason: ''
    });
    expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body).not.toHaveProperty('_id');
    expect(res.body).not.toHaveProperty('isDeleted');
    expect(res.body).not.toHaveProperty('success');
    expect(res.body.daysLeft).toBeGreaterThanOrEqual(29);
    expect(new Date(res.body.payment.paidAt).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it('the amount, status and source in the request are ignored, and the transaction id may be empty', async () => {
    const res = await sell(actors.admin, actors.customer, plan, { trxId: undefined, amount: 1, payment: { amount: 1, status: 'unpaid' }, status: 'cancelled', source: 'online' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'active', source: 'admin', payment: { amount: 900, status: 'paid', trxId: '' } });
    // cash, with an empty id, is fine too
    const cash = await sell(actors.admin, await createUser({ role: ROLES.B2C }), plan, { paymentMethod: 'cash', trxId: '' });
    expect(cash.status).toBe(201);
  });

  it('starts today in Dhaka by default, and on the day given', async () => {
    const byDefault = await sell(actors.admin, actors.customer, plan);
    expect(new Date(byDefault.body.startDate).getTime()).toBe(dates.today().toDate().getTime());

    const given = await sell(actors.admin, await createUser({ role: ROLES.B2C }), plan, { startDate: '2026-10-01' });
    expect(given.body.startDate).toBe('2026-09-30T18:00:00.000Z'); // midnight of 1 Oct in Dhaka
  });

  it.each([
    ['a 15-day plan from 1 Oct ends at the end of 15 Oct', { durationValue: 15, durationUnit: 'day' }, '2026-10-01', '2026-10-15T17:59:59.999Z'],
    ['a 30-day plan from 1 Oct ends on 30 Oct', { durationValue: 30, durationUnit: 'day' }, '2026-10-01', '2026-10-30T17:59:59.999Z'],
    ['a 6-month plan from 1 Oct ends on 31 Mar', { durationValue: 6, durationUnit: 'month' }, '2026-10-01', '2027-03-31T17:59:59.999Z'],
    ['a 1-year plan from 7 Oct ends on 6 Oct the next year', { durationValue: 1, durationUnit: 'year' }, '2026-10-07', '2027-10-06T17:59:59.999Z'],
    ['31 Jan plus 1 month clamps to 28 Feb, so it ends on 27 Feb', { durationValue: 1, durationUnit: 'month' }, '2027-01-31', '2027-02-27T17:59:59.999Z'],
    ['31 Jan plus 1 month in a leap year ends on 28 Feb', { durationValue: 1, durationUnit: 'month' }, '2028-01-31', '2028-02-28T17:59:59.999Z'],
    ['a 1-day plan ends the same day', { durationValue: 1, durationUnit: 'day' }, '2026-10-07', '2026-10-07T17:59:59.999Z']
  ])('%s', async (_label, duration, startDate, expectedEnd) => {
    const p = await makePlan(duration);

    const res = await sell(actors.admin, actors.customer, p, { startDate });

    expect(res.status).toBe(201);
    expect(res.body.endDate).toBe(expectedEnd);
  });

  it('works out dates in Dhaka time, not UTC: 01:00 in Dhaka is still today there', () => {
    expect(dates.today(new Date('2026-10-06T19:00:00Z')).format('YYYY-MM-DD')).toBe('2026-10-07'); // 01:00 on the 7th in Dhaka
    expect(dates.today(new Date('2026-10-07T17:59:00Z')).format('YYYY-MM-DD')).toBe('2026-10-07'); // 23:59 on the 7th
    expect(dates.today(new Date('2026-10-07T18:01:00Z')).format('YYYY-MM-DD')).toBe('2026-10-08'); // 00:01 on the 8th
  });

  it('keeps the planSnapshot when the plan is edited afterwards (rule R2)', async () => {
    const res = await sell(actors.admin, actors.customer, plan);
    await MembershipPlan.updateOne({ _id: plan._id }, { price: 9999, tourDiscountPercent: 80 });

    const read = (await send('get', URL, actors.admin)).body.items[0];
    expect(read.planSnapshot).toMatchObject({ price: 900, tourDiscountPercent: 5 });
    expect(read.id).toBe(res.body.id);
  });

  it('refuses an unknown customer, a non-B2C customer, an unknown or inactive plan, and bad input', async () => {
    const inactive = await makePlan({ name: 'Off', isActive: false });
    const admin2 = await createUser({ role: ROLES.ADMIN });
    const cases = [
      ['unknown customer', body({ _id: '64b7f0f0f0f0f0f0f0f0f0f0' }, plan), 404, 'Customer not found'],
      ['an agency', body(actors.agency, plan), 400, 'Membership is only for B2C customers'],
      ['an admin', body(admin2, plan), 400, 'Membership is only for B2C customers'],
      ['an unknown plan', body(actors.customer, { _id: '64b7f0f0f0f0f0f0f0f0f0f0' }), 400, 'Plan not available'],
      ['an inactive plan', body(actors.customer, inactive), 400, 'Plan not available'],
      ['a payment method that does not exist', body(actors.customer, plan, { paymentMethod: 'card' }), 400, 'Payment method must be one of'],
      ['a start date that is not a date', body(actors.customer, plan, { startDate: 'tomorrow' }), 400, 'Start date must be a date'],
      ['a start date that is not on the calendar', body(actors.customer, plan, { startDate: '2026-02-30' }), 400, 'Start date must be a real date.'],
      ['a missing customer', { planId: String(plan._id), paymentMethod: 'cash' }, 400, 'Customer is required.'],
      ['a missing plan', { customerId: String(actors.customer._id), paymentMethod: 'cash' }, 400, 'Plan is required.']
    ];
    for (const [label, payload, status, message] of cases) {
      const res = await send('post', URL, actors.admin, payload);
      expect({ label, status: res.status, message: res.body.message.includes(message) }).toEqual({ label, status, message: true });
    }
    expect(await Membership.countDocuments()).toBe(0);
  });

  it('a customer can have only one active membership, but may buy again once it has lapsed, been cancelled or been deleted', async () => {
    const first = await sell(actors.admin, actors.customer, plan);
    expect(first.status).toBe(201);

    const second = await sell(actors.admin, actors.customer, plan);
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('Customer already has an active membership - cancel or wait for expiry first.');

    await lapse({ _id: first.body.id }); // lapsed, though the stored status is still "active"
    const renewal = await sell(actors.admin, actors.customer, plan);
    expect(renewal.status).toBe(201);
    expect((await Membership.findById(first.body.id)).status).toBe('expired'); // flipped by the renewal

    await send('patch', `${URL}/${renewal.body.id}/cancel`, actors.admin, {});
    const afterCancel = await sell(actors.admin, actors.customer, plan);
    expect(afterCancel.status).toBe(201);

    await send('delete', `${URL}/${afterCancel.body.id}`, actors.admin);
    expect((await sell(actors.admin, actors.customer, plan)).status).toBe(201);
  });

  it('five requests at the same moment for one customer leave exactly one membership', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => sell(actors.admin, actors.customer, plan)));

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await Membership.countDocuments({ customerId: actors.customer._id })).toBe(1);
  });

  it('writes an audit entry that names no price and no transaction id', async () => {
    const res = await sell(actors.admin, actors.customer, plan, { trxId: 'SECRET-TRX-1' });

    const entry = await AuditLog.findOne({ action: 'MEMBERSHIP_CREATED' }).lean();
    expect(entry).toMatchObject({ actorUserId: actors.admin._id, targetUserId: actors.customer._id, resource: `membership:${res.body.id}` });
    expect(JSON.stringify(entry)).not.toContain('SECRET-TRX-1');
  });
});

describe('the effective status (rule R4)', () => {
  it('a lapsed membership is reported as expired with a negative daysLeft, though the stored status still says active', async () => {
    const m = await makeMembership(actors.customer, plan);
    await lapse(m, 1);

    const res = await send('get', URL, actors.admin);

    expect(res.body.items[0]).toMatchObject({ status: 'expired' });
    expect(res.body.items[0].daysLeft).toBeLessThan(0);
    expect((await Membership.findById(m._id)).status).toBe('active'); // the job has not run
  });

  it('?status= matches the effective status: active excludes lapsed rows, expired includes them', async () => {
    const lapsed = await makeMembership(await createUser({ role: ROLES.B2C, name: 'Lapsed' }), plan);
    await lapse(lapsed);
    await makeMembership(await createUser({ role: ROLES.B2C, name: 'Current' }), plan);
    await makeMembership(await createUser({ role: ROLES.B2C, name: 'Stored expired' }), plan, { status: 'expired', endDate: new Date(Date.now() - 3 * DAY) });
    await makeMembership(await createUser({ role: ROLES.B2C, name: 'Cancelled' }), plan, { status: 'cancelled', cancelledAt: new Date() });
    await makeMembership(await createUser({ role: ROLES.B2C, name: 'Pending' }), plan, { status: 'pending' });
    const names = async (q) => (await send('get', `${URL}?${q}`, actors.admin)).body.items.map((m) => m.customerName).sort();

    expect(await names('status=active')).toEqual(['Current']);
    expect(await names('status=expired')).toEqual(['Lapsed', 'Stored expired']);
    expect(await names('status=cancelled')).toEqual(['Cancelled']);
    expect(await names('status=pending')).toEqual(['Pending']);
    expect((await names('')).length).toBe(5);
    expect((await send('get', `${URL}?status=paused`, actors.admin)).status).toBe(400);
  });

  it('?expiringIn=7 keeps active memberships with 0 to 7 days left, and nothing else', async () => {
    const customerOf = (name) => createUser({ role: ROLES.B2C, name });
    await makeMembership(await customerOf('today'), plan, { endDate: new Date(Date.now() + 60 * 60 * 1000) }); // 0 or 1 day left
    await makeMembership(await customerOf('seven'), plan, { endDate: new Date(Date.now() + 7 * DAY - 60 * 60 * 1000) }); // 7 days left
    await makeMembership(await customerOf('eight'), plan, { endDate: new Date(Date.now() + 7 * DAY + 60 * 60 * 1000) }); // 8 days left
    await lapse(await makeMembership(await customerOf('lapsed'), plan));
    await makeMembership(await customerOf('cancelled'), plan, { status: 'cancelled', endDate: new Date(Date.now() + 2 * DAY) });

    const res = await send('get', `${URL}?expiringIn=7`, actors.admin);

    expect(res.body.items.map((m) => m.customerName).sort()).toEqual(['seven', 'today']);
    expect(res.body.items.every((m) => m.daysLeft >= 0 && m.daysLeft <= 7)).toBe(true);
    expect((await send('get', `${URL}?expiringIn=0`, actors.admin)).body.items.map((m) => m.customerName)).toEqual([]); // the hour left counts as 1 day
    expect((await send('get', `${URL}?expiringIn=abc`, actors.admin)).status).toBe(400);
  });

  it('lists newest start date first, filters by plan, and searches name, phone and email by plain text', async () => {
    const other = await makePlan({ name: 'Other' });
    const emma = await createUser({ role: ROLES.B2C, name: 'Emma Wilson', phone: '+447911123456', email: 'emma@example.com' });
    const raj = await createUser({ role: ROLES.B2C, name: 'Raj Patel', phone: '+8801555000111', email: 'raj@example.com' });
    await makeMembership(emma, plan, { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') });
    await makeMembership(raj, other, { startDate: new Date('2026-06-01'), endDate: new Date('2026-12-31') });
    const names = async (q) => (await send('get', `${URL}?${q}`, actors.admin)).body.items.map((m) => m.customerName);

    expect(await names('')).toEqual(['Raj Patel', 'Emma Wilson']);
    expect(await names(`planId=${other._id}`)).toEqual(['Raj Patel']);
    expect(await names('search=EMMA')).toEqual(['Emma Wilson']);
    expect(await names('search=555000')).toEqual(['Raj Patel']); // part of the phone number
    expect(await names('search=447911')).toEqual(['Emma Wilson']);
    expect(await names('search=example.com')).toEqual(['Raj Patel', 'Emma Wilson']);
    expect(await names('search=.*')).toEqual([]);
    expect(await names('search=&status=&planId=')).toEqual(['Raj Patel', 'Emma Wilson']); // blanks are not filters
    expect((await send('get', `${URL}?planId=bad`, actors.admin)).status).toBe(400);
  });
});

describe('cancelling', () => {
  it('cancels an active membership with a reason, leaves the payment alone, and cannot be repeated', async () => {
    const m = await makeMembership(actors.customer, plan);

    const res = await send('patch', `${URL}/${m._id}/cancel`, actors.admin, { reason: '  Customer request, refund issued.  ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelReason: 'Customer request, refund issued.', payment: { status: 'paid', amount: 900 } });
    expect(res.body.cancelledAt).toBeTruthy();
    const again = await send('patch', `${URL}/${m._id}/cancel`, actors.admin, {});
    expect([again.status, again.body.message]).toEqual([409, 'Only active or pending memberships can be cancelled.']);
    expect(await AuditLog.countDocuments({ action: 'MEMBERSHIP_CANCELLED' })).toBe(1);
  });

  it('a pending membership can be cancelled, a lapsed or expired one cannot, and the reason is optional but limited', async () => {
    const pending = await makeMembership(await createUser({ role: ROLES.B2C }), plan, { status: 'pending' });
    const lapsed = await makeMembership(await createUser({ role: ROLES.B2C }), plan);
    await lapse(lapsed);
    const customer3 = await createUser({ role: ROLES.B2C });
    const fresh = await makeMembership(customer3, plan);

    expect((await send('patch', `${URL}/${pending._id}/cancel`, actors.admin)).status).toBe(200); // no body at all
    expect((await send('patch', `${URL}/${lapsed._id}/cancel`, actors.admin, {})).status).toBe(409);
    expect((await send('patch', `${URL}/${fresh._id}/cancel`, actors.admin, { reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await send('patch', '/api/memberships/64b7f0f0f0f0f0f0f0f0f0f0/cancel', actors.admin, {})).status).toBe(404);
    expect((await Membership.findById(fresh._id)).status).toBe('active');
  });
});

describe('extending', () => {
  it('adds exactly N days to the end date and keeps the end-of-day time in Dhaka', async () => {
    const res0 = await sell(actors.admin, actors.customer, plan, { startDate: '2026-10-01' });
    const before = new Date(res0.body.endDate);

    const res = await send('patch', `${URL}/${res0.body.id}/extend`, actors.admin, { days: 7 });

    expect(res.status).toBe(200);
    expect(new Date(res.body.endDate).getTime() - before.getTime()).toBe(7 * DAY);
    expect(res.body.endDate).toBe('2026-11-06T17:59:59.999Z');
    expect(await AuditLog.countDocuments({ action: 'MEMBERSHIP_EXTENDED' })).toBe(1);
  });

  it('only an effectively active membership can be extended', async () => {
    const lapsed = await makeMembership(await createUser({ role: ROLES.B2C }), plan);
    await lapse(lapsed);
    const cancelled = await makeMembership(await createUser({ role: ROLES.B2C }), plan, { status: 'cancelled' });
    const stored = await makeMembership(await createUser({ role: ROLES.B2C }), plan, { status: 'expired', endDate: new Date(Date.now() - DAY) });

    for (const m of [lapsed, cancelled, stored]) {
      const res = await send('patch', `${URL}/${m._id}/extend`, actors.admin, { days: 7 });
      expect([res.status, res.body.message]).toEqual([409, 'Only active memberships can be extended.']);
    }
  });

  it.each([[0], [3651], [1.5], ['7'], [undefined]])('refuses days = %s', async (days) => {
    const m = await makeMembership(actors.customer, plan);

    expect((await send('patch', `${URL}/${m._id}/extend`, actors.admin, { days })).status).toBe(400);
    expect((await Membership.findById(m._id)).endDate.getTime()).toBe(m.endDate.getTime());
  });

  it('answers 404 for an unknown membership', async () => {
    expect((await send('patch', '/api/memberships/64b7f0f0f0f0f0f0f0f0f0f0/extend', actors.admin, { days: 3 })).status).toBe(404);
  });
});

describe('deleting (soft)', () => {
  it('removes it from the list and the counts, keeps the record and its payment, and cannot be repeated', async () => {
    const m = await makeMembership(actors.customer, plan);

    const res = await send('delete', `${URL}/${m._id}`, actors.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: String(m._id) });
    expect((await send('get', URL, actors.admin)).body).toEqual({ items: [], total: 0 });
    expect((await send('get', `/api/customers/${actors.customer._id}/memberships`, actors.admin)).body.items).toEqual([]);
    const kept = await Membership.findById(m._id);
    expect(kept).toMatchObject({ isDeleted: true });
    expect(kept.deletedAt).toBeTruthy();
    expect(kept.payment.amount).toBe(900);
    expect((await send('delete', `${URL}/${m._id}`, actors.admin)).status).toBe(404);
    expect((await send('patch', `${URL}/${m._id}/cancel`, actors.admin, {})).status).toBe(404);
    expect((await send('delete', '/api/memberships/64b7f0f0f0f0f0f0f0f0f0f0', actors.admin)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'MEMBERSHIP_DELETED' })).toBe(1);
  });
});

describe('one customer\'s history', () => {
  it('lists everything of that customer, newest first, as { items } with no total', async () => {
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-01-01'), status: 'expired', endDate: new Date('2026-02-01') });
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-03-01'), status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Moved abroad' });
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-05-01'), endDate: new Date(Date.now() + 10 * DAY) });
    await makeMembership(await createUser({ role: ROLES.B2C }), plan); // someone else's

    const res = await send('get', `/api/customers/${actors.customer._id}/memberships`, actors.manager);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['items']);
    expect(res.body.items.map((m) => m.status)).toEqual(['active', 'cancelled', 'expired']);
    expect(res.body.items[1].cancelReason).toBe('Moved abroad');
    expect(res.body.items.every((m) => typeof m.daysLeft === 'number')).toBe(true);
  });

  it('answers 404 for a customer that does not exist and 400 for a bad id', async () => {
    expect((await send('get', '/api/customers/64b7f0f0f0f0f0f0f0f0f0f0/memberships', actors.admin)).status).toBe(404);
    expect((await send('get', '/api/customers/nope/memberships', actors.admin)).status).toBe(400);
    expect((await send('get', `/api/customers/${actors.customer._id}/memberships`, actors.admin)).body).toEqual({ items: [] });
  });
});

describe('a customer\'s own memberships (GET /api/b2c/memberships)', () => {
  it('shows only their own, without the cancel reason, and never someone else\'s', async () => {
    const stranger = await createUser({ role: ROLES.B2C });
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-01-01'), status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Internal note' });
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-05-01') });
    await makeMembership(stranger, plan);
    const deleted = await makeMembership(actors.customer, plan, { startDate: new Date('2026-07-01'), status: 'expired', endDate: new Date('2026-08-01') });
    await Membership.updateOne({ _id: deleted._id }, { isDeleted: true });

    const res = await send('get', '/api/b2c/memberships', actors.customer);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((m) => m.status)).toEqual(['active', 'cancelled']);
    expect(res.body.items.every((m) => m.customerId === String(actors.customer._id))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('Internal note');
    expect(res.body.items[0]).not.toHaveProperty('cancelReason');
    // the answer to a stranger is their own list, not the customer's
    expect((await send('get', '/api/b2c/memberships', stranger)).body.total).toBe(1);
  });

  it('can be limited to the active one for the profile page, and ignores an id in the query', async () => {
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-01-01'), status: 'expired', endDate: new Date('2026-02-01') });
    await makeMembership(actors.customer, plan, { startDate: new Date('2026-05-01') });

    const active = await send('get', '/api/b2c/memberships?status=active', actors.customer);
    const sneaky = await send('get', `/api/b2c/memberships?customerId=${actors.admin._id}`, actors.customer);

    expect(active.body.items.map((m) => m.status)).toEqual(['active']);
    expect(sneaky.status).toBe(200);
    expect(sneaky.body.items.every((m) => m.customerId === String(actors.customer._id))).toBe(true);
    expect((await send('get', '/api/b2c/memberships?status=paused', actors.customer)).status).toBe(400);
  });

  it('is for customers only: everyone else is refused', async () => {
    for (const user of [actors.admin, actors.manager, actors.staff, actors.agency]) {
      expect((await send('get', '/api/b2c/memberships', user)).status).toBe(403);
    }
    expect((await send('get', '/api/b2c/memberships', null)).status).toBe(401);
  });

  it('there is no route to change one: a customer cannot sell, cancel, extend or delete', async () => {
    const m = await makeMembership(actors.customer, plan);

    for (const [method, url] of [['post', '/api/b2c/memberships'], ['patch', `/api/b2c/memberships/${m._id}/cancel`], ['delete', `/api/b2c/memberships/${m._id}`]]) {
      expect({ url, status: (await send(method, url, actors.customer, {})).status }).toEqual({ url, status: 404 });
    }
    expect((await Membership.findById(m._id)).status).toBe('active');
  });
});

describe('the helpers the booking module will use', () => {
  it('getActiveMembership returns the active one, and null when there is none, it lapsed, or it was deleted', async () => {
    expect(await membershipService.getActiveMembership(actors.customer._id)).toBeNull();

    const m = await makeMembership(actors.customer, plan);
    expect(await membershipService.getActiveMembership(actors.customer._id)).toMatchObject({ id: String(m._id), status: 'active' });

    await lapse(m);
    expect(await membershipService.getActiveMembership(actors.customer._id)).toBeNull();

    await Membership.updateOne({ _id: m._id }, { endDate: new Date(Date.now() + DAY), isDeleted: true });
    expect(await membershipService.getActiveMembership(actors.customer._id)).toBeNull();
  });

  it('membershipDiscount uses the percent for the type, the per-booking cap, and rounds to 2 places', () => {
    const snap = (extra) => ({ planSnapshot: { tourDiscountPercent: 10, visaDiscountPercent: 5, maxDiscountAmount: null, ...extra } });

    expect(membershipService.membershipDiscount(snap(), 'tour', 20000)).toBe(2000);
    expect(membershipService.membershipDiscount(snap(), 'visa', 20000)).toBe(1000);
    expect(membershipService.membershipDiscount(snap({ maxDiscountAmount: 1500 }), 'tour', 20000)).toBe(1500); // capped
    expect(membershipService.membershipDiscount(snap({ maxDiscountAmount: 1500 }), 'visa', 20000)).toBe(1000); // under the cap
    expect(membershipService.membershipDiscount(snap({ tourDiscountPercent: 12.5 }), 'tour', 333)).toBe(41.63);
    expect(membershipService.membershipDiscount(snap({ tourDiscountPercent: 0 }), 'tour', 5000)).toBe(0);
  });

  it('the discount comes from the snapshot, never from the live plan', async () => {
    await makeMembership(actors.customer, plan);
    await MembershipPlan.updateOne({ _id: plan._id }, { tourDiscountPercent: 90 });

    const active = await membershipService.getActiveMembership(actors.customer._id);

    expect(membershipService.membershipDiscount(active, 'tour', 1000)).toBe(50);
  });
});

describe('keeping stored data honest', () => {
  it('expireLapsed saves the expired status for lapsed memberships only, and can be run again', async () => {
    const lapsed = await makeMembership(await createUser({ role: ROLES.B2C }), plan);
    await lapse(lapsed);
    const current = await makeMembership(actors.customer, plan);
    const cancelled = await makeMembership(await createUser({ role: ROLES.B2C }), plan, { status: 'cancelled', endDate: new Date(Date.now() - DAY) });

    expect(await membershipService.expireLapsed()).toBe(1);
    expect(await membershipService.expireLapsed()).toBe(0);

    expect((await Membership.findById(lapsed._id)).status).toBe('expired');
    expect((await Membership.findById(current._id)).status).toBe('active');
    expect((await Membership.findById(cancelled._id)).status).toBe('cancelled');
  });

  it('the nightly job is off under test, runs once when started, and is scheduled for 00:05 in the business time zone', async () => {
    expect(env.membershipExpiryJob).toBe(false);
    expect(membershipJob.start()).toBeNull();

    const cron = require('node-cron');
    const stop = jest.fn();
    const schedule = jest.spyOn(cron, 'schedule').mockReturnValue({ stop });
    const lapsed = await makeMembership(actors.customer, plan);
    await lapse(lapsed);
    env.membershipExpiryJob = true;
    try {
      const task = membershipJob.start();

      expect(schedule).toHaveBeenCalledWith('5 0 * * *', expect.any(Function), { timezone: env.timezone });
      expect(task.stop).toBe(stop);
      await membershipJob.run(); // what the schedule calls
      expect((await Membership.findById(lapsed._id)).status).toBe('expired');
    } finally {
      env.membershipExpiryJob = false;
      schedule.mockRestore();
    }
  });
});

describe('keeping the customer\'s details on memberships current', () => {
  it('a customer changing their own name or phone updates the copies on all their memberships', async () => {
    await makeMembership(actors.customer, plan, { status: 'expired', endDate: new Date(Date.now() - DAY) });
    await makeMembership(actors.customer, plan);

    const res = await send('patch', '/api/b2c/profile', actors.customer, { name: 'Emma Stone', phone: '+8801999888777' });

    expect(res.status).toBe(200);
    const rows = await Membership.find({ customerId: actors.customer._id });
    expect(rows.map((m) => [m.customerName, m.customerPhone])).toEqual([['Emma Stone', '+8801999888777'], ['Emma Stone', '+8801999888777']]);
    expect((await send('get', `${URL}?search=stone`, actors.admin)).body.total).toBe(2); // search follows the new name
    expect((await send('get', `${URL}?search=wilson`, actors.admin)).body.total).toBe(0);
  });

  it('an admin editing the customer\'s details updates them too, and another customer\'s memberships are untouched', async () => {
    const other = await createUser({ role: ROLES.B2C, name: 'Someone Else' });
    await makeMembership(actors.customer, plan);
    await makeMembership(other, plan);

    await send('patch', `/api/admin/users/${actors.customer._id}`, actors.admin, { name: 'Emma Renamed' });

    expect((await Membership.findOne({ customerId: actors.customer._id })).customerName).toBe('Emma Renamed');
    expect((await Membership.findOne({ customerId: other._id })).customerName).toBe('Someone Else');
    expect((await User.findById(actors.customer._id)).name).toBe('Emma Renamed');
  });
});
