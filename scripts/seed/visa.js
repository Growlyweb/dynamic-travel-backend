// Visa module seed. The 11 system statuses are always created (the system needs them). Countries, visa types,
// checklists and sample applications are demo data and are created only outside production.
//
// Safe to run again: a record that exists is left as it is, and sample applications are created only while there
// are none. Sample applications need an admin account: run `npm run seed` (first admin) or `npm run seed:data` first.
const fs = require('fs');
const path = require('path');
const VisaCountry = require('../../models/VisaCountry');
const VisaType = require('../../models/VisaType');
const VisaChecklist = require('../../models/VisaChecklist');
const VisaChecklistEntry = require('../../models/VisaChecklistEntry');
const VisaStatusConfig = require('../../models/VisaStatusConfig');
const VisaApplication = require('../../models/VisaApplication');
const VisaQuotation = require('../../models/VisaQuotation');
const VisaMessage = require('../../models/VisaMessage');
const MessageTemplate = require('../../models/MessageTemplate');
const Partner = require('../../models/Partner');
const Counter = require('../../models/Counter');
const User = require('../../models/User');
const { ROLES, USER_STATUS, APPROVAL_STATUS } = require('../../config/constants');
const { PRIVATE_ROOT } = require('../../utils/file');
const catalog = require('../../services/visaCatalogService');
const counterService = require('../../services/counterService');
const applications = require('../../services/visaApplicationService');
const statusService = require('../../services/visaStatusService');
const messages = require('../../services/visaMessageService');
const quotations = require('../../services/visaQuotationService');
const events = require('../../utils/events');

const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const COUNTRIES = [
  { name: 'China', code: 'CN', flag: '🇨🇳', description: 'Tourist, business and student visa processing with embassy appointment support.', processingMode: 'Embassy', physicalPassportRequired: true },
  { name: 'United Arab Emirates', code: 'AE', flag: '🇦🇪', description: 'Dubai and Abu Dhabi tourist visas, express processing available.', processingMode: 'eVisa (Online)', expressAvailable: true },
  { name: 'Malaysia', code: 'MY', flag: '🇲🇾', description: 'eVisa and embassy visa processing for Malaysian destinations.', processingMode: 'eVisa (Online)' },
  { name: 'Schengen (France)', code: 'FR', flag: '🇫🇷', description: 'Schengen short-stay visas via VFS France with appointment scheduling.', processingMode: 'Visa center', physicalPassportRequired: true },
  { name: 'United Kingdom', code: 'GB', flag: '🇬🇧', description: 'UK standard visitor visas. Service temporarily paused.', status: 'paused', processingMode: 'Visa center', physicalPassportRequired: true },
  { name: 'Australia', code: 'AU', flag: '🇦🇺', description: 'Visitor visa (subclass 600) processing.', status: 'paused', processingMode: 'Online' },
  { name: 'Singapore', code: 'SG', flag: '🇸🇬', description: 'Singapore visa processing. Physical passport submission required.', processingMode: 'Embassy', physicalPassportRequired: true },
  { name: 'Thailand', code: 'TH', flag: '🇹🇭', description: 'Thailand eVisa. Fully online processing, no physical passport needed.', processingMode: 'eVisa (Online)' }
];

const online = { passportRequirement: 'online_processing' };
const physical = { passportRequirement: 'physical_required', officeSubmissionAvailable: true };

// [country, name, processingTime, entries, b2c, b2b, embassy, service, vat, passport flags]
const TYPES = [
  ['China', 'Tourist Visa', '5-7 working days', 'single', 12000, 10000, 8500, 3000, 500, { ...physical, pickupAvailable: true }],
  ['China', 'Business Visa', '7-10 working days', 'single', 18000, 15000, 12000, 5000, 1000, { ...physical, pickupAvailable: true }],
  ['United Arab Emirates', 'Tourist Visa', '3-4 working days', 'single', 6500, 5200, 4200, 2000, 300, { ...physical, pickupAvailable: true }],
  ['United Arab Emirates', 'Business Visa', '3-5 working days', 'single', 7800, 6400, 5000, 2400, 400, { ...physical, pickupAvailable: true }],
  ['Malaysia', 'Tourist Visa', '2-3 working days', 'single', 4500, 3600, 2800, 1500, 200, online],
  ['Schengen (France)', 'Tourist Visa', '10-15 working days', 'multiple', 14500, 12500, 9500, 4200, 800, physical],
  ['Schengen (France)', 'Business Visa', '10-15 working days', 'multiple', 16000, 14000, 10500, 4500, 1000, physical],
  ['United Kingdom', 'Tourist Visa', '15-20 working days', 'multiple', 18500, 16000, 13000, 4500, 1000, physical],
  ['Singapore', 'Tourist Visa', '3-5 working days', 'single', 8500, 7000, 5500, 2600, 400, { ...physical, pickupAvailable: true }],
  ['Thailand', 'Tourist Visa', '3-7 working days', 'single', 5500, 4500, 3500, 1700, 300, online]
];

const CHECKLIST_ITEMS = [
  ['Passport (valid at least 6 months)', 'required', 'both'],
  ['Recent Passport-size Photograph', 'required', 'digital'],
  ['Bank Statement (last 6 months)', 'required', 'digital'],
  ['Bank Solvency Certificate', 'required', 'digital'],
  ['Hotel Booking', 'required', 'digital'],
  ['Flight Ticket (reservation)', 'required', 'digital'],
  ['Sponsor Letter', 'optional', 'digital']
].map(([label, requirement, submissionMode]) => ({ label, requirement, submissionMode, active: true, fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 }));

// [name, passport, phone, email, country, visa type, discount, advance, method, status moves, assign to staff?]
const APPLICATIONS = [
  ['Rahim Ahmed', 'A02218431', '+8801712556340', 'rahim.ahmed@example.com', 'China', 'Tourist Visa', 0, 5000, 'Bank Transfer', ['under_review'], true],
  ['Nusrat Jahan', 'A03561972', '+8801819264710', 'nusrat.jahan@example.com', 'United Arab Emirates', 'Tourist Visa', 500, 6000, 'Cash', ['under_review', 'documents_completed', 'processing'], true],
  ['Farhana Islam', 'EA0475218', '+8801936275081', 'farhana.islam@example.com', 'Malaysia', 'Tourist Visa', 0, 0, 'Cash', [], false],
  ['Jahangir Alam', 'A01937264', '+8801718453092', 'jahangir.alam@example.com', 'Singapore', 'Tourist Visa', 0, 8500, 'bKash / Nagad', ['under_review', 'processing', 'submitted_to_embassy', 'approved'], true],
  ['Anika Tabassum', 'A04820653', '+8801634958127', 'anika.tabassum@example.com', 'Thailand', 'Tourist Visa', 0, 5500, 'Credit / Debit Card', ['under_review', 'processing', 'submitted_to_embassy', 'approved', 'completed'], false],
  ['Kamal Hossain', 'A00631587', '+8801521847365', 'kamal.hossain@example.com', 'Schengen (France)', 'Business Visa', 1000, 6000, 'Bank Transfer', ['under_review', 'action_required'], true],
  ['Sadia Rahman', 'EB1052846', '+8801792614085', 'sadia.rahman@example.com', 'China', 'Business Visa', 0, 9000, 'Cash', ['under_review', 'rejected'], false],
  ['Tanvir Hasan', 'A02984170', '+8801867330492', 'tanvir.hasan@example.com', 'Malaysia', 'Tourist Visa', 0, 1000, 'Cash', ['cancelled'], false]
];

// A ticket, a hotel booking and a tour package, so the list shows every service.
// [service, name, phone, email, details, total, advance, method, vendor cost, status moves]
const OTHER_APPLICATIONS = [
  ['ticket', 'Mizanur Rahman', '+8801712945360', 'mizanur.rahman@example.com', { tripType: 'Round Way', departure: 'Dhaka (DAC)', arrival: 'Dubai (DXB)', travelClass: 'Economy' }, 78000, 30000, 'bKash / Nagad', 66000, ['under_review']],
  ['hotel', 'Sultana Razia', '+8801815720934', 'sultana.razia@example.com', { name: 'Grand Hyatt Dubai', country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai', stay: '4 Nights' }, 64000, 64000, 'Credit / Debit Card', 52000, []],
  ['tour', 'Imran Khan', '+8801923846105', 'imran.khan@example.com', { packageName: 'Dubai + Kuala Lumpur Tour', duration: '7 Days / 6 Nights', destinations: [{ country: 'United Arab Emirates', countryCode: 'AE', city: 'Dubai' }, { country: 'Malaysia', countryCode: 'MY', city: 'Kuala Lumpur' }] }, 185000, 50000, 'Bank Transfer', 150000, ['under_review', 'processing']]
];

const MOVE_TEXT = {
  action_required: { customerMessage: 'Please upload a clearer bank statement.' },
  rejected: { customerReason: 'The embassy refused the application.', internalReason: 'Insufficient funds shown.' },
  cancelled: { internalReason: 'Applicant withdrew.' }
};

// [name, channel, trigger, subject, message]. The words in double braces are filled in from the application.
const TEMPLATES = [
  ['Application Received', 'sms', 'submitted', '', 'Dear {{applicantName}}, we have received your {{country}} {{visaType}} application {{applicationNumber}}. Track it at {{trackingUrl}}.'],
  ['Under Review', 'sms', 'under_review', '', 'Dear {{applicantName}}, your visa application {{applicationNumber}} is now under review.'],
  ['Action Required', 'sms', 'action_required', '', 'Dear {{applicantName}}, action is required on your visa application {{applicationNumber}}. Please send the requested documents.'],
  ['Submitted to Embassy', 'sms', 'submitted_to_embassy', '', 'Dear {{applicantName}}, your {{country}} visa application {{applicationNumber}} has been submitted to the embassy.'],
  ['Visa Approved', 'sms', 'approved', '', 'Dear {{applicantName}}, your {{country}} visa application {{applicationNumber}} has been approved. Congratulations!'],
  ['Visa Rejected', 'sms', 'rejected', '', 'Dear {{applicantName}}, unfortunately your {{country}} visa application {{applicationNumber}} was rejected. Please contact us for details.'],
  ['Passport Ready', 'sms', 'passport_ready', '', 'Dear {{applicantName}}, your passport for application {{applicationNumber}} is ready for collection.'],
  ['Application Received (email)', 'email', 'submitted', 'We received your visa application {{applicationNumber}}', 'Dear {{applicantName}},\n\nWe have received your {{country}} {{visaType}} application. Your reference is {{applicationNumber}}.\nYou can follow it here: {{trackingUrl}}\n\nThank you for choosing us.'],
  ['Action Required (email)', 'email', 'action_required', 'Action needed on application {{applicationNumber}}', 'Dear {{applicantName}},\n\nWe need something more from you to continue with your {{country}} visa application {{applicationNumber}}.\nFollow it here: {{trackingUrl}}'],
  ['Visa Approved (email)', 'email', 'approved', 'Your {{country}} visa is approved', 'Dear {{applicantName}},\n\nGood news. Your {{country}} {{visaType}} application {{applicationNumber}} has been approved.'],
  ['Visa Rejected (email)', 'email', 'rejected', 'Update on visa application {{applicationNumber}}', 'Dear {{applicantName}},\n\nUnfortunately your {{country}} visa application {{applicationNumber}} was not approved. Please contact us for details.']
];

// The wording of a ticket, a hotel booking or a tour package: any service with no template of its own uses these. There is
// no tracking link, because the website's status page is for visas only.
// [name, channel, trigger, subject, message, service]
const GENERAL_TEMPLATES = [
  ['Booking Received', 'sms', 'submitted', '', 'Dear {{applicantName}}, we have received your {{visaType}} request {{applicationNumber}} ({{country}}). Our team will keep you updated.', 'all'],
  ['Booking Received (email)', 'email', 'submitted', 'We received your request {{applicationNumber}}', 'Dear {{applicantName}},\n\nWe have received your {{visaType}} request for {{country}}. Your reference is {{applicationNumber}}.\nOur team will keep you updated.\n\nThank you for choosing us.', 'all']
];

// [partner index, client, country, visa type, quantity, additional fee, days valid, status moves]
const QUOTATIONS = [
  [0, 'Rahim Ahmed', 'China', 'Tourist Visa', 2, 1500, 14, ['sent', 'accepted']],
  [0, 'Chattogram Group (5 pax)', 'Malaysia', 'Tourist Visa', 5, 2500, 10, ['sent']],
  [0, 'Kamal Hossain', 'Schengen (France)', 'Business Visa', 1, 2000, 21, []]
];

// Templates are made after the applications, so seeding never writes to an applicant: a template that exists while an
// application changes status would send a real email.
const seedMessages = async (actor) => {
  // Wait for the listeners of the events raised above, so none of them sees the templates made below.
  await events.idle();
  const result = { templates: 0, messages: 0 };
  for (const [name, channel, trigger, subject, message, serviceType = 'visa'] of [...TEMPLATES, ...GENERAL_TEMPLATES]) {
    const nameKey = keyOf(name);
    if (await MessageTemplate.exists({ channel, nameKey })) continue;
    await MessageTemplate.create({ name, nameKey, channel, trigger, subject, message, serviceType });
    result.templates += 1;
  }

  if (!actor || (await VisaMessage.exists({}))) return result;
  const sms = await MessageTemplate.findOne({ channel: 'sms', trigger: 'under_review' });
  const sample = await VisaApplication.find().sort({ createdAt: 1 }).limit(2);
  for (const [index, application] of sample.entries()) {
    await messages.send(actor, application._id, { templateId: String(sms._id), markSent: index === 1 });
    result.messages += 1;
  }
  return result;
};

const seedQuotations = async (actor) => {
  if (await VisaQuotation.exists({})) return { quotations: 0 };
  const partners = await Partner.find({ approvalStatus: APPROVAL_STATUS.APPROVED }).sort({ createdAt: 1 });
  if (!actor || !partners.length) return { quotations: 0, quotationNote: 'no approved partner found: run `npm run seed:data` first' };

  let count = 0;
  for (const [partnerIndex, clientName, country, visaType, quantity, additionalFee, days, moves] of QUOTATIONS) {
    const countryRow = await VisaCountry.findOne({ nameKey: keyOf(country) });
    const typeRow = await VisaType.findOne({ country: countryRow._id, nameKey: keyOf(visaType) });
    const quotation = await quotations.create(actor, {
      partnerId: String(partners[partnerIndex % partners.length]._id),
      clientName, countryId: String(countryRow._id), visaTypeId: String(typeRow._id), quantity, additionalFee,
      validUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    });
    for (const status of moves) await quotations.changeStatus(actor, quotation._id, { status });
    count += 1;
  }
  return { quotations: count };
};

// The text of a "Visa Check List" page: what the applicant brings for a country and visa type.
const checklistHtml = (country, type) =>
  `<h3>${country} ${type} - documents required</h3><ul><li>Passport valid for at least 6 months</li><li>Recent passport-size photograph</li><li>Bank statement (last 6 months)</li><li>Hotel booking and flight reservation</li></ul><p>Original documents may be asked for at the interview.</p>`;

const seedCatalog = async () => {
  const created = { countries: 0, types: 0, checklists: 0, checklistEntries: 0 };
  const countryIds = {};

  for (const [index, country] of COUNTRIES.entries()) {
    const nameKey = keyOf(country.name);
    let row = await VisaCountry.findOne({ nameKey });
    if (!row) {
      row = await VisaCountry.create({ ...country, nameKey, displayOrder: index + 1 });
      created.countries += 1;
    }
    countryIds[country.name] = row._id;
  }

  const typeIds = {};
  for (const [country, name, processingTime, entries, b2cPrice, b2bNetPrice, embassy, service, vat, flags] of TYPES) {
    const nameKey = keyOf(name);
    let row = await VisaType.findOne({ country: countryIds[country], nameKey });
    if (!row) {
      row = await VisaType.create({ country: countryIds[country], name, nameKey, processingTime, entries, b2cPrice, b2bNetPrice, fees: { embassy, service, vat }, currency: 'BDT', ...flags });
      created.types += 1;
    }
    typeIds[`${country}|${name}`] = row._id;
  }

  const china = { country: countryIds.China, visaType: typeIds['China|Tourist Visa'], applicantType: 'individual' };
  if (!(await VisaChecklist.exists(china))) {
    await VisaChecklist.create({ ...china, items: CHECKLIST_ITEMS });
    created.checklists += 1;
  }

  for (const [country, name, processingTime] of TYPES) {
    const pair = { country: countryIds[country], visaType: typeIds[`${country}|${name}`] };
    if (await VisaChecklistEntry.exists(pair)) continue;
    await VisaChecklistEntry.create({
      ...pair,
      code: `VI${String(await counterService.next('VI')).padStart(4, '0')}`,
      title: `${country} ${name} Document Check List`,
      description: checklistHtml(country, name),
      processingTime,
      displayOrder: created.checklistEntries + 1
    });
    created.checklistEntries += 1;
  }
  return created;
};

const adminActor = async () => {
  const admin = await User.findOne({ role: ROLES.ADMIN, status: USER_STATUS.ACTIVE });
  return admin ? { id: String(admin._id), role: ROLES.ADMIN, permissions: [] } : null;
};

const seedApplications = async (actor) => {
  if (await VisaApplication.exists({})) return { applications: 0, note: 'applications already exist' };
  if (!actor) return { applications: 0, note: 'no admin account found: run `npm run seed` first' };
  const staff = await User.findOne({ role: ROLES.STAFF, status: USER_STATUS.ACTIVE });

  let count = 0;
  for (const [name, passportNumber, phone, email, country, visaType, discountAmount, advancePaid, paymentMethod, moves, assign] of APPLICATIONS) {
    const countryRow = await VisaCountry.findOne({ nameKey: keyOf(country) });
    const typeRow = await VisaType.findOne({ country: countryRow._id, nameKey: keyOf(visaType) });
    const created = await applications.create(actor, {
      name, passportNumber, phone, email,
      countryId: String(countryRow._id), visaTypeId: String(typeRow._id),
      discountAmount, advancePaid, paymentMethod,
      vendorList: [{ vendorId: '', name: 'Demo Vendor', service: 'visa', country, price: Math.round(typeRow.b2cPrice * 0.7) }],
      assignedStaff: assign && staff ? String(staff._id) : undefined
    });
    for (const status of moves) await statusService.changeStatus(actor, created._id, { status, ...MOVE_TEXT[status] });
    count += 1;
  }

  for (const [serviceType, name, phone, email, details, totalAmount, advancePaid, paymentMethod, cost, moves] of OTHER_APPLICATIONS) {
    const created = await applications.create(actor, {
      serviceType, name, phone, email,
      [serviceType]: details,
      totalAmount, advancePaid, paymentMethod,
      vendorList: [{ vendorId: '', name: 'Demo Vendor', service: serviceType, price: cost }]
    });
    for (const status of moves) await statusService.changeStatus(actor, created._id, { status });
    count += 1;
  }
  return { applications: count };
};

module.exports = {
  name: 'visa',

  async seed({ demo = false } = {}) {
    await catalog.ensureSystemStatuses();
    const result = { statuses: await VisaStatusConfig.countDocuments() };
    if (!demo) return result;
    const actor = await adminActor();
    Object.assign(result, await seedCatalog(), await seedApplications(actor), await seedQuotations(actor), await seedMessages(actor));
    return result;
  },

  async clear() {
    const [applicationsRemoved, checklists, checklistEntries, types, countries, statuses, counters, templatesRemoved, messagesRemoved, quotationsRemoved] = await Promise.all([
      VisaApplication.deleteMany({}),
      VisaChecklist.deleteMany({}),
      VisaChecklistEntry.deleteMany({}),
      VisaType.deleteMany({}),
      VisaCountry.deleteMany({}),
      VisaStatusConfig.deleteMany({}),
      Counter.deleteMany({ _id: /^((VISA|TKT|HTL|TOUR|QT):|VI$)/ }),
      MessageTemplate.deleteMany({}),
      VisaMessage.deleteMany({}),
      VisaQuotation.deleteMany({})
    ]);
    fs.rmSync(path.join(PRIVATE_ROOT, 'visa'), { recursive: true, force: true });
    return {
      applications: applicationsRemoved.deletedCount,
      checklists: checklists.deletedCount,
      checklistEntries: checklistEntries.deletedCount,
      types: types.deletedCount,
      countries: countries.deletedCount,
      statuses: statuses.deletedCount,
      counters: counters.deletedCount,
      templates: templatesRemoved.deletedCount,
      messages: messagesRemoved.deletedCount,
      quotations: quotationsRemoved.deletedCount
    };
  }
};
