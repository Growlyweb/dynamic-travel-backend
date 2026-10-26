const mongoose = require('mongoose');

// A one-time code for the public visa status check. Like the sign-in codes it is stored only as a keyed hash, works once,
// expires on its own (TTL index) and locks after too many wrong tries. It belongs to one application, not to a user,
// because the person checking the status has no account.
const visaStatusCodeSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'VisaApplication', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    // Set when five wrong codes were typed. The record then lives until the lock ends, because it is what remembers the lock.
    lockedUntil: { type: Date, default: null },
    requestMeta: { ip: String, userAgent: String }
  },
  { timestamps: true }
);

visaStatusCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('VisaStatusCode', visaStatusCodeSchema);
