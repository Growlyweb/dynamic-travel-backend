const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../config/constants');

// Append-only record of security-relevant events. Never store passwords or raw tokens here.
const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    resource: { type: String, default: '' },
    result: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
    ip: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
