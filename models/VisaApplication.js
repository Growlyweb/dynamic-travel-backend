const mongoose = require('mongoose');
const { APPLICANT_TYPES, PASSPORT_SUBMISSION_METHODS, PASSPORT_STATUSES, PASSPORT_REQUIREMENTS } = require('../config/visa');

const { ObjectId } = mongoose.Schema.Types;

// One visa file. Staff create it from the dashboard; the money numbers are calculated by services/visaMoney.js and
// never taken from the browser. Lists that belong to one application only (documents, timeline, notes, payments)
// are embedded, so an application is a single read.

const money = { type: Number, min: 0, default: 0 };

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, required: true, maxlength: 40 },
    date: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    enteredBy: { type: ObjectId, ref: 'User' },
    enteredByName: { type: String, default: '' },
    voided: { type: Boolean, default: false },
    voidedAt: { type: Date },
    voidedBy: { type: ObjectId, ref: 'User' },
    voidedByName: { type: String, default: '' },
    voidReason: { type: String, trim: true, maxlength: 300, default: '' }
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const documentSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 200 },
    checklistItem: { type: ObjectId },
    originalName: { type: String, required: true, maxlength: 120 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storagePath: { type: String, required: true },
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
    uploadedBy: { type: ObjectId, ref: 'User' },
    uploadedByName: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewedAt: { type: Date }
  },
  { _id: true }
);

const timelineSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    event: { type: String, required: true, maxlength: 80 },
    message: { type: String, default: '', maxlength: 1000 },
    // "internal": staff only. "customer": the applicant sees it. "both" is shown to everybody.
    visibility: { type: String, enum: ['internal', 'customer', 'both'], default: 'internal' },
    by: { type: String, default: 'System' },
    byUserId: { type: ObjectId, ref: 'User' }
  },
  { _id: true }
);

const noteSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: String, default: '' },
    byUserId: { type: ObjectId, ref: 'User' },
    text: { type: String, required: true, trim: true, maxlength: 2000 }
  },
  { _id: true }
);

const vendorLineSchema = new mongoose.Schema(
  {
    vendorId: { type: String, trim: true, maxlength: 60, default: '' },
    name: { type: String, trim: true, maxlength: 120, default: '' },
    service: { type: String, trim: true, maxlength: 30, default: 'visa' },
    country: { type: String, trim: true, maxlength: 80, default: '' },
    price: money,
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' }
  },
  { _id: true }
);

const details = (fields) => new mongoose.Schema(Object.fromEntries(fields.map((field) => [field, { type: String, trim: true, maxlength: 300, default: '' }])), { _id: false });

const visaApplicationSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    channel: { type: String, enum: ['b2c', 'b2b'], default: 'b2c', index: true },
    partner: { type: ObjectId, ref: 'Partner' },
    partnerName: { type: String, trim: true, maxlength: 120, default: '' },

    country: { type: ObjectId, ref: 'VisaCountry', required: true, index: true },
    countryName: { type: String, required: true },
    visaType: { type: ObjectId, ref: 'VisaType', required: true },
    visaTypeName: { type: String, required: true },

    applicant: {
      fullName: { type: String, required: true, trim: true, maxlength: 100 },
      dob: { type: String, trim: true, default: '' },
      gender: { type: String, trim: true, maxlength: 20, default: '' },
      nationality: { type: String, trim: true, maxlength: 60, default: 'Bangladeshi' },
      mobile: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
      address: { type: String, trim: true, maxlength: 300, default: '' },
      city: { type: String, trim: true, maxlength: 80, default: '' },
      applicantType: { type: String, enum: APPLICANT_TYPES, default: 'individual' }
    },
    passport: {
      number: { type: String, required: true, trim: true, maxlength: 20 },
      // Capital letters and digits only, so "ab 123-456" and "AB123456" are the same passport for the duplicate rule.
      numberKey: { type: String, required: true, index: true },
      expiry: { type: String, trim: true, default: '' },
      issueDate: { type: String, trim: true, default: '' },
      issuingCountry: { type: String, trim: true, maxlength: 60, default: 'Bangladesh' },
      type: { type: String, trim: true, maxlength: 30, default: 'ordinary' }
    },
    service: {
      entries: { type: String, trim: true, maxlength: 30, default: 'single' },
      duration: { type: String, trim: true, maxlength: 40, default: '' }
    },

    status: { type: String, required: true, default: 'submitted', index: true },
    assignedStaff: { type: ObjectId, ref: 'User', index: true },
    actionRequired: {
      type: new mongoose.Schema({ message: String, requestedAt: Date, requestedBy: String }, { _id: false }),
      default: null
    },
    rejection: {
      type: new mongoose.Schema({ internalReason: String, customerReason: String, decidedAt: Date }, { _id: false }),
      default: null
    },

    // The price copied from the visa type when the file was created. It never changes afterwards.
    price: {
      currency: { type: String, required: true, default: 'BDT' },
      rateToBase: { type: Number, required: true, default: 1 },
      b2c: money,
      b2b: money,
      fees: { embassy: money, service: money, vat: money }
    },
    // All numbers below are in price.currency and calculated on the server. advancePaid is the sum of the payments that
    // are not voided. See services/visaMoney.js.
    account: {
      totalAmount: money,
      discountAmount: money,
      netAmount: money,
      advancePaid: money,
      dueAmount: money,
      paymentStatus: { type: String, enum: ['Paid', 'Partial', 'Unpaid'], default: 'Unpaid' },
      paymentMethod: { type: String, trim: true, maxlength: 40, default: '' },
      totalOverrideReason: { type: String, trim: true, maxlength: 300, default: '' },
      costPrice: money,
      profit: { type: Number, default: 0 },
      netAmountBase: money
    },
    payments: { type: [paymentSchema], default: [] },
    vendorLines: { type: [vendorLineSchema], default: [] },

    documents: { type: [documentSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },
    internalNotes: { type: [noteSchema], default: [] },
    customerNotes: { type: [noteSchema], default: [] },

    passportRequirement: { type: String, enum: PASSPORT_REQUIREMENTS, default: 'online_processing' },
    passportSubmissionMethod: { type: String, enum: PASSPORT_SUBMISSION_METHODS, default: 'online' },
    passportStatus: { type: String, enum: PASSPORT_STATUSES, default: 'not_required' },
    pickupRequest: {
      type: new mongoose.Schema(
        {
          ...details(['locationType', 'contactName', 'phone', 'address', 'district', 'area', 'landmark', 'preferredDate', 'status', 'note']).obj,
          assignedStaff: { type: ObjectId, ref: 'User' },
          assignedStaffName: { type: String, trim: true, maxlength: 100, default: '' }
        },
        { _id: false }
      ),
      default: null
    },
    passportReceived: { type: details(['receivedDate', 'receivedBy', 'passportNumber', 'remarks']), default: null },
    passportCollection: { type: details(['collectedDate', 'collectorName', 'collectorPhone', 'nid', 'relation', 'remarks']), default: null },

    // Why a second application for the same passport and country was allowed (see the duplicate rule).
    duplicateNote: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
    statusChangedAt: { type: Date, default: Date.now }
  },
  { timestamps: true, toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } } }
);

visaApplicationSchema.index({ createdAt: -1 });
visaApplicationSchema.index({ 'passport.numberKey': 1, country: 1, createdAt: -1 });

module.exports = mongoose.model('VisaApplication', visaApplicationSchema);
