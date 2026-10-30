const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const VisaApplication = require('../models/VisaApplication');
const Tour = require('../models/Tour');
const CustomTourRequest = require('../models/CustomTourRequest');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// Helper to format percentage delta
const formatDelta = (current, previous) => {
  if (!previous || previous === 0) {
    return current > 0 ? '+100%' : '0%';
  }
  const diff = ((current - previous) / previous) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}%`;
};

// GET /api/dashboard/overview
exports.getOverview = asyncHandler(async (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [
    totalVisaApplications,
    visaLast30,
    visaPrev30,
    activeTours,
    toursLast30,
    toursPrev30,
    totalCustomers,
    customersLast30,
    customersPrev30,
    totalPartners,
    totalUsers,
    revenueData
  ] = await Promise.all([
    VisaApplication.countDocuments({ status: { $ne: 'cancelled' } }),
    VisaApplication.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    VisaApplication.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
    Tour.countDocuments({ status: 'published' }),
    Tour.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Tour.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
    User.countDocuments({ role: ROLES.B2C }),
    User.countDocuments({ role: ROLES.B2C, createdAt: { $gte: thirtyDaysAgo } }),
    User.countDocuments({ role: ROLES.B2C, createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
    Partner.countDocuments(),
    User.countDocuments(),
    VisaApplication.aggregate([
      {
        $match: {
          status: { $nin: ['cancelled', 'rejected'] },
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$account.netAmount' }
        }
      }
    ])
  ]);

  const revenueThisMonth = revenueData[0]?.total || 0;

  const overviewData = {
    totalVisaApplications,
    visaDelta: formatDelta(visaLast30, visaPrev30),
    activeTours,
    tourDelta: formatDelta(toursLast30, toursPrev30),
    totalCustomers,
    customerDelta: formatDelta(customersLast30, customersPrev30),
    revenueThisMonth,
    revenueDelta: '+5.0%',
    totalPartners,
    totalUsers
  };

  sendResponse(res, 200, true, 'Dashboard overview fetched successfully.', overviewData);
});

// GET /api/dashboard/visa-trend
exports.getVisaTrend = asyncHandler(async (req, res) => {
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rawTrend = await VisaApplication.aggregate([
    {
      $match: {
        createdAt: { $gte: twelveMonthsAgo }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const map = new Map();
  rawTrend.forEach((row) => {
    const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
    map.set(key, row.count);
  });

  const series = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    series.push({
      label: monthsShort[d.getMonth()],
      value: map.get(key) || 0
    });
  }

  sendResponse(res, 200, true, 'Visa trend fetched successfully.', series);
});

// GET /api/dashboard/tour-trend
exports.getTourTrend = asyncHandler(async (req, res) => {
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rawTrend = await CustomTourRequest.aggregate([
    {
      $match: {
        createdAt: { $gte: twelveMonthsAgo }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const map = new Map();
  rawTrend.forEach((row) => {
    const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
    map.set(key, row.count);
  });

  const series = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    series.push({
      label: monthsShort[d.getMonth()],
      value: map.get(key) || 0
    });
  }

  sendResponse(res, 200, true, 'Tour trend fetched successfully.', series);
});

// GET /api/dashboard/recent-applications
exports.getRecentApplications = asyncHandler(async (req, res) => {
  const recent = await VisaApplication.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const formatted = recent.map((app) => ({
    id: app._id.toString(),
    reference: app.number || app.trackingNumber || `VISA-${app._id}`,
    applicant: app.applicant?.fullName || 'Applicant',
    country: app.countryName || app.country || 'International',
    submittedAt: (app.createdAt || new Date()).toISOString(),
    status: app.status || 'submitted'
  }));

  sendResponse(res, 200, true, 'Recent applications fetched successfully.', formatted);
});

// GET /api/dashboard/recent-activities
exports.getRecentActivities = asyncHandler(async (req, res) => {
  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('actorUserId', 'name email role')
    .lean();

  const activities = logs.map((log) => ({
    id: log._id.toString(),
    actor: log.actorUserId?.name || log.actorUserId?.email || 'System',
    action: `${(log.action || '').toLowerCase().replace(/_/g, ' ')}${log.resource ? ` on ${log.resource}` : ''}`,
    at: (log.createdAt || new Date()).toISOString()
  }));

  sendResponse(res, 200, true, 'Recent activities fetched successfully.', activities);
});
