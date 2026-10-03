const mongoose = require('mongoose');
const { ROLES, USER_STATUS, AUTH_PROVIDERS } = require('../config/constants');
const { ALL_PERMISSIONS } = require('../config/rbac');

// One identity table for all four roles. Role-specific data (e.g. a B2B company) lives in its own model.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },

    // select:false so a hash can never leak by accident. Load it with .select('+passwordHash').
    // Absent for accounts that only sign in through Firebase.
    passwordHash: { type: String, select: false },

    // No default on purpose: every creation path must choose the role explicitly.
    role: { type: String, enum: Object.values(ROLES), required: true, index: true },
    permissions: { type: [{ type: String, enum: ALL_PERMISSIONS }], default: [] },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.PENDING, index: true },

    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },

    // Incrementing this invalidates every access and refresh token issued before.
    tokenVersion: { type: Number, default: 0 },

    // B2B only
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },

    authProvider: { type: String, enum: Object.values(AUTH_PROVIDERS), default: AUTH_PROVIDERS.LOCAL },
    firebaseUid: { type: String },

    lastLoginAt: { type: Date }
  },
  { timestamps: true }
);

// Unique only when present. A partial index (not sparse) also ignores explicit nulls.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ firebaseUid: 1 }, { unique: true, partialFilterExpression: { firebaseUid: { $type: 'string' } } });

userSchema.pre('validate', function requireContact(next) {
  if (!this.email && !this.phone) {
    this.invalidate('email', 'An email or a phone number is required.');
  }
  next();
});

// Never leak secrets or internals in any JSON response.
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.tokenVersion;
    delete ret.firebaseUid;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
