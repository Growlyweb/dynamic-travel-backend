const { test, expect } = require('../helpers/test');
const { bearer, json, unique, phoneFor, signUpCustomer, signUpAgency, adminSession, createStaff } = require('../helpers/api');

const planBody = (name, overrides = {}) => ({
  name,
  durationValue: 15,
  durationUnit: 'day',
  price: 500,
  tourDiscountPercent: 5,
  visaDiscountPercent: 5,
  maxDiscountAmount: null,
  features: ['5% off tour packages'],
  ...overrides
});

const stats = async (ctx, token) => (await json(await ctx.get('/api/membership-stats', { headers: bearer(token) })));
const planCount = (s, name) => (s.planDistribution.find((p) => p.label === name) || {}).value;

test.describe('membership plans and memberships over real HTTP', () => {
  test('an admin builds a plan, sells it, and the customer sees their membership, the end date and the amount from the plan', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client(), { name: 'Emma Wilson', phone: phoneFor() });
    const planName = unique('Starter');

    const plan = await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(planName) });
    expect(plan.status()).toBe(201);
    const planId = (await json(plan)).id;

    const sold = await ctx.post('/api/memberships', {
      headers: bearer(admin.token),
      data: { customerId: customer.user._id, planId, paymentMethod: 'bkash', trxId: '  BKX1  ', startDate: '2026-10-01', amount: 1 }
    });
    const membership = await json(sold);
    expect(sold.status()).toBe(201);
    expect(membership).toMatchObject({
      customerId: customer.user._id,
      customerName: 'Emma Wilson',
      status: 'active',
      source: 'admin',
      startDate: '2026-09-30T18:00:00.000Z', // midnight of 1 Oct in Dhaka
      endDate: '2026-10-15T17:59:59.999Z', // the end of 15 Oct in Dhaka: the start day counts as day 1
      planSnapshot: { name: planName, durationValue: 15, price: 500 },
      payment: { method: 'bkash', amount: 500, trxId: 'BKX1', status: 'paid' } // the amount comes from the plan, not the request
    });
    expect(membership.id).toMatch(/^[0-9a-f]{24}$/);
    expect(membership).not.toHaveProperty('_id');

    // the customer sees it, as { items, total }, and cannot see the admin's note
    const mine = await json(await ctx.get('/api/b2c/memberships', { headers: bearer(customer.token) }));
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({ id: membership.id, planSnapshot: { name: planName } });
    expect(mine.items[0]).not.toHaveProperty('cancelReason');
    expect(typeof mine.items[0].daysLeft).toBe('number');

    // the admin's list and the customer's history both have it
    const all = await json(await ctx.get(`/api/memberships?search=${encodeURIComponent('Emma')}&planId=${planId}`, { headers: bearer(admin.token) }));
    expect(all.items.map((m) => m.id)).toEqual([membership.id]);
    const history = await json(await ctx.get(`/api/customers/${customer.user._id}/memberships`, { headers: bearer(admin.token) }));
    expect(history).toEqual({ items: [expect.objectContaining({ id: membership.id })] });
  });

  test('only one active membership per customer, even when five admins click at the same moment; a cancelled one can be replaced', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const planId = (await json(await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(unique('Race')) }))).id;
    const data = { customerId: customer.user._id, planId, paymentMethod: 'cash' };

    const results = await Promise.all(Array.from({ length: 5 }, () => ctx.post('/api/memberships', { headers: bearer(admin.token), data })));
    const statuses = results.map((r) => r.status()).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const loser = await json(results.find((r) => r.status() === 409));
    expect(loser.message).toBe('Customer already has an active membership - cancel or wait for expiry first.');

    const winner = await json(results.find((r) => r.status() === 201));
    const cancelled = await ctx.patch(`/api/memberships/${winner.id}/cancel`, { headers: bearer(admin.token), data: { reason: 'Customer request' } });
    expect((await json(cancelled))).toMatchObject({ status: 'cancelled', cancelReason: 'Customer request', payment: { status: 'paid' } });
    expect((await ctx.post('/api/memberships', { headers: bearer(admin.token), data })).status()).toBe(201);
    expect((await ctx.patch(`/api/memberships/${winner.id}/cancel`, { headers: bearer(admin.token), data: {} })).status()).toBe(409);
  });

  test('extend moves the end by exact days, and a customer, an agency, an admin or staff cannot be sold to wrongly', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const agency = await signUpAgency(await client());
    const planId = (await json(await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(unique('Extend')) }))).id;
    const sell = (customerId, extra = {}) => ctx.post('/api/memberships', { headers: bearer(admin.token), data: { customerId, planId, paymentMethod: 'nagad', ...extra } });

    expect((await sell(agency.user._id)).status()).toBe(400); // not a B2C customer
    expect((await json(await sell(agency.user._id))).message).toBe('Membership is only for B2C customers');
    expect((await sell('64b7f0f0f0f0f0f0f0f0f0f0')).status()).toBe(404);

    const created = await json(await sell(customer.user._id, { startDate: '2026-10-01' }));
    const extended = await json(await ctx.patch(`/api/memberships/${created.id}/extend`, { headers: bearer(admin.token), data: { days: 7 } }));
    expect(extended.endDate).toBe('2026-10-22T17:59:59.999Z');
    expect((await ctx.patch(`/api/memberships/${created.id}/extend`, { headers: bearer(admin.token), data: { days: 0 } })).status()).toBe(400);
  });

  test('plans: unique name in any letter case, edit does not change a sold membership, an inactive plan cannot be sold, a used plan cannot be deleted', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const name = unique('Gold');
    const post = (data) => ctx.post('/api/membership-plans', { headers: bearer(admin.token), data });

    const gold = await json(await post(planBody(name, { price: 4500 })));
    const clash = await post(planBody(name.toUpperCase()));
    expect(clash.status()).toBe(409);
    expect((await json(clash)).message).toBe('Another plan already uses this name.');

    const sold = await json(await ctx.post('/api/memberships', { headers: bearer(admin.token), data: { customerId: customer.user._id, planId: gold.id, paymentMethod: 'bank', trxId: 'TRX-9' } }));
    // the dashboard sends the whole plan back
    const edited = await ctx.put(`/api/membership-plans/${gold.id}`, { headers: bearer(admin.token), data: { ...gold, price: 9999, sortOrder: 99 } });
    expect(edited.status()).toBe(200);
    expect(await json(edited)).toMatchObject({ price: 9999, sortOrder: gold.sortOrder });
    const after = await json(await ctx.get(`/api/memberships?planId=${gold.id}`, { headers: bearer(admin.token) }));
    expect(after.items[0]).toMatchObject({ id: sold.id, planSnapshot: { price: 4500 }, payment: { amount: 4500 } });

    // a used plan cannot be deleted; it can be switched off, and then it cannot be sold
    const blocked = await ctx.delete(`/api/membership-plans/${gold.id}`, { headers: bearer(admin.token) });
    expect([blocked.status(), (await json(blocked)).message]).toEqual([409, 'This plan has memberships. Deactivate it instead of deleting it.']);
    expect((await json(await ctx.patch(`/api/membership-plans/${gold.id}/toggle`, { headers: bearer(admin.token) }))).isActive).toBe(false);
    const other = await signUpCustomer(await client());
    const notSellable = await ctx.post('/api/memberships', { headers: bearer(admin.token), data: { customerId: other.user._id, planId: gold.id, paymentMethod: 'cash' } });
    expect([notSellable.status(), (await json(notSellable)).message]).toEqual([400, 'Plan not available']);

    // an unused plan is deleted for real
    const spare = await json(await post(planBody(unique('Spare'))));
    expect(await json(await ctx.delete(`/api/membership-plans/${spare.id}`, { headers: bearer(admin.token) }))).toEqual({ success: true, id: spare.id });
  });

  test('a deleted membership leaves the numbers but its payment stays in revenue; the customer\'s rename follows into search', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client(), { name: 'Old Name' });
    const planName = unique('Stats');
    const plan = await json(await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(planName, { price: 1234 }) }));
    const before = await stats(ctx, admin.token);

    const sold = await json(await ctx.post('/api/memberships', { headers: bearer(admin.token), data: { customerId: customer.user._id, planId: plan.id, paymentMethod: 'cash' } }));
    const during = await stats(ctx, admin.token);
    expect(during.total).toBe(before.total + 1);
    expect(during.active).toBe(before.active + 1);
    expect(during.revenueThisMonth).toBe(before.revenueThisMonth + 1234);
    expect(planCount(during, planName)).toBe(1);
    expect(during.revenueByMonth).toHaveLength(6);

    // the customer renames themself: the admin's search follows
    await ctx.patch('/api/b2c/profile', { headers: bearer(customer.token), data: { name: 'Brand New Name' } });
    const found = await json(await ctx.get('/api/memberships?search=brand%20new', { headers: bearer(admin.token) }));
    expect(found.items.map((m) => m.id)).toEqual([sold.id]);

    expect(await json(await ctx.delete(`/api/memberships/${sold.id}`, { headers: bearer(admin.token) }))).toEqual({ success: true, id: sold.id });
    const after = await stats(ctx, admin.token);
    expect(after.total).toBe(before.total);
    expect(after.active).toBe(before.active);
    expect(planCount(after, planName)).toBe(0);
    expect(after.revenueThisMonth).toBe(before.revenueThisMonth + 1234); // the payment is still revenue
    expect((await ctx.get('/api/b2c/memberships', { headers: bearer(customer.token) })).status()).toBe(200);
    expect((await json(await ctx.get('/api/b2c/memberships', { headers: bearer(customer.token) }))).total).toBe(0);
    expect((await ctx.delete(`/api/memberships/${sold.id}`, { headers: bearer(admin.token) })).status()).toBe(404);
  });

  test('sales by period: monthly and half, six periods each, the current one last', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);

    const monthly = await json(await ctx.get('/api/membership-report/periods', { headers: bearer(admin.token) }));
    const half = await json(await ctx.get('/api/membership-report/periods?mode=half', { headers: bearer(admin.token) }));

    expect(monthly.items).toHaveLength(6);
    expect(monthly.items[5].label).toMatch(/\(to date\)$/);
    expect(monthly.items[0].id).toBe(`monthly-${monthly.items[0].start}`);
    expect(half.items).toHaveLength(6);
    expect(half.items.every((p) => /^[A-Z][a-z]{2} \d{1,2}-\d{1,2}, \d{4}$/.test(p.label))).toBe(true);
    expect((await ctx.get('/api/membership-report/periods?mode=weekly', { headers: bearer(admin.token) })).status()).toBe(400);
  });

  test('only an admin or staff holding MEMBERSHIP_MANAGE can manage; a customer, an agency and other staff cannot, and nothing changes', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const agency = await signUpAgency(await client());
    const manager = await createStaff(admin.token, { permissions: ['MEMBERSHIP_MANAGE'] });
    const plainStaff = await createStaff(admin.token, { permissions: ['TOUR_MANAGE', 'B2B_VIEW'] });
    const plan = await json(await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(unique('Guarded')) }));

    // a manager can do the work
    expect((await ctx.patch(`/api/membership-plans/${plan.id}/toggle`, { headers: bearer(manager.token) })).status()).toBe(200);
    expect((await ctx.patch(`/api/membership-plans/${plan.id}/toggle`, { headers: bearer(manager.token) })).status()).toBe(200);

    for (const [who, token] of Object.entries({ customer: customer.token, agency: agency.token, 'staff without MEMBERSHIP_MANAGE': plainStaff.token })) {
      const statuses = [
        (await ctx.post('/api/membership-plans', { headers: bearer(token), data: planBody(unique('Sneaky')) })).status(),
        (await ctx.put(`/api/membership-plans/${plan.id}`, { headers: bearer(token), data: planBody('Hijack') })).status(),
        (await ctx.delete(`/api/membership-plans/${plan.id}`, { headers: bearer(token) })).status(),
        (await ctx.post('/api/memberships', { headers: bearer(token), data: { customerId: customer.user._id, planId: plan.id, paymentMethod: 'cash' } })).status(),
        (await ctx.get('/api/memberships', { headers: bearer(token) })).status(),
        (await ctx.get('/api/membership-stats', { headers: bearer(token) })).status()
      ];
      expect({ who, statuses }).toEqual({ who, statuses: Array(6).fill(403) });
    }
    expect((await ctx.get('/api/memberships')).status()).toBe(401);
    expect((await ctx.get('/api/memberships', { headers: { Authorization: 'Bearer ' } })).status()).toBe(401);
    expect((await json(await ctx.get('/api/membership-plans', { headers: bearer(admin.token) }))).items.some((p) => p.name === 'Hijack')).toBe(false);
  });

  test('a customer reads only their own memberships, and the other routes for memberships do not exist for them', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const emma = await signUpCustomer(await client());
    const raj = await signUpCustomer(await client());
    const planId = (await json(await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: planBody(unique('Own')) }))).id;
    const sellTo = (user) => ctx.post('/api/memberships', { headers: bearer(admin.token), data: { customerId: user.user._id, planId, paymentMethod: 'cash' } });
    const emmasId = (await json(await sellTo(emma))).id;
    await sellTo(raj);

    const mine = await json(await ctx.get('/api/b2c/memberships?status=active', { headers: bearer(emma.token) }));
    expect(mine.items.map((m) => m.id)).toEqual([emmasId]);
    const sneaky = await json(await ctx.get(`/api/b2c/memberships?customerId=${raj.user._id}`, { headers: bearer(emma.token) }));
    expect(sneaky.items.every((m) => m.customerId === emma.user._id)).toBe(true);
    expect((await ctx.patch(`/api/b2c/memberships/${emmasId}/cancel`, { headers: bearer(emma.token), data: {} })).status()).toBe(404);
    expect((await ctx.get('/api/b2c/memberships', { headers: bearer(admin.token) })).status()).toBe(403);
  });

  test('validation answers 400 with a message an admin can read', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);

    const bad = await ctx.post('/api/membership-plans', { headers: bearer(admin.token), data: { name: '', durationValue: 0, durationUnit: 'week', price: -1 } });
    const body = await json(bad);

    expect(bad.status()).toBe(400);
    expect(body.message).toContain('Plan name is required.');
    expect(body.message).toContain('Duration must be at least 1.');
    expect(body.errors.map((e) => e.field).sort()).toEqual(['body.durationUnit', 'body.durationValue', 'body.name', 'body.price']);
    expect((await ctx.post('/api/memberships', { headers: bearer(admin.token), data: { planId: 'x', paymentMethod: 'card', startDate: '2026-02-30' } })).status()).toBe(400);
  });
});
