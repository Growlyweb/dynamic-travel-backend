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
const VisaStatusConfig = require('../../models/VisaStatusConfig');
const VisaApplication = require('../../models/VisaApplication');
const Counter = require('../../models/Counter');
const User = require('../../models/User');
const { ROLES, USER_STATUS } = require('../../config/constants');
const { PRIVATE_ROOT } = require('../../utils/file');
const catalog = require('../../services/visaCatalogService');
const applications = require('../../services/visaApplicationService');
const statusService = require('../../services/visaStatusService');

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
  ['Rahim Ahmed', 'BR0912345', '+8801712556340', 'rahim.ahmed@example.com', 'China', 'Tourist Visa', 0, 5000, 'Bank Transfer', ['under_review'], true],
  ['Nusrat Jahan', 'BR2233445', '+8801811223344', 'nusrat.jahan@example.com', 'United Arab Emirates', 'Tourist Visa', 500, 6000, 'Cash', ['under_review', 'documents_completed', 'processing'], true],
  ['Farhana Islam', 'BR5566778', '+8801913456780', 'farhana.islam@example.com', 'Malaysia', 'Tourist Visa', 0, 0, 'Cash', [], false],
  ['Jahangir Alam', 'BR7788990', '+8801711222333', 'jahangir.alam@example.com', 'Singapore', 'Tourist Visa', 0, 8500, 'bKash / Nagad', ['under_review', 'processing', 'submitted_to_embassy', 'approved'], true],
  ['Anika Tabassum', 'BR1122334', '+8801611777888', 'anika.tabassum@example.com', 'Thailand', 'Tourist Visa', 0, 5500, 'Credit / Debit Card', ['under_review', 'processing', 'submitted_to_embassy', 'approved', 'completed'], false],
  ['Kamal Hossain', 'BR9988776', '+8801555666777', 'kamal.hossain@example.com', 'Schengen (France)', 'Business Visa', 1000, 6000, 'Bank Transfer', ['under_review', 'action_required'], true],
  ['Sadia Rahman', 'BR4455667', '+8801777888999', 'sadia.rahman@example.com', 'China', 'Business Visa', 0, 9000, 'Cash', ['under_review', 'rejected'], false],
  ['Tanvir Hasan', 'BR3344556', '+8801899000111', 'tanvir.hasan@example.com', 'Malaysia', 'Tourist Visa', 0, 1000, 'Cash', ['cancelled'], false]
];

const MOVE_TEXT = {
  action_required: { customerMessage: 'Please upload a clearer bank statement.' },
  rejected: { customerReason: 'The embassy refused the application.', internalReason: 'Insufficient funds shown.' },
  cancelled: { internalReason: 'Applicant withdrew.' }
};

const seedCatalog = async () => {
  const created = { countries: 0, types: 0, checklists: 0 };
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
  return created;
};

const seedApplications = async () => {
  if (await VisaApplication.exists({})) return { applications: 0, note: 'applications already exist' };
  const admin = await User.findOne({ role: ROLES.ADMIN, status: USER_STATUS.ACTIVE });
  if (!admin) return { applications: 0, note: 'no admin account found: run `npm run seed` first' };
  const staff = await User.findOne({ role: ROLES.STAFF, status: USER_STATUS.ACTIVE });
  const actor = { id: String(admin._id), role: ROLES.ADMIN, permissions: [] };

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
  return { applications: count };
};

module.exports = {
  name: 'visa',

  async seed({ demo = false } = {}) {
    await catalog.ensureSystemStatuses();
    const result = { statuses: await VisaStatusConfig.countDocuments() };
    if (!demo) return result;
    Object.assign(result, await seedCatalog(), await seedApplications());
    return result;
  },

  async clear() {
    const [applicationsRemoved, checklists, types, countries, statuses, counters] = await Promise.all([
      VisaApplication.deleteMany({}),
      VisaChecklist.deleteMany({}),
      VisaType.deleteMany({}),
      VisaCountry.deleteMany({}),
      VisaStatusConfig.deleteMany({}),
      Counter.deleteMany({ _id: /^(VISA|QT):/ })
    ]);
    fs.rmSync(path.join(PRIVATE_ROOT, 'visa'), { recursive: true, force: true });
    return {
      applications: applicationsRemoved.deletedCount,
      checklists: checklists.deletedCount,
      types: types.deletedCount,
      countries: countries.deletedCount,
      statuses: statuses.deletedCount,
      counters: counters.deletedCount
    };
  }
};
