// Partner seed. Creates demo B2B partners and applicant records with multiple uploaded documents
// in various review states (PENDING, VERIFIED, REJECTED) with review notes.
const mongoose = require('mongoose');
const Partner = require('../../models/Partner');
const User = require('../../models/User');
const { ROLES, USER_STATUS, APPROVAL_STATUS, DOCUMENT_TYPE } = require('../../config/constants');
const authService = require('../../services/authService');

const DEMO_PASSWORD = 'Demo@12345';
const DEMO_DOMAIN = '@demo.dynamictravel.test';

const DEMO_PARTNERS = [
  {
    companyName: 'Apex Global Tours',
    licenseNo: 'LIC-TEST-IMG-99',
    businessType: 'Travel Agency & Tour Operator',
    address: 'House 42, Road 11, Banani, Dhaka, Bangladesh',
    approvalStatus: APPROVAL_STATUS.PENDING,
    contactPerson: { name: 'Jamil Test Partner', email: `jamil.partner${DEMO_DOMAIN}`, phone: '+8801712999888' },
    documents: [
      {
        type: DOCUMENT_TYPE.TRADE_LICENSE,
        originalName: 'image.png',
        mimeType: 'image/png',
        size: 14614,
        storagePath: 'partners/image-1793304366163-e2ef2b557b7c.png',
        status: 'PENDING',
        uploadedAt: new Date(),
      },
      {
        type: DOCUMENT_TYPE.BUSINESS_CARD,
        originalName: 'Official Partner ID Card.png',
        mimeType: 'image/png',
        size: 14614,
        storagePath: 'partners/image-1793304366163-e2ef2b557b7c.png',
        status: 'PENDING',
        uploadedAt: new Date(),
      },
      {
        type: DOCUMENT_TYPE.OTHER,
        originalName: 'Tax Compliance & Incorporation.pdf',
        mimeType: 'application/pdf',
        size: 1840000,
        storagePath: 'partners/demo/tin_sunrise.pdf',
        status: 'PENDING',
        uploadedAt: new Date(),
      },
    ],
  },
  {
    companyName: 'Sunrise Holidays Ltd',
    licenseNo: 'TRD-DEL-9812',
    businessType: 'Travel Agency & Tour Operator',
    address: 'Connaught Place, New Delhi, India',
    approvalStatus: APPROVAL_STATUS.PENDING,
    contactPerson: { name: 'Rahul Mehta', email: `rahul.mehta${DEMO_DOMAIN}`, phone: '+919811002233' },
    documents: [
      {
        type: DOCUMENT_TYPE.TRADE_LICENSE,
        originalName: 'Trade license 2026-2027.pdf',
        mimeType: 'application/pdf',
        size: 2140000,
        storagePath: 'partners/demo/trade_license_sunrise.pdf',
        status: 'PENDING',
        uploadedAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        type: DOCUMENT_TYPE.BUSINESS_CARD,
        originalName: 'Business Card - Rahul Mehta (MD).png',
        mimeType: 'image/png',
        size: 512000,
        storagePath: 'partners/demo/business_card_sunrise.png',
        status: 'PENDING',
        uploadedAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        type: DOCUMENT_TYPE.OTHER,
        originalName: 'Certificate of Incorporation.pdf',
        mimeType: 'application/pdf',
        size: 1840000,
        storagePath: 'partners/demo/coi_sunrise.pdf',
        status: 'PENDING',
        uploadedAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        type: DOCUMENT_TYPE.OTHER,
        originalName: 'Tax Identification (TIN) Certificate.pdf',
        mimeType: 'application/pdf',
        size: 940000,
        storagePath: 'partners/demo/tin_sunrise.pdf',
        status: 'PENDING',
        uploadedAt: new Date(Date.now() - 86400000 * 2),
      },
    ],
  },
  {
    companyName: 'Gulf Horizon Expeditions',
    licenseNo: 'TRD-DXB-9904',
    businessType: 'Destination Management Company',
    address: 'Sheikh Zayed Road, Dubai, UAE',
    approvalStatus: APPROVAL_STATUS.PENDING,
    contactPerson: { name: 'Tariq Al-Mansoor', email: `tariq.mansoor${DEMO_DOMAIN}`, phone: '+971501234567' },
    documents: [
      {
        type: DOCUMENT_TYPE.TRADE_LICENSE,
        originalName: 'Dubai Municipality Trade License.pdf',
        mimeType: 'application/pdf',
        size: 3200000,
        storagePath: 'partners/demo/trade_license_gulf.pdf',
        status: 'VERIFIED',
        reviewedAt: new Date(Date.now() - 86400000),
        uploadedAt: new Date(Date.now() - 86400000 * 3),
      },
      {
        type: DOCUMENT_TYPE.OTHER,
        originalName: 'Civil Defense Fire & Safety Certificate.pdf',
        mimeType: 'application/pdf',
        size: 1450000,
        storagePath: 'partners/demo/safety_cert_gulf.pdf',
        status: 'REJECTED',
        reviewNote: 'Certificate expired on 30 June 2026. Please upload current renewed copy.',
        reviewedAt: new Date(Date.now() - 86400000),
        uploadedAt: new Date(Date.now() - 86400000 * 3),
      },
      {
        type: DOCUMENT_TYPE.OTHER,
        originalName: 'Managing Director Passport & Visa.pdf',
        mimeType: 'application/pdf',
        size: 2800000,
        storagePath: 'partners/demo/passport_gulf.pdf',
        status: 'PENDING',
        uploadedAt: new Date(Date.now() - 86400000 * 3),
      },
    ],
  },
  {
    companyName: 'Skyline Travels & Tours',
    licenseNo: 'TRD-DXB-8801',
    businessType: 'Travel Agency',
    address: 'Deira, Dubai, UAE',
    approvalStatus: APPROVAL_STATUS.APPROVED,
    contactPerson: { name: 'Amina Khan', email: `amina.khan${DEMO_DOMAIN}`, phone: '+971509988776' },
    documents: [
      {
        type: DOCUMENT_TYPE.TRADE_LICENSE,
        originalName: 'Trade license 2026.pdf',
        mimeType: 'application/pdf',
        size: 2450000,
        storagePath: 'partners/demo/trade_license_skyline.pdf',
        status: 'VERIFIED',
        reviewedAt: new Date(Date.now() - 86400000 * 10),
        uploadedAt: new Date(Date.now() - 86400000 * 12),
      },
      {
        type: DOCUMENT_TYPE.BUSINESS_CARD,
        originalName: 'Business Card - Amina Khan.png',
        mimeType: 'image/png',
        size: 480000,
        storagePath: 'partners/demo/business_card_skyline.png',
        status: 'VERIFIED',
        reviewedAt: new Date(Date.now() - 86400000 * 10),
        uploadedAt: new Date(Date.now() - 86400000 * 12),
      },
    ],
  },
];

const seed = async ({ demo = true } = {}) => {
  if (!demo) return { partners: 0 };
  let created = 0;
  let updated = 0;

  for (const p of DEMO_PARTNERS) {
    let user = await User.findOne({ email: p.contactPerson.email });
    if (!user) {
      user = await User.create({
        name: p.contactPerson.name,
        email: p.contactPerson.email,
        passwordHash: await authService.hashPassword(DEMO_PASSWORD),
        role: ROLES.B2B,
        status: USER_STATUS.ACTIVE,
        emailVerified: true,
      });
    }

    const existingPartner = await Partner.findOne({ licenseNo: p.licenseNo });
    if (!existingPartner) {
      const partner = await Partner.create({
        userId: user._id,
        companyName: p.companyName,
        licenseNo: p.licenseNo,
        businessType: p.businessType,
        address: p.address,
        approvalStatus: p.approvalStatus,
        documents: p.documents,
        contactPerson: p.contactPerson,
        reviewedAt: p.approvalStatus === APPROVAL_STATUS.APPROVED ? new Date() : undefined,
      });
      user.partnerId = partner._id;
      await user.save();
      created += 1;
    } else {
      // Ensure documents are rich and up-to-date
      existingPartner.documents = p.documents;
      existingPartner.approvalStatus = p.approvalStatus;
      await existingPartner.save();
      updated += 1;
    }
  }

  return { created, updated, total: DEMO_PARTNERS.length };
};

const clear = async () => {
  const users = await User.find({ email: { $regex: `@demo\\.dynamictravel\\.test$` }, role: ROLES.B2B });
  const userIds = users.map((u) => u._id);
  const result = await Partner.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  return result.deletedCount;
};

module.exports = { name: 'partner', seed, clear };
