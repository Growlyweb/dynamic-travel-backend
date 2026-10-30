const mongoose = require('mongoose');
const User = require('../models/User');
const VisaApplication = require('../models/VisaApplication');
const CustomTourRequest = require('../models/CustomTourRequest');
const Membership = require('../models/Membership');
const SaleFile = require('../models/SaleFile');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const { ROLES, AUDIT_ACTIONS } = require('../config/constants');

// Helper to sanitize regex search strings
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.listCustomers = async ({ page = 1, limit = 10, search, status }) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const match = { role: ROLES.B2C };

  if (status) {
    match.status = status;
  }

  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), 'i');
    match.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'visaapplications',
        let: { userEmail: '$email', userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ['$applicant.email', '$$userEmail'] },
                  { $eq: ['$createdBy', '$$userId'] }
                ]
              }
            }
          },
          {
            $project: {
              status: 1,
              netAmount: '$account.netAmount'
            }
          }
        ],
        as: 'visaApps'
      }
    },
    {
      $lookup: {
        from: 'customtourrequests',
        let: { userEmail: '$email' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$customer.email', '$$userEmail'] }
            }
          }
        ],
        as: 'tourRequests'
      }
    },
    {
      $lookup: {
        from: 'memberships',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$customerId', '$$userId'] },
                  { $eq: ['$status', 'active'] }
                ]
              }
            }
          },
          {
            $lookup: {
              from: 'membershipplans',
              localField: 'planId',
              foreignField: '_id',
              as: 'plan'
            }
          },
          {
            $project: {
              status: 1,
              planName: { $arrayElemAt: ['$plan.name', 0] }
            }
          }
        ],
        as: 'memberships'
      }
    },
    {
      $project: {
        id: '$_id',
        name: 1,
        email: 1,
        phone: { $ifNull: ['$phone', ''] },
        country: { $ifNull: ['$address.country', 'Bangladesh'] },
        status: { $toLower: '$status' },
        joinedAt: '$createdAt',
        bookings: {
          $add: [{ $size: '$visaApps' }, { $size: '$tourRequests' }]
        },
        totalSpend: {
          $reduce: {
            input: '$visaApps',
            initialValue: 0,
            in: { $add: ['$$value', { $ifNull: ['$$this.netAmount', 0] }] }
          }
        },
        activeMembership: {
          $ifNull: [{ $arrayElemAt: ['$memberships.planName', 0] }, null]
        }
      }
    },
    { $sort: { joinedAt: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }],
        totalCount: [{ $count: 'count' }]
      }
    }
  ];

  const [result] = await User.aggregate(pipeline);
  const items = result?.items || [];
  const total = result?.totalCount[0]?.count || 0;

  return {
    items,
    meta: {
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    }
  };
};

exports.getCustomerById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid customer ID.');
  }

  const user = await User.findOne({ _id: id, role: ROLES.B2C }).lean();
  if (!user) {
    throw new ApiError(404, 'Customer not found.');
  }

  const [visaApps, tourRequests, memberships, saleFiles] = await Promise.all([
    VisaApplication.find({
      $or: [{ 'applicant.email': user.email }, { createdBy: user._id }]
    })
      .sort({ createdAt: -1 })
      .lean(),
    CustomTourRequest.find({ 'customer.email': user.email })
      .sort({ createdAt: -1 })
      .lean(),
    Membership.find({ customerId: user._id })
      .populate('planId', 'name price durationValue durationUnit')
      .sort({ createdAt: -1 })
      .lean(),
    SaleFile.find({ party: user._id })
      .sort({ date: -1 })
      .lean()
  ]);

  const totalSpend = visaApps.reduce((sum, app) => sum + (app.account?.netAmount || 0), 0);

  return {
    customer: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      country: user.address?.country || 'Bangladesh',
      address: user.address || {},
      status: (user.status || 'ACTIVE').toLowerCase(),
      joinedAt: user.createdAt,
      bookingsCount: visaApps.length + tourRequests.length,
      totalSpend,
      memberships,
      recentVisas: visaApps.slice(0, 5),
      recentTours: tourRequests.slice(0, 5),
      sales: saleFiles.slice(0, 5)
    }
  };
};

exports.updateCustomerStatus = async (actor, id, status) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid customer ID.');
  }

  const user = await User.findOne({ _id: id, role: ROLES.B2C });
  if (!user) {
    throw new ApiError(404, 'Customer not found.');
  }

  const prevStatus = user.status;
  user.status = status;
  await user.save();

  await auditService.log({
    actorUserId: actor._id,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGE,
    resource: 'User',
    resourceId: user._id,
    details: { from: prevStatus, to: status, role: ROLES.B2C }
  });

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    status: user.status.toLowerCase()
  };
};
