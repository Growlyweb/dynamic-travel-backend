const mongoose = require('mongoose');
const { APPROVAL_STATUS, DOCUMENT_TYPE } = require('../config/constants');

// B2B business profile. Approval is tracked here, separately from User.status:
// the owner can log in once their email is verified, but operational access
// needs approvalStatus === APPROVED.
const documentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(DOCUMENT_TYPE), required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    // Path relative to storage/private. Never exposed to clients.
    storagePath: { type: String, required: true, select: false },
    status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  },
  { toJSON: { transform: (doc, ret) => { delete ret.storagePath; return ret; } } }
);

const partnerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyName: { type: String, required: true, trim: true, maxlength: 150 },
    licenseNo: { type: String, required: true, trim: true, unique: true },
    businessType: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    documents: { type: [documentSchema], default: [] },

    approvalStatus: {
      type: String,
      enum: Object.values(APPROVAL_STATUS),
      default: APPROVAL_STATUS.PENDING,
      index: true
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Partner', partnerSchema);
