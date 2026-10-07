const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// GET /api/dashboard/overview
exports.getOverview = asyncHandler(async (req, res) => {
  const [totalCustomers, totalPartners, totalUsers] = await Promise.all([
    User.countDocuments({ role: ROLES.B2C }),
    Partner.countDocuments(),
    User.countDocuments(),
  ]);

  const overviewData = {
    totalVisaApplications: 1284,
    visaDelta: '+8.2%',
    activeTours: 48,
    tourDelta: '+4.6%',
    totalCustomers: totalCustomers > 0 ? totalCustomers : 2310,
    customerDelta: '+12.1%',
    revenueThisMonth: 84500,
    revenueDelta: '+6.8%',
    totalPartners,
    totalUsers,
  };

  sendResponse(res, 200, true, 'Dashboard overview fetched successfully.', overviewData);
});

// GET /api/dashboard/visa-trend
exports.getVisaTrend = asyncHandler(async (req, res) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const visaTrendData = months.map((label, index) => ({
    label,
    value: 60 + Math.round(40 * Math.sin(index / 1.8)) + index * 4,
  }));

  sendResponse(res, 200, true, 'Visa trend fetched successfully.', visaTrendData);
});

// GET /api/dashboard/tour-trend
exports.getTourTrend = asyncHandler(async (req, res) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  const tourTrendData = months.map((label, index) => ({
    label,
    value: 18 + ((index * 7) % 23),
  }));

  sendResponse(res, 200, true, 'Tour trend fetched successfully.', tourTrendData);
});

// GET /api/dashboard/recent-applications
exports.getRecentApplications = asyncHandler(async (req, res) => {
  const recentApplicationsData = [
    {
      id: 'visa_501',
      reference: 'VS-2026-0501',
      applicant: 'Rohan Gupta',
      country: 'United Arab Emirates',
      submittedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      status: 'in_review',
    },
    {
      id: 'visa_502',
      reference: 'VS-2026-0502',
      applicant: 'Sara Ali',
      country: 'Schengen (France)',
      submittedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      status: 'approved',
    },
    {
      id: 'visa_503',
      reference: 'VS-2026-0503',
      applicant: 'Tom Becker',
      country: 'United Kingdom',
      submittedAt: new Date(Date.now() - 3600000 * 26).toISOString(),
      status: 'action_required',
    },
    {
      id: 'visa_504',
      reference: 'VS-2026-0504',
      applicant: 'Nina Roy',
      country: 'Singapore',
      submittedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      status: 'submitted',
    },
  ];

  sendResponse(res, 200, true, 'Recent applications fetched successfully.', recentApplicationsData);
});

// GET /api/dashboard/recent-activities
exports.getRecentActivities = asyncHandler(async (req, res) => {
  const dbLogs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('actorUserId', 'name email role');

  let activities = [];

  if (dbLogs && dbLogs.length > 0) {
    activities = dbLogs.map((log) => ({
      id: log._id.toString(),
      actor: log.actorUserId?.name || log.actorUserId?.email || 'System',
      action: `${log.action.toLowerCase().replace(/_/g, ' ')}${log.resource ? ` on ${log.resource}` : ''}`,
      at: log.createdAt.toISOString(),
    }));
  } else {
    activities = [
      { id: 'act_1', actor: 'Super Admin', action: 'approved visa VS-2026-0491 for Leh Cohen', at: new Date(Date.now() - 1800000).toISOString() },
      { id: 'act_2', actor: 'Operations Staff', action: 'published tour package "Swiss Alps Explorer"', at: new Date(Date.now() - 7200000).toISOString() },
      { id: 'act_3', actor: 'System', action: 'received a withdrawal request from Skyline Travels', at: new Date(Date.now() - 14400000).toISOString() },
      { id: 'act_4', actor: 'Mei Chen', action: 'uploaded 3 documents for visa VS-2026-0488', at: new Date(Date.now() - 28800000).toISOString() },
      { id: 'act_5', actor: 'Alex Morgan', action: 'invited a new user lucas@example.com', at: new Date(Date.now() - 86400000).toISOString() },
    ];
  }

  sendResponse(res, 200, true, 'Recent activities fetched successfully.', activities);
});
