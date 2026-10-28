const mongoose = require('mongoose');
const { ALL_PERMISSIONS } = require('../config/rbac');

// A named set of permissions that an admin hands to staff. The permission keys are fixed in config/rbac.json,
// the roles are data. `system` roles are made by the code and cannot be changed or deleted.
const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    // Lower case copy of the name, so "Accountant" and "accountant" cannot both exist.
    nameKey: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    permissions: { type: [{ type: String, enum: ALL_PERMISSIONS }], default: [] },
    // The template it was started from, for the "Reset to template" button. Not a rule: the permissions are what count.
    templateKey: { type: String, default: null },
    system: { type: Boolean, default: false }
  },
  { timestamps: true }
);

roleSchema.index({ nameKey: 1 }, { unique: true });

roleSchema.pre('validate', function setNameKey(next) {
  this.nameKey = String(this.name || '').trim().toLowerCase();
  next();
});

module.exports = mongoose.model('Role', roleSchema);
