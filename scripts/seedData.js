// Comprehensive Seed script to populate MongoDB with initial Admin, Staff, Customers, B2B Partners, and Audit Logs.
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const env = require('../config/env');
const { ROLES, USER_STATUS, APPROVAL_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const authService = require('../services/authService');

(async () => {
  console.log('⚡ Connecting to database for seeding...');
  await connectDB();
  await User.syncIndexes();
  await Partner.syncIndexes();
  await AuditLog.syncIndexes();

  // 1. Seed Admin
  const adminEmail = env.adminSeed?.email || 'admin@example.com';
  const adminPassword = env.adminSeed?.password || 'Admin@12345';
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      name: 'Super Admin',
      email: adminEmail,
      passwordHash: await authService.hashPassword(adminPassword),
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    console.log(`✅ Admin created: ${admin.email} / ${adminPassword}`);
  } else {
    console.log(`ℹ️ Admin exists: ${admin.email}`);
  }

  // 2. Seed Staff
  const staffEmail = 'staff@example.com';
  const staffPassword = 'Staff@12345';
  let staff = await User.findOne({ email: staffEmail });
  if (!staff) {
    staff = await User.create({
      name: 'Operations Manager',
      email: staffEmail,
      passwordHash: await authService.hashPassword(staffPassword),
      role: ROLES.STAFF,
      permissions: ['VISA_VIEW', 'VISA_UPDATE', 'B2B_VIEW', 'B2B_APPROVE', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY', 'USER_VIEW', 'REPORT_VIEW'],
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    console.log(`✅ Staff created: ${staff.email} / ${staffPassword}`);
  } else {
    console.log(`ℹ️ Staff exists: ${staff.email}`);
  }

  // 3. Seed B2C Customers
  const customerData = [
    { name: 'Rohan Gupta', email: 'rohan.gupta@example.com', phone: '+8801710000001' },
    { name: 'Sara Ali', email: 'sara.ali@example.com', phone: '+8801710000002' },
    { name: 'Tom Becker', email: 'tom.becker@example.com', phone: '+8801710000003' },
    { name: 'Nina Roy', email: 'nina.roy@example.com', phone: '+8801710000004' },
    { name: 'Mei Chen', email: 'mei.chen@example.com', phone: '+8801710000005' },
  ];

  for (const c of customerData) {
    let cust = await User.findOne({ email: c.email });
    if (!cust) {
      await User.create({
        name: c.name,
        email: c.email,
        phone: c.phone,
        passwordHash: await authService.hashPassword('Customer@12345'),
        role: ROLES.B2C,
        status: USER_STATUS.ACTIVE,
        emailVerified: true,
      });
      console.log(`✅ Customer created: ${c.email}`);
    }
  }

  // 4. Seed B2B Partners
  const partnerSeedData = [
    {
      companyName: 'Skyline Travels & Tours',
      licenseNo: 'LIC-2026-8801',
      businessType: 'Travel Agency',
      address: 'Gulshan 2, Dhaka, Bangladesh',
      email: 'contact@skylinetravels.test',
      ownerName: 'Skyline Admin',
      approvalStatus: APPROVAL_STATUS.APPROVED,
    },
    {
      companyName: 'Global Horizon Expeditions',
      licenseNo: 'LIC-2026-8802',
      businessType: 'Tour Operator',
      address: 'Banani C/A, Dhaka, Bangladesh',
      email: 'info@globalhorizon.test',
      ownerName: 'Horizon Manager',
      approvalStatus: APPROVAL_STATUS.PENDING,
    },
    {
      companyName: 'Apex Express Visa Services',
      licenseNo: 'LIC-2026-8803',
      businessType: 'Visa Consultancy',
      address: 'Dhanmondi 27, Dhaka, Bangladesh',
      email: 'support@apexvisa.test',
      ownerName: 'Apex Owner',
      approvalStatus: APPROVAL_STATUS.APPROVED,
    },
  ];

  for (const p of partnerSeedData) {
    let pUser = await User.findOne({ email: p.email });
    if (!pUser) {
      pUser = await User.create({
        name: p.ownerName,
        email: p.email,
        passwordHash: await authService.hashPassword('Partner@12345'),
        role: ROLES.B2B,
        status: USER_STATUS.ACTIVE,
        emailVerified: true,
      });

      const partner = await Partner.create({
        userId: pUser._id,
        companyName: p.companyName,
        licenseNo: p.licenseNo,
        businessType: p.businessType,
        address: p.address,
        approvalStatus: p.approvalStatus,
        reviewedBy: admin._id,
        reviewedAt: new Date(),
      });

      pUser.partnerId = partner._id;
      await pUser.save();
      console.log(`✅ Partner created: ${p.companyName} (${p.approvalStatus})`);
    }
  }

  // 5. Seed Audit Logs
  const logCount = await AuditLog.countDocuments();
  if (logCount === 0) {
    const auditLogsToCreate = [
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Admin Console',
        createdAt: new Date(Date.now() - 3600000 * 1),
      },
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.PARTNER_APPROVE,
        targetUserId: admin._id,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Skyline Travels & Tours',
        createdAt: new Date(Date.now() - 3600000 * 3),
      },
      {
        actorUserId: staff._id,
        action: AUDIT_ACTIONS.USER_UPDATE,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Rohan Gupta Profile',
        createdAt: new Date(Date.now() - 3600000 * 5),
      },
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.DOCUMENT_VERIFY,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Trade License LIC-2026-8801',
        createdAt: new Date(Date.now() - 3600000 * 8),
      },
      {
        actorUserId: staff._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Staff Workstation',
        createdAt: new Date(Date.now() - 3600000 * 12),
      },
    ];

    await AuditLog.insertMany(auditLogsToCreate);
    console.log('✅ Audit logs seeded.');
  } else {
    console.log(`ℹ️ Audit logs already exist: ${logCount} entries`);
  }
})()
  .then(() => mongoose.disconnect())
  .then(() => {
    console.log('🎉 Seeding complete.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Seeding failed:', err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
