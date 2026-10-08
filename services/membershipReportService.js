const Membership = require('../models/Membership');
const MembershipPlan = require('../models/MembershipPlan');
const { MEMBERSHIP_STATUS: STATUS, PAYMENT_STATUS } = require('../config/constants');
const dates = require('./membershipDates');
const { effectiveFilter } = require('./membershipService');

// "Now" is the current time, and every month and day boundary is in the business time zone (Asia/Dhaka).
// Memberships use the effective status. Soft-deleted memberships are left out of every count, but their
// payments still count in revenue.

const visible = { isDeleted: false };
const between = (from, to) => ({ $gte: from, $lte: to });

// Total of the payments received in a period (inclusive), deleted memberships included.
const revenueBetween = async (from, to) => {
  const [row] = await Membership.aggregate([
    { $match: { 'payment.status': PAYMENT_STATUS.PAID, 'payment.paidAt': between(from, to) } },
    { $group: { _id: null, total: { $sum: '$payment.amount' } } }
  ]);
  return row ? row.total : 0;
};

const stats = async (now = new Date()) => {
  const here = dates.inZone(now);
  const thisMonth = dates.monthRange(here);

  // The last 6 calendar months including this one, oldest first, even when a month has no revenue.
  const months = Array.from({ length: 6 }, (_, i) => here.subtract(5 - i, 'month'));

  const [total, active, expiringIn7, expiredThisMonth, revenueThisMonth, revenueByMonth, plans, perPlan] = await Promise.all([
    Membership.countDocuments(visible),
    Membership.countDocuments({ ...visible, ...effectiveFilter(STATUS.ACTIVE, now) }),
    Membership.countDocuments({ ...visible, ...effectiveFilter(STATUS.ACTIVE, now), endDate: { $gte: now, $lte: new Date(now.getTime() + 7 * dates.DAY_MS) } }),
    // Expired (a cancelled one is not counted) with the end date inside this month.
    Membership.countDocuments({ ...visible, ...effectiveFilter(STATUS.EXPIRED, now), endDate: between(thisMonth.from, thisMonth.to) }),
    revenueBetween(thisMonth.from, thisMonth.to),
    Promise.all(months.map((month) => revenueBetween(...Object.values(dates.monthRange(month))))),
    MembershipPlan.find().sort({ sortOrder: 1, createdAt: 1 }).select('name'),
    Membership.aggregate([{ $match: visible }, { $group: { _id: '$planId', count: { $sum: 1 } } }])
  ]);

  const counts = new Map(perPlan.map((row) => [String(row._id), row.count]));
  return {
    total,
    active,
    expiringIn7,
    expiredThisMonth,
    revenueThisMonth,
    revenueByMonth: months.map((month, i) => ({ label: month.format('MMM'), value: revenueByMonth[i] })),
    // One entry per plan that exists, including plans nobody bought.
    planDistribution: plans.map((plan) => ({ label: plan.name, value: counts.get(String(plan._id)) || 0 }))
  };
};

// ---------------------------------------------------------------- sales by period

// The last 6 calendar months, oldest first. The current one is labelled "(to date)".
const monthlyPeriods = (here) =>
  Array.from({ length: 6 }, (_, i) => {
    const month = here.subtract(5 - i, 'month');
    const current = i === 5;
    return { start: month.startOf('month'), end: month.endOf('month'), label: `${month.format('MMM YYYY')}${current ? ' (to date)' : ''}` };
  });

// The last 6 fifteen-day periods, oldest first: the 1st to the 15th, and the 16th to the end of the month.
const halfPeriods = (here) => {
  const periods = [];
  let cursor = here;
  for (let i = 0; i < 6; i += 1) {
    const first = cursor.date() <= 15;
    const start = first ? cursor.startOf('month') : cursor.date(16).startOf('day');
    const end = first ? cursor.date(15).endOf('day') : cursor.endOf('month');
    periods.unshift({ start, end, label: `${start.format('MMM')} ${start.date()}-${end.date()}, ${start.format('YYYY')}` });
    // the period before this one
    cursor = first ? start.subtract(1, 'day') : start.date(15);
  }
  return periods;
};

const periods = async ({ mode = 'monthly' } = {}, now = new Date()) => {
  const here = dates.inZone(now);
  const ranges = mode === 'half' ? halfPeriods(here) : monthlyPeriods(here);

  const items = await Promise.all(
    ranges.map(async ({ start, end, label }) => {
      const from = start.toDate();
      const to = end.toDate();
      const [newCount, revenue, expiredCount, cancelledCount] = await Promise.all([
        Membership.countDocuments({ ...visible, createdAt: between(from, to) }),
        revenueBetween(from, to),
        // Not cancelled, ended inside this period, and already in the past.
        Membership.countDocuments({ ...visible, status: { $ne: STATUS.CANCELLED }, endDate: between(from, new Date(Math.min(to.getTime(), now.getTime()))) }),
        Membership.countDocuments({ ...visible, cancelledAt: between(from, to) })
      ]);
      return { id: `${mode}-${dates.ymd(start)}`, label, start: dates.ymd(start), end: dates.ymd(end), newCount, revenue, expiredCount, cancelledCount };
    })
  );
  return { items };
};

module.exports = { stats, periods };
