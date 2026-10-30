const mongoose = require('mongoose');
const PickupRequest = require('../models/PickupRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Partner = require('../models/Partner');
const VisaApplication = require('../models/VisaApplication');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const { AUDIT_ACTIONS, ROLES } = require('../config/constants');

// Helper to sanitize search string
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── Pickups ── */

exports.createPickup = async (user, payload) => {
  let partner = null;
  if (user.role === ROLES.B2B) {
    partner = await Partner.findOne({ userId: user._id });
  } else if (payload.partnerId) {
    partner = await Partner.findById(payload.partnerId);
  }

  if (!partner) {
    throw new ApiError(404, 'Partner profile not found.');
  }

  const pickup = await PickupRequest.create({
    partnerId: partner._id,
    partnerName: partner.companyName,
    location: payload.location,
    contactPerson: payload.contactPerson,
    contactPhone: payload.contactPhone,
    pickupAt: payload.pickupAt,
    travelers: payload.travelers || 1,
    notes: payload.notes || ''
  });

  await auditService.log({
    actorUserId: user._id,
    action: 'B2B_PICKUP_REQUEST',
    resource: 'PickupRequest',
    resourceId: pickup._id,
    details: { partnerId: partner._id, location: pickup.location }
  });

  return pickup;
};

exports.listPickups = async ({ partnerId, status, search, page = 1, limit = 10 }) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const filter = {};
  if (partnerId) filter.partnerId = partnerId;
  if (status) filter.status = status;
  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$or = [{ location: rx }, { partnerName: rx }, { contactPerson: rx }];
  }

  const [items, total] = await Promise.all([
    PickupRequest.find(filter)
      .populate('assignedStaff', 'name email')
      .sort({ pickupAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    PickupRequest.countDocuments(filter)
  ]);

  return {
    items: items.map((p) => ({
      id: p._id,
      partner: p.partnerName,
      location: p.location,
      pickupAt: p.pickupAt,
      travelers: p.travelers,
      status: p.status,
      assignedStaff: p.assignedStaff?.name || null,
      notes: p.notes
    })),
    meta: {
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    }
  };
};

exports.updatePickup = async (actor, id, payload) => {
  const pickup = await PickupRequest.findById(id);
  if (!pickup) throw new ApiError(404, 'Pickup request not found.');

  if (payload.status) pickup.status = payload.status;
  if (payload.assignedStaff !== undefined) pickup.assignedStaff = payload.assignedStaff || null;
  if (payload.notes !== undefined) pickup.notes = payload.notes;

  await pickup.save();

  await auditService.log({
    actorUserId: actor._id,
    action: 'B2B_PICKUP_UPDATE',
    resource: 'PickupRequest',
    resourceId: pickup._id,
    details: payload
  });

  return pickup;
};

/* ── Commissions & Balance ── */

exports.getPartnerCommissions = async (user, requestedPartnerId = null) => {
  let partner = null;
  if (user.role === ROLES.B2B) {
    partner = await Partner.findOne({ userId: user._id });
  } else if (requestedPartnerId) {
    partner = await Partner.findById(requestedPartnerId);
  }

  if (!partner) {
    if (user.role !== ROLES.B2B && !requestedPartnerId) {
      return {
        partner: null,
        totalEarned: 0,
        totalWithdrawn: 0,
        availableBalance: 0,
        completedPassportsCount: 0,
        items: []
      };
    }
    throw new ApiError(404, 'Partner not found.');
  }

  // Find all approved/completed visa applications for this partner
  const apps = await VisaApplication.find({
    channel: 'b2b',
    partnerName: partner.companyName,
    status: { $in: ['approved', 'completed', 'passport_ready'] }
  })
    .sort({ createdAt: -1 })
    .lean();

  const commissionRate = partner.commissionRate || 8; // Default 8%

  const commissionItems = apps.map((app) => {
    const serviceFee = app.price?.fees?.service || 2000;
    const earnedAmount = Math.round((serviceFee * commissionRate) / 100);
    return {
      id: app._id,
      booking: app.number || app.trackingNumber,
      applicant: app.applicant?.fullName || 'Client',
      amount: earnedAmount,
      rate: `${commissionRate}%`,
      month: new Date(app.createdAt).toLocaleString('default', { month: 'long', year: 'numeric' }),
      status: 'earned',
      date: app.createdAt
    };
  });

  const totalEarned = commissionItems.reduce((sum, item) => sum + item.amount, 0);

  // Total withdrawn / approved
  const withdrawals = await WithdrawalRequest.find({
    partnerId: partner._id,
    status: { $in: ['approved', 'paid'] }
  }).lean();

  const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amount, 0);
  const availableBalance = Math.max(0, totalEarned - totalWithdrawn);

  return {
    partner: {
      id: partner._id,
      name: partner.companyName,
      commissionRate
    },
    totalEarned,
    totalWithdrawn,
    availableBalance,
    completedPassportsCount: apps.length,
    items: commissionItems
  };
};

/* ── Withdrawals ── */

exports.createWithdrawal = async (user, payload) => {
  const partner = await Partner.findOne({ userId: user._id });
  if (!partner) throw new ApiError(404, 'Partner profile not found.');

  const commissionStats = await exports.getPartnerCommissions(user);

  if (payload.amount > commissionStats.availableBalance) {
    throw new ApiError(
      422,
      `Requested amount (${payload.amount} BDT) exceeds available balance (${commissionStats.availableBalance} BDT).`
    );
  }

  const withdrawal = await WithdrawalRequest.create({
    partnerId: partner._id,
    partnerName: partner.companyName,
    amount: payload.amount,
    method: payload.method,
    accountDetails: payload.accountDetails,
    status: 'pending'
  });

  await auditService.log({
    actorUserId: user._id,
    action: 'B2B_WITHDRAWAL_REQUEST',
    resource: 'WithdrawalRequest',
    resourceId: withdrawal._id,
    details: { amount: payload.amount, method: payload.method }
  });

  return withdrawal;
};

exports.listWithdrawals = async ({ partnerId, status, page = 1, limit = 10 }) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const filter = {};
  if (partnerId) filter.partnerId = partnerId;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    WithdrawalRequest.find(filter)
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    WithdrawalRequest.countDocuments(filter)
  ]);

  return {
    items: items.map((w) => ({
      id: w._id,
      partner: w.partnerName,
      amount: w.amount,
      method: w.method,
      accountDetails: w.accountDetails,
      requestedAt: w.createdAt,
      status: w.status,
      reviewedBy: w.reviewedBy?.name || null,
      adminNote: w.adminNote,
      transactionReference: w.transactionReference
    })),
    meta: {
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    }
  };
};

exports.reviewWithdrawal = async (actor, id, { status, adminNote, transactionReference }) => {
  const withdrawal = await WithdrawalRequest.findById(id);
  if (!withdrawal) throw new ApiError(404, 'Withdrawal request not found.');

  withdrawal.status = status;
  withdrawal.reviewedBy = actor._id;
  withdrawal.reviewedAt = new Date();
  if (adminNote) withdrawal.adminNote = adminNote;
  if (transactionReference) withdrawal.transactionReference = transactionReference;

  await withdrawal.save();

  await auditService.log({
    actorUserId: actor._id,
    action: 'B2B_WITHDRAWAL_REVIEW',
    resource: 'WithdrawalRequest',
    resourceId: withdrawal._id,
    details: { status, adminNote, transactionReference }
  });

  return withdrawal;
};
