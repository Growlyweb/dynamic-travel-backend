const request = require('supertest');

const app = require('../../app');
const rbac = require('../../config/rbac');
const User = require('../../models/User');
const raw = require('../../config/rbac.json');
const { ROLES } = require('../../config/constants');
const { createUser, bearer } = require('./helpers/factory');

const clone = () => JSON.parse(JSON.stringify(raw));

describe('config/rbac.json', () => {
  it('drives ROLES, permissions and the role flags', () => {
    expect(Object.keys(rbac.ROLES)).toEqual(Object.keys(raw.roles));
    expect(rbac.ALL_PERMISSIONS).toEqual(Object.keys(raw.permissions));
    expect(rbac.INVITABLE_ROLES).toEqual(['ADMIN', 'STAFF']);
    expect(rbac.SELF_REGISTER_ROLES).toEqual(['B2B', 'B2C']);
    expect(rbac.bypassesPermissions('ADMIN')).toBe(true);
    expect(rbac.bypassesPermissions('STAFF')).toBe(false);
    expect(rbac.canHavePermissions('STAFF')).toBe(true);
    expect(rbac.canHavePermissions('B2B')).toBe(false);
    expect(rbac.canHavePermissions('NOPE')).toBe(false);
  });

  it('changing the JSON changes the behaviour (a new permission and a new invitable role)', () => {
    const config = clone();
    config.permissions.INVOICE_VIEW = 'See invoices';
    config.roles.B2B.invitable = true;

    const built = rbac.build(config);
    expect(built.ALL_PERMISSIONS).toContain('INVOICE_VIEW');
    expect(built.INVITABLE_ROLES).toEqual(['ADMIN', 'STAFF', 'B2B']);
  });

  it.each([
    ['a missing required role', (c) => delete c.roles.STAFF, /role "STAFF" is required/],
    ['a role without a label', (c) => delete c.roles.B2C.label, /needs a "label"/],
    ['a non-boolean flag', (c) => (c.roles.ADMIN.invitable = 'yes'), /needs a boolean "invitable"/],
    ['a role that bypasses AND holds permissions', (c) => (c.roles.STAFF.bypassPermissions = true), /cannot both/],
    ['a lower-case permission code', (c) => (c.permissions.visa_view = 'x'), /UPPER_SNAKE_CASE/],
    ['a permission without a description', (c) => (c.permissions.USER_VIEW = ''), /needs a text description/],
    ['no permissions at all', (c) => (c.permissions = {}), /cannot be empty/],
    ['a wrong top-level shape', (c) => delete c.roles, /must contain a "roles" object/]
  ])('refuses to load %s', (label, mutate, message) => {
    const config = clone();
    mutate(config);
    expect(() => rbac.build(config)).toThrow(message);
  });
});

describe('selfRegister flag closes sign-up for a role', () => {
  const PDF = Buffer.from('%PDF-1.4 x');
  const closeFor = (...roles) =>
    jest.spyOn(rbac, 'canSelfRegister').mockImplementation((role) => !roles.includes(role));
  afterEach(() => jest.restoreAllMocks());

  const registerB2C = () =>
    request(app).post('/api/auth/register').send({ name: 'Rahim Uddin', email: 'rahim@example.com', password: 'Str0ng!Pass' });
  const registerB2B = () =>
    request(app)
      .post('/api/auth/b2b/register')
      .field('name', 'Karim Hossain')
      .field('email', 'karim@agency.com')
      .field('phone', '+8801811111111')
      .field('password', 'Str0ng!Pass')
      .field('companyName', 'Sky Travels')
      .field('licenseNo', 'TL-1')
      .field('address', '45 Motijheel, Dhaka')
      .attach('tradeLicense', PDF, { filename: 'l.pdf', contentType: 'application/pdf' });

  it('both are open by default', async () => {
    expect((await registerB2C()).status).toBe(201);
    expect((await registerB2B()).status).toBe(201);
  });

  it('closing B2B refuses B2B registration (no user, no file left) but leaves B2C open', async () => {
    closeFor('B2B');

    const b2b = await registerB2B();
    expect(b2b.status).toBe(403);
    expect(b2b.body.code).toBe('REGISTRATION_CLOSED');
    expect(await User.countDocuments()).toBe(0);

    expect((await registerB2C()).status).toBe(201);
  });

  it('closing B2C refuses customer registration and a first-time Google sign-in, but not B2B', async () => {
    closeFor('B2C');

    const b2c = await registerB2C();
    expect(b2c.status).toBe(403);
    expect(b2c.body.code).toBe('REGISTRATION_CLOSED');

    const firebaseService = require('../../services/firebaseService');
    jest.spyOn(firebaseService, 'verifyIdToken').mockResolvedValue({
      uid: 'g1', email: 'new@example.com', email_verified: true, name: 'New', firebase: { sign_in_provider: 'google.com' }
    });
    const google = await request(app).post('/api/auth/firebase').send({ idToken: 'x'.repeat(40) });
    expect(google.status).toBe(403);
    expect(await User.countDocuments()).toBe(0);

    expect((await registerB2B()).status).toBe(201);
  });
});

describe('GET /api/admin/rbac', () => {
  it('returns the roles and permissions from the JSON file to an admin', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    const res = await request(app).get('/api/admin/rbac').set(bearer(admin));

    expect(res.status).toBe(200);
    expect(res.body.data.roles.map((r) => r.code)).toEqual(['ADMIN', 'STAFF', 'B2B', 'B2C']);
    expect(res.body.data.roles.find((r) => r.code === 'STAFF')).toMatchObject({ label: 'Staff', assignablePermissions: true });
    expect(res.body.data.permissions).toHaveLength(Object.keys(raw.permissions).length);
    expect(res.body.data.permissions[0]).toEqual({ code: 'USER_VIEW', description: raw.permissions.USER_VIEW });
  });

  it('is closed to everyone but ADMIN', async () => {
    for (const role of [ROLES.STAFF, ROLES.B2B, ROLES.B2C]) {
      const user = await createUser({ role });
      expect((await request(app).get('/api/admin/rbac').set(bearer(user))).status).toBe(403);
    }
    expect((await request(app).get('/api/admin/rbac')).status).toBe(401);
  });

  it('every permission the API accepts for staff exists in the JSON, and unknown ones are refused', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const auth = bearer(admin);

    const ok = await request(app)
      .post('/api/admin/staff')
      .set(auth)
      .send({ name: 'All Perms', email: 'allperms@example.com', permissions: Object.keys(raw.permissions) });
    expect(ok.status).toBe(201);

    const bad = await request(app)
      .post('/api/admin/staff')
      .set(auth)
      .send({ name: 'Bad', email: 'bad@example.com', permissions: ['NOT_IN_JSON'] });
    expect(bad.status).toBe(422);
  });
});
