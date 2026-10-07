const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

const DEMO_PLANS = [
  { id: 'mp_1', name: 'Starter', durationValue: 15, durationUnit: 'day', price: 500, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null, description: 'Short-trip cover for one holiday.', features: ['5% off tour packages', '5% off visa processing'], isActive: true, sortOrder: 1 },
  { id: 'mp_2', name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null, description: 'One month of member pricing.', features: ['5% off tour packages', '5% off visa processing'], isActive: true, sortOrder: 2 },
  { id: 'mp_3', name: 'Silver', durationValue: 6, durationUnit: 'month', price: 2500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 1500, description: 'Half a year of discounts.', features: ['10% off tour packages', '10% off visa processing'], isActive: true, sortOrder: 3 },
  { id: 'mp_4', name: 'Gold', durationValue: 1, durationUnit: 'year', price: 4500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 3000, description: 'Best value — full year.', features: ['10% off tour packages', '10% off visa processing'], isActive: true, sortOrder: 4 },
];

const DEMO_MEMBERSHIPS = [
  {
    id: 'mem_1', customerId: 'cus_401', customerName: 'Rohan Gupta', customerEmail: 'rohan.gupta@example.com', customerPhone: '+8801710000001',
    planId: 'mp_3', planSnapshot: { name: 'Silver', durationValue: 6, durationUnit: 'month', price: 2500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 1500 },
    startDate: '2026-08-10', endDate: '2027-02-10', status: 'active', daysLeft: 125,
    payment: { method: 'bkash', amount: 2500, trxId: 'BKX88231A', status: 'paid', paidAt: '2026-08-10' },
    source: 'admin', createdAt: '2026-08-10',
  },
  {
    id: 'mem_2', customerId: 'cus_402', customerName: 'Sara Ali', customerEmail: 'sara.ali@example.com', customerPhone: '+8801710000002',
    planId: 'mp_2', planSnapshot: { name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null },
    startDate: '2026-09-10', endDate: '2026-10-10', status: 'active', daysLeft: 4,
    payment: { method: 'nagad', amount: 900, trxId: 'NG447120C', status: 'paid', paidAt: '2026-09-10' },
    source: 'admin', createdAt: '2026-09-10',
  },
  {
    id: 'mem_3', customerId: 'cus_403', customerName: 'Tom Becker', customerEmail: 'tom.becker@example.com', customerPhone: '+8801710000003',
    planId: 'mp_1', planSnapshot: { name: 'Starter', durationValue: 15, durationUnit: 'day', price: 500, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: null },
    startDate: '2026-10-01', endDate: '2026-10-16', status: 'active', daysLeft: 10,
    payment: { method: 'online', amount: 500, trxId: 'ONL99120F', status: 'paid', paidAt: '2026-10-01' },
    source: 'admin', createdAt: '2026-10-01',
  }
];

// GET /api/memberships
exports.getMemberships = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  let items = [...DEMO_MEMBERSHIPS];
  if (status) items = items.filter(m => m.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(m => `${m.customerName} ${m.customerEmail} ${m.customerPhone}`.toLowerCase().includes(q));
  }
  sendResponse(res, 200, true, 'Memberships fetched.', { items, total: items.length });
});

// GET /api/membership-plans
exports.getPlans = asyncHandler(async (req, res) => {
  sendResponse(res, 200, true, 'Membership plans fetched.', { items: DEMO_PLANS, total: DEMO_PLANS.length });
});

// GET /api/membership-stats
exports.getStats = asyncHandler(async (req, res) => {
  const stats = {
    total: DEMO_MEMBERSHIPS.length,
    active: DEMO_MEMBERSHIPS.filter(m => m.status === 'active').length,
    expiringIn7: 1,
    expiredThisMonth: 0,
    revenueThisMonth: 3900,
    revenueByMonth: [
      { label: 'May', value: 1200 },
      { label: 'Jun', value: 2500 },
      { label: 'Jul', value: 1800 },
      { label: 'Aug', value: 3200 },
      { label: 'Sep', value: 2900 },
      { label: 'Oct', value: 3900 }
    ],
    planDistribution: [
      { label: 'Starter', value: 1 },
      { label: 'Basic', value: 1 },
      { label: 'Silver', value: 1 },
      { label: 'Gold', value: 0 }
    ]
  };
  sendResponse(res, 200, true, 'Membership stats fetched.', stats);
});
