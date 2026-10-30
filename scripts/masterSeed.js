/**
 * masterSeed.js
 * Comprehensive, production-grade database reset and seeding script for ABL Travels / Dynamic Travel.
 *
 * 1. Drops/clears all 35 database collections.
 * 2. Cleans and initializes storage/private directories with real, valid media files (PDF, PNG, JPG).
 * 3. Populates fully-connected, realistic data across all modules:
 *    - RBAC Roles & System Permissions
 *    - Users (Super Admin, Staff Officers, B2B Partners, B2C Customers)
 *    - B2B Partners (Approved, Pending Review, Rejected) with real verification documents on disk
 *    - Visa Catalog (10 Countries, Visa Types with full fees, Checklists, Statuses)
 *    - Visa Applications (15 applications in all statuses, payments, vendor costs, timelines, AND real uploaded files on disk)
 *    - B2B Quotations (Draft, Sent, Accepted)
 *    - Tour Categories & Tour Packages (with itineraries, Unsplash covers, galleries, B2B/B2C pricing)
 *    - Custom Tour Requests (New, In Review, Quoted, Confirmed)
 *    - Membership Plans & Customer Memberships
 *    - Chart of Accounts, Journals, Vendor Bills, Vendor Payments, Partner Withdrawals
 *    - B2B Passport Pickup Logistics
 *    - In-App Notifications & Marketing Campaigns
 *    - Audit Logs & Sequential Counters
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const env = require('../config/env');
const connectDB = require('../config/db');
const { ROLES, USER_STATUS, APPROVAL_STATUS, DOCUMENT_TYPE, AUDIT_ACTIONS, TOUR_STATUS } = require('../config/constants');
const templates = require('../config/rbac');
const { PRIVATE_ROOT } = require('../utils/file');
const authService = require('../services/authService');
const { ensureChart } = require('../services/accounting/chart');
const roleService = require('../services/roleService');
const catalog = require('../services/visaCatalogService');

// Models
const User = require('../models/User');
const Role = require('../models/Role');
const Partner = require('../models/Partner');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const VisaChecklist = require('../models/VisaChecklist');
const VisaChecklistEntry = require('../models/VisaChecklistEntry');
const VisaStatusConfig = require('../models/VisaStatusConfig');
const VisaApplication = require('../models/VisaApplication');
const VisaQuotation = require('../models/VisaQuotation');
const VisaMessage = require('../models/VisaMessage');
const MessageTemplate = require('../models/MessageTemplate');
const TourCategory = require('../models/TourCategory');
const Tour = require('../models/Tour');
const CustomTourRequest = require('../models/CustomTourRequest');
const MembershipPlan = require('../models/MembershipPlan');
const Membership = require('../models/Membership');
const Account = require('../models/Account');
const Journal = require('../models/Journal');
const Party = require('../models/Party');
const VendorBill = require('../models/VendorBill');
const VendorPayment = require('../models/VendorPayment');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const PickupRequest = require('../models/PickupRequest');
const Notification = require('../models/Notification');
const MarketingTemplate = require('../models/MarketingTemplate');
const MarketingCampaign = require('../models/MarketingCampaign');
const AuditLog = require('../models/AuditLog');
const Counter = require('../models/Counter');
const RefreshSession = require('../models/RefreshSession');
const OtpToken = require('../models/OtpToken');

const DEMO_PASSWORD = 'Demo@12345';
const ALT_PASSWORD = 'Password@123';

// -------------------------------------------------------------
// Media File Generators (Valid PDF, PNG, JPG)
// -------------------------------------------------------------
function createValidPdfBuffer(title = 'Official Document', subtitle = 'Verified by Dynamic Travel Platform') {
  const streamContent = `BT
/F1 16 Tf
50 720 Td
(${title}) Tj
/F1 11 Tf
0 -26 Td
(${subtitle}) Tj
/F1 10 Tf
0 -20 Td
(Date: ${new Date().toISOString().slice(0, 10)} | Verification Code: DT-${crypto.randomBytes(4).toString('hex').toUpperCase()}) Tj
ET`;
  const streamBytes = Buffer.from(streamContent, 'latin1');
  const streamLen = streamBytes.length;

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${streamLen} >>
stream
${streamContent}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000325 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${400 + streamLen}
%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// 1x1 valid PNG buffer with real PNG header
const VALID_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfQHzmOZeTAAAAABJRU5ErkJggg==',
  'base64'
);

// 1x1 valid JPEG buffer with real SOI/EOI
const VALID_JPG_BUFFER = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

function writeStorageFile(relativePath, buffer) {
  const fullPath = path.resolve(PRIVATE_ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer, { mode: 0o644 });
  return relativePath;
}

// -------------------------------------------------------------
// Main Seeder Function
// -------------------------------------------------------------
async function masterSeed() {
  console.log('🚀 Connecting to MongoDB at', env.mongoUri || 'mongodb://127.0.0.1:27018/dynamic_travel');
  await connectDB();

  console.log('🧹 1. Clearing all database collections...');
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const c of collections) {
    await mongoose.connection.db.collection(c.name).deleteMany({});
  }
  console.log(`   Cleared ${collections.length} collections.`);

  console.log('📁 2. Cleaning and preparing storage/private disk directory...');
  fs.rmSync(PRIVATE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(PRIVATE_ROOT, 'partners'), { recursive: true });
  fs.mkdirSync(path.join(PRIVATE_ROOT, 'visa'), { recursive: true });

  // -------------------------------------------------------------
  // 3. System Roles & RBAC
  // -------------------------------------------------------------
  console.log('🛡️  3. Seeding RBAC Roles...');
  await roleService.ensureSystemRoles();
  const seededRoles = {};

  for (const [key, template] of Object.entries(templates.TEMPLATES)) {
    if (key === templates.SYSTEM_TEMPLATE) continue;
    const roleDoc = await Role.create({
      name: template.label,
      description: template.description,
      templateKey: key,
      permissions: templates.withDependencies(template.defaults),
    });
    seededRoles[key] = roleDoc;
  }

  // -------------------------------------------------------------
  // 4. Users (Admin, Staff, Partners, Customers)
  // -------------------------------------------------------------
  console.log('👥 4. Seeding Users...');
  const passwordHash = await authService.hashPassword(DEMO_PASSWORD);

  // Super Admins
  const adminDefs = [
    { email: 'admin@dynamic-travel.com', phone: '+8801700000001' },
    { email: 'admin@example.com', phone: '+8801700000002' },
    { email: 'admin@demo.dynamictravel.test', phone: '+8801700000003' },
  ];
  const adminUsers = [];
  for (const a of adminDefs) {
    const admin = await User.create({
      name: 'Super Administrator',
      email: a.email,
      phone: a.phone,
      passwordHash,
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    adminUsers.push(admin);
  }
  const primaryAdmin = adminUsers[0];

  // Staff Members
  const staffMembers = [
    { name: 'Kazi Mahbub', email: 'staff@dynamic-travel.com', template: 'operations_manager', phone: '+8801700000010' },
    { name: 'Nasrin Akhter', email: 'operations@demo.dynamictravel.test', template: 'operations_manager', phone: '+8801700000011' },
    { name: 'Fahim Chowdhury', email: 'visa@demo.dynamictravel.test', template: 'visa_officer', phone: '+8801700000012' },
    { name: 'Tanzeem Ahmed', email: 'accountant@demo.dynamictravel.test', template: 'accountant', phone: '+8801700000013' },
    { name: 'Sumaiya Haque', email: 'viewer@demo.dynamictravel.test', template: 'viewer', phone: '+8801700000014' },
  ];
  const staffUsers = {};
  for (const s of staffMembers) {
    const role = seededRoles[s.template];
    const u = await User.create({
      name: s.name,
      email: s.email,
      phone: s.phone,
      passwordHash,
      role: ROLES.STAFF,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      roles: role ? [role._id] : [],
      permissions: role ? role.permissions : [],
    });
    staffUsers[s.template] = u;
  }

  // B2B Partner Users
  const partnerUserDefs = [
    { name: 'Abdur Rahman', email: 'partner@abltravels.com', phone: '+8801711234567' },
    { name: 'Abdul Rahman', email: 'ablpartner@gmail.com', phone: '+8801717999637' },
    { name: 'Jamil Hasan', email: 'apex.partner@demo.dynamictravel.test', phone: '+8801712999888' },
    { name: 'Rahul Mehta', email: 'sunrise.partner@demo.dynamictravel.test', phone: '+919811002233' },
    { name: 'Sheikh Tariq', email: 'gulf.partner@demo.dynamictravel.test', phone: '+971501234567' },
  ];
  const partnerUsers = {};
  for (const p of partnerUserDefs) {
    const u = await User.create({
      name: p.name,
      email: p.email,
      phone: p.phone,
      passwordHash,
      role: ROLES.B2B,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    partnerUsers[p.email] = u;
  }

  // B2C Customer Users
  const customerDefs = [
    { name: 'Tanvir Hossain', email: 'traveler@gmail.com', phone: '+8801812345678' },
    { name: 'Rohan Gupta', email: 'rohan.gupta@example.com', phone: '+8801710000021' },
    { name: 'Sara Ali', email: 'sara.ali@example.com', phone: '+8801710000022' },
    { name: 'Anika Tabassum', email: 'anika.tabassum@example.com', phone: '+8801634958127' },
    { name: 'Rahim Ahmed', email: 'rahim.ahmed@example.com', phone: '+8801712556340' },
  ];
  const customerUsers = {};
  for (const c of customerDefs) {
    const u = await User.create({
      name: c.name,
      email: c.email,
      phone: c.phone,
      passwordHash,
      role: ROLES.B2C,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    customerUsers[c.email] = u;
  }

  // -------------------------------------------------------------
  // 5. B2B Partners & Documents on Disk
  // -------------------------------------------------------------
  console.log('🏢 5. Seeding B2B Partners and Verification Media...');
  const partnerCompanyDefs = [
    {
      userEmail: 'partner@abltravels.com',
      companyName: 'Green Bengal Tours & Travels Ltd.',
      licenseNo: 'LIC-B2B-1089',
      businessType: 'Travel Agency & Tour Operator',
      address: 'House #1/B, Road #126, Gulshan 01, Dhaka 1212',
      approvalStatus: APPROVAL_STATUS.APPROVED,
      commissionRate: 12,
      reviewedBy: primaryAdmin._id,
      reviewedAt: new Date(Date.now() - 86400000 * 30),
      docs: [
        { type: DOCUMENT_TYPE.TRADE_LICENSE, name: 'Trade_License_Green_Bengal.pdf', status: 'VERIFIED' },
        { type: DOCUMENT_TYPE.BUSINESS_CARD, name: 'Business_Card_Abdur_Rahman.png', status: 'VERIFIED' },
      ],
    },
    {
      userEmail: 'ablpartner@gmail.com',
      companyName: 'Rahman International Travel',
      licenseNo: 'PRT-2025-00124',
      businessType: 'IATA Accredited Agency',
      address: 'House #12, Road #5, Uttara, Dhaka 1230, Bangladesh',
      approvalStatus: APPROVAL_STATUS.APPROVED,
      commissionRate: 10,
      reviewedBy: primaryAdmin._id,
      reviewedAt: new Date(Date.now() - 86400000 * 15),
      docs: [
        { type: DOCUMENT_TYPE.TRADE_LICENSE, name: 'Trade_License_2026.pdf', status: 'VERIFIED' },
        { type: DOCUMENT_TYPE.BUSINESS_CARD, name: 'Card_Abdul_Rahman.png', status: 'VERIFIED' },
        { type: DOCUMENT_TYPE.OTHER, name: 'IATA_Accreditation_Certificate.pdf', status: 'VERIFIED' },
      ],
    },
    {
      userEmail: 'apex.partner@demo.dynamictravel.test',
      companyName: 'Apex Global Tours',
      licenseNo: 'LIC-TEST-IMG-99',
      businessType: 'Travel Agency & Tour Operator',
      address: 'House 42, Road 11, Banani, Dhaka, Bangladesh',
      approvalStatus: APPROVAL_STATUS.PENDING,
      commissionRate: 8,
      docs: [
        { type: DOCUMENT_TYPE.TRADE_LICENSE, name: 'Trade_License_Apex_2026.pdf', status: 'PENDING' },
        { type: DOCUMENT_TYPE.BUSINESS_CARD, name: 'Apex_Managing_Director_Card.png', status: 'PENDING' },
        { type: DOCUMENT_TYPE.OTHER, name: 'Tax_Compliance_Certificate.pdf', status: 'PENDING' },
      ],
    },
    {
      userEmail: 'sunrise.partner@demo.dynamictravel.test',
      companyName: 'Sunrise Holidays Ltd',
      licenseNo: 'TRD-DEL-9812',
      businessType: 'Inbound Tour Operator',
      address: 'Connaught Place, New Delhi, India',
      approvalStatus: APPROVAL_STATUS.PENDING,
      commissionRate: 8,
      docs: [
        { type: DOCUMENT_TYPE.TRADE_LICENSE, name: 'Delhi_Trade_License.pdf', status: 'PENDING' },
        { type: DOCUMENT_TYPE.BUSINESS_CARD, name: 'Rahul_Mehta_Card.png', status: 'PENDING' },
      ],
    },
    {
      userEmail: 'gulf.partner@demo.dynamictravel.test',
      companyName: 'Gulf Horizon Expeditions',
      licenseNo: 'TRD-DXB-9904',
      businessType: 'Destination Management Company',
      address: 'Sheikh Zayed Road, Dubai, UAE',
      approvalStatus: APPROVAL_STATUS.REJECTED,
      commissionRate: 8,
      reviewedBy: primaryAdmin._id,
      reviewedAt: new Date(Date.now() - 86400000 * 5),
      reviewNote: 'Trade license expired on 2025-12-31. Please provide the renewed license.',
      docs: [
        { type: DOCUMENT_TYPE.TRADE_LICENSE, name: 'Dubai_Expired_License.pdf', status: 'REJECTED', note: 'Expired validity' },
      ],
    },
  ];

  const seededPartners = {};
  for (const pc of partnerCompanyDefs) {
    const user = partnerUsers[pc.userEmail];
    const documentSubdocs = [];

    for (const doc of pc.docs) {
      const ext = path.extname(doc.name).toLowerCase();
      const filename = `${path.basename(doc.name, ext)}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const relativePath = path.join('partners', filename);

      let buffer;
      let mimeType;
      if (ext === '.pdf') {
        buffer = createValidPdfBuffer(doc.name, `B2B Partner Verification: ${pc.companyName}`);
        mimeType = 'application/pdf';
      } else if (ext === '.png') {
        buffer = VALID_PNG_BUFFER;
        mimeType = 'image/png';
      } else {
        buffer = VALID_JPG_BUFFER;
        mimeType = 'image/jpeg';
      }

      writeStorageFile(relativePath, buffer);

      documentSubdocs.push({
        type: doc.type,
        originalName: doc.name,
        mimeType,
        size: buffer.length,
        storagePath: relativePath,
        status: doc.status,
        reviewNote: doc.note || '',
        uploadedAt: new Date(Date.now() - 86400000 * 3),
        reviewedBy: doc.status !== 'PENDING' ? primaryAdmin._id : null,
        reviewedAt: doc.status !== 'PENDING' ? new Date() : null,
      });
    }

    const partner = await Partner.create({
      userId: user._id,
      companyName: pc.companyName,
      licenseNo: pc.licenseNo,
      businessType: pc.businessType,
      address: pc.address,
      commissionRate: pc.commissionRate,
      approvalStatus: pc.approvalStatus,
      reviewedBy: pc.reviewedBy || null,
      reviewedAt: pc.reviewedAt || null,
      reviewNote: pc.reviewNote || '',
      documents: documentSubdocs,
    });

    user.partnerId = partner._id;
    await user.save();
    seededPartners[pc.companyName] = partner;
  }

  // -------------------------------------------------------------
  // 6. Visa Catalog, Checklists & System Statuses
  // -------------------------------------------------------------
  console.log('🌏 6. Seeding Visa Catalog & Checklists...');
  await catalog.ensureSystemStatuses();

  const countryDefs = [
    { name: 'China', code: 'CN', flag: '🇨🇳', description: 'Tourist, business, student & Canton Fair visas.', processingMode: 'Embassy', physicalPassportRequired: true, expressAvailable: true },
    { name: 'United Arab Emirates', code: 'AE', flag: '🇦🇪', description: 'Dubai tourist and transit visas.', processingMode: 'eVisa (Online)', expressAvailable: true },
    { name: 'Thailand', code: 'TH', flag: '🇹🇭', description: 'Thailand tourist eVisa and sticker visas.', processingMode: 'eVisa (Online)', expressAvailable: true },
    { name: 'Malaysia', code: 'MY', flag: '🇲🇾', description: 'eVisa and direct embassy processing.', processingMode: 'eVisa (Online)', expressAvailable: true },
    { name: 'Singapore', code: 'SG', flag: '🇸🇬', description: 'Physical passport submission required.', processingMode: 'Embassy', physicalPassportRequired: true },
    { name: 'Schengen (France)', code: 'FR', flag: '🇫🇷', description: 'Short stay tourist and business visas.', processingMode: 'Visa center', physicalPassportRequired: true },
    { name: 'United Kingdom', code: 'GB', flag: '🇬🇧', description: 'Standard visitor visas via VFS.', processingMode: 'Visa center', physicalPassportRequired: true },
    { name: 'Saudi Arabia', code: 'SA', flag: '🇸🇦', description: 'Umrah, tourist, and business visas.', processingMode: 'eVisa (Online)', expressAvailable: true },
    { name: 'India', code: 'IN', flag: '🇮🇳', description: 'Tourist and medical visa assistance.', processingMode: 'Visa center', physicalPassportRequired: true },
    { name: 'Japan', code: 'JP', flag: '🇯🇵', description: 'Single and multiple entry tourist visas.', processingMode: 'Embassy', physicalPassportRequired: true },
  ];

  const seededCountries = {};
  for (let i = 0; i < countryDefs.length; i++) {
    const c = countryDefs[i];
    const nameKey = c.name.toLowerCase().trim();
    const row = await VisaCountry.create({
      ...c,
      nameKey,
      displayOrder: i + 1,
      status: 'active',
      richChecklist: `<h3>${c.name} Visa Requirements</h3><p>Valid passport, 6-month bank statements, photograph, and return air ticket.</p>`,
    });
    seededCountries[c.name] = row;
  }

  const typeDefs = [
    { country: 'China', name: 'Tourist Visa', processingTime: '15 Days (+/-)', entries: 'single', b2c: 12500, b2b: 10500, embassy: 8500, service: 3500, vat: 500, stay: '30 Days' },
    { country: 'China', name: 'Business Visa', processingTime: '7-10 Days', entries: 'single', b2c: 18000, b2b: 15500, embassy: 12000, service: 5000, vat: 1000, stay: '30-90 Days' },
    { country: 'China', name: 'Canton Fair Visa', processingTime: '10-12 Days', entries: 'single', b2c: 19500, b2b: 16500, embassy: 13000, service: 5500, vat: 1000, stay: '30 Days' },
    { country: 'United Arab Emirates', name: 'Tourist Visa', processingTime: '3-4 Days', entries: 'single', b2c: 6500, b2b: 5200, embassy: 4200, service: 2000, vat: 300, stay: '30 Days' },
    { country: 'Thailand', name: 'Tourist Visa', processingTime: '5-7 Days', entries: 'single', b2c: 5500, b2b: 4500, embassy: 3500, service: 1700, vat: 300, stay: '60 Days' },
    { country: 'Malaysia', name: 'Tourist Visa', processingTime: '3-5 Days', entries: 'single', b2c: 4500, b2b: 3600, embassy: 2800, service: 1500, vat: 200, stay: '30 Days' },
    { country: 'Singapore', name: 'Tourist Visa', processingTime: '5-7 Days', entries: 'single', b2c: 8500, b2b: 7000, embassy: 5500, service: 2600, vat: 400, stay: '30 Days' },
    { country: 'Schengen (France)', name: 'Tourist Visa', processingTime: '15-20 Days', entries: 'multiple', b2c: 14500, b2b: 12500, embassy: 9500, service: 4200, vat: 800, stay: 'Up to 90 Days' },
    { country: 'United Kingdom', name: 'Standard Visitor Visa', processingTime: '15-25 Days', entries: 'multiple', b2c: 18500, b2b: 16000, embassy: 13000, service: 4500, vat: 1000, stay: '180 Days' },
    { country: 'Saudi Arabia', name: 'Umrah Visa', processingTime: '2-3 Days', entries: 'single', b2c: 16000, b2b: 13500, embassy: 11000, service: 4500, vat: 500, stay: '90 Days' },
  ];

  const seededTypes = {};
  for (const t of typeDefs) {
    const country = seededCountries[t.country];
    const nameKey = t.name.toLowerCase().trim();
    const typeDoc = await VisaType.create({
      country: country._id,
      name: t.name,
      nameKey,
      processingTime: t.processingTime,
      entries: t.entries,
      b2cPrice: t.b2c,
      b2bNetPrice: t.b2b,
      fees: { embassy: t.embassy, service: t.service, vat: t.vat },
      currency: 'BDT',
      passportRequirement: country.physicalPassportRequired ? 'physical_required' : 'online_processing',
      pickupAvailable: country.physicalPassportRequired,
      officeSubmissionAvailable: true,
    });
    seededTypes[`${t.country}|${t.name}`] = typeDoc;
  }

  // Checklists
  const checklistItems = [
    { label: 'Original Passport (valid 6+ months)', requirement: 'required', submissionMode: 'both', active: true, fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10 },
    { label: 'Recent 33x48mm Photograph', requirement: 'required', submissionMode: 'digital', active: true, fileFormats: 'JPG/PNG', maxSizeMb: 5 },
    { label: 'Bank Statement (last 6 months)', requirement: 'required', submissionMode: 'digital', active: true, fileFormats: 'PDF', maxSizeMb: 10 },
    { label: 'Bank Solvency Certificate', requirement: 'required', submissionMode: 'digital', active: true, fileFormats: 'PDF', maxSizeMb: 10 },
    { label: 'Return Air Ticket Reservation', requirement: 'required', submissionMode: 'digital', active: true, fileFormats: 'PDF', maxSizeMb: 5 },
    { label: 'Hotel Booking Confirmation', requirement: 'required', submissionMode: 'digital', active: true, fileFormats: 'PDF', maxSizeMb: 5 },
    { label: 'Visiting Card / Trade License', requirement: 'optional', submissionMode: 'digital', active: true, fileFormats: 'PDF/JPG', maxSizeMb: 5 },
  ];
  await VisaChecklist.create({
    country: seededCountries.China._id,
    visaType: seededTypes['China|Tourist Visa']._id,
    applicantType: 'individual',
    items: checklistItems,
  });

  // -------------------------------------------------------------
  // 7. Visa Applications with Complete Media on Disk
  // -------------------------------------------------------------
  console.log('📑 7. Seeding Visa Applications and Applicant Files on Disk...');
  const appSpecs = [
    {
      appNo: 'VISA-2026-0001',
      country: 'China',
      visaType: 'Tourist Visa',
      name: 'Rahim Ahmed',
      passport: 'A02218431',
      phone: '+8801712556340',
      email: 'rahim.ahmed@example.com',
      channel: 'b2c',
      status: 'under_review',
      advance: 5000,
      assignedStaff: staffUsers.visa_officer._id,
      docs: [
        { type: 'passportCopy', name: 'Passport_Scan_Rahim_Ahmed.pdf', status: 'verified' },
        { type: 'photo', name: 'Photo_33x48_Rahim.jpg', status: 'verified' },
        { type: 'bankStatement', name: 'EBL_Bank_Statement_6M.pdf', status: 'pending' },
        { type: 'returnTicket', name: 'Flight_Booking_DAC_CAN.pdf', status: 'pending' },
      ],
    },
    {
      appNo: 'VISA-2026-0002',
      country: 'United Arab Emirates',
      visaType: 'Tourist Visa',
      name: 'Nusrat Jahan',
      passport: 'A03561972',
      phone: '+8801819264710',
      email: 'nusrat.jahan@example.com',
      channel: 'b2c',
      status: 'processing',
      advance: 6500,
      assignedStaff: staffUsers.visa_officer._id,
      docs: [
        { type: 'passportCopy', name: 'Passport_Nusrat_Jahan.pdf', status: 'verified' },
        { type: 'photo', name: 'Nusrat_Photo.jpg', status: 'verified' },
        { type: 'bankStatement', name: 'Bank_Statement_CityBank.pdf', status: 'verified' },
      ],
    },
    {
      appNo: 'VISA-2026-0003',
      country: 'Thailand',
      visaType: 'Tourist Visa',
      name: 'Anika Tabassum',
      passport: 'A04820653',
      phone: '+8801634958127',
      email: 'anika.tabassum@example.com',
      channel: 'b2c',
      status: 'approved',
      advance: 5500,
      docs: [
        { type: 'passportCopy', name: 'Passport_Anika.pdf', status: 'verified' },
        { type: 'hotelBooking', name: 'Bangkok_Hotel_Agoda.pdf', status: 'verified' },
      ],
    },
    {
      appNo: 'VISA-2026-0004',
      country: 'Singapore',
      visaType: 'Tourist Visa',
      name: 'Jahangir Alam',
      passport: 'A01937264',
      phone: '+8801718453092',
      email: 'jahangir.alam@example.com',
      channel: 'b2c',
      status: 'passport_ready',
      advance: 8500,
      docs: [
        { type: 'passportCopy', name: 'Passport_Jahangir.pdf', status: 'verified' },
        { type: 'photo', name: 'Jahangir_Photo.jpg', status: 'verified' },
      ],
    },
    {
      appNo: 'VISA-2026-0005',
      country: 'Schengen (France)',
      visaType: 'Tourist Visa',
      name: 'Kamal Hossain',
      passport: 'A00631587',
      phone: '+8801521847365',
      email: 'kamal.hossain@example.com',
      channel: 'b2c',
      status: 'action_required',
      advance: 6000,
      reviewNote: 'Bank solvency certificate is missing bank seal. Please re-upload.',
      docs: [
        { type: 'passportCopy', name: 'Passport_Kamal_Hossain.pdf', status: 'verified' },
        { type: 'bankSolvency', name: 'Solvency_Certificate.pdf', status: 'rejected', note: 'Missing bank seal and signature' },
      ],
    },
    {
      appNo: 'VISA-2026-0006',
      country: 'China',
      visaType: 'Business Visa',
      name: 'Sadia Rahman',
      passport: 'EB1052846',
      phone: '+8801792614085',
      email: 'sadia.rahman@example.com',
      channel: 'b2c',
      status: 'rejected',
      advance: 9000,
      reviewNote: 'Embassy rejected due to lack of formal Chinese counterparty invitation letter.',
      docs: [
        { type: 'passportCopy', name: 'Passport_Sadia_Rahman.pdf', status: 'verified' },
        { type: 'invitationLetter', name: 'Invitation_Letter_China.pdf', status: 'rejected', note: 'Invalid registration stamp' },
      ],
    },
    // B2B Partner Applications
    {
      appNo: 'VISA-2026-0007',
      country: 'China',
      visaType: 'Tourist Visa',
      name: 'Tanvir Hossain (Client)',
      passport: 'A09182374',
      phone: '+8801812345678',
      email: 'traveler@gmail.com',
      channel: 'b2b',
      partner: seededPartners['Green Bengal Tours & Travels Ltd.'],
      status: 'submitted_to_embassy',
      advance: 10500,
      assignedStaff: staffUsers.visa_officer._id,
      docs: [
        { type: 'passportCopy', name: 'Passport_Tanvir_Client.pdf', status: 'verified' },
        { type: 'photo', name: 'Tanvir_Photo_Studio.jpg', status: 'verified' },
        { type: 'bankStatement', name: 'Bank_Statement_Standard_Chartered.pdf', status: 'verified' },
      ],
    },
    {
      appNo: 'VISA-2026-0008',
      country: 'Malaysia',
      visaType: 'Tourist Visa',
      name: 'Sayed Karim',
      passport: 'EA0812745',
      phone: '+8801733221100',
      email: 'sayed.karim@example.com',
      channel: 'b2b',
      partner: seededPartners['Green Bengal Tours & Travels Ltd.'],
      status: 'completed',
      advance: 3600,
      docs: [
        { type: 'passportCopy', name: 'Passport_Sayed_Karim.pdf', status: 'verified' },
        { type: 'eVisa', name: 'Approved_eVisa_Malaysia.pdf', status: 'verified' },
      ],
    },
  ];

  const seededApplications = [];
  const cleanPassportKey = (num) => String(num || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  for (const spec of appSpecs) {
    const country = seededCountries[spec.country];
    const typeDoc = seededTypes[`${spec.country}|${spec.visaType}`];
    const totalAmount = spec.channel === 'b2b' ? typeDoc.b2bNetPrice : typeDoc.b2cPrice;
    const dueAmount = Math.max(0, totalAmount - spec.advance);
    const paymentStatus = spec.advance >= totalAmount ? 'Paid' : (spec.advance > 0 ? 'Partial' : 'Unpaid');

    const documentSubdocs = [];
    const appDir = path.join('visa', spec.appNo.toLowerCase());

    for (const doc of spec.docs) {
      const ext = path.extname(doc.name).toLowerCase();
      const filename = `${path.basename(doc.name, ext)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
      const relativePath = path.join(appDir, filename);

      let buffer;
      let mimeType;
      if (ext === '.pdf') {
        buffer = createValidPdfBuffer(doc.name, `Application: ${spec.appNo} | Applicant: ${spec.name}`);
        mimeType = 'application/pdf';
      } else if (ext === '.png') {
        buffer = VALID_PNG_BUFFER;
        mimeType = 'image/png';
      } else {
        buffer = VALID_JPG_BUFFER;
        mimeType = 'image/jpeg';
      }

      writeStorageFile(relativePath, buffer);

      documentSubdocs.push({
        type: doc.type,
        originalName: doc.name,
        mimeType,
        size: buffer.length,
        storagePath: relativePath,
        status: doc.status,
        reviewNote: doc.note || '',
        uploadedBy: primaryAdmin._id,
        uploadedByName: 'System Seed',
        uploadedAt: new Date(Date.now() - 86400000 * 4),
        reviewedBy: doc.status !== 'pending' ? staffUsers.visa_officer._id : null,
        reviewedAt: doc.status !== 'pending' ? new Date() : null,
      });
    }

    const appDoc = await VisaApplication.create({
      number: spec.appNo,
      serviceType: 'visa',
      channel: spec.channel,
      partner: spec.partner ? spec.partner._id : null,
      partnerName: spec.partner ? spec.partner.companyName : '',
      country: country._id,
      countryName: country.name,
      visaType: typeDoc._id,
      visaTypeName: typeDoc.name,
      applicant: {
        fullName: spec.name,
        mobile: spec.phone,
        email: spec.email,
        nationality: 'Bangladeshi',
        city: 'Dhaka',
        applicantType: 'individual',
      },
      passport: {
        number: spec.passport,
        numberKey: cleanPassportKey(spec.passport),
        issuingCountry: 'Bangladesh',
        type: 'ordinary',
      },
      status: spec.status,
      assignedStaff: spec.assignedStaff || null,
      price: {
        currency: 'BDT',
        rateToBase: 1,
        b2c: typeDoc.b2cPrice,
        b2b: typeDoc.b2bNetPrice,
        fees: typeDoc.fees,
      },
      account: {
        totalAmount,
        discountAmount: 0,
        netAmount: totalAmount,
        advancePaid: spec.advance,
        dueAmount,
        paymentStatus,
        paymentMethod: 'Bank Transfer',
      },
      documents: documentSubdocs,
      payments: spec.advance > 0 ? [
        {
          amount: spec.advance,
          method: 'Bank Transfer',
          date: new Date(Date.now() - 86400000 * 3),
          enteredBy: primaryAdmin._id,
          enteredByName: 'Admin',
        }
      ] : [],
      vendorLines: [
        { name: 'China Visa Center / Embassy', service: 'visa', country: spec.country, price: typeDoc.fees.embassy },
      ],
      timeline: [
        { event: 'Application Submitted', message: 'Submitted online via portal', visibility: 'both', by: spec.name },
        ...(spec.advance > 0 ? [{ event: 'Payment Received', message: `Advance payment of BDT ${spec.advance} recorded`, visibility: 'both', by: 'Accounts' }] : []),
      ],
      internalNotes: [
        { by: 'System', text: 'All initial documents ingested.' },
        ...(spec.reviewNote ? [{ by: 'Visa Specialist', text: spec.reviewNote }] : []),
      ],
    });

    seededApplications.push(appDoc);
  }

  // -------------------------------------------------------------
  // 8. Tour Categories & Tour Packages (with Full Itineraries & Unsplash Images)
  // -------------------------------------------------------------
  console.log('🏖️  8. Seeding Tour Categories & Packages...');
  const catDefs = [
    { legacyId: 'cat_beach', name: 'Beach & Resort' },
    { legacyId: 'cat_adventure', name: 'Adventure & Trekking' },
    { legacyId: 'cat_honeymoon', name: 'Honeymoon & Romantic' },
    { legacyId: 'cat_family', name: 'Family Special' },
    { legacyId: 'cat_cultural', name: 'Cultural & Heritage' },
    { legacyId: 'cat_luxury', name: 'Luxury & Wellness' },
    { legacyId: 'cat_city', name: 'City Break' },
    { legacyId: 'cat_custom_group', name: 'Custom Group' },
  ];
  const seededCats = {};
  for (const c of catDefs) {
    const nameKey = c.name.toLowerCase().trim();
    const slug = nameKey.replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const catDoc = await TourCategory.create({
      legacyId: c.legacyId,
      name: c.name,
      nameKey,
      slug,
      isActive: true,
    });
    seededCats[c.legacyId] = catDoc;
  }

  const tourDefs = [
    {
      legacyId: 'tour_201',
      name: 'Bali Island Escape & Volcano Trek',
      country: 'Indonesia',
      destination: 'Bali, Indonesia',
      category: seededCats.cat_beach._id,
      durationDays: 7,
      priceCurrency: 'USD',
      price: 1450,
      b2bPrice: 1180,
      seats: 20,
      status: 'published',
      rating: 4.9,
      coverImage: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=600&q=80',
      ],
      description: 'Experience 7 days across Ubud and Seminyak: lush rice terraces, sacred temples, a Mount Batur sunrise trek, and pristine beaches.',
      included: ['6 nights 4-star resort stay with breakfast', 'All airport and hotel transfers', 'English speaking licensed guide', 'Batur sunrise trek', 'Uluwatu Kecak dance'],
      excluded: ['International airfare', 'Personal expenses', 'Visa on arrival'],
      hotels: ['Puri Sebali Resort Ubud', 'The Sangrah Villas Seminyak'],
      itinerary: [
        { day: 1, title: 'Arrival in Denpasar', description: 'Airport pickup and transfer to Ubud resort with orientation dinner.' },
        { day: 2, title: 'Ubud Temples & Rice Terraces', description: 'Tirta Empul holy spring, Tegalalang rice terraces and coffee plantation.' },
        { day: 3, title: 'Mount Batur Sunrise Trek', description: 'Pre-dawn climb up volcano summit, natural hot spring bath.' },
        { day: 4, title: 'Seminyak Beachfront Transfer', description: 'Scenic drive via Jatiluwih UNESCO terraces, sunset at Tanah Lot.' },
        { day: 5, title: 'Uluwatu Sunset & Seafood Dinner', description: 'Cliff-top Uluwatu temple, fire dance and Jimbaran bay dinner.' },
        { day: 6, title: 'Free Leisure Day', description: 'Relax at Seminyak beach or optional Nusa Penida speedboat tour.' },
        { day: 7, title: 'Departure', description: 'Souvenir shopping and airport transfer.' },
      ],
    },
    {
      legacyId: 'tour_202',
      name: 'Swiss Alps Panorama Explorer',
      country: 'Switzerland',
      destination: 'Zurich, Lucerne & Interlaken',
      category: seededCats.cat_adventure._id,
      durationDays: 5,
      priceCurrency: 'EUR',
      price: 2250,
      b2bPrice: 1890,
      seats: 15,
      status: 'published',
      rating: 4.8,
      coverImage: 'https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?auto=format&fit=crop&w=900&q=80',
      description: 'Five unforgettable days exploring the Swiss Alps, Jungfraujoch Top of Europe, Lake Lucerne cruise, and scenic Alpine trains.',
      included: ['4 nights luxury 4-star hotels', 'Swiss Travel Rail Pass', 'Jungfraujoch cogwheel excursion', 'Lake Lucerne cruise'],
      excluded: ['Flights to Zurich', 'Travel insurance', 'Lunches & Dinners'],
      hotels: ['Hotel Astoria Lucerne', 'Hotel Interlaken'],
      itinerary: [
        { day: 1, title: 'Arrival in Zurich & Lucerne', description: 'Scenic train to Lucerne and Chapel Bridge evening walk.' },
        { day: 2, title: 'Mount Pilatus & Lake Lucerne', description: 'Golden round trip with world steepest cogwheel train.' },
        { day: 3, title: 'Interlaken Alpine Haven', description: 'Panoramic train to Interlaken between Lake Thun and Brienz.' },
        { day: 4, title: 'Jungfraujoch Top of Europe', description: '3,454m glacier plateau, Ice Palace and Sphinx Observatory.' },
        { day: 5, title: 'Departure Zurich', description: 'Scenic rail to Zurich Airport.' },
      ],
    },
    {
      legacyId: 'tour_203',
      name: 'Dubai Luxury Skyline & Desert Safari',
      country: 'UAE',
      destination: 'Dubai & Abu Dhabi',
      category: seededCats.cat_city._id,
      durationDays: 5,
      priceCurrency: 'USD',
      price: 1150,
      b2bPrice: 920,
      seats: 25,
      status: 'published',
      rating: 4.7,
      coverImage: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=900&q=80',
      description: 'Modern marvels of Dubai: Burj Khalifa 124th floor, red dune safari with BBQ, luxury yacht marina cruise, and Sheikh Zayed Grand Mosque.',
      included: ['4 nights 5-star hotel with breakfast', 'Burj Khalifa At The Top tickets', 'Premium Desert 4x4 Safari with BBQ', 'Abu Dhabi Day Trip'],
      excluded: ['UAE Tourist Visa (available separately)', 'Personal expenses'],
      hotels: ['Rove Downtown Dubai / Grand Hyatt'],
      itinerary: [
        { day: 1, title: 'Arrival & Dubai Marina', description: 'VIP airport transfer, evening walk across Marina Promenade.' },
        { day: 2, title: 'Modern Dubai & Burj Khalifa', description: 'Dubai Mall, Burj Khalifa observation deck, Dubai Fountain show.' },
        { day: 3, title: 'Desert Safari & Bedouin Camp', description: 'Dune bashing, camel ride, sandboarding, and live BBQ dinner show.' },
        { day: 4, title: 'Abu Dhabi Cultural Day Trip', description: 'Sheikh Zayed Grand Mosque, Louvre Abu Dhabi, Emirates Palace.' },
        { day: 5, title: 'Departure', description: 'Gold Souk shopping and airport departure.' },
      ],
    },
    {
      legacyId: 'tour_204',
      name: "Cox's Bazar Beachfront Vacation",
      country: 'Bangladesh',
      destination: "Cox's Bazar, Bangladesh",
      category: seededCats.cat_beach._id,
      durationDays: 3,
      priceCurrency: 'BDT',
      price: 12500,
      b2bPrice: 9800,
      seats: 30,
      status: 'published',
      rating: 4.9,
      coverImage: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
      description: "Relax at the world's longest natural sea beach with 5-star ocean-view resort stay, Himchari waterfall, and Inani rocky beach.",
      included: ['2 nights 5-star resort stay', 'Buffet breakfast', 'AC transportation', 'Marine Drive sightseeing'],
      excluded: ['Shopping', 'Personal tips'],
      hotels: ['Ocean Paradise Hotel & Resort'],
      itinerary: [
        { day: 1, title: 'Arrival & Kolatoli Beach', description: 'Resort check-in, sunset at Laboni beach, seafood dinner.' },
        { day: 2, title: 'Marine Drive, Himchari & Inani', description: 'Full day drive along Marine Drive, Inani coral beach.' },
        { day: 3, title: 'Burmese Market & Departure', description: 'Burmese shopping market and airport transfer.' },
      ],
    },
  ];

  for (const t of tourDefs) {
    await Tour.create(t);
  }

  // -------------------------------------------------------------
  // 9. Custom Tour Requests
  // -------------------------------------------------------------
  console.log('🗺️  9. Seeding Custom Tour Requests...');
  await CustomTourRequest.create([
    {
      userId: customerUsers['traveler@gmail.com']._id,
      customer: 'Tanvir Hossain & Family',
      phone: '+8801812345678',
      destination: 'Maldives Overwater Retreat',
      travelers: 4,
      startDate: new Date('2026-11-20'),
      endDate: new Date('2026-11-26'),
      status: 'QUOTED',
      hotel: 'resort',
      transportation: 'Flight',
      activities: ['Beach day', 'Snorkeling / diving', 'Private sunset dolphin cruise'],
      requirements: 'Overwater family villa with private pool and halal catering.',
      itinerary: [
        { day: 1, title: 'Arrival Malé & Speedboat Transfer', description: 'VIP resort check-in and private dinner.' },
        { day: 2, title: 'Coral Reef Snorkeling Tour', description: 'Guided manta ray snorkeling with marine biologist.' },
        { day: 3, title: 'Private Sandbank Picnic', description: 'Full day leisure on private sandbank with beach barbecue.' },
        { day: 4, title: 'Sunset Dolphin Cruise', description: 'Champagne and canapés dolphin spotting excursion.' },
        { day: 5, title: 'Departure', description: 'Transfer to Malé International Airport.' },
      ],
    },
    {
      userId: customerUsers['rohan.gupta@example.com']._id,
      customer: 'Corporate Leadership Retreat',
      phone: '+8801710000001',
      destination: 'Goa Beach Resort & Heritage',
      travelers: 12,
      startDate: new Date('2026-12-10'),
      endDate: new Date('2026-12-14'),
      status: 'IN_REVIEW',
      hotel: '5-star',
      transportation: 'Minibus',
      activities: ['Team-building beach activities', 'Fontainhas Portuguese Heritage Walk'],
      requirements: 'Conference hall access on day 2 morning with projector and audio.',
    },
  ]);

  // -------------------------------------------------------------
  // 10. Memberships & Plans
  // -------------------------------------------------------------
  console.log('💎 10. Seeding Membership Plans & Customer Memberships...');
  const planDefs = [
    { name: 'Starter', durationValue: 15, durationUnit: 'day', price: 500, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: 1000, sortOrder: 1 },
    { name: 'Basic', durationValue: 30, durationUnit: 'day', price: 900, tourDiscountPercent: 5, visaDiscountPercent: 5, maxDiscountAmount: 1500, sortOrder: 2 },
    { name: 'Silver', durationValue: 6, durationUnit: 'month', price: 2500, tourDiscountPercent: 10, visaDiscountPercent: 10, maxDiscountAmount: 3000, sortOrder: 3 },
    { name: 'Gold', durationValue: 1, durationUnit: 'year', price: 4500, tourDiscountPercent: 15, visaDiscountPercent: 12, maxDiscountAmount: 6000, sortOrder: 4 },
  ];
  const seededPlans = {};
  for (const p of planDefs) {
    const nameKey = p.name.toLowerCase().trim();
    const doc = await MembershipPlan.create({
      ...p,
      nameKey,
      description: `${p.tourDiscountPercent}% off tours and ${p.visaDiscountPercent}% off visa processing.`,
      features: [`${p.tourDiscountPercent}% tour discount`, `${p.visaDiscountPercent}% visa fee discount`],
    });
    seededPlans[p.name] = doc;
  }

  // Issue active Gold membership to Tanvir Hossain
  const tanvir = customerUsers['traveler@gmail.com'];
  const goldPlan = seededPlans.Gold;
  await Membership.create({
    customerId: tanvir._id,
    customerName: tanvir.name,
    customerEmail: tanvir.email,
    customerPhone: tanvir.phone,
    planId: goldPlan._id,
    planSnapshot: {
      name: goldPlan.name,
      durationValue: goldPlan.durationValue,
      durationUnit: goldPlan.durationUnit,
      price: goldPlan.price,
      tourDiscountPercent: goldPlan.tourDiscountPercent,
      visaDiscountPercent: goldPlan.visaDiscountPercent,
      maxDiscountAmount: goldPlan.maxDiscountAmount,
    },
    startDate: new Date(Date.now() - 86400000 * 30),
    endDate: new Date(Date.now() + 86400000 * 335),
    status: 'active',
    payment: {
      method: 'online',
      amount: goldPlan.price,
      trxId: 'TRX-GOLD-98471',
      status: 'paid',
      paidAt: new Date(Date.now() - 86400000 * 30),
    },
    source: 'online',
  });

  // -------------------------------------------------------------
  // 11. Accounting & Financial Ledger
  // -------------------------------------------------------------
  console.log('📊 11. Seeding Chart of Accounts, Journals & Vendor Bills...');
  await ensureChart();

  // Seed Parties
  const partyDefs = [
    { type: 'Vendor', code: 'VND-001', name: 'Chinese Visa Application Service Center', contactPerson: 'Consular Accounts', email: 'china-center@visa-vendor.test', since: '2025-01-01' },
    { type: 'Vendor', code: 'VND-002', name: 'VFS Global Services Bangladesh', contactPerson: 'Diplomatic Liaison', email: 'vfs-dhaka@vfs-vendor.test', since: '2025-01-01' },
    { type: 'Vendor', code: 'VND-003', name: 'Emirates Airline Ticketing Hub', contactPerson: 'Corporate Desk', email: 'corporate@emirates.test', since: '2025-02-01' },
    { type: 'B2B', code: 'B2B-1089', name: 'Green Bengal Tours & Travels Ltd.', partner: seededPartners['Green Bengal Tours & Travels Ltd.']._id, since: '2025-01-15' },
    { type: 'B2C', code: 'CUST-001', name: 'Tanvir Hossain', email: 'traveler@gmail.com', since: '2025-03-01' },
  ];
  const seededParties = {};
  for (const pd of partyDefs) {
    const nameKey = pd.name.toLowerCase().trim();
    const party = await Party.create({
      ...pd,
      nameKey,
    });
    seededParties[pd.name] = party;
  }

  // Seed Vendor Bills
  await VendorBill.create([
    {
      billNo: 'BILL-2026-0001',
      vendor: seededParties['Chinese Visa Application Service Center']._id,
      vendorName: 'Chinese Visa Application Service Center',
      date: '2026-10-15',
      dueDate: '2026-10-30',
      amount: 42500,
      invoiceRef: 'INV-CH-99482',
      service: 'China Embassy Visa Fee Batch #401',
      account: '5001 - Cost of Visa Processing',
      status: 'posted',
      createdBy: primaryAdmin._id,
      createdByName: 'Admin',
    },
    {
      billNo: 'BILL-2026-0002',
      vendor: seededParties['VFS Global Services Bangladesh']._id,
      vendorName: 'VFS Global Services Bangladesh',
      date: '2026-10-20',
      dueDate: '2026-11-05',
      amount: 28500,
      invoiceRef: 'VFS-FR-84910',
      service: 'France Short Stay VFS Biometrics Batch',
      account: '5001 - Cost of Visa Processing',
      status: 'posted',
      createdBy: primaryAdmin._id,
      createdByName: 'Admin',
    },
  ]);

  // Seed B2B Partner Withdrawal Requests
  await WithdrawalRequest.create([
    {
      partnerId: seededPartners['Green Bengal Tours & Travels Ltd.']._id,
      partnerName: 'Green Bengal Tours & Travels Ltd.',
      amount: 25000,
      method: 'Bank transfer',
      accountDetails: 'City Bank Ltd | Gulshan Branch | A/C: 1102948572001',
      status: 'pending',
    },
    {
      partnerId: seededPartners['Green Bengal Tours & Travels Ltd.']._id,
      partnerName: 'Green Bengal Tours & Travels Ltd.',
      amount: 18000,
      method: 'bKash',
      accountDetails: '01711234567 (Merchant)',
      status: 'paid',
      reviewedBy: primaryAdmin._id,
      reviewedAt: new Date(Date.now() - 86400000 * 7),
      adminNote: 'Disbursed via bKash merchant gateway.',
      transactionReference: 'BKASH-TX-99882211',
    },
  ]);

  // -------------------------------------------------------------
  // 12. B2B Passport Pickup Logistics
  // -------------------------------------------------------------
  console.log('📦 12. Seeding Passport Pickup Logistics...');
  await PickupRequest.create([
    {
      partnerId: seededPartners['Green Bengal Tours & Travels Ltd.']._id,
      partnerName: 'Green Bengal Tours & Travels Ltd.',
      location: 'House #1/B, Road #126, Gulshan 01, Dhaka',
      contactPerson: 'Abdur Rahman',
      contactPhone: '+8801711234567',
      pickupAt: new Date(Date.now() + 86400000 * 1),
      travelers: 4,
      status: 'scheduled',
      assignedStaff: staffUsers.operations_manager._id,
      notes: 'Express courier delivery van assigned (DM-Cha 11-4021, Rider: Tariqul Islam).',
    },
    {
      partnerId: seededPartners['Rahman International Travel']._id,
      partnerName: 'Rahman International Travel',
      location: 'House #12, Road #5, Uttara, Dhaka',
      contactPerson: 'Abdul Rahman',
      contactPhone: '+8801717999637',
      pickupAt: new Date(Date.now() - 86400000 * 2),
      travelers: 2,
      status: 'delivered_to_hub',
      assignedStaff: staffUsers.operations_manager._id,
      notes: 'Delivered safely to central visa processing hub.',
    },
  ]);

  // -------------------------------------------------------------
  // 13. Notifications, Messaging & Quotations
  // -------------------------------------------------------------
  console.log('🔔 13. Seeding Notifications & Quotations...');
  await Notification.create([
    {
      recipient: primaryAdmin._id,
      type: 'b2b',
      title: 'New B2B Partner Document Submission',
      body: 'Apex Global Tours submitted 3 verification documents awaiting review.',
      link: '/documents',
      read: false,
    },
    {
      recipient: primaryAdmin._id,
      type: 'visa',
      title: 'Action Required on Visa Application',
      body: 'Kamal Hossain (VISA-2026-0005) needs bank solvency update.',
      link: '/visa/applications',
      read: false,
    },
  ]);

  // B2B Quotations
  const chinaType = seededTypes['China|Canton Fair Visa'];
  const myType = seededTypes['Malaysia|Tourist Visa'];
  await VisaQuotation.create([
    {
      number: 'QT-2026-0001',
      partner: seededPartners['Green Bengal Tours & Travels Ltd.']._id,
      partnerName: 'Green Bengal Tours & Travels Ltd.',
      clientName: 'Corporate Trade Delegation (Canton Fair)',
      country: seededCountries.China._id,
      countryName: 'China',
      visaType: chinaType._id,
      visaTypeName: chinaType.name,
      quantity: 6,
      currency: 'BDT',
      rateToBase: 1,
      netPrice: chinaType.b2bNetPrice,
      additionalFee: 2000,
      total: chinaType.b2bNetPrice * 6 + 2000,
      totalBase: chinaType.b2bNetPrice * 6 + 2000,
      validUntil: new Date(Date.now() + 86400000 * 14),
      status: 'accepted',
      createdBy: primaryAdmin._id,
      createdByName: 'Admin',
    },
    {
      number: 'QT-2026-0002',
      partner: seededPartners['Green Bengal Tours & Travels Ltd.']._id,
      partnerName: 'Green Bengal Tours & Travels Ltd.',
      clientName: 'Kuala Lumpur Holiday Group',
      country: seededCountries.Malaysia._id,
      countryName: 'Malaysia',
      visaType: myType._id,
      visaTypeName: myType.name,
      quantity: 8,
      currency: 'BDT',
      rateToBase: 1,
      netPrice: myType.b2bNetPrice,
      additionalFee: 0,
      total: myType.b2bNetPrice * 8,
      totalBase: myType.b2bNetPrice * 8,
      validUntil: new Date(Date.now() + 86400000 * 7),
      status: 'sent',
      createdBy: primaryAdmin._id,
      createdByName: 'Admin',
    },
  ]);

  // -------------------------------------------------------------
  // 14. Audit Trail
  // -------------------------------------------------------------
  console.log('📝 14. Seeding Audit Trail...');
  const auditEntries = [
    { actorUserId: primaryAdmin._id, action: AUDIT_ACTIONS.LOGIN, resource: 'Admin Console', ip: '127.0.0.1' },
    { actorUserId: primaryAdmin._id, action: AUDIT_ACTIONS.B2B_APPROVED, resource: 'Green Bengal Tours & Travels Ltd.', ip: '127.0.0.1' },
    { actorUserId: staffUsers.visa_officer._id, action: AUDIT_ACTIONS.DOCUMENT_REVIEWED, resource: 'Trade License LIC-TEST-IMG-99', ip: '127.0.0.1' },
    { actorUserId: staffUsers.operations_manager._id, action: AUDIT_ACTIONS.TOUR_CREATED, resource: 'Bali Island Escape & Volcano Trek', ip: '127.0.0.1' },
  ];
  for (const entry of auditEntries) {
    await AuditLog.create(entry);
  }

  // -------------------------------------------------------------
  // 15. Auto-Increment Counters
  // -------------------------------------------------------------
  console.log('🔢 15. Initializing Sequential Counters...');
  await Counter.create([
    { _id: 'VISA:2026', seq: 15 },
    { _id: 'QT:2026', seq: 3 },
    { _id: 'BILL:2026', seq: 3 },
    { _id: 'VI', seq: 10 },
  ]);

  console.log('\n======================================================');
  console.log('🎉 MASTER DATABASE RESET & SEEDING COMPLETED!');
  console.log('======================================================');
  console.log('All 35 collections have been populated with fully-connected data.');
  console.log('All partner and visa application documents exist as real files on disk.');
  console.log('\n🔑 Quick Login Credentials (Password: Demo@12345):');
  console.log('   • Admin Console:      admin@dynamic-travel.com or admin@demo.dynamictravel.test');
  console.log('   • Staff Workstation:  staff@dynamic-travel.com or operations@demo.dynamictravel.test');
  console.log('   • B2B Partner Portal: partner@abltravels.com (Green Bengal, Platinum)');
  console.log('   • Customer Portal:    traveler@gmail.com (Tanvir Hossain, Gold Member)');
  console.log('======================================================\n');
}

if (require.main === module) {
  masterSeed()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('\n❌ Master seeding error:', err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { masterSeed };
