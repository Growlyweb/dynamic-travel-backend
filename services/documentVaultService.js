const mongoose = require('mongoose');
const VisaApplication = require('../models/VisaApplication');
const Partner = require('../models/Partner');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/constants');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatBytes = (bytes = 0) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

exports.listDocuments = async ({ page = 1, limit = 10, search, status, type, module: moduleFilter, partnerId }) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (pageNum - 1) * pageSize;

  const pipelines = [];

  // 1. Visa documents pipeline
  if (!moduleFilter || moduleFilter === 'visa' || moduleFilter === 'all') {
    pipelines.push(
      VisaApplication.aggregate([
        { $unwind: '$documents' },
        {
          $project: {
            id: '$documents._id',
            docId: '$documents._id',
            parentId: '$_id',
            module: { $literal: 'visa' },
            owner: { $ifNull: ['$applicant.fullName', 'Applicant'] },
            ownerType: { $ifNull: ['$channel', 'b2c'] },
            name: { $ifNull: ['$documents.originalName', '$documents.name'] },
            type: { $ifNull: ['$documents.type', 'Document'] },
            sizeBytes: { $ifNull: ['$documents.size', 0] },
            status: { $ifNull: ['$documents.status', 'pending'] },
            reviewNote: { $ifNull: ['$documents.reviewNote', ''] },
            uploadedAt: { $ifNull: ['$documents.uploadedAt', '$createdAt'] }
          }
        }
      ])
    );
  }

  // 2. Partner documents pipeline
  if (!moduleFilter || moduleFilter === 'partner' || moduleFilter === 'all') {
    pipelines.push(
      Partner.aggregate([
        { $unwind: '$documents' },
        {
          $project: {
            id: '$documents._id',
            docId: '$documents._id',
            parentId: '$_id',
            module: { $literal: 'partner' },
            owner: { $ifNull: ['$companyName', 'Partner'] },
            ownerType: { $literal: 'b2b' },
            name: { $ifNull: ['$documents.originalName', '$documents.type'] },
            type: { $ifNull: ['$documents.type', 'Trade License'] },
            sizeBytes: { $ifNull: ['$documents.size', 0] },
            status: { $ifNull: ['$documents.status', 'pending'] },
            reviewNote: { $ifNull: ['$documents.reviewNote', ''] },
            uploadedAt: { $ifNull: ['$documents.uploadedAt', '$createdAt'] }
          }
        }
      ])
    );
  }

  const results = await Promise.all(pipelines);
  let combined = results.flat();

  if (partnerId) {
    combined = combined.filter((doc) => String(doc.parentId) === String(partnerId));
  }

  // Apply in-memory filtering for search & status across the aggregated union
  if (status) {
    combined = combined.filter((doc) => String(doc.status).toLowerCase() === status.toLowerCase());
  }

  if (type) {
    const typeRx = new RegExp(escapeRegex(type), 'i');
    combined = combined.filter((doc) => typeRx.test(doc.type));
  }

  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), 'i');
    combined = combined.filter((doc) => rx.test(doc.name) || rx.test(doc.owner) || rx.test(doc.type));
  }

  // Sort newest first
  combined.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  const total = combined.length;
  const pagedItems = combined.slice(skip, skip + pageSize).map((doc) => ({
    ...doc,
    size: formatBytes(doc.sizeBytes),
    downloadUrl:
      doc.module === 'partner'
        ? `/api/documents/partners/${doc.parentId}/${doc.docId}`
        : `/api/visa/applications/${doc.parentId}/documents/${doc.docId}/download`
  }));

  return {
    items: pagedItems,
    meta: {
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    }
  };
};

exports.updateDocumentStatus = async (actor, docId, { status, reviewNote }) => {
  // Check in VisaApplication first
  let application = await VisaApplication.findOne({ 'documents._id': docId });
  if (application) {
    const doc = application.documents.id(docId);
    if (!doc) throw new ApiError(404, 'Document not found.');
    doc.status = status;
    if (reviewNote !== undefined) doc.reviewNote = reviewNote;
    await application.save();

    await auditService.log({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.DOCUMENT_VERIFY || 'DOCUMENT_STATUS_CHANGE',
      resource: 'VisaApplication',
      resourceId: application._id,
      details: { docId, status, reviewNote }
    });

    return {
      id: doc._id,
      status: doc.status,
      reviewNote: doc.reviewNote
    };
  }

  // Check in Partner
  let partner = await Partner.findOne({ 'documents._id': docId });
  if (partner) {
    const doc = partner.documents.id(docId);
    if (!doc) throw new ApiError(404, 'Document not found.');
    doc.status = status;
    if (reviewNote !== undefined) doc.reviewNote = reviewNote;
    await partner.save();

    await auditService.log({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.DOCUMENT_VERIFY || 'DOCUMENT_STATUS_CHANGE',
      resource: 'Partner',
      resourceId: partner._id,
      details: { docId, status, reviewNote }
    });

    return {
      id: doc._id,
      status: doc.status,
      reviewNote: doc.reviewNote
    };
  }

  throw new ApiError(404, 'Document not found in any module.');
};

exports.deleteDocument = async (actor, docId) => {
  // Check in VisaApplication
  let application = await VisaApplication.findOne({ 'documents._id': docId });
  if (application) {
    application.documents.pull({ _id: docId });
    await application.save();

    await auditService.log({
      actorUserId: actor._id,
      action: 'DOCUMENT_DELETE',
      resource: 'VisaApplication',
      resourceId: application._id,
      details: { docId }
    });

    return { ok: true, deletedId: docId };
  }

  // Check in Partner
  let partner = await Partner.findOne({ 'documents._id': docId });
  if (partner) {
    partner.documents.pull({ _id: docId });
    await partner.save();

    await auditService.log({
      actorUserId: actor._id,
      action: 'DOCUMENT_DELETE',
      resource: 'Partner',
      resourceId: partner._id,
      details: { docId }
    });

    return { ok: true, deletedId: docId };
  }

  throw new ApiError(404, 'Document not found in any module.');
};
