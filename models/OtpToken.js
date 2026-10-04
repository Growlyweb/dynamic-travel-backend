const mongoose = require('mongoose');
const { OTP_PURPOSE } = require('../config/constants');

// One-time codes and link tokens (email verification, password reset, staff invite).
// Only the keyed hash is stored. Records are single use and expire on their own (TTL index).
const otpTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: Object.values(OTP_PURPOSE), required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    requestMeta: {
      ip: String,
      userAgent: String
    }
  },
  { timestamps: true }
);

otpTokenSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
otpTokenSchema.index({ tokenHash: 1 });
otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpToken', otpTokenSchema);
