// One-time script to create the FIRST admin account. Every later admin is created
// by an existing admin (POST /api/admin/users). Usage: npm run seed
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const env = require('../config/env');
const { ROLES, USER_STATUS } = require('../config/constants');
const User = require('../models/User');
const authService = require('../services/authService');
const { email: emailSchema, password: passwordSchema } = require('../validations/common');

(async () => {
  const { name, email: rawEmail, password: rawPassword } = env.adminSeed;
  if (!rawEmail || !rawPassword) {
    throw new Error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD in .env first.');
  }

  // Same rules as a normal password, so the first admin cannot start with a weak one.
  const email = emailSchema.parse(rawEmail);
  const password = passwordSchema.parse(rawPassword);

  await connectDB();
  // Builds the current indexes and drops stale ones (e.g. a unique "username" index left by an
  // older version of this boilerplate), which would otherwise reject new users.
  await User.syncIndexes();

  const existing = await User.findOne({ role: ROLES.ADMIN });
  if (existing) {
    console.log('An admin already exists. Nothing to do.');
    return;
  }

  const user = await User.create({
    name,
    email,
    passwordHash: await authService.hashPassword(password),
    role: ROLES.ADMIN,
    status: USER_STATUS.ACTIVE,
    emailVerified: true
  });

  console.log('Admin created:');
  console.log(`  email   : ${user.email}`);
  console.log('  password: value of ADMIN_SEED_PASSWORD in .env. Change it after the first login.');
  console.log('Login at POST /api/auth/login');
})()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    // zod errors carry a list of issues; print them one per line
    if (err.issues) err.issues.forEach((issue) => console.error(`ADMIN_SEED: ${issue.message}`));
    else console.error(err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
