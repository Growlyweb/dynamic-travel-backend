// One entry per route. Bodies, query strings and path parameters reference the zod schemas in
// validations/, so they stay in step with the real validation. Everything a person reads (summary,
// description, who may call it, rate limit, examples, error codes) is written here.
const { z } = require('zod');
const auth = require('../../validations/auth.validation');
const user = require('../../validations/user.validation');
const partner = require('../../validations/partner.validation');
const profile = require('../../validations/profile.validation');
const tours = require('../../validations/tour.validation');
const membership = require('../../validations/membership.validation');
const { obj, str, bool, ref, arrayOf, exUser, exDocument, exPartner, exSession, exMeta, exCategory, exTour, exCustomRequest, exItinerary, exPlan, exMembership, exStats, exPeriod, NOW, ID } = require('./shared');

// ---- tags (order = order in Postman folders)
const TAGS = [
  { name: 'System', description: 'Is the server up? Health and version. Public.' },
  { name: 'Auth: sign up and verify', description: 'Register a customer or an agency, confirm the email code, resend it, and set the first password of an invited account. Public.' },
  { name: 'Auth: sign in and session', description: 'Log in (email or Google), refresh the tokens, log out, and read who is signed in. Start here, then use the Authorize button.' },
  { name: 'Auth: passwords', description: 'Forgot, check and reset a password with an emailed code, and change a password while signed in.' },
  { name: 'Customer (B2C)', description: 'Endpoints for signed-in customers: profile and their own memberships.' },
  { name: 'Agency (B2B)', description: 'Endpoints for signed-in agencies. Operational routes need an APPROVED partner.' },
  { name: 'Staff', description: 'Endpoints for staff. Each feature needs a permission an admin granted.' },
  { name: 'Admin: users', description: 'ADMIN only. Accounts, invites, status, roles, permissions, roles catalog.' },
  { name: 'Admin: agencies', description: 'ADMIN only. Review B2B applications and their documents.' },
  { name: 'Admin: audit', description: 'ADMIN only. Security event log.' },
  { name: 'Documents', description: 'Private business documents, served only after an ownership check.' },
  { name: 'Tour categories', description: 'Reading is public. Changing needs ADMIN, or STAFF with TOUR_MANAGE.' },
  { name: 'Tours', description: 'Reading is public (published tours; the B2B price only for admin, TOUR_MANAGE staff and approved agencies). Changing needs ADMIN, or STAFF with TOUR_MANAGE.' },
  { name: 'Custom tours', description: 'A B2C customer sends and follows their own request; tour managers answer it.' },
  { name: 'Membership plans', description: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE. The plans an admin sells. Answers are { items, total } or the object itself, not the usual envelope.' },
  { name: 'Memberships', description: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE. Assign a plan to a B2C customer, record the payment, cancel, extend, delete.' },
  { name: 'Membership reports', description: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE. Dashboard numbers and sales by period.' },
  { name: 'Dashboard', description: 'ADMIN, or STAFF. Numbers for the admin dashboard. Some figures are placeholders until the visa, tour booking and revenue modules exist.' },
  { name: 'Visa', description: 'ADMIN, or STAFF with the permission each route names. Countries, visa types, document checklists, statuses, applications with their money, documents and passport handling. Lists answer with `meta` and `pagination`.' },
  { name: 'Settings', description: 'Internal users. Currencies with their exchange rates, document limits and retention. Changing most of them is for admins.' },
  { name: 'Visa: public status', description: 'No login. An applicant checks the status of a visa application with a code sent to the email address on it.' },
  { name: 'Accounts', description: 'The simple Accounts screens: sales, receipts, dues, expenses, clients, monthly and yearly reports. Every number is added up from posted journals. Internal users only.' },
  { name: 'Vendors', description: 'Suppliers, their bills, payments and advances. Every bill and payment posts a journal. Internal users only.' }
];

// Tags whose operations keep the order they are written in (a flow: sign up, then verify, then log in). Every other
// tag is sorted by path, then by method (GET, POST, PUT, PATCH, DELETE), in scripts/openapi/spec.js.
const FLOW_TAGS = new Set(['Auth: sign up and verify', 'Auth: sign in and session', 'Auth: passwords']);

// ---- rate limit sentences
const RATE = {
  api: 'Every `/api` route is also limited to 300 requests per 15 minutes per IP.',
  register: 'Rate limit: 10 requests per hour per IP (one quota shared with the other register endpoint).',
  otp: 'Rate limit: 5 requests per 15 minutes per IP + email (one quota shared by verify-otp, resend-otp, verify-reset-token, reset-password and setup-account).',
  login: 'Rate limit: 10 requests per 15 minutes per IP + email.',
  firebase: 'Rate limit: 30 requests per 15 minutes per IP.',
  refresh: 'Rate limit: 30 requests per 15 minutes per IP.',
  forgot: 'Rate limit: 3 requests per hour per IP + email.',
  change: 'Rate limit: 5 requests per 15 minutes per signed-in user.'
};

const SESSION_NOTE =
  'Tokens: the response carries a short-lived `accessToken`. The refresh token arrives as an **httpOnly cookie** (path `/api/auth`) for web clients. ' +
  'Send the header `X-Client-Type: mobile` to get it in the JSON body as `refreshToken` instead.';

const ok = (status, message, schema, example, opts = {}) => ({ status, message, schema, example, ...opts });

// Membership answers are not wrapped in { success, message, data }: a list is { items, total }, a single answer is the
// object itself, and a delete is { success, id }.
const listOf = (name) => obj({ items: arrayOf(ref(name)), total: { type: 'integer', example: 1 } }, ['items', 'total']);
const deleted = () => obj({ success: bool(true), id: str('6ac0a5f0eebc510147c67250') }, ['success', 'id']);
// A failed validation of a membership route is 400, with the first message and the field list.
const invalid = (message, field) => ({ codes: ['VALIDATION_ERROR'], message, fields: [{ field, message }] });

// ---- dashboard numbers, visa module and settings (internal users)
const INT = (example) => ({ type: 'integer', example });
const exRole = (over = {}) => ({ id: '6ac0a5f0eebc510147c67300', name: 'Accountant', description: 'Keeps the books and the vendor accounts.', permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'VENDOR_VIEW', 'VENDOR_MANAGE'], templateKey: 'accountant', system: false, userCount: 2, createdAt: NOW, updatedAt: NOW, ...over });
const NUM = (example) => ({ type: 'number', example });
const TREND_POINT = obj({ label: str('Jan'), value: INT(60) }, ['label', 'value']);

const OID = '6ac0a5f0eebc510147c67250';
const ID_COUNTRY = '6ac0a5f0eebc510147c67251';
const ID_TYPE = '6ac0a5f0eebc510147c67252';
const ID_APP = '6ac0a5f0eebc510147c67253';
const ID_DOC = '6ac0a5f0eebc510147c67254';
const ID_PAYMENT = '6ac0a5f0eebc510147c67255';
const ID_STATUS = '6ac0a5f0eebc510147c67256';
const ID_STAFF = '6ac0a5f0eebc510147c67257';

const VISA_COUNTRY = obj({
  _id: str(ID_COUNTRY), name: str('China'), code: str('CN'), flag: str('🇨🇳'), description: str('Tourist, business and student visa processing.'),
  status: str('active', { enum: ['active', 'paused'] }), displayOrder: INT(1), processingMode: str('Embassy'), processingTime: str('5-7 working days'),
  physicalPassportRequired: bool(true), expressAvailable: bool(false), richChecklist: str('<h3>Mandatory Requirements</h3><ul><li>Passport</li></ul>'),
  sampleDocs: arrayOf(obj({ name: str('Sample bank statement'), type: str('document'), url: str('https://example.com/sample.pdf') })), createdAt: str(NOW), updatedAt: str(NOW)
});
const VISA_COUNTRY_EXAMPLE = {
  _id: ID_COUNTRY, name: 'China', code: 'CN', flag: '🇨🇳', description: 'Tourist, business and student visa processing.', status: 'active', displayOrder: 1,
  processingMode: 'Embassy', processingTime: '5-7 working days', physicalPassportRequired: true, expressAvailable: false,
  richChecklist: '<h3>Mandatory Requirements</h3><ul><li>Passport</li></ul>', sampleDocs: [], createdAt: NOW, updatedAt: NOW
};

const VISA_TYPE = obj({
  _id: str(ID_TYPE), country: str(ID_COUNTRY), name: str('Tourist Visa'), description: str(''), processingTime: str('5-7 working days'),
  entries: str('single', { enum: ['single', 'double', 'multiple'] }), currency: str('BDT'), b2cPrice: NUM(12000), b2bNetPrice: NUM(10000),
  fees: obj({ embassy: NUM(8500), service: NUM(3000), vat: NUM(500) }), validFrom: str(NOW), terms: str(''), status: str('active', { enum: ['active', 'paused'] }),
  passportRequirement: str('physical_required', { enum: ['online_processing', 'physical_required'] }), pickupAvailable: bool(true), officeSubmissionAvailable: bool(true),
  createdAt: str(NOW), updatedAt: str(NOW)
});
const VISA_TYPE_EXAMPLE = {
  _id: ID_TYPE, country: ID_COUNTRY, name: 'Tourist Visa', description: '', processingTime: '5-7 working days', entries: 'single', currency: 'BDT', b2cPrice: 12000, b2bNetPrice: 10000,
  fees: { embassy: 8500, service: 3000, vat: 500 }, validFrom: NOW, terms: '', status: 'active', passportRequirement: 'physical_required', pickupAvailable: true,
  officeSubmissionAvailable: true, createdAt: NOW, updatedAt: NOW
};

const VISA_CHECKLIST_ITEM = obj({
  _id: str(OID), label: str('Passport (valid at least 6 months)'), requirement: str('required', { enum: ['required', 'optional', 'conditional'] }), active: bool(true),
  submissionMode: str('both', { enum: ['digital', 'physical', 'both'] }), fileFormats: str('PDF/JPG/PNG'), maxSizeMb: INT(10)
});
const VISA_CHECKLIST = obj({
  _id: { type: 'string', nullable: true, example: OID }, country: str(ID_COUNTRY), visaType: str(ID_TYPE), applicantType: str('individual'),
  items: arrayOf(VISA_CHECKLIST_ITEM), isDefault: bool(false)
});
const VISA_CHECKLIST_EXAMPLE = {
  _id: OID, country: ID_COUNTRY, visaType: ID_TYPE, applicantType: 'individual', isDefault: false,
  items: [{ _id: OID, label: 'Passport (valid at least 6 months)', requirement: 'required', active: true, submissionMode: 'both', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 }]
};

const VISA_STATUS = obj({
  _id: str(ID_STATUS), key: str('under_review'), displayName: str('Under Review'), customerMessage: str('Your application is being reviewed by our team.'),
  internalDescription: str('A staff member is checking the application and documents.'), category: str('in_progress', { enum: ['in_progress', 'action_required', 'success', 'failed', 'cancelled'] }),
  active: bool(true), displayOrder: INT(2), isSystem: bool(true)
});
const VISA_STATUS_EXAMPLE = {
  _id: ID_STATUS, key: 'under_review', displayName: 'Under Review', customerMessage: 'Your application is being reviewed by our team.',
  internalDescription: 'A staff member is checking the application and documents.', category: 'in_progress', active: true, displayOrder: 2, isSystem: true, createdAt: NOW, updatedAt: NOW
};

const VISA_ACCOUNT = obj({
  totalAmount: NUM(12000), discountAmount: NUM(1000), netAmount: NUM(11000), advancePaid: NUM(4000), dueAmount: NUM(7000),
  paymentStatus: str('Partial', { enum: ['Paid', 'Partial', 'Unpaid'] }), paymentMethod: str('Cash'), totalOverrideReason: str(''), costPrice: NUM(7000), profit: NUM(4000), netAmountBase: NUM(11000)
});
const VISA_PAYMENT = obj({
  _id: str(ID_PAYMENT), amount: NUM(4000), method: str('Cash'), date: str(NOW), note: str('Advance at application'), enteredByName: str('Admin Person'),
  voided: bool(false), voidReason: str('')
});
const VISA_DOCUMENT = obj({
  _id: str(ID_DOC), type: str('Passport Copy'), originalName: str('passport.pdf'), mimeType: str('application/pdf'), size: INT(204800),
  status: str('pending', { enum: ['pending', 'verified', 'rejected'] }), reviewNote: str(''), uploadedByName: str('Admin Person'), uploadedAt: str(NOW)
});
const VISA_TIMELINE_ENTRY = obj({
  _id: str(OID), at: str(NOW), event: str('Application Created'), message: str('Application created successfully.'),
  visibility: str('both', { enum: ['internal', 'customer', 'both'] }), by: str('Admin Person')
});
const VISA_APPLICATION = obj({
  _id: str(ID_APP), number: str('VISA-2026-000001'), channel: str('b2c', { enum: ['b2c', 'b2b'] }), partner: str(OID), partnerName: str(''),
  country: str(ID_COUNTRY), countryName: str('China'), visaType: str(ID_TYPE), visaTypeName: str('Tourist Visa'),
  applicant: obj({ fullName: str('Rahim Ahmed'), mobile: str('+8801712556340'), email: str('rahim@example.com'), nationality: str('Bangladeshi'), applicantType: str('individual') }),
  passport: obj({ number: str('BR0912345'), numberKey: str('BR0912345'), expiry: str('2030-06-15'), issueDate: str('2020-06-16'), issuingCountry: str('Bangladesh'), type: str('ordinary') }),
  status: str('under_review'), assignedStaff: obj({ _id: str(ID_STAFF), name: str('Priya Nair') }),
  price: obj({ currency: str('BDT'), rateToBase: NUM(1), b2c: NUM(12000), b2b: NUM(10000), fees: obj({ embassy: NUM(8500), service: NUM(3000), vat: NUM(500) }) }),
  account: VISA_ACCOUNT, payments: arrayOf(VISA_PAYMENT), documents: arrayOf(VISA_DOCUMENT), timeline: arrayOf(VISA_TIMELINE_ENTRY),
  internalNotes: arrayOf(obj({})), customerNotes: arrayOf(obj({})),
  passportSubmissionMethod: str('office', { enum: ['online', 'office', 'pickup'] }), passportStatus: str('not_received'), createdAt: str(NOW), updatedAt: str(NOW)
});
const VISA_APPLICATION_EXAMPLE = {
  _id: ID_APP, number: 'VISA-2026-000001', channel: 'b2c', partnerName: '', country: ID_COUNTRY, countryName: 'China', visaType: ID_TYPE, visaTypeName: 'Tourist Visa',
  applicant: { fullName: 'Rahim Ahmed', mobile: '+8801712556340', email: 'rahim@example.com', nationality: 'Bangladeshi', applicantType: 'individual' },
  passport: { number: 'BR0912345', numberKey: 'BR0912345', expiry: '2030-06-15', issueDate: '2020-06-16', issuingCountry: 'Bangladesh', type: 'ordinary' },
  status: 'under_review', assignedStaff: { _id: ID_STAFF, name: 'Priya Nair' },
  price: { currency: 'BDT', rateToBase: 1, b2c: 12000, b2b: 10000, fees: { embassy: 8500, service: 3000, vat: 500 } },
  account: { totalAmount: 12000, discountAmount: 1000, netAmount: 11000, advancePaid: 4000, dueAmount: 7000, paymentStatus: 'Partial', paymentMethod: 'Cash', totalOverrideReason: '', costPrice: 7000, profit: 4000, netAmountBase: 11000 },
  payments: [{ _id: ID_PAYMENT, amount: 4000, method: 'Cash', date: NOW, note: 'Advance at application', enteredByName: 'Admin Person', voided: false, voidReason: '' }],
  documents: [{ _id: ID_DOC, type: 'Passport Copy', originalName: 'passport.pdf', mimeType: 'application/pdf', size: 204800, status: 'pending', reviewNote: '', uploadedByName: 'Admin Person', uploadedAt: NOW }],
  timeline: [{ _id: OID, at: NOW, event: 'Application Created', message: 'Application created successfully.', visibility: 'both', by: 'Admin Person' }],
  internalNotes: [], customerNotes: [], passportSubmissionMethod: 'office', passportStatus: 'not_received', createdAt: NOW, updatedAt: NOW
};
const VISA_LIST_ROW_EXAMPLE = (() => {
  const { payments, timeline, internalNotes, customerNotes, ...row } = VISA_APPLICATION_EXAMPLE;
  return { ...row, documentCount: 1 };
})();

const CURRENCIES_EXAMPLE = {
  base: 'BDT',
  items: [
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rateToBase: 1, source: 'base' },
    { code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 122, source: 'manual', updatedAt: NOW }
  ]
};
const CURRENCIES = obj({
  base: str('BDT'),
  items: arrayOf(obj({ code: str('USD'), name: str('US Dollar'), symbol: str('$'), rateToBase: NUM(122), source: str('manual', { enum: ['base', 'manual', 'api'] }), updatedAt: str(NOW) }))
});
const SETTINGS_EXAMPLE = {
  'visa.documents': { maxSizeMb: 10, allowedTypes: ['pdf', 'jpg', 'png', 'webp'], maxFilesPerItem: 5 },
  'visa.retention': { days: 730 },
  'visa.duplicateWindowDays': { days: 90 },
  currencies: CURRENCIES_EXAMPLE
};

// Request schemas come straight from the validation files, so the documentation cannot drift from the real rules.
const visaCatalog = require('../../validations/visaCatalog.validation');
const visaApp = require('../../validations/visaApplication.validation');
const settingV = require('../../validations/setting.validation');
const ACCESS = { view: 'ADMIN, or STAFF with VISA_VIEW', edit: 'ADMIN, or STAFF with VISA_EDIT', update: 'ADMIN, or STAFF with VISA_UPDATE' };

const V = (method, path, id, summary, description, access, rest) => ({ method, path, tag: 'Visa', id, summary, description, access, needsAuth: true, ...rest });
const list = (message, schema, example) => ok(200, message, arrayOf(schema), [example], { paginated: true });
const APP_PARAM = { id: ID_APP };
const DOC_PARAM = { id: ID_APP, docId: ID_DOC };

// ---- messages and quotations
const visaMessage = require('../../validations/visaMessage.validation');
const visaQuotation = require('../../validations/visaQuotation.validation');
const ID_TEMPLATE = '6ac0a5f0eebc510147c67258';
const ID_MESSAGE = '6ac0a5f0eebc510147c67259';
const ID_QUOTATION = '6ac0a5f0eebc510147c6725a';
const ID_PARTNER = '6ac0a5f0eebc510147c6725b';

const MESSAGE_TEMPLATE = obj({
  _id: str(ID_TEMPLATE), name: str('Under Review'), channel: str('sms', { enum: ['sms', 'email'] }), trigger: str('under_review'), subject: str(''),
  message: str('Dear {{applicantName}}, your visa application {{applicationNumber}} is now under review.'), active: bool(true), createdAt: str(NOW), updatedAt: str(NOW)
});
const MESSAGE_TEMPLATE_EXAMPLE = {
  _id: ID_TEMPLATE, name: 'Under Review', channel: 'sms', trigger: 'under_review', subject: '',
  message: 'Dear {{applicantName}}, your visa application {{applicationNumber}} is now under review.', active: true, createdAt: NOW, updatedAt: NOW
};
const VISA_MESSAGE = obj({
  _id: str(ID_MESSAGE), application: str(ID_APP), applicationNumber: str('VISA-2026-000001'), channel: str('sms', { enum: ['sms', 'email'] }), to: str('+8801712556340'),
  toName: str('Rahim Ahmed'), templateName: str('Under Review'), trigger: str('under_review'), subject: str(''), body: str('Dear Rahim Ahmed, your visa application VISA-2026-000001 is now under review.'),
  status: str('pending', { enum: ['pending', 'sent', 'failed'] }), source: str('auto', { enum: ['auto', 'manual'] }), provider: str('manual'), error: str(''),
  createdByName: str('System'), sentAt: str(NOW), sentByName: str('Admin Person'), createdAt: str(NOW)
});
const VISA_MESSAGE_EXAMPLE = {
  _id: ID_MESSAGE, application: ID_APP, applicationNumber: 'VISA-2026-000001', channel: 'sms', to: '+8801712556340', toName: 'Rahim Ahmed', templateName: 'Under Review', trigger: 'under_review',
  subject: '', body: 'Dear Rahim Ahmed, your visa application VISA-2026-000001 is now under review.', status: 'pending', source: 'auto', provider: 'manual', error: '', createdByName: 'System', createdAt: NOW, updatedAt: NOW
};
const VISA_QUOTATION = obj({
  _id: str(ID_QUOTATION), number: str('QT-2026-0001'), partner: str(ID_PARTNER), partnerName: str('ABC Travels'), clientName: str('Rahim Ahmed'), country: str(ID_COUNTRY), countryName: str('China'),
  visaType: str(ID_TYPE), visaTypeName: str('Tourist Visa'), quantity: INT(2), currency: str('BDT'), rateToBase: NUM(1), netPrice: NUM(10000), additionalFee: NUM(1500), total: NUM(21500), totalBase: NUM(21500),
  validUntil: str(NOW), notes: str(''), status: str('draft', { enum: ['draft', 'sent', 'accepted', 'rejected', 'expired'] }), storedStatus: str('draft', { enum: ['draft', 'sent', 'accepted', 'rejected'] }),
  createdByName: str('Admin Person'), createdAt: str(NOW), updatedAt: str(NOW)
});
const VISA_QUOTATION_EXAMPLE = {
  _id: ID_QUOTATION, number: 'QT-2026-0001', partner: ID_PARTNER, partnerName: 'ABC Travels', clientName: 'Rahim Ahmed', country: ID_COUNTRY, countryName: 'China', visaType: ID_TYPE, visaTypeName: 'Tourist Visa',
  quantity: 2, currency: 'BDT', rateToBase: 1, netPrice: 10000, additionalFee: 1500, total: 21500, totalBase: 21500, validUntil: NOW, notes: '', status: 'draft', storedStatus: 'draft',
  createdByName: 'Admin Person', createdAt: NOW, updatedAt: NOW
};
const QUOTATION_PARAM = { id: ID_QUOTATION };

// shared success shapes
const SESSION = ref('Session');

const endpoints = [
  // =============================================================== AUTH
  {
    method: 'post', path: '/api/auth/register', tag: 'Auth: sign up and verify', id: 'registerCustomer',
    summary: 'Register a customer (B2C)',
    description:
      'Creates a customer account and emails a 6-digit verification code. The account is `PENDING` until the code is confirmed with **Verify email code**.\n\n' +
      'The role is always `B2C`. There is no `role` field: anything extra in the body is ignored.\n\n' + RATE.register,
    access: 'Public', body: auth.registerB2C,
    bodyExample: { name: 'Rahim Uddin', email: 'rahim@example.com', phone: '+8801712345678', password: 'Str0ng!Pass' },
    success: ok(201, 'Account created. Enter the verification code we emailed you.', obj({ user: ref('User'), otpSent: bool(true) }), { user: exUser({ status: 'PENDING', emailVerified: false, lastLoginAt: undefined }), otpSent: true }),
    errors: { 403: ['REGISTRATION_CLOSED'], 409: ['EMAIL_TAKEN', 'PHONE_TAKEN'], 422: true, 429: true },
    notes: '`otpSent: false` means the account exists but the email could not be delivered. Use **Resend verification code**.'
  },
  {
    method: 'post', path: '/api/auth/b2b/register', tag: 'Auth: sign up and verify', id: 'registerAgency',
    summary: 'Register an agency (B2B)',
    description:
      'Creates an agency user (`PENDING`) and a partner record (`PENDING`), stores the uploaded documents privately, and emails a verification code.\n\n' +
      'After verifying the email the owner can log in, but operational routes stay closed (`PARTNER_NOT_APPROVED`) until an admin approves the partner.\n\n' +
      '**Form-data.** A `tradeLicense` file is required. Allowed file types: PDF, JPEG, PNG, WEBP, up to 5 MB each.\n\n' + RATE.register,
    access: 'Public',
    multipart: {
      zod: auth.registerB2B,
      files: {
        tradeLicense: { description: 'Trade license (required). PDF, JPEG, PNG or WEBP, max 5 MB.' },
        businessCard: { description: 'Business card (optional).' },
        otherDocuments: { description: 'Up to 3 further documents (optional).', multiple: true, maxItems: 3 }
      },
      required: ['tradeLicense'],
      example: { name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', password: 'Str0ng!Pass', companyName: 'Sky Travels Ltd', licenseNo: 'TL-2024-0042', businessType: 'Travel agency', address: '45 Motijheel, Dhaka' }
    },
    success: ok(201, 'Business account created. Verify your email; an administrator will then review your application.', obj({ user: ref('User'), partner: ref('Partner'), otpSent: bool(true) }), { user: exUser({ _id: '6ac0a5f0eebc510147c6722e', name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', role: 'B2B', status: 'PENDING', emailVerified: false, partnerId: '6ac0a5f0eebc510147c6722f', lastLoginAt: undefined }), partner: exPartner(), otpSent: true }),
    errors: { 400: ['FILE_TYPE_NOT_ALLOWED'], 403: ['REGISTRATION_CLOSED'], 409: ['EMAIL_TAKEN', 'PHONE_TAKEN', 'LICENSE_TAKEN'], 413: true, 422: ['VALIDATION_ERROR'], 429: true },
    notes: 'A missing trade license answers 422 with `errors[0].field = "tradeLicense"`. If any check fails, no file is kept.'
  },
  {
    method: 'post', path: '/api/auth/verify-otp', tag: 'Auth: sign up and verify', id: 'verifyEmailCode',
    summary: 'Verify email code',
    description:
      'Confirms the 6-digit code from the registration email. Activates the account and **signs the user in**. The code is valid 10 minutes, works once, and dies after 5 wrong tries.\n\n' +
      SESSION_NOTE + '\n\n' + RATE.otp,
    access: 'Public', mobileHeader: true, body: auth.verifyOtp, bodyExample: { email: 'rahim@example.com', otp: '482913' },
    success: ok(200, 'Email verified.', SESSION, exSession(), { setsCookie: true }),
    errors: { 400: ['INVALID_CODE'], 403: ['ACCOUNT_NOT_ACTIVE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/resend-otp', tag: 'Auth: sign up and verify', id: 'resendEmailCode',
    summary: 'Resend verification code',
    description: 'Sends a new code and cancels the previous one. At least 60 seconds must pass between sends. The answer is identical whether or not the email exists, so it cannot be used to find registered addresses.\n\n' + RATE.otp,
    access: 'Public', body: auth.resendOtp, bodyExample: { email: 'rahim@example.com' },
    success: ok(200, 'If that account is waiting for verification, a new code was sent.'),
    errors: { 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/login', tag: 'Auth: sign in and session', id: 'login',
    summary: 'Log in (email and password)',
    description:
      'Works for every role. The answer is the same `Invalid credentials` whether the email is unknown, has no password, or the password is wrong.\n\n' +
      '**The `accessToken` in the answer is what every protected route needs.** In Swagger UI it goes into the Authorize box by itself. In Postman, put it into the collection variable `bearerToken`.\n\n' + SESSION_NOTE + '\n\n' + RATE.login,
    access: 'Public', mobileHeader: true, body: auth.login, bodyExample: { email: 'rahim@example.com', password: 'Str0ng!Pass' },
    success: ok(200, 'Login successful.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['INVALID_CREDENTIALS'], 403: ['EMAIL_NOT_VERIFIED', 'ACCOUNT_NOT_ACTIVE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/firebase', tag: 'Auth: sign in and session', id: 'loginWithGoogle',
    summary: 'Continue with Google (Firebase ID token)',
    description:
      'The client signs in with Google through the Firebase SDK, then sends the Firebase **ID token** here. The API verifies it and answers with its own tokens.\n\n' +
      '- Only **Google** is accepted. A token from Firebase email and password, phone or any other method is refused with `FIREBASE_PROVIDER_NOT_ALLOWED`.\n' +
      '- A first sign-in creates an already-verified `B2C` account. If a customer account with the same verified email exists, it is linked instead of duplicated.\n' +
      '- An email that belongs to an admin, staff or agency account answers `ACCOUNT_TYPE_MISMATCH`.\n\n' + SESSION_NOTE + '\n\n' + RATE.firebase,
    access: 'Public', mobileHeader: true, body: auth.firebaseLogin,
    bodyExample: { idToken: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vdHJhdmVsbXMtZGV2In0.signature' },
    success: ok(200, 'Login successful.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['FIREBASE_TOKEN_INVALID'], 403: ['FIREBASE_PROVIDER_NOT_ALLOWED', 'FIREBASE_UNVERIFIED', 'ACCOUNT_NOT_ACTIVE', 'REGISTRATION_CLOSED'], 409: ['ACCOUNT_TYPE_MISMATCH'], 422: true, 429: true, 503: ['FIREBASE_DISABLED'] }
  },
  {
    method: 'post', path: '/api/auth/refresh', tag: 'Auth: sign in and session', id: 'refreshTokens',
    summary: 'Refresh tokens',
    description:
      'Swaps the refresh token for a new access token **and a new refresh token** (rotation). The old refresh token stops working.\n\n' +
      '- **Web:** send nothing. The browser sends the `refreshToken` cookie by itself (Swagger UI on this server too), and Postman does once a login has set it.\n' +
      '- **Mobile:** send the header `X-Client-Type: mobile` and put the token in the body.\n\n' +
      'Replaying an already-used refresh token is treated as theft and signs the user out on every device.\n\n' + RATE.refresh,
    access: 'Refresh token (cookie or body)', mobileHeader: true, body: auth.refresh, bodyExample: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YWMwYTVmMCJ9.signature' }, bodyRequired: false,
    success: ok(200, 'Token refreshed.', SESSION, exSession(), { setsCookie: true }),
    errors: { 401: ['SESSION_EXPIRED', 'TOKEN_INVALID'], 403: ['ACCOUNT_NOT_ACTIVE'], 429: true }
  },
  {
    method: 'post', path: '/api/auth/logout', tag: 'Auth: sign in and session', id: 'logout',
    summary: 'Log out',
    description: 'Ends this device\'s session. Set `allDevices` to `true` to end every session and cancel all live access tokens. The refresh token is read from the cookie (web) or the body (mobile).',
    access: 'Signed in (any role)', needsAuth: true, body: auth.logout, bodyExample: { allDevices: false }, bodyRequired: false,
    success: ok(200, 'Logged out.'),
    errors: { 401: true }
  },
  {
    method: 'post', path: '/api/auth/forgot-password', tag: 'Auth: passwords', id: 'forgotPassword',
    summary: 'Forgot password: request a code',
    description: 'Emails a 6-digit reset code to an active account. The answer is identical whether or not the email exists.\n\n' + RATE.forgot,
    access: 'Public', body: auth.forgotPassword, bodyExample: { email: 'rahim@example.com' },
    success: ok(200, 'If an account exists for that email, a reset code was sent.'),
    errors: { 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/verify-reset-token', tag: 'Auth: passwords', id: 'checkResetCode',
    summary: 'Forgot password: check the code',
    description: 'Checks a reset code **without using it up**, so a screen can validate it before asking for the new password. It still counts as one of the 5 attempts.\n\n' + RATE.otp,
    access: 'Public', body: auth.verifyResetToken, bodyExample: { email: 'rahim@example.com', otp: '482913' },
    success: ok(200, 'Code is valid.'),
    errors: { 400: ['INVALID_CODE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/reset-password', tag: 'Auth: passwords', id: 'resetPassword',
    summary: 'Forgot password: set the new password',
    description: 'Uses the code (once) and sets the new password. Every session and token issued before is cancelled, and the user gets a "password changed" email. A customer who joined with Google can use this to add a password.\n\n' + RATE.otp,
    access: 'Public', body: auth.resetPassword, bodyExample: { email: 'rahim@example.com', otp: '482913', newPassword: 'N3w!Passw0rd' },
    success: ok(200, 'Password reset. Please log in with your new password.'),
    errors: { 400: ['INVALID_CODE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/setup-account', tag: 'Auth: sign up and verify', id: 'setupInvitedAccount',
    summary: 'Invited staff or admin: set the first password',
    description: 'An admin creates staff and admin accounts without a password. The invitation email carries a link with a token; this call spends it, sets the password and activates the account. The token works once and expires after 48 hours.\n\n' + RATE.otp,
    access: 'Public (invite token)', body: auth.setupAccount, bodyExample: { token: 'a3f1c9d27b8e4f60a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718', password: 'Sara@Pass12' },
    success: ok(200, 'Account activated. You can now log in.'),
    errors: { 400: ['INVALID_INVITE'], 422: true, 429: true }
  },
  {
    method: 'post', path: '/api/auth/change-password', tag: 'Auth: passwords', id: 'changePassword',
    summary: 'Change password (signed in)',
    description: 'Requires the current password. Other devices are signed out; this device continues with the **fresh tokens in the response**, so store them.\n\n' + SESSION_NOTE + '\n\n' + RATE.change,
    access: 'Signed in (any role)', needsAuth: true, mobileHeader: true, body: auth.changePassword, bodyExample: { currentPassword: 'Str0ng!Pass', newPassword: 'N3w!Passw0rd' },
    success: ok(200, 'Password updated. Your other devices were signed out.', obj({ accessToken: str(), expiresIn: str('15m'), refreshToken: str() }, ['accessToken', 'expiresIn']), exSession(false), { setsCookie: true }),
    errors: { 400: ['NO_PASSWORD_SET'], 401: ['WRONG_PASSWORD'], 422: true, 429: true }
  },
  {
    method: 'get', path: '/api/auth/me', tag: 'Auth: sign in and session', id: 'getMe',
    summary: 'Who am I',
    description: 'Returns the signed-in account, the `access` it has (its roles, the permissions that result from them, and whether it is an admin who passes every check), plus the partner record for agencies. Use `access` to guard screens and menus. Never includes a password hash.',
    access: 'Signed in (any role)', needsAuth: true,
    success: ok(200, 'Current user profile.', obj({ user: ref('User'), access: obj({ roles: arrayOf(obj({ id: str('6ac0a5f0eebc510147c67300'), name: str('Accountant'), system: bool(false) })), permissions: arrayOf(str('ACCOUNTS_EDIT')), isAdmin: bool(false) }), partner: ref('Partner') }, ['user']), { user: exUser(), access: { roles: [{ id: '6ac0a5f0eebc510147c67300', name: 'Accountant', system: false }], permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT'], isAdmin: false } }),
    errors: { 401: true, 403: ['ACCOUNT_NOT_ACTIVE'] }
  },

  // =============================================================== CUSTOMER
  {
    method: 'get', path: '/api/b2c/profile', tag: 'Customer (B2C)', id: 'getCustomerProfile',
    summary: 'My profile', description: 'The signed-in customer\'s own record. The id always comes from the token, never from the URL.',
    access: 'B2C', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser() }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/b2c/profile', tag: 'Customer (B2C)', id: 'updateCustomerProfile',
    summary: 'Update my profile',
    description: 'Only `name` and `phone` can be changed. A changed phone becomes unverified again. `email`, `role`, `status`, `permissions` and `partnerId` are ignored if sent.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}`).',
    access: 'B2C', needsAuth: true, body: profile.updateProfile, bodyExample: { name: 'Rahim U.', phone: '+8801712345678' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ name: 'Rahim U.' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },

  // =============================================================== AGENCY
  {
    method: 'get', path: '/api/b2b/profile', tag: 'Agency (B2B)', id: 'getAgencyProfile',
    summary: 'My profile and partner record', description: 'Available while the application is being reviewed.',
    access: 'B2B', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User'), partner: ref('Partner') }), { user: exUser({ role: 'B2B', partnerId: '6ac0a5f0eebc510147c6722f' }), partner: exPartner() }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/b2b/profile', tag: 'Agency (B2B)', id: 'updateAgencyProfile',
    summary: 'Update my profile',
    description: 'Change `name`, `phone`, `address` or `businessType`. `companyName` and `licenseNo` are locked, because changing them needs a new review.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}` and `PATCH /api/admin/b2b/{id}`).',
    access: 'B2B', needsAuth: true, body: profile.updateB2BProfile, bodyExample: { address: '12 Gulshan Avenue, Dhaka', businessType: 'Travel agency' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User'), partner: ref('Partner') }), { user: exUser({ role: 'B2B' }), partner: exPartner({ address: '12 Gulshan Avenue, Dhaka' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/b2b/documents', tag: 'Agency (B2B)', id: 'listMyDocuments',
    summary: 'My documents and their review status', description: 'Each document shows its type, review status and the reviewer\'s note. The internal storage path is never shown.',
    access: 'B2B', needsAuth: true,
    success: ok(200, 'Documents fetched.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'REJECTED', reviewNote: 'Image is blurry' })]), errors: { 401: true, 403: true, 404: true }
  },
  {
    method: 'post', path: '/api/b2b/documents', tag: 'Agency (B2B)', id: 'uploadMoreDocuments',
    summary: 'Upload more documents',
    description: 'Allowed while the application is `PENDING`, `UNDER_REVIEW` or `REJECTED`. After approval the set is locked (`DOCUMENTS_LOCKED`). A partner can hold at most 10 documents.\n\n**Form-data.** Send at least one file. PDF, JPEG, PNG or WEBP, 5 MB each.',
    access: 'B2B', needsAuth: true,
    multipart: {
      zod: null,
      files: {
        tradeLicense: { description: 'Trade license.' },
        businessCard: { description: 'Business card.' },
        otherDocuments: { description: 'Up to 3 further documents.', multiple: true, maxItems: 3 }
      },
      required: [], example: {}
    },
    success: ok(201, 'Documents uploaded.', arrayOf(ref('PartnerDocument')), [exDocument(), exDocument({ _id: '6ac0a5f0eebc510147c67231', type: 'BUSINESS_CARD', originalName: 'card.png', mimeType: 'image/png' })]),
    errors: { 400: ['FILE_TYPE_NOT_ALLOWED'], 401: true, 403: true, 409: ['DOCUMENTS_LOCKED'], 413: true, 422: ['VALIDATION_ERROR'] }
  },
  {
    method: 'get', path: '/api/b2b/overview', tag: 'Agency (B2B)', id: 'getAgencyOverview',
    summary: 'Operational overview (approved agencies only)',
    description: 'The first route behind the approval gate. Every future operational route (passports, pickups, commission, withdrawals, invoices) sits behind the same gate. Before approval it answers `403 PARTNER_NOT_APPROVED`.',
    access: 'B2B with an APPROVED partner', needsAuth: true,
    success: ok(200, 'Partner overview.', obj({ companyName: str('Sky Travels Ltd'), approvalStatus: str('APPROVED') }), { companyName: 'Sky Travels Ltd', approvalStatus: 'APPROVED' }),
    errors: { 401: true, 403: ['PARTNER_NOT_APPROVED', 'FORBIDDEN'] }
  },

  // =============================================================== STAFF
  {
    method: 'get', path: '/api/staff/profile', tag: 'Staff', id: 'getStaffProfile',
    summary: 'My profile', description: 'The signed-in staff member\'s own record, including their permissions.',
    access: 'STAFF', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser({ role: 'STAFF', name: 'Sara Staff', email: 'sara@example.com', permissions: ['B2B_VIEW', 'DOCUMENT_VERIFY'] }) }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/staff/profile', tag: 'Staff', id: 'updateStaffProfile',
    summary: 'Update my profile', description: 'Only `name` and `phone`. Permissions can only be changed by an admin.\n\nA profile can be changed only by its owner (this route, which always acts on the signed-in person) and by an admin (`PATCH /api/admin/users/{id}`).',
    access: 'STAFF', needsAuth: true, body: profile.updateProfile, bodyExample: { name: 'Sara A. Staff' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ role: 'STAFF', name: 'Sara A. Staff' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/staff/partners', tag: 'Staff', id: 'staffListPartners',
    summary: 'List agencies (read only)', description: 'Needs the permission `B2B_VIEW`. Staff cannot approve or reject: that is an admin decision.',
    access: 'STAFF with B2B_VIEW', needsAuth: true, query: partner.listPartners, queryExample: { page: '1', limit: '10', approvalStatus: 'PENDING' },
    success: ok(200, 'Partners fetched.', arrayOf(ref('Partner')), [exPartner()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'patch', path: '/api/staff/partners/{id}/documents/{docId}', tag: 'Staff', id: 'staffReviewDocument',
    summary: 'Verify or reject an agency document',
    description: 'Needs the permission `DOCUMENT_VERIFY`. Reviewing a document does **not** approve the agency. The reviewer\'s `note` is shown to the agency owner.',
    access: 'STAFF with DOCUMENT_VERIFY', needsAuth: true, params: partner.reviewParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    body: partner.reviewDocument, bodyExample: { status: 'VERIFIED', note: 'License checked against the registry.' },
    success: ok(200, 'Document reviewed.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'VERIFIED', reviewNote: 'License checked against the registry.' })]), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== ADMIN: USERS
  {
    method: 'get', path: '/api/admin/rbac', tag: 'Admin: users', id: 'getRolesAndPermissions',
    summary: 'Roles and permissions catalog', description: 'The permissions defined in `config/rbac.json`, plus the role templates (what is ticked by default and what is suggested), the permissions that need another permission, the sensitive ones, and how to group them on screen. Use it to fill role and permission pickers so screens never drift from the rules.',
    access: 'ADMIN', needsAuth: true,
    success: ok(200, 'Roles and permissions fetched.', ref('RbacCatalog'), {
      roles: [{ code: 'STAFF', label: 'Staff', description: 'Internal team member.', selfRegister: false, invitable: true, bypassPermissions: false, assignablePermissions: true }],
      permissions: [{ code: 'VISA_VIEW', description: 'See visa applications' }],
      templates: [{ key: 'accountant', label: 'Accountant', description: 'Keeps the books and the vendor accounts.', defaults: ['REPORTS_VIEW', 'ACCOUNTS_EDIT'], optional: ['ACCOUNTS_VOID'] }],
      dependencies: { ACCOUNTS_EDIT: ['REPORTS_VIEW'] },
      sensitive: { ACCOUNTS_VOID: 'Voids receipts and payments and cancels sales, which changes the books.' },
      groups: [{ key: 'accounts', label: 'Accounts', permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_VOID'] }]
    }), errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/admin/roles', tag: 'Admin: users', id: 'listRoles',
    summary: 'List roles', description: 'Every role with how many people hold it. The built-in "No access yet" role comes first.',
    access: 'ADMIN', needsAuth: true,
    success: ok(200, 'Roles fetched.', arrayOf(ref('Role')), [exRole()]), errors: { 401: true, 403: true }
  },
  {
    method: 'post', path: '/api/admin/roles', tag: 'Admin: users', id: 'createRole',
    summary: 'Create a role',
    description: 'Send a `templateKey` to start from its default permissions, or send `permissions` yourself (they win over the template). A permission that needs another one (for example an edit permission needs its view permission) gets it added, so the answer can hold more than you sent. Names are unique without regard to case.',
    access: 'ADMIN', needsAuth: true, body: user.createRole, bodyExample: { name: 'Senior accountant', templateKey: 'accountant', permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_VOID', 'VENDOR_VIEW', 'VENDOR_MANAGE'] },
    success: ok(201, 'Role created.', ref('Role'), exRole({ name: 'Senior accountant', userCount: 0 })), errors: { 401: true, 403: true, 409: ['ROLE_NAME_TAKEN'], 422: true }
  },
  {
    method: 'get', path: '/api/admin/roles/{id}', tag: 'Admin: users', id: 'getRole',
    summary: 'Get a role', description: 'One role with its permissions and how many people hold it.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Role fetched.', ref('Role'), exRole()), errors: { 401: true, 403: true, 404: ['ROLE_NOT_FOUND'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/roles/{id}', tag: 'Admin: users', id: 'updateRole',
    summary: 'Change a role',
    description: 'Change the name, the description or the permissions. It works on the next request of everyone who holds the role. The built-in role cannot be changed (`ROLE_LOCKED`). The audit log keeps the permissions before and after.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updateRoleDefinition, bodyExample: { permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_VOID'] },
    success: ok(200, 'Role updated.', ref('Role'), exRole({ permissions: ['REPORTS_VIEW', 'ACCOUNTS_EDIT', 'ACCOUNTS_VOID'] })), errors: { 401: true, 403: true, 404: ['ROLE_NOT_FOUND'], 409: ['ROLE_LOCKED', 'ROLE_NAME_TAKEN'], 422: true }
  },
  {
    method: 'delete', path: '/api/admin/roles/{id}', tag: 'Admin: users', id: 'deleteRole',
    summary: 'Delete a role', description: 'Only a role that nobody holds. Otherwise `ROLE_IN_USE` says how many people to move first. The built-in role cannot be deleted.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Role deleted.'), errors: { 401: true, 403: true, 404: ['ROLE_NOT_FOUND'], 409: ['ROLE_LOCKED', 'ROLE_IN_USE'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/roles', tag: 'Admin: users', id: 'updateUserRoles',
    summary: 'Set the roles of a staff member',
    description: 'Replaces the roles of a STAFF account with the ones you send (at least one). The person may do what all their roles allow together. You cannot change your own roles. The change, with the permissions it added and removed, is written to the audit log.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.assignRoles, bodyExample: { roleIds: ['6ac0a5f0eebc510147c67300'] },
    success: ok(200, 'Roles updated.', ref('User'), exUser({ role: 'STAFF', roles: [{ _id: '6ac0a5f0eebc510147c67300', name: 'Accountant', system: false }] })), errors: { 401: true, 403: true, 404: true, 400: ['ROLE_NOT_FOUND'], 409: ['SELF_CHANGE', 'PERMISSIONS_NOT_ASSIGNABLE'], 422: true }
  },
  {
    method: 'post', path: '/api/admin/users/{id}/permissions-to-role', tag: 'Admin: users', id: 'convertPermissionsToRole',
    summary: 'Turn the old individual permissions into a role',
    description: 'For accounts made before roles existed. Makes a role from the person\'s own permission list, gives it to them and empties the old list.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.convertPermissions, bodyExample: { name: 'Front desk' },
    success: ok(201, 'The individual permissions are now a role.', obj({ user: ref('User'), role: ref('Role') }), { user: exUser({ role: 'STAFF' }), role: exRole({ name: 'Front desk' }) }), errors: { 401: true, 403: true, 404: true, 409: ['SELF_CHANGE', 'NOTHING_TO_CONVERT', 'ROLE_NAME_TAKEN'], 422: true }
  },
  {
    method: 'get', path: '/api/admin/profile', tag: 'Admin: users', id: 'getAdminProfile',
    summary: 'My profile (admin)', description: 'The signed-in admin\'s own record. The person always comes from the token, never from the URL or body.',
    access: 'ADMIN', needsAuth: true,
    success: ok(200, 'Profile fetched.', obj({ user: ref('User') }), { user: exUser({ role: 'ADMIN', name: 'Super Admin', email: 'boss@example.com' }) }), errors: { 401: true, 403: true }
  },
  {
    method: 'patch', path: '/api/admin/profile', tag: 'Admin: users', id: 'updateAdminProfile',
    summary: 'Update my profile (admin)', description: 'Change your own `name` or `phone`. Send at least one. Email, role, status and permissions cannot be changed here.',
    access: 'ADMIN', needsAuth: true, body: profile.adminUpdateUser, bodyExample: { name: 'Super Admin', phone: '+8801712345678' },
    success: ok(200, 'Profile updated.', obj({ user: ref('User') }), { user: exUser({ role: 'ADMIN', name: 'Super Admin', email: 'boss@example.com' }) }), errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'adminUpdateUserProfile',
    summary: 'Edit someone else\'s profile (name, phone)',
    description: 'The only way to change another person\'s profile. Every other role is refused (`403`), including staff holding every permission. Only `name` and `phone` can be changed; the email, role, status and permissions are ignored here and have their own admin actions. A changed phone becomes unverified again. The audit log records which fields changed, never their values. Send at least one field.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: profile.adminUpdateUser, bodyExample: { name: 'Edited By Admin', phone: '+8801788888888' },
    success: ok(200, 'Profile updated.', ref('User'), exUser({ name: 'Edited By Admin', phone: '+8801788888888', phoneVerified: false })), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/users', tag: 'Admin: users', id: 'listUsers',
    summary: 'List users', description: 'Search and filter every account, with pages. Responses never include password hashes.',
    access: 'ADMIN', needsAuth: true, query: user.listUsers, queryExample: { page: '1', limit: '10', role: 'B2C', status: 'ACTIVE', search: 'rahim' },
    success: ok(200, 'Users fetched.', arrayOf(ref('User')), [exUser()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'post', path: '/api/admin/users', tag: 'Admin: users', id: 'createInternalUser',
    summary: 'Create an admin or staff account (sends an invite)',
    description: 'Creates the account **without a password** and emails an invite link. Only the roles marked `invitable` in `rbac.json` (ADMIN, STAFF) can be created here; customers and agencies register themselves. `permissions` apply to STAFF only.',
    access: 'ADMIN', needsAuth: true, body: user.createUser, bodyExample: { name: 'Second Admin', email: 'admin2@example.com', role: 'ADMIN' },
    success: ok(201, 'Account created and invitation sent.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ _id: ID, name: 'Second Admin', email: 'admin2@example.com', role: 'ADMIN', status: 'PENDING', emailVerified: false, lastLoginAt: undefined }), inviteSent: true }),
    errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'post', path: '/api/admin/staff', tag: 'Admin: users', id: 'createStaff',
    summary: 'Create a staff account (sends an invite)',
    description: 'Same as creating a user, but always `STAFF`. Staff start with **no** permissions: they get exactly the list you send.',
    access: 'ADMIN', needsAuth: true, body: user.createStaff, bodyExample: { name: 'Sara Staff', email: 'sara@example.com', permissions: ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'] },
    success: ok(201, 'Staff account created and invitation sent.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ _id: ID, name: 'Sara Staff', email: 'sara@example.com', role: 'STAFF', status: 'PENDING', emailVerified: false, permissions: ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'], lastLoginAt: undefined }), inviteSent: true }),
    errors: { 401: true, 403: true, 409: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'getUser',
    summary: 'Get one user', description: 'One account by id.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'User fetched.', ref('User'), exUser()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'delete', path: '/api/admin/users/{id}', tag: 'Admin: users', id: 'deactivateUser',
    summary: 'Deactivate a user (soft delete)', description: 'Sets the account to `INACTIVE`, cancels its sessions, and keeps the record for the audit trail. You cannot deactivate yourself, and the last active admin cannot be removed.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Account deactivated.'), errors: { 401: true, 403: true, 404: true, 409: ['SELF_CHANGE', 'LAST_ADMIN'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/status', tag: 'Admin: users', id: 'updateUserStatus',
    summary: 'Change account status',
    description: 'ACTIVE, SUSPENDED, BLOCKED or INACTIVE. Anything other than ACTIVE cancels the person\'s tokens at once. You cannot change your own status, the last active admin is protected, and a never-verified account cannot be activated by hand. The change and the optional `reason` are written to the audit log.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updateStatus, bodyExample: { status: 'SUSPENDED', reason: 'Chargeback dispute' },
    success: ok(200, 'Account status updated.', ref('User'), exUser({ status: 'SUSPENDED' })), errors: { 401: true, 403: true, 404: true, 409: ['SELF_CHANGE', 'LAST_ADMIN', 'NOT_VERIFIED'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/role', tag: 'Admin: users', id: 'updateUserRole',
    summary: 'Change role (admin or staff only)',
    description: 'Moves an account between the invitable roles (ADMIN and STAFF). Customers and agencies keep what they registered as (`ROLE_LOCKED`). Moving someone to ADMIN clears their permission list; to STAFF it sets the list you send. The person\'s old tokens stop working.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updateRole, bodyExample: { role: 'STAFF', permissions: ['REPORT_VIEW'] },
    success: ok(200, 'Role updated.', ref('User'), exUser({ role: 'STAFF', permissions: ['REPORT_VIEW'] })), errors: { 401: true, 403: true, 404: true, 409: ['ROLE_LOCKED', 'SELF_CHANGE', 'LAST_ADMIN'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/users/{id}/permissions', tag: 'Admin: users', id: 'updateUserPermissions',
    summary: 'Set staff permissions',
    description: 'Replaces the permission list of a STAFF account (duplicates are removed). Takes effect on the next request. Roles without a permission list answer `PERMISSIONS_NOT_ASSIGNABLE`.',
    access: 'ADMIN', needsAuth: true, params: user.idParam, body: user.updatePermissions, bodyExample: { permissions: ['B2B_VIEW', 'DOCUMENT_VIEW'] },
    success: ok(200, 'Permissions updated.', ref('User'), exUser({ role: 'STAFF', permissions: ['B2B_VIEW', 'DOCUMENT_VIEW'] })), errors: { 401: true, 403: true, 404: true, 409: ['PERMISSIONS_NOT_ASSIGNABLE'], 422: true }
  },
  {
    method: 'post', path: '/api/admin/users/{id}/resend-invite', tag: 'Admin: users', id: 'resendInvite',
    summary: 'Resend an invitation', description: 'For an admin or staff account that has not set a password yet. The previous link stops working.',
    access: 'ADMIN', needsAuth: true, params: user.idParam,
    success: ok(200, 'Invitation sent again.', obj({ user: ref('User'), inviteSent: bool(true) }), { user: exUser({ role: 'STAFF', status: 'PENDING' }), inviteSent: true }), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },

  // =============================================================== ADMIN: AGENCIES
  {
    method: 'get', path: '/api/admin/b2b', tag: 'Admin: agencies', id: 'adminListPartners',
    summary: 'List agencies', description: 'Filter by approval status or search by company name and license number. `userId` is expanded to the owner\'s name, email, phone and status.',
    access: 'ADMIN', needsAuth: true, query: partner.listPartners, queryExample: { page: '1', limit: '10', approvalStatus: 'PENDING', search: 'sky' },
    success: ok(200, 'Partners fetched.', arrayOf(ref('Partner')), [exPartner({ userId: { _id: '6ac0a5f0eebc510147c6722e', name: 'Karim Hossain', email: 'karim@agency.com', phone: '+8801811111111', status: 'ACTIVE' } })], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/admin/b2b/{id}', tag: 'Admin: agencies', id: 'adminGetPartner',
    summary: 'Get one agency', description: 'One partner record with its documents.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    success: ok(200, 'Partner fetched.', ref('Partner'), exPartner()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}', tag: 'Admin: agencies', id: 'adminUpdatePartner',
    summary: 'Edit an agency\'s business record',
    description: 'Change `companyName`, `licenseNo`, `businessType` or `address` (send at least one). An agency owner can only change the last two themselves; an admin, as the reviewer, may change all four. The approval status is not touched. A license number that belongs to another agency answers `409`. The audit log records which fields changed, never their values.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    body: profile.adminUpdatePartner, bodyExample: { companyName: 'Sky Travels International Ltd', address: '9 Dhanmondi, Dhaka' },
    success: ok(200, 'Partner updated.', ref('Partner'), exPartner({ companyName: 'Sky Travels International Ltd', address: '9 Dhanmondi, Dhaka' })), errors: { 401: true, 403: true, 404: true, 409: true, 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}/approval', tag: 'Admin: agencies', id: 'decidePartner',
    summary: 'Approve, reject, review or suspend an agency',
    description: '`APPROVED` opens the operational routes and **needs a trade license on file** (`TRADE_LICENSE_MISSING`). `REJECTED` and `SUSPENDED` close them. None of these change the owner\'s login. The decision, your id and the old and new status are audit-logged, and the owner is emailed with your `note`.',
    access: 'ADMIN', needsAuth: true, params: partner.partnerParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f' },
    body: partner.decide, bodyExample: { decision: 'APPROVED', note: 'Documents verified' },
    success: ok(200, 'Partner status is now APPROVED.', ref('Partner'), exPartner({ approvalStatus: 'APPROVED', reviewNote: 'Documents verified', reviewedBy: '6ac0a5f0eebc510147c6722a', reviewedAt: '2026-10-03T07:10:00.000Z' })),
    errors: { 401: true, 403: true, 404: true, 409: ['TRADE_LICENSE_MISSING'], 422: true }
  },
  {
    method: 'patch', path: '/api/admin/b2b/{id}/documents/{docId}', tag: 'Admin: agencies', id: 'adminReviewDocument',
    summary: 'Verify or reject an agency document', description: 'Marks one uploaded document `VERIFIED` or `REJECTED`. The `note` is shown to the agency owner.',
    access: 'ADMIN', needsAuth: true, params: partner.reviewParam, paramExamples: { id: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    body: partner.reviewDocument, bodyExample: { status: 'REJECTED', note: 'Image is blurry, please upload a clearer scan.' },
    success: ok(200, 'Document reviewed.', arrayOf(ref('PartnerDocument')), [exDocument({ status: 'REJECTED', reviewNote: 'Image is blurry, please upload a clearer scan.' })]), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== ADMIN: AUDIT
  {
    method: 'get', path: '/api/admin/audit-logs', tag: 'Admin: audit', id: 'listAuditLogs',
    summary: 'Audit log', description: 'Security-relevant events, newest first: sign-ups, logins and failed logins, logouts, password changes and resets, account, role and permission changes, partner decisions, document reviews and token-theft detection. Passwords and tokens are never recorded.',
    access: 'ADMIN', needsAuth: true, query: user.listAuditLogs, queryExample: { page: '1', limit: '20', action: 'ROLE_CHANGED' },
    success: ok(200, 'Audit logs fetched.', arrayOf(ref('AuditLog')), [{ _id: ID, actorUserId: '6ac0a5f0eebc510147c6722a', action: 'ROLE_CHANGED', targetUserId: '6ac0a5f0eebc510147c6722e', resource: '', result: 'SUCCESS', ip: '::1', meta: { from: 'STAFF', to: 'ADMIN', permissions: [] }, createdAt: '2026-10-03T07:10:00.000Z' }], { paginated: true }),
    errors: { 401: true, 403: true, 422: true }
  },

  // =============================================================== DOCUMENTS
  {
    method: 'get', path: '/api/documents/partners/{partnerId}/{docId}', tag: 'Documents', id: 'downloadPartnerDocument',
    summary: 'Download a private document',
    description:
      'Streams the file **only after an ownership check**:\n\n' +
      '- an ADMIN, or STAFF with `DOCUMENT_VIEW`: any partner\'s documents\n' +
      '- a B2B user: only their own partner\'s documents\n' +
      '- anyone else: `404`, exactly as if the document did not exist\n\n' +
      'The file arrives as an attachment and is never cached. In Swagger UI use the **Download file** link in the response. In Postman use **Send and Download**.',
    access: 'Owner, ADMIN, or STAFF with DOCUMENT_VIEW', needsAuth: true, params: partner.documentParam, paramExamples: { partnerId: '6ac0a5f0eebc510147c6722f', docId: '6ac0a5f0eebc510147c67230' },
    binary: true, errors: { 401: true, 404: true, 422: true }
  },

  // =============================================================== TOUR CATEGORIES
  {
    method: 'get', path: '/api/tour-categories', tag: 'Tour categories', id: 'listTourCategories',
    summary: 'List tour categories',
    description: 'Active categories, sorted by name. A tour manager can add `includeInactive=true` to see the removed ones too; for anyone else the parameter changes nothing.\n\nA token is optional. ' + RATE.api,
    access: 'Public', optionalAuth: true, query: tours.listCategories, queryBlank: ['search', 'includeInactive'], queryDocs: { search: 'Part of the category name, ignoring letter case.', includeInactive: '`true` adds removed categories. Only tour managers get them.' }, queryExample: { page: '1', limit: '20' },
    success: ok(200, 'Categories fetched.', arrayOf(ref('TourCategory')), [exCategory()], { paginated: true }), errors: { 401: true, 422: true }
  },
  {
    method: 'get', path: '/api/tour-categories/{id}', tag: 'Tour categories', id: 'getTourCategory',
    summary: 'Get one tour category',
    description: 'The `id` is this API\'s id (24 hex characters) **or** the id the frontend used before, such as `cat_beach`. A removed category answers `404` unless the caller is a tour manager.',
    access: 'Public', optionalAuth: true, params: tours.categoryParam,
    success: ok(200, 'Category fetched.', ref('TourCategory'), exCategory()), errors: { 401: true, 404: true, 422: true }
  },
  {
    method: 'post', path: '/api/tour-categories', tag: 'Tour categories', id: 'createTourCategory',
    summary: 'Create a tour category',
    description: 'Category names are unique in any letter case and with any spacing. Sending a name that already exists is **not an error**: the existing category is returned with `200` instead of `201`, and no second one is made. If that category had been removed it is switched on again.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, body: tours.createCategory, bodyExample: { name: 'Beach & Resort' },
    success: ok(201, 'Category created.', ref('TourCategory'), exCategory()), errors: { 401: true, 403: true, 422: true },
    notes: 'The `200` answer for an existing name has the message "A category with this name already exists."'
  },
  {
    method: 'delete', path: '/api/tour-categories/{id}', tag: 'Tour categories', id: 'removeTourCategory',
    summary: 'Remove a tour category',
    description: 'Switches the category off (`isActive: false`); nothing is deleted. It disappears from the public list. A category that active tours still use cannot be removed (`CATEGORY_IN_USE`): move or archive those tours first. Repeating the call is harmless.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.categoryParam,
    success: ok(200, 'Category removed.', ref('TourCategory'), exCategory({ isActive: false })), errors: { 401: true, 403: true, 404: true, 409: ['CATEGORY_IN_USE'], 422: true }
  },

  // =============================================================== TOURS
  {
    method: 'get', path: '/api/tours', tag: 'Tours', id: 'listTours',
    summary: 'List and search tours',
    description:
      'The public sees **published** tours only (a `status` they send is ignored). A tour manager also sees drafts and unpublished tours, and archived ones with `status=archived`.\n\n' +
      '- `search` matches name, destination and country, ignoring letter case. Special characters are plain text.\n' +
      '- `category` takes one id or several separated by commas, as this API\'s ids or old frontend ids (`cat_beach,cat_city`).\n' +
      '- `minPrice` and `maxPrice` filter the public price. `durationDays` is an exact match.\n' +
      '- `sort` is `createdAt`, `price`, `durationDays` or `rating`; a leading `-` means descending. Default `-createdAt` (newest first).\n\n' +
      '**`b2bPrice` is only in the answer for** an admin, staff with TOUR_MANAGE, and a B2B user whose partner is APPROVED. Everyone else never receives the field.\n\n' +
      'A token is optional. With a token the answer is shaped for that person; a wrong token is `401`, not anonymous. An empty query value counts as not given. To see the signed-in view, authorize first (the Authorize button in Swagger UI, or the header `Authorization: Bearer <token>`; in Postman set the request\'s Authorization to Bearer Token `{{bearerToken}}`). ' + RATE.api,
    access: 'Public', optionalAuth: true, query: tours.listTours,
    queryDocs: {
      search: 'Matches name, destination and country, ignoring letter case. Special characters are plain text.',
      category: 'One category id, or several separated by commas. This API\'s id or an old frontend id such as `cat_beach`.',
      country: 'Exact country name, ignoring letter case.',
      destination: 'Part of the destination text.',
      status: 'Tour managers only: draft, published, unpublished or archived. Ignored for the public, who see published tours. Managers see everything except archived when it is empty.',
      minPrice: 'Lowest public price (inclusive).',
      maxPrice: 'Highest public price (inclusive).',
      durationDays: 'Exact number of days.',
      sort: 'createdAt, price, durationDays or rating. A leading `-` sorts descending. Empty means `-createdAt` (newest first).'
    },
    queryBlank: ['search', 'category', 'country', 'destination', 'status', 'minPrice', 'maxPrice', 'durationDays', 'sort'],
    queryExample: { page: '1', limit: '10' },
    success: ok(200, 'Tours fetched.', arrayOf(ref('Tour')), [exTour()], { paginated: true }), errors: { 401: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/{id}', tag: 'Tours', id: 'getTour',
    summary: 'Get one tour',
    description: 'The `id` is this API\'s id **or** the id the frontend used before, such as `tour_205`. The itinerary is in ascending day order. A tour that is not published answers `404` for the public, exactly like one that does not exist; tour managers can read it. `b2bPrice` follows the same rule as the list.\n\nA token is optional.',
    access: 'Public', optionalAuth: true, params: tours.tourParam,
    success: ok(200, 'Tour fetched.', ref('Tour'), exTour()), errors: { 401: true, 404: true, 422: true }
  },
  {
    method: 'post', path: '/api/tours', tag: 'Tours', id: 'createTour',
    summary: 'Create a tour',
    description:
      'Prices and counts cannot be negative. `priceCurrency` is `BDT`, `USD` or `EUR`. `status` defaults to `draft`. `category` is optional and may be this API\'s id or an old frontend id; it must exist and be active. ' +
      'Itinerary days are unique, from 1, and no day may be after `durationDays`. A **published** tour needs at least one itinerary day; a draft may be incomplete. ' +
      '`coverImage` and `gallery` are http or https links. Unknown fields are ignored.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, body: tours.createTour,
    bodyExample: {
      name: "Cox's Bazar Beach Escape", country: 'Bangladesh', destination: "Cox's Bazar, Bangladesh", category: 'cat_beach', durationDays: 3, priceCurrency: 'BDT',
      price: 12500, b2bPrice: 10000, seats: 25, status: 'published', rating: 4.9, coverImage: 'https://picsum.photos/seed/coxs-bazar/900/560',
      description: 'Experience the world longest natural sea beach with luxury resort stay and fresh seafood.',
      included: ['2 nights hotel stay', 'Breakfast included'], excluded: ['Personal expenses'], hotels: ['Ocean Paradise Hotel & Resort'],
      itinerary: exItinerary, terms: 'Standard cancellation rules apply.'
    },
    success: ok(201, 'Tour created.', ref('Tour'), exTour({ b2bPrice: 10000 })), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'patch', path: '/api/tours/{id}', tag: 'Tours', id: 'updateTour',
    summary: 'Edit a tour',
    description: 'Send only the fields to change (at least one). The rules are checked against the whole tour as it would be saved, so publishing a tour with no itinerary, or shortening `durationDays` below an existing itinerary day, is refused. Setting `status` to `published` publishes it; setting it back from `archived` restores it. The audit log records which fields changed, never their values.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.tourParam,
    body: tours.updateTour, bodyExample: { price: 13000, seats: 30 },
    success: ok(200, 'Tour updated.', ref('Tour'), exTour({ price: 13000, seats: 30, b2bPrice: 10000 })), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'delete', path: '/api/tours/{id}', tag: 'Tours', id: 'archiveTour',
    summary: 'Archive a tour',
    description: 'Sets `status` to `archived`. The tour leaves every public list and nothing is deleted, so records that point at it keep working. Repeating the call is harmless. A manager can publish it again with **Edit a tour**.',
    access: 'ADMIN, or STAFF with TOUR_MANAGE', needsAuth: true, params: tours.tourParam,
    success: ok(200, 'Tour archived.', ref('Tour'), exTour({ status: 'archived', b2bPrice: 10000 })), errors: { 401: true, 403: true, 404: true, 422: true }
  },

  // =============================================================== CUSTOM TOURS
  {
    method: 'post', path: '/api/tours/custom-requests', tag: 'Custom tours', id: 'createCustomTourRequest',
    summary: 'Send a custom tour request',
    description:
      'Only a signed-in **B2C customer** can send one. Agencies, staff and admins get `403`.\n\n' +
      'The owner is always the signed-in customer. `userId`, `status` and review fields in the body are ignored. The request starts as `NEW`. `endDate` must not be before `startDate`; `travelers` is at least 1; `transportation` defaults to `Private car`. ' +
      'Dates are `YYYY-MM-DD` or a full ISO date-time.',
    access: 'B2C', needsAuth: true, body: tours.createCustomRequest,
    bodyExample: { customer: 'Rahim Uddin', phone: '+8801712345678', destination: 'Sajek Valley', travelers: 4, startDate: '2026-12-01', endDate: '2026-12-05', hotel: '3-star', transportation: 'Private car', activities: ['Trekking', 'Bonfire'], requirements: 'Vegetarian meals', itinerary: [{ day: 1, title: 'Arrival', description: 'Check in' }] },
    success: ok(201, 'Your custom tour request was received.', ref('CustomTourRequest'), exCustomRequest()), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/custom-requests', tag: 'Custom tours', id: 'listCustomTourRequests',
    summary: 'List custom tour requests',
    description: 'A B2C customer receives **their own** requests. A tour manager receives everyone\'s, with `userId` expanded to the customer\'s name, email and phone. Filter by `status`, search the customer name or destination. Newest first.',
    access: 'B2C (own requests), or ADMIN / STAFF with TOUR_MANAGE (all)', needsAuth: true, query: tours.listCustomRequests, queryBlank: ['status', 'search'], queryDocs: { status: 'NEW, IN_REVIEW, QUOTED, CONFIRMED or CANCELLED.', search: 'Part of the customer name or destination.' }, queryExample: { page: '1', limit: '10' },
    success: ok(200, 'Custom tour requests fetched.', arrayOf(ref('CustomTourRequest')), [exCustomRequest()], { paginated: true }), errors: { 401: true, 403: true, 422: true }
  },
  {
    method: 'get', path: '/api/tours/custom-requests/{id}', tag: 'Custom tours', id: 'getCustomTourRequest',
    summary: 'Get one custom tour request',
    description: 'A customer can read only their own request. Someone else\'s answers `404`, exactly like one that does not exist. The consultant\'s `reviewNote` (for example the quote) appears here.',
    access: 'B2C (own request), or ADMIN / STAFF with TOUR_MANAGE', needsAuth: true, params: tours.customRequestParam,
    success: ok(200, 'Custom tour request fetched.', ref('CustomTourRequest'), exCustomRequest()), errors: { 401: true, 403: true, 404: true, 422: true }
  },
  {
    method: 'patch', path: '/api/tours/custom-requests/{id}/status', tag: 'Custom tours', id: 'setCustomTourRequestStatus',
    summary: 'Change the status of a custom tour request',
    description:
      'Allowed moves: `NEW` to `IN_REVIEW` or `CANCELLED`; `IN_REVIEW` to `QUOTED` or `CANCELLED`; `QUOTED` to `IN_REVIEW`, `CONFIRMED` or `CANCELLED`; `CONFIRMED` to `CANCELLED`. `CANCELLED` is final. Any other move answers `409 INVALID_TRANSITION`.\n\n' +
      'A **tour manager** can make any allowed move and may add a `note` (for example the quote), shown to the customer. A **customer** can only cancel their own request, and only while it is `NEW`; any other change is `403`.',
    access: 'ADMIN / STAFF with TOUR_MANAGE (any allowed move), or B2C (cancel own NEW request)', needsAuth: true, params: tours.customRequestParam,
    body: tours.setCustomRequestStatus, bodyExample: { status: 'QUOTED', note: 'Total BDT 85,000 for four travelers.' },
    success: ok(200, 'Request status is now QUOTED.', ref('CustomTourRequest'), exCustomRequest({ status: 'QUOTED', reviewNote: 'Total BDT 85,000 for four travelers.', reviewedBy: '6ac0a5f0eebc510147c6722b', reviewedAt: NOW })),
    errors: { 401: true, 403: true, 404: true, 409: ['INVALID_TRANSITION'], 422: true }
  },

  // =============================================================== MEMBERSHIP PLANS
  {
    method: 'get', path: '/api/membership-plans', tag: 'Membership plans', id: 'listMembershipPlans',
    summary: 'List membership plans',
    description: 'Every plan, **inactive ones included**, sorted by `sortOrder`. The dashboard hides inactive plans itself where needed.\n\n**Answer shape:** `{ items, total }`, with no `success` or `data` wrapper and with `id` instead of `_id`. All membership routes answer this way.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, query: membership.listPlans, queryBlank: ['search'], queryDocs: { search: 'Part of the plan name, ignoring letter case.' },
    success: ok(200, 'Plans fetched.', obj({}), undefined, { raw: { items: [exPlan()], total: 1 }, rawSchema: listOf('MembershipPlan') }), errors: { 401: true, 403: true }
  },
  {
    method: 'post', path: '/api/membership-plans', tag: 'Membership plans', id: 'createMembershipPlan',
    summary: 'Create a membership plan',
    description: 'The server sets `id`, `sortOrder` (the highest so far plus 1) and the timestamps. The name is unique in any letter case and spacing. `maxDiscountAmount` of `0` or `null` means no cap and is saved as `null`. Empty features are dropped. Unknown fields are ignored. The tour and visa discounts are separate, so a plan can give 10% on tours and 5% on visas.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, body: membership.createPlan,
    bodyExample: { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 4500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 3000, description: 'Best value - a full year of member pricing.', features: ['10% off tour packages', '10% off visa processing'], isActive: true },
    success: ok(201, 'Plan created.', obj({}), undefined, { raw: exPlan(), rawSchema: ref('MembershipPlan') }),
    errors: { 400: invalid('Duration must be at least 1.', 'body.durationValue'), 401: true, 403: true, 409: ['PLAN_NAME_TAKEN'] }
  },
  {
    method: 'put', path: '/api/membership-plans/{id}', tag: 'Membership plans', id: 'updateMembershipPlan',
    summary: 'Edit a membership plan',
    description: 'The dashboard sends the whole plan back, so `id`, `sortOrder` and the timestamps are ignored. `name`, `durationValue`, `durationUnit` and `price` are required; any other field that is left out stays as it is. The name check skips the plan being edited. **Memberships already sold are never changed**: each keeps its own copy of the plan (`planSnapshot`).',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam,
    body: membership.updatePlan, bodyExample: { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 5000, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 3000, description: 'Best value', features: ['10% off tour packages'], isActive: true },
    success: ok(200, 'Plan updated.', obj({}), undefined, { raw: exPlan({ price: 5000 }), rawSchema: ref('MembershipPlan') }),
    errors: { 400: invalid('Price cannot be negative.', 'body.price'), 401: true, 403: true, 404: true, 409: ['PLAN_NAME_TAKEN'] }
  },
  {
    method: 'patch', path: '/api/membership-plans/{id}/toggle', tag: 'Membership plans', id: 'toggleMembershipPlan',
    summary: 'Activate or deactivate a plan',
    description: 'No request body. Flips `isActive` and returns the plan. An inactive plan cannot be assigned to a customer (`Plan not available`). Memberships already sold carry on.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam,
    success: ok(200, 'Plan updated.', obj({}), undefined, { raw: exPlan({ isActive: false }), rawSchema: ref('MembershipPlan') }), errors: { 400: invalid('Invalid id.', 'params.id'), 401: true, 403: true, 404: true }
  },
  {
    method: 'delete', path: '/api/membership-plans/{id}', tag: 'Membership plans', id: 'deleteMembershipPlan',
    summary: 'Delete a membership plan',
    description: 'Only a plan that no membership ever used can be deleted, **including memberships that were later deleted or expired**. Otherwise the answer is `409`: deactivate the plan instead.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam,
    success: ok(200, 'Plan deleted.', obj({}), undefined, { raw: { success: true, id: '6ac0a5f0eebc510147c67250' }, rawSchema: deleted() }), errors: { 400: invalid('Invalid id.', 'params.id'), 401: true, 403: true, 404: true, 409: ['PLAN_IN_USE'] }
  },

  // =============================================================== MEMBERSHIPS
  {
    method: 'get', path: '/api/memberships', tag: 'Memberships', id: 'listMemberships',
    summary: 'List memberships',
    description:
      'Newest start date first. Every item carries the **effective status** and a computed `daysLeft`: a membership whose end date has passed is reported as `expired` even if the nightly job has not saved that yet.\n\n' +
      '- `status` matches the effective status: `active` excludes lapsed rows, `expired` includes them.\n' +
      '- `expiringIn=7` keeps active memberships with 0 to 7 days left.\n' +
      '- `search` matches the customer name, phone and email by plain text, ignoring letter case.\n' +
      '- Deleted memberships are never listed. There is no pagination.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, query: membership.listMemberships,
    queryBlank: ['status', 'planId', 'expiringIn', 'search'], queryDocs: { status: 'pending, active, expired or cancelled (the effective status).', planId: 'Only memberships of this plan.', expiringIn: 'Active memberships with at most this many days left.', search: 'Part of the customer name, phone or email.' },
    success: ok(200, 'Memberships fetched.', obj({}), undefined, { raw: { items: [exMembership()], total: 1 }, rawSchema: listOf('Membership') }), errors: { 400: invalid('Invalid status.', 'query.status'), 401: true, 403: true }
  },
  {
    method: 'post', path: '/api/memberships', tag: 'Memberships', id: 'createMembership',
    summary: 'Assign a plan to a customer and record the payment',
    description:
      'Checks, in this order: the customer exists (`404`), is a B2C customer (`400`), the plan exists and is active (`400 Plan not available`), and the customer has no active membership (`409`). A membership that has lapsed never blocks a renewal.\n\n' +
      'The membership keeps a copy of the plan (`planSnapshot`). The end date is the start date plus the plan length minus one day, at 23:59:59.999 in Asia/Dhaka: a 15-day plan starting 1 Oct ends on 15 Oct. `startDate` is `YYYY-MM-DD` and defaults to today in Asia/Dhaka. A future start date is still `active`.\n\n' +
      'The payment is saved as `paid` with the amount **from the plan** (the request cannot set it). `trxId` is only kept for the record and may be empty.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, body: membership.createMembership,
    bodyExample: { customerId: '6ac0a5f0eebc510147c6722a', planId: '6ac0a5f0eebc510147c67250', paymentMethod: 'bkash', trxId: 'BKX88231A', startDate: '2026-10-07' },
    success: ok(201, 'Membership created.', obj({}), undefined, { raw: exMembership(), rawSchema: ref('Membership') }),
    errors: {
      400: { codes: ['NOT_B2C', 'PLAN_NOT_AVAILABLE', 'VALIDATION_ERROR'], message: 'Membership is only for B2C customers', fields: undefined },
      401: true, 403: true, 404: true, 409: ['ALREADY_ACTIVE']
    }
  },
  {
    method: 'patch', path: '/api/memberships/{id}/cancel', tag: 'Memberships', id: 'cancelMembership',
    summary: 'Cancel a membership',
    description: 'Allowed for an active or pending membership. Sets `status` to `cancelled` with `cancelledAt` and the optional `reason` (up to 500 characters). Discounts stop at once. The payment status is **not** changed: refunds are handled by hand.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam, body: membership.cancelMembership, bodyRequired: false,
    bodyExample: { reason: 'Customer request, refund issued.' },
    success: ok(200, 'Membership cancelled.', obj({}), undefined, { raw: exMembership({ status: 'cancelled', cancelledAt: NOW, cancelReason: 'Customer request, refund issued.' }), rawSchema: ref('Membership') }),
    errors: { 400: invalid('Reason must be at most 500 characters.', 'body.reason'), 401: true, 403: true, 404: true, 409: { codes: ['INVALID_STATE'], message: 'Only active or pending memberships can be cancelled.' } }
  },
  {
    method: 'patch', path: '/api/memberships/{id}/extend', tag: 'Memberships', id: 'extendMembership',
    summary: 'Extend a membership',
    description: 'Adds `days` (1 to 3650) to the current end date and keeps the 23:59:59.999 time, in Asia/Dhaka. Only an effectively **active** membership can be extended; a lapsed, cancelled or expired one answers `409`.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam, body: membership.extendMembership, bodyExample: { days: 7 },
    success: ok(200, 'Membership extended.', obj({}), undefined, { raw: exMembership({ endDate: '2026-11-06T17:59:59.999Z', daysLeft: 38 }), rawSchema: ref('Membership') }),
    errors: { 400: invalid('Days must be at least 1.', 'body.days'), 401: true, 403: true, 404: true, 409: { codes: ['INVALID_STATE'], message: 'Only active memberships can be extended.' } }
  },
  {
    method: 'delete', path: '/api/memberships/{id}', tag: 'Memberships', id: 'deleteMembership',
    summary: 'Delete a membership',
    description: 'A **soft delete**: the membership leaves every list and count, and no longer blocks the customer from buying again, but the record and its payment are kept, so the **revenue stays in the reports**. A deleted membership answers `404` afterwards.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.idParam,
    success: ok(200, 'Membership deleted.', obj({}), undefined, { raw: { success: true, id: '6ac0a5f0eebc510147c67251' }, rawSchema: deleted() }), errors: { 400: invalid('Invalid id.', 'params.id'), 401: true, 403: true, 404: true }
  },
  {
    method: 'get', path: '/api/customers/{customerId}/memberships', tag: 'Memberships', order: 10, id: 'listCustomerMemberships',
    summary: 'Memberships of one customer',
    description: 'The full history of one customer, newest first, with the effective status and `daysLeft`. Used by the customer profile page. This answer has `items` only, with no `total`. An unknown customer answers `404`.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, params: membership.customerParam, paramExamples: { customerId: '6ac0a5f0eebc510147c6722a' },
    success: ok(200, 'Memberships fetched.', obj({}), undefined, { raw: { items: [exMembership()] }, rawSchema: obj({ items: arrayOf(ref('Membership')) }, ['items']) }), errors: { 400: invalid('Invalid id.', 'params.customerId'), 401: true, 403: true, 404: true }
  },

  // =============================================================== MEMBERSHIP REPORTS
  {
    method: 'get', path: '/api/membership-stats', tag: 'Membership reports', id: 'getMembershipStats',
    summary: 'Membership numbers for the dashboard',
    description:
      'Everything the cards and charts need, in one object. Memberships are counted by their effective status; deleted ones are not counted, but their payments still count in revenue. Months and days follow Asia/Dhaka.\n\n' +
      '- `expiredThisMonth` counts expired memberships (not cancelled ones) whose end date is in the current month.\n' +
      '- `revenueByMonth` always has exactly 6 entries, the last 6 calendar months, oldest first, with `0` for a month without payments.\n' +
      '- `planDistribution` has one entry per existing plan, including plans with 0 memberships.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true,
    success: ok(200, 'Stats fetched.', obj({}), undefined, { raw: exStats, rawSchema: ref('MembershipStats') }), errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/membership-report/periods', tag: 'Membership reports', id: 'getMembershipPeriods',
    summary: 'Sales by period',
    description: 'The last 6 periods, oldest first. `mode=monthly` (the default) gives 6 calendar months, and the current one is labelled "(to date)". `mode=half` gives 6 fifteen-day periods (the 1st to the 15th, the 16th to the end of the month), ending with the one we are in. Each period runs from 00:00:00.000 of its first day to 23:59:59.999 of its last, in Asia/Dhaka.',
    access: 'ADMIN, or STAFF with MEMBERSHIP_MANAGE', needsAuth: true, query: membership.reportPeriods, queryExample: { mode: 'monthly' },
    success: ok(200, 'Report fetched.', obj({}), undefined, { raw: { items: [exPeriod] }, rawSchema: obj({ items: arrayOf(ref('MembershipPeriod')) }, ['items']) }), errors: { 400: invalid('mode must be monthly or half.', 'query.mode'), 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/b2c/memberships', tag: 'Customer (B2C)', id: 'listMyMemberships',
    summary: 'My memberships',
    description: 'A customer reads **their own** memberships, newest first, with the effective status and `daysLeft`. The customer always comes from the token. The admin\'s internal `cancelReason` is left out. Use `status=active` for the profile page. Read-only: a customer cannot sell, cancel or extend one.',
    access: 'B2C', needsAuth: true, query: membership.listOwnMemberships, queryBlank: ['status'], queryDocs: { status: 'pending, active, expired or cancelled (the effective status).' },
    success: ok(200, 'Memberships fetched.', obj({}), undefined, { raw: { items: [(({ cancelReason, ...rest }) => rest)(exMembership())], total: 1 }, rawSchema: listOf('Membership') }), errors: { 400: invalid('Invalid status.', 'query.status'), 401: true, 403: true }
  },

  // =============================================================== DASHBOARD (internal)
  {
    method: 'get', path: '/api/dashboard/overview', tag: 'Dashboard', id: 'getDashboardOverview',
    summary: 'Admin dashboard cards',
    description: 'The numbers on the top row of the admin dashboard. `totalCustomers`, `totalPartners` and `totalUsers` are counted from the database (`totalCustomers` shows a placeholder while there are no customers yet). The visa, tour and revenue figures are placeholders until those modules exist.',
    access: 'ADMIN, or STAFF', needsAuth: true,
    success: ok(200, 'Dashboard overview fetched successfully.', obj({
      totalVisaApplications: INT(1284), visaDelta: str('+8.2%'), activeTours: INT(48), tourDelta: str('+4.6%'),
      totalCustomers: INT(2310), customerDelta: str('+12.1%'), revenueThisMonth: INT(84500), revenueDelta: str('+6.8%'),
      totalPartners: INT(3), totalUsers: INT(12)
    }), {
      totalVisaApplications: 1284, visaDelta: '+8.2%', activeTours: 48, tourDelta: '+4.6%', totalCustomers: 2310, customerDelta: '+12.1%',
      revenueThisMonth: 84500, revenueDelta: '+6.8%', totalPartners: 3, totalUsers: 12
    }),
    errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/dashboard/visa-trend', tag: 'Dashboard', id: 'getDashboardVisaTrend',
    summary: 'Visa applications per month',
    description: 'Twelve points, January to December, for the line chart. Placeholder values until the visa module stores real applications.',
    access: 'ADMIN, or STAFF', needsAuth: true,
    success: ok(200, 'Visa trend fetched successfully.', arrayOf(TREND_POINT), [{ label: 'Jan', value: 60 }, { label: 'Feb', value: 77 }]),
    errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/dashboard/tour-trend', tag: 'Dashboard', id: 'getDashboardTourTrend',
    summary: 'Tour bookings per month',
    description: 'Nine points, January to September, for the bar chart. Placeholder values until there is a booking module.',
    access: 'ADMIN, or STAFF', needsAuth: true,
    success: ok(200, 'Tour trend fetched successfully.', arrayOf(TREND_POINT), [{ label: 'Jan', value: 18 }, { label: 'Feb', value: 25 }]),
    errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/dashboard/recent-applications', tag: 'Dashboard', id: 'getDashboardRecentApplications',
    summary: 'Latest visa applications',
    description: 'The four most recent applications for the dashboard table. Placeholder rows until the visa module stores real applications.',
    access: 'ADMIN, or STAFF', needsAuth: true,
    success: ok(200, 'Recent applications fetched successfully.', arrayOf(obj({
      id: str('visa_501'), reference: str('VS-2026-0501'), applicant: str('Rohan Gupta'), country: str('United Arab Emirates'), submittedAt: str(NOW), status: str('in_review')
    })), [{ id: 'visa_501', reference: 'VS-2026-0501', applicant: 'Rohan Gupta', country: 'United Arab Emirates', submittedAt: NOW, status: 'in_review' }]),
    errors: { 401: true, 403: true }
  },
  {
    method: 'get', path: '/api/dashboard/recent-activities', tag: 'Dashboard', id: 'getDashboardRecentActivities',
    summary: 'Latest activity',
    description: 'The ten newest entries of the security and audit log, worded for people ("login failed on user:..."). When the log is empty, placeholder entries are returned so the dashboard is not blank.',
    access: 'ADMIN, or STAFF', needsAuth: true,
    success: ok(200, 'Recent activities fetched successfully.', arrayOf(obj({ id: str(ID), actor: str('Super Admin'), action: str('login'), at: str(NOW) })), [{ id: ID, actor: 'Super Admin', action: 'login', at: NOW }]),
    errors: { 401: true, 403: true }
  },

  // =============================================================== VISA (internal)
  V('get', '/api/visa/dashboard', 'getVisaDashboard', 'Visa module counters',
    'Application counts by status and channel, the approval rate, per-country figures and the 10 newest applications, all counted from the database. `approvedTotal` counts approved, passport ready and completed files. `unassigned` ignores finished applications.',
    ACCESS.view, {
      success: ok(200, 'Visa dashboard overview fetched.', obj({
        total: INT(1), submitted: INT(0), underReview: INT(1), actionRequired: INT(0), documentsCompleted: INT(0), processing: INT(0), submittedToEmbassy: INT(0), approved: INT(0),
        passportReady: INT(0), completed: INT(0), rejected: INT(0), cancelled: INT(0), b2c: INT(1), b2b: INT(0), unassigned: INT(0), approvedTotal: INT(0), decisionRate: INT(0),
        countries: arrayOf(obj({ countryId: str(ID_COUNTRY), country: str('China'), flag: str('🇨🇳'), applications: INT(1), approved: INT(0), approvalRate: INT(0) })), recent: arrayOf(VISA_APPLICATION)
      }), {
        total: 1, submitted: 0, underReview: 1, actionRequired: 0, documentsCompleted: 0, processing: 0, submittedToEmbassy: 0, approved: 0, passportReady: 0, completed: 0, rejected: 0, cancelled: 0,
        b2c: 1, b2b: 0, unassigned: 0, approvedTotal: 0, decisionRate: 0, countries: [{ countryId: ID_COUNTRY, country: 'China', flag: '🇨🇳', applications: 1, approved: 0, approvalRate: 0 }], recent: [VISA_LIST_ROW_EXAMPLE]
      }),
      errors: { 401: true, 403: true }
    }),
  V('get', '/api/visa/staff', 'listVisaStaff', 'Staff for the "assign to" list',
    'Active admins and staff, with only their id, name and role. This is what the application screens use to pick who handles a file, so it needs only `VISA_VIEW`, not the user list permission.',
    ACCESS.view, {
      query: visaApp.staffLookup, queryExample: { search: 'priya' },
      success: ok(200, 'Staff fetched.', arrayOf(obj({ _id: str(ID_STAFF), name: str('Priya Nair'), role: str('STAFF') })), [{ _id: ID_STAFF, name: 'Priya Nair', role: 'STAFF' }]),
      errors: { 401: true, 403: true, 422: true }
    }),

  // ---- countries
  V('get', '/api/visa/countries', 'listVisaCountries', 'Visa countries',
    'Countries we process visas for, in display order. `search` matches the name or the code. A list answers with `pagination` as well as `meta`.',
    ACCESS.view, { query: visaCatalog.listCountries, queryExample: { search: 'china', status: 'active' }, success: list('Visa countries fetched.', VISA_COUNTRY, VISA_COUNTRY_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('post', '/api/visa/countries', 'createVisaCountry', 'Add a visa country',
    'The name must be new (any letter case). `richChecklist` is rich text and is cleaned on save: only headings, paragraphs, lists, bold, italic, quotes and links survive.',
    ACCESS.edit, {
      body: visaCatalog.createCountry, bodyExample: { name: 'Japan', code: 'JP', flag: '🇯🇵', description: 'Tourist visa processing.', processingMode: 'Embassy', physicalPassportRequired: true },
      success: ok(201, 'Country created.', VISA_COUNTRY, VISA_COUNTRY_EXAMPLE), errors: { 401: true, 403: true, 409: ['COUNTRY_EXISTS'], 422: true }
    }),
  V('get', '/api/visa/countries/{id}', 'getVisaCountry', 'One visa country', 'The country with that id. An unknown id answers `404`.',
    ACCESS.view, { params: visaCatalog.idParam, paramExamples: { id: ID_COUNTRY }, success: ok(200, 'Visa country fetched.', VISA_COUNTRY, VISA_COUNTRY_EXAMPLE), errors: { 401: true, 403: true, 404: ['COUNTRY_NOT_FOUND'], 422: true } }),
  V('patch', '/api/visa/countries/{id}', 'updateVisaCountry', 'Change a visa country', 'Send only what changes. Pausing a country hides it from new applications and keeps the old ones.',
    ACCESS.edit, {
      params: visaCatalog.idParam, paramExamples: { id: ID_COUNTRY }, body: visaCatalog.updateCountry, bodyExample: { status: 'paused' },
      success: ok(200, 'Country updated.', VISA_COUNTRY, VISA_COUNTRY_EXAMPLE), errors: { 401: true, 403: true, 404: ['COUNTRY_NOT_FOUND'], 409: ['COUNTRY_EXISTS'], 422: true }
    }),
  V('delete', '/api/visa/countries/{id}', 'deleteVisaCountry', 'Delete a visa country',
    'Deletes the country with its visa types and checklists. A country that has applications is refused with `COUNTRY_IN_USE`: pause it instead.',
    ACCESS.edit, { params: visaCatalog.idParam, paramExamples: { id: ID_COUNTRY }, success: ok(200, 'Country deleted.'), errors: { 401: true, 403: true, 404: ['COUNTRY_NOT_FOUND'], 409: ['COUNTRY_IN_USE'], 422: true } }),

  // ---- visa types
  V('get', '/api/visa/types', 'listVisaTypes', 'Visa types', 'Visa types with their prices and fees. Filter by `countryId` or `status`, or search the name.',
    ACCESS.view, { query: visaCatalog.listTypes, queryExample: { countryId: ID_COUNTRY }, success: list('Visa types fetched.', VISA_TYPE, VISA_TYPE_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('post', '/api/visa/types', 'createVisaType', 'Add a visa type',
    'Prices are in `currency`, which must be enabled in the currency settings (BDT and USD are by default). The name must be new inside the country.',
    ACCESS.edit, {
      body: visaCatalog.createType, bodyExample: { countryId: ID_COUNTRY, name: 'Business Visa', entries: 'multiple', currency: 'BDT', b2cPrice: 18000, b2bNetPrice: 15000, fees: { embassy: 12000, service: 5000, vat: 1000 }, passportRequirement: 'physical_required', pickupAvailable: true },
      success: ok(201, 'Visa type created.', VISA_TYPE, VISA_TYPE_EXAMPLE), errors: { 401: true, 403: true, 404: ['COUNTRY_NOT_FOUND'], 409: ['VISA_TYPE_EXISTS'], 422: ['VALIDATION_ERROR', 'CURRENCY_NOT_ENABLED'] }
    }),
  V('get', '/api/visa/types/{id}', 'getVisaType', 'One visa type', 'The visa type with that id. An unknown id answers `404`.',
    ACCESS.view, { params: visaCatalog.idParam, paramExamples: { id: ID_TYPE }, success: ok(200, 'Visa type fetched.', VISA_TYPE, VISA_TYPE_EXAMPLE), errors: { 401: true, 403: true, 404: ['VISA_TYPE_NOT_FOUND'], 422: true } }),
  V('patch', '/api/visa/types/{id}', 'updateVisaType', 'Change a visa type',
    'Send only what changes. A price change never alters an existing application: each one keeps the price it was created with.',
    ACCESS.edit, {
      params: visaCatalog.idParam, paramExamples: { id: ID_TYPE }, body: visaCatalog.updateType, bodyExample: { b2cPrice: 13000 },
      success: ok(200, 'Visa type updated.', VISA_TYPE, VISA_TYPE_EXAMPLE), errors: { 401: true, 403: true, 404: ['VISA_TYPE_NOT_FOUND'], 409: ['VISA_TYPE_EXISTS', 'VISA_TYPE_IN_USE'], 422: ['VALIDATION_ERROR', 'CURRENCY_NOT_ENABLED'] }
    }),
  V('delete', '/api/visa/types/{id}', 'deleteVisaType', 'Delete a visa type', 'Deletes the type and its checklists. A type that has applications is refused with `VISA_TYPE_IN_USE`: pause it instead.',
    ACCESS.edit, { params: visaCatalog.idParam, paramExamples: { id: ID_TYPE }, success: ok(200, 'Visa type deleted.'), errors: { 401: true, 403: true, 404: ['VISA_TYPE_NOT_FOUND'], 409: ['VISA_TYPE_IN_USE'], 422: true } }),

  // ---- checklists
  V('get', '/api/visa/checklists/{countryId}/{visaTypeId}/{applicantType}', 'getVisaChecklist', 'Document checklist',
    'The documents an applicant must give for one country, visa type and applicant type (`individual`, `business`, `student`, `employee` or `sponsored`). When nothing was saved, a default list is returned with `isDefault: true`.',
    ACCESS.view, {
      params: visaCatalog.checklistParam, paramExamples: { countryId: ID_COUNTRY, visaTypeId: ID_TYPE, applicantType: 'individual' },
      success: ok(200, 'Checklist fetched.', VISA_CHECKLIST, VISA_CHECKLIST_EXAMPLE), errors: { 401: true, 403: true, 404: ['VISA_TYPE_NOT_FOUND'], 422: true }
    }),
  V('put', '/api/visa/checklists/{countryId}/{visaTypeId}/{applicantType}', 'saveVisaChecklist', 'Save a document checklist',
    'Replaces the whole list with `items`. Each item gets an `_id` that an upload can refer to with `checklistItemId`, so its size limit applies.',
    ACCESS.edit, {
      params: visaCatalog.checklistParam, paramExamples: { countryId: ID_COUNTRY, visaTypeId: ID_TYPE, applicantType: 'individual' }, body: visaCatalog.saveChecklist,
      bodyExample: { items: [{ label: 'Passport (valid at least 6 months)', requirement: 'required', submissionMode: 'both', maxSizeMb: 10 }] },
      success: ok(200, 'Checklist saved.', VISA_CHECKLIST, VISA_CHECKLIST_EXAMPLE), errors: { 401: true, 403: true, 404: ['VISA_TYPE_NOT_FOUND'], 422: true }
    }),

  // ---- statuses
  V('get', '/api/visa/statuses', 'listVisaStatuses', 'Visa statuses',
    'The 11 system statuses (created on first use) and the ones staff added, in display order. The allowed moves between statuses are in `config/visaStatuses.json`.',
    ACCESS.view, { query: visaCatalog.listStatuses, queryExample: { active: 'true' }, success: list('Visa statuses fetched.', VISA_STATUS, VISA_STATUS_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('post', '/api/visa/statuses', 'createVisaStatus', 'Add a status',
    'Adds a custom status inside a category. The `key` is made from the name when it is not sent. A custom status in the `failed` or `cancelled` category ends an application like a system one does.',
    ACCESS.edit, {
      body: visaCatalog.createStatus, bodyExample: { displayName: 'Waiting for Embassy Slot', category: 'in_progress', customerMessage: 'We are waiting for an appointment.' },
      success: ok(201, 'Status created.', VISA_STATUS, { ...VISA_STATUS_EXAMPLE, key: 'waiting_for_embassy_slot', displayName: 'Waiting for Embassy Slot', isSystem: false }), errors: { 401: true, 403: true, 409: ['STATUS_EXISTS'], 422: true }
    }),
  V('patch', '/api/visa/statuses/{id}', 'updateVisaStatus', 'Change a status',
    'A system status keeps its key, category and place in the flow, and cannot be turned off (`STATUS_LOCKED`). Its wording and order can change.',
    ACCESS.edit, {
      params: visaCatalog.idParam, paramExamples: { id: ID_STATUS }, body: visaCatalog.updateStatus, bodyExample: { customerMessage: 'Your visa is being reviewed.' },
      success: ok(200, 'Status updated.', VISA_STATUS, VISA_STATUS_EXAMPLE), errors: { 401: true, 403: true, 404: ['STATUS_NOT_FOUND'], 409: ['STATUS_LOCKED'], 422: true }
    }),
  V('delete', '/api/visa/statuses/{id}', 'deleteVisaStatus', 'Delete a status', 'Only a custom status that no application is in can be deleted (`STATUS_LOCKED`, `STATUS_IN_USE`).',
    ACCESS.edit, { params: visaCatalog.idParam, paramExamples: { id: ID_STATUS }, success: ok(200, 'Status deleted.'), errors: { 401: true, 403: true, 404: ['STATUS_NOT_FOUND'], 409: ['STATUS_LOCKED', 'STATUS_IN_USE'], 422: true } }),

  // ---- applications
  V('get', '/api/visa/applications', 'listVisaApplications', 'Visa applications',
    'Newest first. `search` matches the number, the applicant name, phone and email, the passport number (spaces and case ignored), the country and the partner. `staff` is a user id or `unassigned`. A row leaves out the timeline, notes, payments and vendor lines: fetch one application for those.',
    ACCESS.view, {
      query: visaApp.listApplications, queryExample: { status: 'under_review', channel: 'b2c', search: 'rahim', page: '1', limit: '20' },
      success: list('Visa applications fetched.', VISA_APPLICATION, VISA_LIST_ROW_EXAMPLE), errors: { 401: true, 403: true, 422: true }
    }),
  V('post', '/api/visa/applications', 'createVisaApplication', 'Create a visa application',
    'Staff and admins create the file. The server numbers it (`VISA-<year>-<6 digits>`, restarting every year), copies the price and the exchange rate from the visa type, and calculates net, advance, due and the payment status. ' +
    'A `totalAmount` different from the price list needs `totalOverrideReason`. An `advancePaid` becomes the first payment entry. ' +
    'Duplicates: the same passport, country and visa type with an open application is refused (`DUPLICATE_OPEN_APPLICATION`). The same passport and country inside the last 90 days (a setting) needs `confirmDuplicate`, a note that stays on the file (`DUPLICATE_RECENT_APPLICATION`). A rejected application never blocks a new one.',
    ACCESS.edit, {
      body: visaApp.createApplication,
      bodyExample: { name: 'Rahim Ahmed', phone: '+8801712556340', email: 'rahim@example.com', passportNumber: 'BR0912345', countryId: ID_COUNTRY, visaTypeId: ID_TYPE, discountAmount: 1000, advancePaid: 4000, paymentMethod: 'Cash', vendorList: [{ name: 'Visa Vendor', service: 'visa', price: 7000 }] },
      success: ok(201, 'Visa application created.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['COUNTRY_NOT_FOUND', 'VISA_TYPE_NOT_FOUND', 'PARTNER_NOT_FOUND'], 409: ['DUPLICATE_OPEN_APPLICATION', 'DUPLICATE_RECENT_APPLICATION'], 422: ['VALIDATION_ERROR', 'OVERRIDE_REASON_REQUIRED', 'DISCOUNT_TOO_HIGH', 'PAYMENTS_EXCEED_NET', 'CATALOG_PAUSED', 'PARTNER_REQUIRED', 'PARTNER_NOT_APPROVED', 'INVALID_STAFF', 'CURRENCY_NOT_ENABLED'] }
    }),
  V('get', '/api/visa/applications/{id}', 'getVisaApplication', 'One visa application',
    'The whole file: applicant, passport, price, money, payments, documents (without storage paths), the timeline (newest first), notes and passport handling. An unknown id answers `404`.',
    ACCESS.view, { params: visaApp.idParam, paramExamples: APP_PARAM, success: ok(200, 'Visa application fetched.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 422: true } }),
  V('patch', '/api/visa/applications/{id}', 'updateVisaApplication', 'Edit a visa application',
    'Applicant and passport details, vendor lines, the total, the discount and the assigned staff member (`null` takes it away). Status, country, visa type and payments have their own routes and are ignored here. ' +
    'Changing the total or the discount recalculates the money, and is refused when the payments already received would be more than the amount to pay.',
    ACCESS.edit, {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaApp.updateApplication, bodyExample: { assignedStaff: ID_STAFF, discountAmount: 2000 },
      success: ok(200, 'Visa application updated.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 409: ['DUPLICATE_OPEN_APPLICATION'], 422: ['VALIDATION_ERROR', 'OVERRIDE_REASON_REQUIRED', 'DISCOUNT_TOO_HIGH', 'PAYMENTS_EXCEED_NET', 'INVALID_STAFF'] }
    }),
  V('patch', '/api/visa/applications/{id}/status', 'changeVisaApplicationStatus', 'Change the status',
    'The one place where a status changes. It checks the allowed moves, the wording each move needs (`customerMessage` for `action_required`, `customerReason` for `rejected`, `internalReason` for `cancelled` and for reopening), writes the timeline with the signed-in person, an audit entry, and raises an event. ' +
    'A finished application (completed, rejected, cancelled) can only be reopened, to `under_review`, by an admin. Every change needs `VISA_UPDATE`; the check sits behind one function so a stricter key can be added later.',
    ACCESS.update, {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaApp.changeStatus, bodyExample: { status: 'action_required', customerMessage: 'Please send a clearer bank statement.' },
      success: ok(200, 'Status changed.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 409: ['INVALID_STATUS_CHANGE'], 422: ['VALIDATION_ERROR', 'UNKNOWN_STATUS', 'STATUS_TEXT_REQUIRED'] }
    }),
  V('post', '/api/visa/applications/{id}/notes', 'addVisaApplicationNote', 'Add a note',
    'An `internal` note stays inside. A `customer` note is meant for the applicant and its timeline entry is marked for them.',
    ACCESS.edit, {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaApp.addNote, bodyExample: { type: 'internal', text: 'Call him tomorrow morning.' },
      success: ok(201, 'Note added.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 422: true }
    }),

  // ---- payments
  V('post', '/api/visa/applications/{id}/payments', 'addVisaPayment', 'Record a payment',
    'Payments are entered by hand. The server adds the amount to the advance received and recalculates the amount due and the payment status (`Paid`, `Partial`, `Unpaid`). A payment above the amount due is refused.',
    ACCESS.edit, {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaApp.addPayment, bodyExample: { amount: 3000, method: 'bKash / Nagad', note: 'trx 8F2K91' },
      success: ok(201, 'Payment recorded.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 422: ['VALIDATION_ERROR', 'PAYMENT_EXCEEDS_DUE'] }
    }),
  V('post', '/api/visa/applications/{id}/payments/{paymentId}/void', 'voidVisaPayment', 'Void a payment',
    'A wrong entry is never deleted: it is voided with a reason, so the history stays. The totals are recalculated without it. Needs `VISA_PAYMENT_VOID`, which an admin can give to staff.',
    'ADMIN, or STAFF with VISA_PAYMENT_VOID', {
      params: visaApp.paymentParam, paramExamples: { id: ID_APP, paymentId: ID_PAYMENT }, body: visaApp.voidPayment, bodyExample: { reason: 'Typed the wrong amount.' },
      success: ok(200, 'Payment voided.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND', 'PAYMENT_NOT_FOUND'], 409: ['PAYMENT_ALREADY_VOIDED'], 422: true }
    }),

  // ---- documents
  V('post', '/api/visa/applications/{id}/documents', 'uploadVisaDocument', 'Upload a document',
    'Form-data with a `file` and a `type` (the checklist item name). The real file type is read from the file\'s own bytes, so a renamed file is refused. Limits come from the settings (10 MB, PDF, JPG, PNG or WEBP, 5 files per item by default). ' +
    'Name a checklist line with `checklistItemId` to apply its own, lower size limit. The file is stored outside any public folder under a random name.',
    ACCESS.edit, {
      params: visaApp.idParam, paramExamples: APP_PARAM,
      multipart: { zod: visaApp.uploadDocument, files: { file: { description: 'The document. PDF, JPEG, PNG or WEBP.' } }, required: ['file'], example: { type: 'Passport Copy' } },
      success: ok(201, 'Document uploaded.', VISA_DOCUMENT, VISA_APPLICATION_EXAMPLE.documents[0]),
      errors: { 400: ['FILE_REQUIRED', 'FILE_TYPE_NOT_ALLOWED', 'FILE_TYPE_MISMATCH'], 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 409: ['TOO_MANY_FILES'], 413: ['FILE_TOO_LARGE'], 422: ['VALIDATION_ERROR', 'CHECKLIST_ITEM_NOT_FOUND'] }
    }),
  V('get', '/api/visa/applications/{id}/documents/{docId}/file', 'downloadVisaDocument', 'Download a document',
    'Streams the stored file `inline`, with `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy` and `Cache-Control: private, no-store`. Needs both `VISA_VIEW` and `DOCUMENT_VIEW`.',
    'ADMIN, or STAFF with VISA_VIEW and DOCUMENT_VIEW', { params: visaApp.documentParam, paramExamples: DOC_PARAM, binary: true, errors: { 401: true, 403: true, 404: ['DOCUMENT_NOT_FOUND', 'FILE_MISSING'], 422: true } }),
  V('patch', '/api/visa/applications/{id}/documents/{docId}', 'reviewVisaDocument', 'Verify or reject a document',
    'Sets the document to `verified`, `rejected` or back to `pending`. A rejection needs a `reviewNote` written for the applicant. The decision goes on the timeline.',
    'ADMIN, or STAFF with DOCUMENT_VERIFY', {
      params: visaApp.documentParam, paramExamples: DOC_PARAM, body: visaApp.reviewDocument, bodyExample: { status: 'rejected', reviewNote: 'The photo is blurry. Please upload a clearer one.' },
      success: ok(200, 'Document reviewed.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND', 'DOCUMENT_NOT_FOUND'], 422: true }
    }),
  V('delete', '/api/visa/applications/{id}/documents/{docId}', 'deleteVisaDocument', 'Delete a document', 'Removes the record and the stored file.',
    ACCESS.edit, { params: visaApp.documentParam, paramExamples: DOC_PARAM, success: ok(200, 'Document deleted.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND', 'DOCUMENT_NOT_FOUND'], 422: true } }),

  // ---- passport
  V('patch', '/api/visa/applications/{id}/passport', 'updateVisaPassport', 'Update passport handling',
    'One call for every passport step, applied in this order: the submission method (`online`, `office` or `pickup`, limited by what the visa type allows), the pickup request, the pickup staff member (`null` removes them), then the passport status with its `details`. ' +
    'Online files need no physical passport. Every step goes on the timeline.',
    'ADMIN, or STAFF with PASSPORT_UPDATE', {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaApp.updatePassport, bodyExample: { passportStatus: 'received_at_office', details: { receivedDate: '2026-10-01', receivedBy: 'Ahmed Karim', remarks: 'Two blank pages.' } },
      success: ok(200, 'Passport updated.', VISA_APPLICATION, VISA_APPLICATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND'], 409: ['INVALID_PASSPORT_CHANGE'], 422: ['VALIDATION_ERROR', 'INVALID_STAFF'] }
    }),

  // ---- messages
  V('get', '/api/visa/templates', 'listVisaTemplates', 'Message templates',
    'The wording used when an application reaches a status. An **email** template is sent automatically through EmailJS at that moment. An **sms** template makes a prepared message in the log, which staff send by hand (no SMS provider is connected yet). Each template has an on/off switch (`active`).',
    ACCESS.view, { query: visaMessage.listTemplates, queryExample: { channel: 'sms' }, success: list('Message templates fetched.', MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('post', '/api/visa/templates', 'createVisaTemplate', 'Add a message template',
    'The `trigger` is a status key. The text may use only {{applicantName}}, {{applicationNumber}}, {{country}}, {{visaType}}, {{status}} and {{trackingUrl}}; any other word is refused (`UNKNOWN_VARIABLE`). An email template needs a `subject`. The name must be new for its channel.',
    ACCESS.edit, {
      body: visaMessage.createTemplate, bodyExample: { name: 'Under Review', channel: 'sms', trigger: 'under_review', message: 'Dear {{applicantName}}, your visa application {{applicationNumber}} is now under review.' },
      success: ok(201, 'Template created.', MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_EXAMPLE), errors: { 401: true, 403: true, 409: ['TEMPLATE_EXISTS'], 422: ['VALIDATION_ERROR', 'UNKNOWN_STATUS', 'UNKNOWN_VARIABLE'] }
    }),
  V('patch', '/api/visa/templates/{id}', 'updateVisaTemplate', 'Change a message template', 'Send only what changes. Set `active` to false to switch a template off without deleting it.',
    ACCESS.edit, {
      params: visaMessage.idParam, paramExamples: { id: ID_TEMPLATE }, body: visaMessage.updateTemplate, bodyExample: { active: false },
      success: ok(200, 'Template updated.', MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_EXAMPLE), errors: { 401: true, 403: true, 404: ['TEMPLATE_NOT_FOUND'], 409: ['TEMPLATE_EXISTS'], 422: ['VALIDATION_ERROR', 'UNKNOWN_STATUS', 'UNKNOWN_VARIABLE'] }
    }),
  V('delete', '/api/visa/templates/{id}', 'deleteVisaTemplate', 'Delete a message template', 'Messages already made from it stay in the log.',
    ACCESS.edit, { params: visaMessage.idParam, paramExamples: { id: ID_TEMPLATE }, success: ok(200, 'Template deleted.'), errors: { 401: true, 403: true, 404: ['TEMPLATE_NOT_FOUND'], 422: true } }),
  V('get', '/api/visa/messages', 'listVisaMessages', 'Message log',
    'Every message prepared for an applicant, newest first, with the text exactly as written. `status` is `pending` (an SMS waiting to be sent by hand), `sent` or `failed` (with `error`). `source` says whether the system made it at a status change (`auto`) or a person did (`manual`). Filter by `applicationId`.',
    ACCESS.view, { query: visaMessage.listMessages, queryExample: { status: 'pending', channel: 'sms' }, success: list('Messages fetched.', VISA_MESSAGE, VISA_MESSAGE_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('patch', '/api/visa/messages/{id}', 'markVisaMessage', 'Mark an SMS as sent or failed',
    'Staff send an SMS by hand, then say what happened. `sent` records who and when and puts it on the application timeline. `failed` needs an `error`. A sent message stays sent. Only an SMS is marked by hand.',
    ACCESS.edit, {
      params: visaMessage.idParam, paramExamples: { id: ID_MESSAGE }, body: visaMessage.markMessage, bodyExample: { status: 'sent' },
      success: ok(200, 'Message updated.', VISA_MESSAGE, { ...VISA_MESSAGE_EXAMPLE, status: 'sent', sentAt: NOW, sentByName: 'Admin Person' }),
      errors: { 401: true, 403: true, 404: ['MESSAGE_NOT_FOUND'], 409: ['NOT_AN_SMS', 'MESSAGE_ALREADY_SENT', 'INVALID_MESSAGE_CHANGE'], 422: true }
    }),
  V('post', '/api/visa/messages/{id}/send', 'resendVisaEmail', 'Send a failed email again', 'Tries an email that failed (or has no result yet) again through EmailJS. The log row is updated with the new result.',
    ACCESS.edit, {
      params: visaMessage.idParam, paramExamples: { id: ID_MESSAGE },
      success: ok(200, 'Email sent again.', VISA_MESSAGE, { ...VISA_MESSAGE_EXAMPLE, channel: 'email', to: 'rahim@example.com', status: 'sent', provider: 'emailjs' }),
      errors: { 401: true, 403: true, 404: ['MESSAGE_NOT_FOUND'], 409: ['NOT_AN_EMAIL', 'MESSAGE_ALREADY_SENT'], 422: ['NO_EMAIL'] }
    }),
  V('post', '/api/visa/applications/{id}/messages', 'sendVisaMessage', 'Send a message to the applicant',
    'Pick a template (`templateId`) or write your own (`channel` and `message`). The words in double braces are filled in from the application. An **email** is sent at once through EmailJS and the log row says `sent` or `failed`. An **sms** becomes a `pending` row; add `markSent: true` when you already sent it from your own phone.',
    ACCESS.edit, {
      params: visaApp.idParam, paramExamples: APP_PARAM, body: visaMessage.sendMessage, bodyExample: { channel: 'sms', message: 'Dear {{applicantName}}, please call us about {{applicationNumber}}.', markSent: false },
      success: ok(201, 'Message created.', VISA_MESSAGE, VISA_MESSAGE_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['APPLICATION_NOT_FOUND', 'TEMPLATE_NOT_FOUND'], 422: ['VALIDATION_ERROR', 'UNKNOWN_VARIABLE', 'CHANNEL_MISMATCH', 'NO_EMAIL'] }
    }),

  // ---- quotations
  V('get', '/api/visa/partners', 'listVisaPartners', 'Partners for a quotation', 'Approved agencies, with only their id and company name, for the partner drop-down. Needs `VISA_VIEW`, not the partner management permission.',
    ACCESS.view, {
      query: visaQuotation.partnerLookup, queryExample: { search: 'abc' },
      success: ok(200, 'Partners fetched.', arrayOf(obj({ _id: str(ID_PARTNER), companyName: str('ABC Travels') })), [{ _id: ID_PARTNER, companyName: 'ABC Travels' }]), errors: { 401: true, 403: true, 422: true }
    }),
  V('get', '/api/visa/quotations', 'listVisaQuotations', 'Quotations',
    'Price quotes for B2B partners, newest first. A draft or sent quotation past its date is shown with the status `expired` (the stored status is in `storedStatus`). `search` matches the number, partner, client and country.',
    ACCESS.view, { query: visaQuotation.listQuotations, queryExample: { status: 'sent' }, success: list('Quotations fetched.', VISA_QUOTATION, VISA_QUOTATION_EXAMPLE), errors: { 401: true, 403: true, 422: true } }),
  V('post', '/api/visa/quotations', 'createVisaQuotation', 'Create a quotation',
    'The server numbers it (`QT-<year>-<4 digits>`, restarting every year), copies the partner net price, the currency and the exchange rate from the visa type, and calculates `total = net price x quantity + additional fee`. The browser cannot set the price. The partner must be approved. `validUntil` defaults to 14 days from now.',
    ACCESS.edit, {
      body: visaQuotation.createQuotation, bodyExample: { partnerId: ID_PARTNER, clientName: 'Rahim Ahmed', countryId: ID_COUNTRY, visaTypeId: ID_TYPE, quantity: 2, additionalFee: 1500, validUntil: '2026-11-15' },
      success: ok(201, 'Quotation created.', VISA_QUOTATION, VISA_QUOTATION_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['PARTNER_NOT_FOUND', 'COUNTRY_NOT_FOUND', 'VISA_TYPE_NOT_FOUND'], 422: ['VALIDATION_ERROR', 'PARTNER_NOT_APPROVED', 'CATALOG_PAUSED', 'CURRENCY_NOT_ENABLED'] }
    }),
  V('get', '/api/visa/quotations/{id}', 'getVisaQuotation', 'One quotation', 'The quotation with that id. An unknown id answers `404`.',
    ACCESS.view, { params: visaQuotation.idParam, paramExamples: QUOTATION_PARAM, success: ok(200, 'Quotation fetched.', VISA_QUOTATION, VISA_QUOTATION_EXAMPLE), errors: { 401: true, 403: true, 404: ['QUOTATION_NOT_FOUND'], 422: true } }),
  V('patch', '/api/visa/quotations/{id}', 'updateVisaQuotation', 'Change a draft quotation',
    'Only a draft can change (`QUOTATION_LOCKED` once sent). The price is copied again only when the visa type changes, and the total is recalculated.',
    ACCESS.edit, {
      params: visaQuotation.idParam, paramExamples: QUOTATION_PARAM, body: visaQuotation.updateQuotation, bodyExample: { quantity: 3, validUntil: '2026-11-30' },
      success: ok(200, 'Quotation updated.', VISA_QUOTATION, VISA_QUOTATION_EXAMPLE),
      errors: { 401: true, 403: true, 404: ['QUOTATION_NOT_FOUND', 'PARTNER_NOT_FOUND', 'COUNTRY_NOT_FOUND', 'VISA_TYPE_NOT_FOUND'], 409: ['QUOTATION_LOCKED'], 422: ['VALIDATION_ERROR', 'PARTNER_NOT_APPROVED', 'CATALOG_PAUSED'] }
    }),
  V('patch', '/api/visa/quotations/{id}/status', 'changeVisaQuotationStatus', 'Send, accept or reject a quotation',
    'A draft can be sent. A sent quotation can be accepted or rejected. Nothing leaves accepted or rejected. A quotation past its date cannot be sent or accepted (`QUOTATION_EXPIRED`): extend the date of the draft first. Accepting raises an event that the accounting module will use later.',
    ACCESS.edit, {
      params: visaQuotation.idParam, paramExamples: QUOTATION_PARAM, body: visaQuotation.changeStatus, bodyExample: { status: 'sent' },
      success: ok(200, 'Quotation status changed.', VISA_QUOTATION, { ...VISA_QUOTATION_EXAMPLE, status: 'sent', storedStatus: 'sent' }), errors: { 401: true, 403: true, 404: ['QUOTATION_NOT_FOUND'], 409: ['INVALID_STATUS_CHANGE'], 422: ['VALIDATION_ERROR', 'QUOTATION_EXPIRED'] }
    }),
  V('delete', '/api/visa/quotations/{id}', 'deleteVisaQuotation', 'Delete a draft quotation', 'Only a draft can be deleted (`QUOTATION_LOCKED`).',
    ACCESS.edit, { params: visaQuotation.idParam, paramExamples: QUOTATION_PARAM, success: ok(200, 'Quotation deleted.'), errors: { 401: true, 403: true, 404: ['QUOTATION_NOT_FOUND'], 409: ['QUOTATION_LOCKED'], 422: true } }),

  // =============================================================== SETTINGS (internal)
  { method: 'get', path: '/api/settings', tag: 'Settings', id: 'listSettings', summary: 'All settings',
    description: 'Every setting with its saved value, or its default until one is saved: `visa.documents` (upload limits), `visa.retention` (days to keep documents), `visa.duplicateWindowDays` and `currencies`.',
    access: 'ADMIN, or STAFF with SETTINGS_VIEW', needsAuth: true, success: ok(200, 'Settings fetched.', obj({}), SETTINGS_EXAMPLE), errors: { 401: true, 403: true } },
  { method: 'put', path: '/api/settings/{key}', tag: 'Settings', id: 'saveSetting', summary: 'Change a setting',
    description: 'Saves the value of one setting (not `currencies`, which has its own routes). The value is checked against the rules of that setting.',
    access: 'ADMIN', needsAuth: true, params: settingV.keyParam, paramExamples: { key: 'visa.documents' }, body: settingV.saveSetting,
    bodyExample: { value: { maxSizeMb: 10, allowedTypes: ['pdf', 'jpg', 'png', 'webp'], maxFilesPerItem: 5 } },
    success: ok(200, 'Setting saved.', obj({ key: str('visa.documents'), value: obj({}) }), { key: 'visa.documents', value: SETTINGS_EXAMPLE['visa.documents'] }), errors: { 401: true, 403: true, 404: ['SETTING_NOT_FOUND'], 422: true } },
  { method: 'get', path: '/api/settings/currencies', tag: 'Settings', id: 'listCurrencies', summary: 'Currencies and rates',
    description: 'The currencies a price can use and how many BDT one unit is worth. BDT is the base and always 1. `source` says where a rate came from: `manual`, `api` or `base`.',
    access: 'ADMIN or STAFF', needsAuth: true, success: ok(200, 'Currencies fetched.', CURRENCIES, CURRENCIES_EXAMPLE), errors: { 401: true, 403: true } },
  { method: 'put', path: '/api/settings/currencies', tag: 'Settings', id: 'saveCurrencies', summary: 'Save the currencies',
    description: 'Replaces the list. A rate that differs from the saved one becomes `manual`. BDT must stay in the list.',
    access: 'ADMIN, or STAFF with VISA_EDIT', needsAuth: true, body: settingV.saveCurrencies,
    bodyExample: { items: [{ code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', rateToBase: 1 }, { code: 'USD', name: 'US Dollar', symbol: '$', rateToBase: 125.5 }] },
    success: ok(200, 'Currencies saved.', CURRENCIES, CURRENCIES_EXAMPLE), errors: { 401: true, 403: true, 422: true } },
  { method: 'post', path: '/api/settings/currencies/{code}/refresh', tag: 'Settings', id: 'refreshCurrencyRate', summary: 'Fill the rate from the exchange rate service',
    description: 'Fetches today\'s rate from the free open.er-api.com service and saves it with `source: "api"`. Staff can still type over it. When the service is down the old rate stays and the answer is `502`.',
    access: 'ADMIN, or STAFF with VISA_EDIT', needsAuth: true, params: settingV.currencyParam, paramExamples: { code: 'USD' },
    success: ok(200, 'Exchange rate refreshed.', CURRENCIES, CURRENCIES_EXAMPLE), errors: { 400: true, 401: true, 403: true, 404: ['CURRENCY_NOT_ENABLED'], 422: true, 502: ['RATE_SERVICE_UNAVAILABLE'] } },

  ...require('./accountingEndpoints')({ ok, obj, str, bool, arrayOf, INT, NUM, NOW }),

  // =============================================================== SYSTEM
  {
    method: 'get', path: '/', tag: 'System', id: 'getVersion',
    summary: 'API version', description: 'A simple "is it up" check that also returns the version.', access: 'Public',
    success: ok(200, 'API is running.', obj({}), undefined, { raw: { success: true, message: 'API is running.', version: '1.0.0' }, rawSchema: obj({ success: bool(true), message: str('API is running.'), version: str('1.0.0') }) }), errors: {}
  },
  {
    method: 'get', path: '/health', tag: 'System', id: 'getHealth',
    summary: 'Health check', description: 'Answers `200` when the database is connected and `503` when it is not. Not rate limited. Use it for uptime monitors.', access: 'Public',
    success: ok(200, 'Healthy.', obj({}), undefined, { raw: { success: true, uptime: 1234.56, db: 'up' }, rawSchema: obj({ success: bool(true), uptime: { type: 'number', example: 1234.56 }, db: { type: 'string', enum: ['up', 'down'], example: 'up' } }) }),
    errors: { 503: ['DB_DOWN'] }, healthDown: true
  }
];

module.exports = { endpoints, TAGS, FLOW_TAGS };
