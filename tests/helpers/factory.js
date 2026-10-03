const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');
const User = require('../../models/User');
const Partner = require('../../models/Partner');
const { ROLES, USER_STATUS, APPROVAL_STATUS } = require('../../config/constants');
const tokenService = require('../../services/tokenService');
const { outbox } = require('../../utils/mailer');

const PASSWORD = 'Str0ng!Pass';

let counter = 0;
const unique = (prefix) => `${prefix}${Date.now()}${counter++}`;

// Creates a user straight in the database (fast path for tests that are not about registration).
const createUser = async ({ role = ROLES.B2C, status = USER_STATUS.ACTIVE, permissions = [], password = PASSWORD, ...rest } = {}) =>
  User.create({
    name: `Test ${role}`,
    email: `${unique(role.toLowerCase())}@example.com`,
    passwordHash: await bcrypt.hash(password, env.bcryptCost),
    role,
    status,
    permissions,
    // Only a PENDING account is still waiting for verification; any other state implies it happened.
    emailVerified: status !== USER_STATUS.PENDING,
    ...rest
  });

// A B2B user with a Partner record, in the given approval state.
const createB2B = async ({ approvalStatus = APPROVAL_STATUS.APPROVED, withDocument = true, ...userOverrides } = {}) => {
  const user = await createUser({ role: ROLES.B2B, ...userOverrides });
  const partner = await Partner.create({
    userId: user._id,
    companyName: `Company ${unique('c')}`,
    licenseNo: unique('LIC'),
    approvalStatus,
    documents: withDocument
      ? [
          {
            type: 'TRADE_LICENSE',
            originalName: 'license.pdf',
            mimeType: 'application/pdf',
            size: 10,
            storagePath: 'partners/missing.pdf'
          }
        ]
      : []
  });
  user.partnerId = partner._id;
  await user.save();
  return { user, partner };
};

// Bearer header for a user, signed directly (no HTTP round trip).
const bearer = (user) => ({ Authorization: `Bearer ${tokenService.signAccessToken(user)}` });

// The newest email sent to an address (the memory mail provider keeps them in `outbox`).
const lastEmailTo = (address) => [...outbox].reverse().find((mail) => mail.to_email === address);

const loginRequest = (email, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });

// Convenience: one admin, one of each role.
const createRoleSet = async () => {
  const admin = await createUser({ role: ROLES.ADMIN });
  const staff = await createUser({ role: ROLES.STAFF });
  const b2c = await createUser({ role: ROLES.B2C });
  const { user: b2b, partner } = await createB2B();
  return { admin, staff, b2c, b2b, partner };
};

module.exports = { PASSWORD, createUser, createB2B, createRoleSet, bearer, lastEmailTo, loginRequest, unique };
