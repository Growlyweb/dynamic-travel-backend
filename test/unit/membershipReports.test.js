const Membership = require('../../models/Membership');
const { ROLES } = require('../../config/constants');
const { createUser } = require('./helpers/factory');
const { DAY, dates, makePlan, makeMembership, makeActors, send } = require('./helpers/membership');

const STATS = '/api/membership-stats';
const PERIODS = '/api/membership-report/periods';

const here = () => dates.inZone(new Date());
const monthsAgo = (n) => here().subtract(n, 'month');
// A moment safely inside a month, so nothing here can flake near a month boundary.
const middleOf = (month) => month.date(10).hour(12).minute(0).second(0).millisecond(0).toDate();
const startOfThisMonth = () => dates.monthRange(here()).from;

let actors;
beforeEach(async () => {
  actors = await makeActors();
});

const customer = () => createUser({ role: ROLES.B2C });
const withPayment = (amount, paidAt, status = 'paid') => ({ payment: { amount, paidAt, status } });

describe('the numbers on the dashboard cards (GET /api/membership-stats)', () => {
  it('with nothing sold: zeros, six months of zero revenue, and every plan with 0', async () => {
    await makePlan({ name: 'Basic', sortOrder: 1 });
    await makePlan({ name: 'Gold', sortOrder: 2 });

    const res = await send('get', STATS, actors.admin);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, active: 0, expiringIn7: 0, expiredThisMonth: 0, revenueThisMonth: 0 });
    expect(res.body.revenueByMonth).toHaveLength(6);
    expect(res.body.revenueByMonth.every((m) => m.value === 0)).toBe(true);
    expect(res.body.planDistribution).toEqual([{ label: 'Basic', value: 0 }, { label: 'Gold', value: 0 }]);
    expect(res.body).not.toHaveProperty('success');
  });

  it('counts by effective status, leaves out cancelled and deleted ones, and counts revenue by the day it was paid', async () => {
    const basic = await makePlan({ name: 'Basic', sortOrder: 1 });
    const silver = await makePlan({ name: 'Silver', sortOrder: 2 });
    await makePlan({ name: 'Gold', sortOrder: 3 });
    const now = new Date();
    const justIntoThisMonth = new Date(startOfThisMonth().getTime() + 1);

    await makeMembership(await customer(), basic, withPayment(900, now)); // active
    await makeMembership(await customer(), basic, { endDate: new Date(now.getTime() + 3 * DAY), ...withPayment(900, now) }); // active, expiring in 3 days
    await makeMembership(await customer(), basic, { endDate: justIntoThisMonth, ...withPayment(900, middleOf(monthsAgo(2))) }); // lapsed this month (stored still active)
    await makeMembership(await customer(), silver, { status: 'expired', endDate: middleOf(monthsAgo(3)), ...withPayment(900, middleOf(monthsAgo(3))) }); // expired long ago
    await makeMembership(await customer(), basic, { status: 'cancelled', cancelledAt: now, endDate: justIntoThisMonth, ...withPayment(900, now) }); // cancelled: not "expired"
    await makeMembership(await customer(), basic, { status: 'expired', endDate: middleOf(monthsAgo(1)), ...withPayment(700, middleOf(monthsAgo(1))) }); // expired last month
    await makeMembership(await customer(), basic, withPayment(300, now, 'refunded')); // active, but refunded: no revenue
    await makeMembership(await customer(), basic, { isDeleted: true, deletedAt: now, ...withPayment(500, now) }); // deleted: no count, still revenue

    const res = await send('get', STATS, actors.manager);

    expect(res.body).toMatchObject({
      total: 7, // every status, but not the deleted one
      active: 3, // the first, the expiring one, and the refunded one
      expiringIn7: 1,
      expiredThisMonth: 1, // only the lapsed one: not the cancelled one, not the ones that ended in earlier months
      revenueThisMonth: 900 + 900 + 900 + 500 // the refunded 300 is not revenue; the deleted 500 still is
    });
    expect(res.body.revenueByMonth.map((m) => m.value)).toEqual([0, 0, 900, 900, 700, 3200]); // 3 months ago, 2 months ago, last month, this month
    expect(res.body.planDistribution).toEqual([{ label: 'Basic', value: 6 }, { label: 'Silver', value: 1 }, { label: 'Gold', value: 0 }]);
  });

  it('revenueByMonth always has exactly 6 entries, oldest first, labelled with the short month name', async () => {
    const res = await send('get', STATS, actors.admin);

    const expected = Array.from({ length: 6 }, (_, i) => monthsAgo(5 - i).format('MMM'));
    expect(res.body.revenueByMonth.map((m) => m.label)).toEqual(expected);
    expect(res.body.revenueByMonth.map((m) => m.label).every((l) => /^[A-Z][a-z]{2}$/.test(l))).toBe(true);
  });

  it('a membership sold and then deleted leaves the counts but its payment stays in revenue', async () => {
    const plan = await makePlan({ name: 'Basic', price: 900 });
    const sold = await send('post', '/api/memberships', actors.admin, { customerId: String(actors.customer._id), planId: String(plan._id), paymentMethod: 'cash' });

    await send('delete', `/api/memberships/${sold.body.id}`, actors.admin);
    const res = await send('get', STATS, actors.admin);

    expect(res.body).toMatchObject({ total: 0, active: 0, revenueThisMonth: 900 });
    expect(res.body.planDistribution).toEqual([{ label: 'Basic', value: 0 }]);
    expect(await Membership.countDocuments()).toBe(1); // the record is still there
  });

  it('a lapsed membership leaves "active" at once, with no need for the nightly job', async () => {
    const plan = await makePlan({ name: 'Basic' });
    const m = await makeMembership(actors.customer, plan);
    expect((await send('get', STATS, actors.admin)).body.active).toBe(1);

    await Membership.updateOne({ _id: m._id }, { endDate: new Date(Date.now() - DAY) });

    expect((await send('get', STATS, actors.admin)).body.active).toBe(0);
  });
});

describe('sales by period (GET /api/membership-report/periods)', () => {
  const seed = async () => {
    const plan = await makePlan({ name: 'Basic', sortOrder: 1 });
    const now = new Date();
    const last = middleOf(monthsAgo(1));
    // sold and expired last month
    await makeMembership(await customer(), plan, { status: 'expired', createdAt: last, endDate: last, ...withPayment(700, last) });
    // sold this month, cancelled this month
    await makeMembership(await customer(), plan, { status: 'cancelled', cancelledAt: now, ...withPayment(900, now) });
    // sold this month, still active
    await makeMembership(await customer(), plan, withPayment(900, now));
    // sold this month, lapsed this month
    await makeMembership(await customer(), plan, { endDate: new Date(startOfThisMonth().getTime() + 1), ...withPayment(900, now) });
  };

  it('monthly (the default): six months, oldest first, with a label, id and range for each', async () => {
    const res = await send('get', PERIODS, actors.admin);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['items']);
    expect(res.body.items).toHaveLength(6);
    const months = Array.from({ length: 6 }, (_, i) => monthsAgo(5 - i));
    expect(res.body.items.map((p) => p.start)).toEqual(months.map((m) => m.startOf('month').format('YYYY-MM-DD')));
    expect(res.body.items.map((p) => p.end)).toEqual(months.map((m) => m.endOf('month').format('YYYY-MM-DD')));
    expect(res.body.items.map((p) => p.id)).toEqual(months.map((m) => `monthly-${m.startOf('month').format('YYYY-MM-DD')}`));
    expect(res.body.items.map((p) => p.label).slice(0, 5)).toEqual(months.slice(0, 5).map((m) => m.format('MMM YYYY')));
    expect(res.body.items[5].label).toBe(`${months[5].format('MMM YYYY')} (to date)`);
    expect(new Set(res.body.items.map((p) => p.id)).size).toBe(6);
    expect(res.body.items[0]).toEqual(expect.objectContaining({ newCount: 0, revenue: 0, expiredCount: 0, cancelledCount: 0 }));
  });

  it('counts new memberships, revenue, expiries and cancellations in the period they belong to', async () => {
    await seed();

    const { items } = (await send('get', `${PERIODS}?mode=monthly`, actors.admin)).body;
    const lastMonth = items[4];
    const thisMonth = items[5];

    expect(lastMonth).toMatchObject({ newCount: 1, revenue: 700, expiredCount: 1, cancelledCount: 0 });
    expect(thisMonth).toMatchObject({
      newCount: 3, // the three sold now (the first was created last month)
      revenue: 2700,
      expiredCount: 1, // the lapsed one; the cancelled one is not "expired"
      cancelledCount: 1
    });
  });

  it('a deleted membership leaves the counts but its payment stays in the revenue of its period', async () => {
    const plan = await makePlan({ name: 'Basic' });
    await makeMembership(actors.customer, plan, { isDeleted: true, deletedAt: new Date(), ...withPayment(500, new Date()) });

    const thisMonth = (await send('get', PERIODS, actors.admin)).body.items[5];

    expect(thisMonth).toMatchObject({ newCount: 0, revenue: 500 });
  });

  it('half: six fifteen-day periods, oldest first, each the 1st to the 15th or the 16th to the end of the month', async () => {
    const res = await send('get', `${PERIODS}?mode=half`, actors.admin);

    expect(res.body.items).toHaveLength(6);
    for (const p of res.body.items) {
      expect(p.id).toBe(`half-${p.start}`);
      const [first, last] = [Number(p.start.slice(8)), Number(p.end.slice(8))];
      expect([[1, 15], [16, dates.dayjs(p.start).endOf('month').date()]]).toContainEqual([first, last]);
      expect(p.label).toMatch(/^[A-Z][a-z]{2} \d{1,2}-\d{1,2}, \d{4}$/);
    }
    // no gaps and no overlaps
    for (let i = 1; i < 6; i += 1) {
      expect(dates.dayjs(res.body.items[i].start).diff(dates.dayjs(res.body.items[i - 1].end), 'day')).toBe(1);
    }
    // the last period is the one we are in
    const today = dates.today().format('YYYY-MM-DD');
    expect(res.body.items[5].start <= today && today <= res.body.items[5].end).toBe(true);
    expect(new Set(res.body.items.map((p) => p.id)).size).toBe(6);
  });

  it('half: counts fall into the right fifteen days', async () => {
    const plan = await makePlan({ name: 'Basic' });
    const today = here();
    const inCurrent = today.date() <= 15 ? today.date(15).hour(12) : today.date(16).hour(12);
    // sold in the current fifteen-day period, and one in the period before it
    const before = today.date() <= 15 ? today.subtract(1, 'month').date(20).hour(12) : today.date(5).hour(12);
    await makeMembership(await customer(), plan, { createdAt: inCurrent.toDate(), ...withPayment(900, inCurrent.toDate()), endDate: new Date(Date.now() + 20 * DAY) });
    await makeMembership(await customer(), plan, { createdAt: before.toDate(), ...withPayment(700, before.toDate()), status: 'expired', endDate: before.toDate() });

    const { items } = (await send('get', `${PERIODS}?mode=half`, actors.admin)).body;

    expect(items[4]).toMatchObject({ newCount: 1, revenue: 700, expiredCount: 1 });
    expect(items[5]).toMatchObject({ newCount: 1, revenue: 900, expiredCount: 0 }); // a period runs to its last day
  });

  it('refuses a mode that does not exist', async () => {
    expect((await send('get', `${PERIODS}?mode=weekly`, actors.admin)).status).toBe(400);
    expect((await send('get', `${PERIODS}?mode=`, actors.admin)).status).toBe(200); // blank means the default
  });
});
