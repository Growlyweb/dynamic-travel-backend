const mongoose = require('mongoose');
const { MESSAGE_CHANNELS, TEMPLATE_SERVICES } = require('../config/visa');

// Wording sent when an application reaches a status. `channel` is "email" (sent automatically through EmailJS when the
// status is reached) or "sms" (a prepared message that staff send by hand and mark as sent). The words
// {{applicantName}}, {{applicationNumber}}, {{country}}, {{visaType}}, {{status}} and {{trackingUrl}} are filled in.
// `serviceType` is the service the wording is for ("all" is any service that has no template of its own for the channel).
// A template with none was written when there were only visas, so it is a visa template.
// `active` is the on/off switch of each template.
const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true, index: true },
    trigger: { type: String, required: true, trim: true, maxlength: 40, index: true },
    serviceType: { type: String, enum: TEMPLATE_SERVICES, default: 'visa' },
    subject: { type: String, trim: true, maxlength: 150, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.nameKey; delete ret.__v; return ret; } } }
);

messageTemplateSchema.index({ channel: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
