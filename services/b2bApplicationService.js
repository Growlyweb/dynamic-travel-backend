const mongoose = require('mongoose');
const VisaApplication = require('../models/VisaApplication');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const Partner = require('../models/Partner');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const counterService = require('./counterService');
const events = require('../utils/events');
const { AUDIT_ACTIONS } = require('../config/constants');

const passportKey = (val) => String(val || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const escapeRegex = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Map backend visa status to B2B dashboard status keys
const mapStatusToKey = (status) => {
  const s = String(status || '').toLowerCase();
  if (['approved', 'issued', 'completed', 'passport_ready'].includes(s)) return 'approved';
  if (['rejected', 'cancelled'].includes(s)) return 'rejected';
  if (['action_required', 'docs_required', 'document_review'].includes(s)) return 'document_review';
  if (['on_hold', 'hold'].includes(s)) return 'on_hold';
  return 'processing';
};

const mapStatusToLabel = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'approved' || s === 'completed') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'action_required' || s === 'document_review') return 'Document Review';
  if (s === 'on_hold') return 'On Hold';
  return 'Processing';
};

exports.listApplications = async (user, query = {}) => {
  const partner = await Partner.findOne({ userId: user._id });
  if (!partner) throw new ApiError(404, 'Partner profile not found.');

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter = {
    $or: [{ partner: partner._id }, { partnerName: partner.companyName }]
  };

  // Status filtering
  if (query.status && query.status !== 'all') {
    const qKey = String(query.status).toLowerCase();
    if (qKey === 'processing') {
      filter.status = { $in: ['submitted', 'processing', 'in_process', 'under_review', 'verified'] };
    } else if (qKey === 'document_review') {
      filter.status = { $in: ['action_required', 'document_review', 'docs_required'] };
    } else if (qKey === 'approved') {
      filter.status = { $in: ['approved', 'completed', 'passport_ready', 'issued'] };
    } else if (qKey === 'rejected') {
      filter.status = { $in: ['rejected', 'cancelled'] };
    } else if (qKey === 'on_hold') {
      filter.status = { $in: ['on_hold', 'hold'] };
    }
  }

  // Type filter
  if (query.visaType) {
    filter.visaTypeName = new RegExp(escapeRegex(query.visaType.trim()), 'i');
  }

  // Search filter
  if (query.search && query.search.trim()) {
    const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { number: rx },
        { 'applicant.fullName': rx },
        { 'passport.number': rx },
        { countryName: rx }
      ]
    });
  }

  const [items, total] = await Promise.all([
    VisaApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    VisaApplication.countDocuments(filter)
  ]);

  const commissionRate = partner.commissionRate || 12;

  const formattedItems = items.map((app) => {
    const fee = app.account?.totalAmount || 14500;
    const earnedCommission = Math.round((fee * commissionRate) / 100);
    const statusKey = mapStatusToKey(app.status);
    const statusLabel = mapStatusToLabel(app.status);

    return {
      id: app._id,
      appRef: app.number,
      number: app.number,
      applicantName: app.applicant?.fullName || 'Client',
      passportNo: app.passport?.number || '',
      passportExpiry: app.passport?.expiry || '',
      country: app.countryName || 'China',
      applicationType: app.visaTypeName || 'Tourist Visa',
      travelDate: app.applicant?.dob || 'Flexible',
      applyDate: new Date(app.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      status: statusLabel,
      statusKey,
      fee: `BDT ${fee.toLocaleString()}`,
      feeAmount: fee,
      commission: `BDT ${earnedCommission.toLocaleString()}`,
      commissionAmount: earnedCommission,
      documentsCount: (app.documents || []).length,
      createdAt: app.createdAt
    };
  });

  return {
    items: formattedItems,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    }
  };
};

exports.createApplication = async (user, body) => {
  const partner = await Partner.findOne({ userId: user._id });
  if (!partner) throw new ApiError(404, 'Partner profile not found.');

  // Lookup country
  let country = null;
  if (body.countryId && mongoose.isValidObjectId(body.countryId)) {
    country = await VisaCountry.findById(body.countryId);
  } else if (body.countryCode) {
    country = await VisaCountry.findOne({ code: body.countryCode.toUpperCase() });
  } else if (body.country) {
    country = await VisaCountry.findOne({ name: new RegExp(`^${escapeRegex(body.country.trim())}$`, 'i') });
  }

  // Lookup visa type
  let type = null;
  if (body.visaTypeId && mongoose.isValidObjectId(body.visaTypeId)) {
    type = await VisaType.findById(body.visaTypeId);
  } else if (body.applicationType || body.visaType) {
    const typeName = body.applicationType || body.visaType;
    type = await VisaType.findOne({ name: new RegExp(`^${escapeRegex(typeName.trim())}$`, 'i') });
  }

  const appNumber = await counterService.nextNumber('APP', { width: 4 });
  const fee = Number(body.fee) || 14500;
  const commissionRate = partner.commissionRate || 12;

  const application = await VisaApplication.create({
    number: appNumber,
    serviceType: 'visa',
    channel: 'b2b',
    partner: partner._id,
    partnerName: partner.companyName,
    country: country ? country._id : new mongoose.Types.ObjectId(),
    countryName: country ? country.name : (body.country || 'China'),
    visaType: type ? type._id : new mongoose.Types.ObjectId(),
    visaTypeName: type ? type.name : (body.applicationType || body.visaType || 'Tourist Visa'),
    applicant: {
      fullName: body.applicantName,
      mobile: body.contactPhone || partner.address || '+8801700000000',
      email: body.email || '',
      applicantType: 'individual'
    },
    passport: {
      number: body.passportNo,
      numberKey: passportKey(body.passportNo),
      expiry: body.passportExpiry || ''
    },
    service: {
      entries: 'single',
      duration: '30 Days'
    },
    status: 'submitted',
    statusHistory: [{ status: 'submitted', at: new Date() }],
    timeline: [
      {
        event: 'Application Submitted',
        message: 'Application created via B2B Partner Portal',
        visibility: 'both',
        by: partner.companyName,
        byUserId: user._id
      }
    ],
    price: {
      currency: 'BDT',
      rateToBase: 1,
      b2c: fee,
      b2b: Math.round(fee * (1 - commissionRate / 100)),
      fees: { service: Math.round(fee * 0.2), embassy: Math.round(fee * 0.8), vat: 0 }
    },
    account: {
      totalAmount: fee,
      netAmount: fee,
      advancePaid: 0,
      dueAmount: fee,
      paymentStatus: 'Unpaid'
    },
    createdBy: user._id
  });

  // Emit event for notification and accounting
  events.emit(events.EVENTS.VISA_APPLICATION_CREATED, {
    applicationId: String(application._id),
    number: application.number
  });

  await auditService.record({
    actorUserId: user._id,
    action: AUDIT_ACTIONS.VISA_APPLICATION_CREATED || 'VISA_APPLICATION_CREATED',
    resource: 'VisaApplication',
    resourceId: application._id,
    details: { number: application.number, partnerId: partner._id }
  });

  return {
    id: application._id,
    appRef: application.number,
    number: application.number,
    applicantName: application.applicant.fullName,
    passportNo: application.passport.number,
    country: application.countryName,
    applicationType: application.visaTypeName,
    status: 'Processing',
    statusKey: 'processing',
    fee: `BDT ${fee.toLocaleString()}`,
    commission: `BDT ${Math.round((fee * commissionRate) / 100).toLocaleString()}`,
    createdAt: application.createdAt
  };
};

exports.getApplication = async (user, id) => {
  const partner = await Partner.findOne({ userId: user._id });
  if (!partner) throw new ApiError(404, 'Partner profile not found.');

  const application = await VisaApplication.findOne({
    _id: id,
    $or: [{ partner: partner._id }, { partnerName: partner.companyName }]
  }).lean();

  if (!application) throw new ApiError(404, 'Application not found.');

  return application;
};
