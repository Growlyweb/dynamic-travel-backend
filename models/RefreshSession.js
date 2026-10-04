const mongoose = require('mongoose');

// One row per signed-in device. Enables logout, rotation and reuse detection.
const refreshSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    // Set whenever the session stops being usable (logout, password change, rotation, theft response).
    revokedAt: { type: Date, default: null },
    // Set ONLY when the token was swapped for a new one. Presenting a rotated token again means
    // it was copied, which is what triggers the "revoke everything" theft response.
    rotatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshSession', refreshSessionSchema);
