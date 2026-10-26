const { z } = require('zod');
const { objectId, pagination, search, phone, email } = require('./common');
const { APPLICANT_TYPES, PAYMENT_METHODS, PASSPORT_SUBMISSION_METHODS, PASSPORT_STATUSES } = require('../config/visa');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);
const amount = (label) => z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(100_000_000, `${label} is too large.`);
const positiveAmount = (label) => z.number(`${label} must be a number.`).gt(0, `${label} must be above zero.`).max(100_000_000, `${label} is too large.`);
const isoDate = (label) =>
  z
    .string(`${label} must be a date.`)
    .trim()
    .refine((value) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) && !Number.isNaN(Date.parse(value)), `${label} must be a valid date.`)
    .transform((value) => new Date(value));
const method = z.enum(PAYMENT_METHODS, `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}.`);

// A blank form field means "not given".
const blankToUndefined = (schema) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

const idParam = z.object({ id: objectId });
const documentParam = z.object({ id: objectId, docId: objectId });
const paymentParam = z.object({ id: objectId, paymentId: objectId });

const vendorLine = z.object({
  vendorId: text('Vendor', 60).optional(),
  name: text('Vendor name', 120).optional(),
  service: text('Service', 30).optional(),
  country: text('Country', 80).optional(),
  price: amount('The vendor price'),
  reference: text('Reference', 120).optional(),
  notes: text('Notes', 500).optional()
});

const applicantFields = {
  name: required('Name', 100),
  phone,
  email: blankToUndefined(email),
  dob: text('Date of birth', 20).optional(),
  gender: text('Gender', 20).optional(),
  nationality: text('Nationality', 60).optional(),
  address: text('Address', 300).optional(),
  city: text('City', 80).optional(),
  applicantType: z.enum(APPLICANT_TYPES).optional()
};

const passportFields = {
  passportNumber: z
    .string('Passport number is required.')
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{3,19}$/, 'Enter a valid passport number (4 to 20 letters and digits).'),
  passportExpiry: text('Passport expiry', 20).optional(),
  passportIssueDate: text('Passport issue date', 20).optional(),
  passportIssuingCountry: text('Issuing country', 60).optional()
};

const createApplication = z.object({
  clientType: z.enum(['b2c', 'b2b']).optional(),
  partnerId: objectId.optional(),
  ...applicantFields,
  ...passportFields,
  countryId: objectId,
  visaTypeId: objectId,
  entries: text('Entries', 30).optional(),
  visaDuration: text('Duration', 40).optional(),

  // Money. The server calculates net, advance, due and the payment status; these are the only inputs.
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'A currency code is three letters.')
    .optional(),
  totalAmount: amount('The total amount').optional(),
  totalOverrideReason: text('The reason', 300).optional(),
  discountAmount: amount('The discount').optional(),
  advancePaid: amount('The advance').optional(),
  paymentMethod: method.optional(),
  paymentDate: isoDate('The payment date').optional(),

  vendorList: z.array(vendorLine).max(20, 'At most 20 vendor lines.').optional(),
  assignedStaff: objectId.optional(),
  confirmDuplicate: text('The confirmation note', 300).optional()
});

const updateApplication = z.object({
  name: applicantFields.name.optional(),
  phone: applicantFields.phone.optional(),
  email: z.union([z.literal(''), email]).optional(),
  dob: applicantFields.dob,
  gender: applicantFields.gender,
  nationality: applicantFields.nationality,
  address: applicantFields.address,
  city: applicantFields.city,
  applicantType: applicantFields.applicantType,
  passportNumber: passportFields.passportNumber.optional(),
  passportExpiry: passportFields.passportExpiry,
  passportIssueDate: passportFields.passportIssueDate,
  passportIssuingCountry: passportFields.passportIssuingCountry,
  entries: text('Entries', 30).optional(),
  visaDuration: text('Duration', 40).optional(),
  totalAmount: amount('The total amount').optional(),
  totalOverrideReason: text('The reason', 300).optional(),
  discountAmount: amount('The discount').optional(),
  vendorList: z.array(vendorLine).max(20, 'At most 20 vendor lines.').optional(),
  // null takes the application away from its staff member
  assignedStaff: objectId.nullable().optional()
});

const listApplications = z.object({
  status: text('Status', 40).optional(),
  countryId: objectId.optional(),
  channel: z.enum(['b2c', 'b2b']).optional(),
  staff: z.union([objectId, z.literal('unassigned')]).optional(),
  paymentStatus: z.enum(['Paid', 'Partial', 'Unpaid']).optional(),
  from: isoDate('From').optional(),
  to: isoDate('To').optional(),
  search,
  ...pagination
});

const changeStatus = z.object({
  status: required('Status', 40),
  customerMessage: text('The customer message', 500).optional(),
  customerReason: text('The customer reason', 500).optional(),
  internalReason: text('The internal reason', 500).optional(),
  note: text('The note', 500).optional()
});

const addNote = z.object({ type: z.enum(['internal', 'customer']), text: required('The note', 2000) });

const addPayment = z.object({
  amount: positiveAmount('The amount'),
  method,
  date: isoDate('The date').optional(),
  note: text('The note', 300).optional()
});

const voidPayment = z.object({ reason: required('The reason', 300) });

const staffLookup = z.object({ search });

const uploadDocument = z.object({
  type: required('Document type', 200),
  checklistItemId: objectId.optional()
});

const reviewDocument = z
  .object({ status: z.enum(['pending', 'verified', 'rejected']), reviewNote: text('The note', 500).optional() })
  .refine((value) => value.status !== 'rejected' || Boolean(value.reviewNote), { message: 'A rejected document needs a note for the applicant.', path: ['reviewNote'] });

const pickupRequest = z.object({
  locationType: text('Location type', 40).optional(),
  contactName: text('Contact name', 100).optional(),
  phone: text('Phone', 30).optional(),
  address: text('Address', 300).optional(),
  district: text('District', 80).optional(),
  area: text('Area', 80).optional(),
  landmark: text('Landmark', 200).optional(),
  preferredDate: text('Preferred date', 40).optional(),
  note: text('Note', 300).optional()
});

const passportDetails = z.record(z.string(), z.string().max(300)).refine((value) => Object.keys(value).length <= 12, 'Too many fields.');

const updatePassport = z.object({
  passportSubmissionMethod: z.enum(PASSPORT_SUBMISSION_METHODS).optional(),
  pickupRequest: pickupRequest.optional(),
  assignedStaff: objectId.nullable().optional(),
  passportStatus: z.enum(PASSPORT_STATUSES).optional(),
  details: passportDetails.optional(),
  note: text('The note', 500).optional()
});

module.exports = {
  idParam,
  documentParam,
  paymentParam,
  createApplication,
  updateApplication,
  listApplications,
  changeStatus,
  addNote,
  addPayment,
  voidPayment,
  staffLookup,
  uploadDocument,
  reviewDocument,
  updatePassport
};
