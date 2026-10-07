const sendResponse = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// In-memory data store for Visa module backend endpoints
let DEMO_COUNTRIES = [
  { id: 'vcn', name: 'China', code: 'CN', flag: '🇨🇳', description: 'Tourist, business and student visa processing with embassy appointment support.', status: 'active', displayOrder: 1 },
  { id: 'vae', name: 'United Arab Emirates', code: 'AE', flag: '🇦🇪', description: 'Dubai and Abu Dhabi tourist visas, express processing available.', status: 'active', displayOrder: 2 },
  { id: 'vmy', name: 'Malaysia', code: 'MY', flag: '🇲🇾', description: 'eVisa and embassy visa processing for Malaysian destinations.', status: 'active', displayOrder: 3 },
  { id: 'vfr', name: 'Schengen (France)', code: 'FR', flag: '🇫🇷', description: 'Schengen short-stay visas via VFS France with appointment scheduling.', status: 'active', displayOrder: 4 },
  { id: 'vgb', name: 'United Kingdom', code: 'GB', flag: '🇬🇧', description: 'UK standard visitor visas. Service temporarily paused.', status: 'paused', displayOrder: 5 },
  { id: 'vau', name: 'Australia', code: 'AU', flag: '🇦🇺', description: 'Visitor visa (subclass 600) processing.', status: 'paused', displayOrder: 6 },
  { id: 'vsg', name: 'Singapore', code: 'SG', flag: '🇸🇬', description: 'Singapore visa processing — physical passport submission required.', status: 'active', displayOrder: 7 },
  { id: 'vth', name: 'Thailand', code: 'TH', flag: '🇹🇭', description: 'Thailand eVisa — fully online processing, no physical passport needed.', status: 'active', displayOrder: 8 },
];

let DEMO_VISA_TYPES = [
  { id: 'vt_cn_tourist', countryId: 'vcn', name: 'Tourist Visa', description: 'Tourist visa.', processingTime: '5–7 working days', entries: 'single', currency: 'BDT', b2cPrice: 12000, b2bNetPrice: 10000, fees: { embassy: 8500, service: 3000, vat: 500 }, terms: '', status: 'active', validFrom: '2026-10-01' },
];

let DEMO_APPLICATIONS = [
  {
    id: 'va_101', number: 'VISA-2026-000101', countryId: 'vcn', visaTypeId: 'vt_cn_tourist',
    country: 'China', visaType: 'Tourist Visa', channel: 'b2c', partner: null,
    applicant: { fullName: 'Rahim Ahmed', dob: '1992-04-18', gender: 'male', nationality: 'Bangladeshi', mobile: '+880 1712 556 340', email: 'rahim.ahmed@gmail.com', address: 'House 42, Road 7, Dhanmondi', city: 'Dhaka', applicantType: 'individual' },
    passport: { number: 'BR0912345', expiry: '2030-06-15', issueDate: '2020-06-16', issuingCountry: 'Bangladesh', type: 'ordinary' },
    status: 'under_review', assignedStaff: 'Priya Nair', submittedAt: '2026-09-28', updatedAt: '2026-10-04',
    price: { currency: 'BDT', b2c: 12000, b2b: 10000 },
    actionRequired: null, rejection: null,
    documents: [], timeline: [], internalNotes: [], customerNotes: []
  },
];

let DEMO_CHECKLISTS = [
  {
    id: 'vcl_1', countryId: 'vcn', visaTypeId: 'vt_cn_tourist', applicantType: 'individual',
    items: [
      { id: 'vci_1', label: 'Passport (valid at least 6 months)', requirement: 'required', active: true, submissionMode: 'both', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_2', label: 'Recent Passport-size Photograph', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_3', label: 'Bank Statement (last 6 months)', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_4', label: 'Bank Solvency Certificate', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_5', label: 'Hotel Booking', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_6', label: 'Flight Ticket (reservation)', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
      { id: 'vci_7', label: 'Sponsor Letter', requirement: 'optional', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
    ],
  }
];

// GET /api/visa/dashboard
exports.getVisaDashboard = asyncHandler(async (req, res) => {
  const data = {
    total: DEMO_APPLICATIONS.length,
    submitted: DEMO_APPLICATIONS.filter(a => a.status === 'submitted').length,
    underReview: DEMO_APPLICATIONS.filter(a => a.status === 'under_review').length,
    actionRequired: DEMO_APPLICATIONS.filter(a => a.status === 'action_required').length,
    processing: DEMO_APPLICATIONS.filter(a => a.status === 'processing').length,
    submittedToEmbassy: DEMO_APPLICATIONS.filter(a => a.status === 'submitted_to_embassy').length,
    approved: DEMO_APPLICATIONS.filter(a => a.status === 'approved').length,
    completed: DEMO_APPLICATIONS.filter(a => a.status === 'completed').length,
    rejected: DEMO_APPLICATIONS.filter(a => a.status === 'rejected').length,
    b2c: DEMO_APPLICATIONS.filter(a => a.channel === 'b2c').length,
    b2b: DEMO_APPLICATIONS.filter(a => a.channel === 'b2b').length,
    unassigned: DEMO_APPLICATIONS.filter(a => !a.assignedStaff).length,
    decisionRate: 85,
    countries: DEMO_COUNTRIES.map(c => ({
      country: c.name, flag: c.flag || '🌐', applications: 1, approved: 1, approvalRate: 100
    })),
    recent: DEMO_APPLICATIONS
  };
  sendResponse(res, 200, true, 'Visa dashboard overview fetched.', data);
});

// GET /api/visa/countries
exports.getCountries = asyncHandler(async (req, res) => {
  const { search } = req.query;
  let items = [...DEMO_COUNTRIES];
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(c => `${c.name} ${c.code || ''}`.toLowerCase().includes(q));
  }
  sendResponse(res, 200, true, 'Visa countries fetched.', { items, total: items.length });
});

// POST /api/visa/countries
exports.createCountry = asyncHandler(async (req, res) => {
  const payload = req.body;
  const newCountry = {
    id: `vc_${Date.now().toString(36)}`,
    flag: payload.flag || '🌐',
    code: payload.code || payload.name.slice(0, 2).toUpperCase(),
    status: 'active',
    displayOrder: DEMO_COUNTRIES.length + 1,
    ...payload,
  };
  DEMO_COUNTRIES.push(newCountry);
  sendResponse(res, 201, true, 'Country created successfully.', newCountry);
});

// PATCH /api/visa/countries/:id
exports.updateCountry = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const index = DEMO_COUNTRIES.findIndex(c => c.id === id);
  if (index >= 0) {
    DEMO_COUNTRIES[index] = { ...DEMO_COUNTRIES[index], ...req.body };
    return sendResponse(res, 200, true, 'Country updated successfully.', DEMO_COUNTRIES[index]);
  }
  sendResponse(res, 404, false, 'Country not found.');
});

// DELETE /api/visa/countries/:id
exports.deleteCountry = asyncHandler(async (req, res) => {
  const { id } = req.params;
  DEMO_COUNTRIES = DEMO_COUNTRIES.filter(c => c.id !== id);
  sendResponse(res, 200, true, 'Country deleted successfully.');
});

// GET /api/visa/types
exports.getVisaTypes = asyncHandler(async (req, res) => {
  const { countryId } = req.query;
  let items = [...DEMO_VISA_TYPES];
  if (countryId) items = items.filter(t => t.countryId === countryId);
  sendResponse(res, 200, true, 'Visa types fetched.', { items, total: items.length });
});

// POST /api/visa/types
exports.createVisaType = asyncHandler(async (req, res) => {
  const payload = req.body;
  const newType = {
    id: `vt_${Date.now().toString(36)}`,
    status: 'active',
    ...payload,
  };
  DEMO_VISA_TYPES.push(newType);
  sendResponse(res, 201, true, 'Visa type created successfully.', newType);
});

// GET /api/visa/checklists/:countryId/:visaTypeId/:applicantType
exports.getChecklist = asyncHandler(async (req, res) => {
  const { countryId, visaTypeId, applicantType } = req.params;
  let checklist = DEMO_CHECKLISTS.find(
    c => c.countryId === countryId && c.visaTypeId === visaTypeId && c.applicantType === applicantType
  );
  if (!checklist) {
    checklist = {
      id: null,
      countryId,
      visaTypeId,
      applicantType,
      items: [
        { id: 'vci_default_1', label: 'Passport (valid at least 6 months)', requirement: 'required', active: true, submissionMode: 'both', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
        { id: 'vci_default_2', label: 'Recent Passport-size Photograph', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
        { id: 'vci_default_3', label: 'Bank Statement (last 6 months)', requirement: 'required', active: true, submissionMode: 'digital', fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 }
      ],
      isDefault: true
    };
  }
  sendResponse(res, 200, true, 'Checklist fetched.', checklist);
});

// PUT /api/visa/checklists/:countryId/:visaTypeId/:applicantType
exports.saveChecklist = asyncHandler(async (req, res) => {
  const { countryId, visaTypeId, applicantType } = req.params;
  const { items } = req.body;
  const index = DEMO_CHECKLISTS.findIndex(
    c => c.countryId === countryId && c.visaTypeId === visaTypeId && c.applicantType === applicantType
  );
  const updated = {
    id: index >= 0 ? DEMO_CHECKLISTS[index].id : `vcl_${Date.now().toString(36)}`,
    countryId,
    visaTypeId,
    applicantType,
    items: items || [],
    isDefault: false
  };
  if (index >= 0) DEMO_CHECKLISTS[index] = updated;
  else DEMO_CHECKLISTS.push(updated);
  sendResponse(res, 200, true, 'Checklist saved.', updated);
});

// GET /api/visa/applications
exports.getApplications = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  let items = [...DEMO_APPLICATIONS];
  if (status) items = items.filter(a => a.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(a => `${a.number} ${a.applicant.fullName} ${a.country}`.toLowerCase().includes(q));
  }
  sendResponse(res, 200, true, 'Visa applications fetched.', { items, total: items.length });
});

// GET /api/visa/applications/:id
exports.getApplicationById = asyncHandler(async (req, res) => {
  const app = DEMO_APPLICATIONS.find(a => a.id === req.params.id) || DEMO_APPLICATIONS[0];
  sendResponse(res, 200, true, 'Visa application fetched.', app);
});
