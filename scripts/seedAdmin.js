// Seed script to initialize default Admin and Staff accounts in MongoDB.
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const env = require('../config/env');
const { ROLES, USER_STATUS } = require('../config/constants');
const User = require('../models/User');
const authService = require('../services/authService');

(async () => {
  const adminEmail = env.adminSeed.email || 'admin@example.com';
  const adminPassword = env.adminSeed.password || 'Admin@12345';
  const adminName = env.adminSeed.name || 'Super Admin';

  const staffEmail = 'staff@example.com';
  const staffPassword = 'Staff@12345';
  const staffName = 'Operations Staff';

  console.log('Connecting to database...');
  await connectDB();
  await User.syncIndexes();

  // Seed Admin Account
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      name: adminName,
      email: adminEmail,
      passwordHash: await authService.hashPassword(adminPassword),
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
    });
    console.log(`✅ Admin created: ${admin.email} (password: ${adminPassword})`);
  } else {
    console.log(`ℹ️ Admin already exists: ${admin.email}`);
  }

  // Seed Staff Account
  let staff = await User.findOne({ email: staffEmail });
  if (!staff) {
    staff = await User.create({
      name: staffName,
      email: staffEmail,
      passwordHash: await authService.hashPassword(staffPassword),
      role: ROLES.STAFF,
      permissions: ['VISA_VIEW', 'VISA_UPDATE', 'B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY', 'USER_VIEW'],
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
    });
    console.log(`✅ Staff created: ${staff.email} (password: ${staffPassword})`);
  } else {
    console.log(`ℹ️ Staff already exists: ${staff.email}`);
  }
})()
  .then(() => mongoose.disconnect())
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed error:', err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
