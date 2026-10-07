const AuditLog = require('../../models/AuditLog');
const Membership = require('../../models/Membership');
const MembershipPlan = require('../../models/MembershipPlan');
const { DAY, makePlan, makeMembership, makeActors, send } = require('./helpers/membership');

const planBody = (overrides = {}) => ({
  name: 'Gold',
  durationValue: 1,
  durationUnit: 'year',
  price: 4500,
  tourDiscountPercent: 10,
  visaDiscountPercent: 10,
  maxDiscountAmount: 3000,
  description: 'Best value',
  features: ['10% off tour packages'],
  isActive: true,
  ...overrides
});

let actors;
beforeEach(async () => {
  actors = await makeActors();
});

describe('who may manage plans', () => {
  it('an admin and staff holding MEMBERSHIP_MANAGE can; everyone else is refused and nothing changes', async () => {
    const plan = await makePlan({ name: 'Existing' });
    const refused = { 'staff without MEMBERSHIP_MANAGE': actors.staff, 'a customer': actors.customer, 'an agency': actors.agency };

    expect((await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'By Admin' }))).status).toBe(201);
    expect((await send('post', '/api/membership-plans', actors.manager, planBody({ name: 'By Manager' }))).status).toBe(201);

    for (const [who, user] of Object.entries(refused)) {
      const statuses = [
        (await send('get', '/api/membership-plans', user)).status,
        (await send('post', '/api/membership-plans', user, planBody({ name: 'Sneaky' }))).status,
        (await send('put', `/api/membership-plans/${plan._id}`, user, planBody({ name: 'Hijack' }))).status,
        (await send('patch', `/api/membership-plans/${plan._id}/toggle`, user)).status,
        (await send('delete', `/api/membership-plans/${plan._id}`, user)).status
      ];
      expect({ who, statuses }).toEqual({ who, statuses: [403, 403, 403, 403, 403] });
    }
    for (const [method, url] of [['get', '/api/membership-plans'], ['post', '/api/membership-plans'], ['put', `/api/membership-plans/${plan._id}`], ['patch', `/api/membership-plans/${plan._id}/toggle`], ['delete', `/api/membership-plans/${plan._id}`]]) {
      expect({ url, status: (await send(method, url, null, planBody())).status }).toEqual({ url, status: 401 });
    }

    const after = await MembershipPlan.findById(plan._id);
    expect({ name: after.name, isActive: after.isActive }).toEqual({ name: 'Existing', isActive: true });
    expect(await MembershipPlan.countDocuments()).toBe(3);
  });
});

describe('creating a plan', () => {
  it('saves it, answers 201 with the plan itself, uses id (not _id) and sets the sort order', async () => {
    const first = await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'Starter' }));
    const second = await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'Basic' }));

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ name: 'Starter', durationValue: 1, durationUnit: 'year', price: 4500, isActive: true, sortOrder: 1 });
    expect(first.body.id).toMatch(/^[0-9a-f]{24}$/);
    expect(first.body).not.toHaveProperty('_id');
    expect(first.body).not.toHaveProperty('nameKey');
    expect(first.body).not.toHaveProperty('__v');
    expect(first.body).not.toHaveProperty('success'); // the plan itself, not wrapped
    expect(second.body.sortOrder).toBe(2);
  });

  it('applies defaults, saves a cap of 0 as null, cleans the features, and ignores id, sortOrder and timestamps', async () => {
    const res = await send('post', '/api/membership-plans', actors.admin, {
      name: '  Silver  ', durationValue: 6, durationUnit: 'month', price: 2500,
      maxDiscountAmount: 0, features: ['  10% off tours ', '', '   ', 'Priority desk'],
      id: '64b7f0f0f0f0f0f0f0f0f0f0', sortOrder: 99, createdAt: '2001-01-01', role: 'ADMIN'
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Silver', tourDiscountPercent: 0, visaDiscountPercent: 0, maxDiscountAmount: null, description: '', isActive: true, sortOrder: 1 });
    expect(res.body.features).toEqual(['10% off tours', 'Priority desk']);
    expect(res.body.id).not.toBe('64b7f0f0f0f0f0f0f0f0f0f0');
    expect(res.body.createdAt).not.toContain('2001');
    expect(res.body).not.toHaveProperty('role');
  });

  it.each([
    ['an empty name', { name: '   ' }, 'Plan name is required.'],
    ['a duration of zero', { durationValue: 0 }, 'Duration must be at least 1.'],
    ['half a duration unit', { durationValue: 1.5 }, 'Duration must be a whole number.'],
    ['a unit that is not allowed', { durationUnit: 'week' }, 'Duration unit must be one of day, month, year.'],
    ['a negative price', { price: -1 }, 'Price cannot be negative.'],
    ['a price sent as text', { price: '100' }, 'Price must be a number.'],
    ['a discount above 100', { tourDiscountPercent: 101 }, 'Tour discount must be between 0 and 100.'],
    ['a negative visa discount', { visaDiscountPercent: -1 }, 'Visa discount must be between 0 and 100.'],
    ['a negative cap', { maxDiscountAmount: -5 }, 'Maximum discount cannot be negative.']
  ])('refuses %s with 400 and a message an admin can read', async (_label, overrides, message) => {
    const res = await send('post', '/api/membership-plans', actors.admin, planBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.message).toContain(message);
    expect(await MembershipPlan.countDocuments()).toBe(0);
  });

  it('a plan name is unique in any letter case and spacing, even for requests at the same moment', async () => {
    await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'Gold' }));

    for (const name of ['gold', 'GOLD', '  Gold   ']) {
      const res = await send('post', '/api/membership-plans', actors.admin, planBody({ name }));
      expect({ name, status: res.status, message: res.body.message }).toEqual({ name, status: 409, message: 'Another plan already uses this name.' });
    }

    const results = await Promise.all(Array.from({ length: 5 }, () => send('post', '/api/membership-plans', actors.admin, planBody({ name: 'Platinum' }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await MembershipPlan.countDocuments()).toBe(2);
  });

  it('records the creation in the audit log', async () => {
    const res = await send('post', '/api/membership-plans', actors.admin, planBody());

    const entry = await AuditLog.findOne({ action: 'MEMBERSHIP_PLAN_CREATED' }).lean();
    expect(entry).toMatchObject({ resource: `membership-plan:${res.body.id}`, actorUserId: actors.admin._id });
  });
});

describe('listing plans', () => {
  it('returns every plan, inactive ones too, sorted by sortOrder, as { items, total }', async () => {
    await makePlan({ name: 'Gold', sortOrder: 4 });
    await makePlan({ name: 'Starter', sortOrder: 1 });
    await makePlan({ name: 'Hidden', sortOrder: 2, isActive: false });

    const res = await send('get', '/api/membership-plans', actors.manager);

    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.name)).toEqual(['Starter', 'Hidden', 'Gold']);
    expect(res.body.total).toBe(3);
    expect(res.body.items[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body).not.toHaveProperty('success');
  });

  it('searches the name by plain text, ignoring letter case', async () => {
    await makePlan({ name: 'Gold Plus' });
    await makePlan({ name: 'Silver' });

    expect((await send('get', '/api/membership-plans?search=GOLD', actors.admin)).body.items.map((p) => p.name)).toEqual(['Gold Plus']);
    expect((await send('get', '/api/membership-plans?search=.*', actors.admin)).body.items).toEqual([]);
    expect((await send('get', '/api/membership-plans?search=', actors.admin)).body.total).toBe(2); // blank is not a filter
  });
});

describe('editing a plan', () => {
  it('accepts the whole plan object back, ignores what is not editable, and may keep its own name', async () => {
    const created = (await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'Gold' }))).body;

    const res = await send('put', `/api/membership-plans/${created.id}`, actors.admin, {
      ...created, price: 5000, name: 'GOLD', id: '64b7f0f0f0f0f0f0f0f0f0f0', sortOrder: 77, createdAt: '2001-01-01', updatedAt: '2001-01-01'
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.id, name: 'GOLD', price: 5000, sortOrder: created.sortOrder });
    expect(res.body.createdAt).toBe(created.createdAt);
  });

  it('leaves what is not sent unchanged, and 0 as the cap switches the cap off', async () => {
    const plan = await makePlan({ name: 'Gold', maxDiscountAmount: 3000, isActive: false, features: ['a'] });

    const res = await send('put', `/api/membership-plans/${plan._id}`, actors.admin, { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 1 });
    expect(res.body).toMatchObject({ isActive: false, features: ['a'], maxDiscountAmount: 3000 });

    const off = await send('put', `/api/membership-plans/${plan._id}`, actors.admin, { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 1, maxDiscountAmount: 0 });
    expect(off.body.maxDiscountAmount).toBeNull();
  });

  it('refuses another plan\'s name, an unknown plan and bad values', async () => {
    await makePlan({ name: 'Silver' });
    const gold = await makePlan({ name: 'Gold' });

    const clash = await send('put', `/api/membership-plans/${gold._id}`, actors.admin, planBody({ name: 'silver' }));
    expect([clash.status, clash.body.message]).toEqual([409, 'Another plan already uses this name.']);
    expect((await send('put', '/api/membership-plans/64b7f0f0f0f0f0f0f0f0f0f0', actors.admin, planBody())).status).toBe(404);
    expect((await send('put', '/api/membership-plans/not-an-id', actors.admin, planBody())).status).toBe(400);
    expect((await send('put', `/api/membership-plans/${gold._id}`, actors.admin, planBody({ price: -1 }))).status).toBe(400);
    expect((await MembershipPlan.findById(gold._id)).name).toBe('Gold');
  });

  it('never changes a membership that was already sold, and the audit log names the fields, not the values', async () => {
    const plan = await makePlan({ name: 'Gold', price: 4500, tourDiscountPercent: 10 });
    const membership = await makeMembership(actors.customer, plan);

    await send('put', `/api/membership-plans/${plan._id}`, actors.admin, planBody({ name: 'Gold', price: 9999, tourDiscountPercent: 50 }));

    const sold = await Membership.findById(membership._id);
    expect(sold.planSnapshot).toMatchObject({ name: 'Gold', price: 4500, tourDiscountPercent: 10 });
    expect(sold.payment.amount).toBe(4500);
    const entry = await AuditLog.findOne({ action: 'MEMBERSHIP_PLAN_UPDATED' }).lean();
    expect(entry.meta.fields).toEqual(expect.arrayContaining(['name', 'price']));
    expect(JSON.stringify(entry)).not.toContain('9999');
  });
});

describe('switching a plan on and off', () => {
  it('flips isActive and returns the plan, with no body needed, and sold memberships carry on', async () => {
    const plan = await makePlan({ name: 'Gold' });
    const membership = await makeMembership(actors.customer, plan);

    const off = await send('patch', `/api/membership-plans/${plan._id}/toggle`, actors.manager);
    const on = await send('patch', `/api/membership-plans/${plan._id}/toggle`, actors.manager);

    expect([off.status, off.body.isActive, on.body.isActive]).toEqual([200, false, true]);
    expect((await Membership.findById(membership._id)).status).toBe('active');
    expect((await send('patch', '/api/membership-plans/64b7f0f0f0f0f0f0f0f0f0f0/toggle', actors.admin)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'MEMBERSHIP_PLAN_TOGGLED' })).toBe(2);
  });
});

describe('deleting a plan', () => {
  it('removes an unused plan and answers { success, id }', async () => {
    const plan = await makePlan({ name: 'Unused' });

    const res = await send('delete', `/api/membership-plans/${plan._id}`, actors.admin);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: String(plan._id) });
    expect(await MembershipPlan.countDocuments()).toBe(0);
    expect((await send('delete', `/api/membership-plans/${plan._id}`, actors.admin)).status).toBe(404);
  });

  it('refuses a plan any membership used, even a deleted or expired one, and says to deactivate it', async () => {
    const plan = await makePlan({ name: 'Used' });
    await makeMembership(actors.customer, plan, { isDeleted: true, deletedAt: new Date(), status: 'expired', endDate: new Date(Date.now() - DAY) });

    const res = await send('delete', `/api/membership-plans/${plan._id}`, actors.admin);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This plan has memberships. Deactivate it instead of deleting it.');
    expect(await MembershipPlan.countDocuments()).toBe(1);
  });
});

describe('the seed script (npm run seed:membership)', () => {
  const { seedMembership, PLANS } = require('../../scripts/seedMembership');

  it('creates the four starting plans once, in order, with the spec\'s placeholder values', async () => {
    expect(await seedMembership()).toEqual(['Starter', 'Basic', 'Silver', 'Gold']);

    const res = await send('get', '/api/membership-plans', actors.admin);
    expect(res.body.items.map((p) => [p.name, p.durationValue, p.durationUnit, p.price, p.tourDiscountPercent, p.maxDiscountAmount, p.sortOrder])).toEqual([
      ['Starter', 15, 'day', 500, 5, null, 1],
      ['Basic', 30, 'day', 900, 5, null, 2],
      ['Silver', 6, 'month', 2500, 10, 1500, 3],
      ['Gold', 1, 'year', 4500, 10, 3000, 4]
    ]);
    expect(PLANS).toHaveLength(4);
  });

  it('running it again changes nothing, and leaves a plan the admin edited as it is', async () => {
    await seedMembership();
    await MembershipPlan.updateOne({ name: 'Gold' }, { price: 7777 });

    expect(await seedMembership()).toEqual([]);

    expect(await MembershipPlan.countDocuments()).toBe(4);
    expect((await MembershipPlan.findOne({ name: 'Gold' })).price).toBe(7777);
  });

  it('does not add a second copy of a plan an admin already made by name', async () => {
    await send('post', '/api/membership-plans', actors.admin, planBody({ name: 'gold' }));

    expect(await seedMembership()).toEqual(['Starter', 'Basic', 'Silver']);
    expect(await MembershipPlan.countDocuments()).toBe(4);
  });
});
