const request = require('supertest');

const app = require('../app');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const RefreshSession = require('../models/RefreshSession');
const userService = require('../services/userService');
const { ROLES, USER_STATUS } = require('../config/constants');
const { PERMISSIONS } = require('../config/rbac');
const { PASSWORD, createUser, bearer, lastEmailTo, loginRequest } = require('./helpers/factory');

let admin;
let auth;

beforeEach(async () => {
  admin = await createUser({ role: ROLES.ADMIN });
  auth = bearer(admin);
});

const inviteTokenFor = (email) => /token=([0-9a-f]+)/.exec(lastEmailTo(email).message)[1];

describe('creating staff and admins (invite flow)', () => {
  it('creates a STAFF account with only the listed permissions and emails an invite', async () => {
    const res = await request(app)
      .post('/api/admin/staff')
      .set(auth)
      .send({ name: 'Sara Staff', email: 'sara@example.com', permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE] });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      role: ROLES.STAFF,
      status: USER_STATUS.PENDING,
      permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE]
    });
    expect(lastEmailTo('sara@example.com').message).toMatch(/\/setup-account\?token=[0-9a-f]{64}/);
    expect(await AuditLog.countDocuments({ action: 'USER_CREATED' })).toBe(1);
  });

  it('gives a new staff account NO permissions unless the admin lists them', async () => {
    const res = await request(app).post('/api/admin/staff').set(auth).send({ name: 'Zero Power', email: 'zero@example.com' });
    expect(res.body.data.user.permissions).toEqual([]);
  });

  it('lets the invited person set a password once, then log in', async () => {
    await request(app).post('/api/admin/staff').set(auth).send({ name: 'Sara Staff', email: 'sara@example.com' });
    const token = inviteTokenFor('sara@example.com');

    // no password yet: cannot log in
    expect((await loginRequest('sara@example.com', PASSWORD)).status).toBe(401);

    const setup = await request(app).post('/api/auth/setup-account').send({ token, password: PASSWORD });
    expect(setup.status).toBe(200);
    expect((await User.findOne({ email: 'sara@example.com' })).status).toBe(USER_STATUS.ACTIVE);
    expect((await loginRequest('sara@example.com', PASSWORD)).status).toBe(200);

    // single use
    const again = await request(app).post('/api/auth/setup-account').send({ token, password: 'An0ther!Pass' });
    expect(again.status).toBe(400);
  });

  it('rejects a bad token and a weak password on setup', async () => {
    await request(app).post('/api/admin/staff').set(auth).send({ name: 'Sara Staff', email: 'sara@example.com' });
    const token = inviteTokenFor('sara@example.com');

    expect((await request(app).post('/api/auth/setup-account').send({ token: 'a'.repeat(64), password: PASSWORD })).status).toBe(400);
    expect((await request(app).post('/api/auth/setup-account').send({ token, password: 'weak' })).status).toBe(422);
  });

  it('can resend an invite, which invalidates the previous link', async () => {
    const created = await request(app).post('/api/admin/staff').set(auth).send({ name: 'Sara', email: 'sara@example.com' });
    const oldToken = inviteTokenFor('sara@example.com');

    const resend = await request(app).post(`/api/admin/users/${created.body.data.user._id}/resend-invite`).set(auth);
    expect(resend.status).toBe(200);

    expect((await request(app).post('/api/auth/setup-account').send({ token: oldToken, password: PASSWORD })).status).toBe(400);
    expect(
      (await request(app).post('/api/auth/setup-account').send({ token: inviteTokenFor('sara@example.com'), password: PASSWORD })).status
    ).toBe(200);
  });

  it('creates another ADMIN through /users, but never B2B or B2C', async () => {
    const ok = await request(app)
      .post('/api/admin/users')
      .set(auth)
      .send({ name: 'Second Admin', email: 'admin2@example.com', role: ROLES.ADMIN, permissions: [PERMISSIONS.USER_VIEW] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.permissions).toEqual([]); // admins do not use permission lists

    for (const role of [ROLES.B2B, ROLES.B2C, 'SUPERUSER']) {
      const res = await request(app).post('/api/admin/users').set(auth).send({ name: 'Nope', email: `${role}@example.com`, role });
      expect(res.status).toBe(422);
    }
  });

  it('rejects duplicates and unknown permissions', async () => {
    const dup = await request(app).post('/api/admin/staff').set(auth).send({ name: 'Dup', email: admin.email });
    expect(dup.status).toBe(409);

    const bad = await request(app)
      .post('/api/admin/staff')
      .set(auth)
      .send({ name: 'Bad', email: 'bad@example.com', permissions: ['DELETE_EVERYTHING'] });
    expect(bad.status).toBe(422);
  });
});

describe('status changes', () => {
  it('suspends an account: its live token, refresh token and login all stop at once', async () => {
    const target = await createUser({ role: ROLES.B2C });
    const session = await loginRequest(target.email);
    const token = session.body.data.accessToken;

    const res = await request(app).patch(`/api/admin/users/${target._id}/status`).set(auth).send({ status: 'SUSPENDED', reason: 'fraud check' });
    expect(res.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await loginRequest(target.email)).status).toBe(403);
    expect(await RefreshSession.countDocuments({ userId: target._id, revokedAt: null })).toBe(0);

    const log = await AuditLog.findOne({ action: 'ACCOUNT_SUSPENDED' });
    expect(String(log.actorUserId)).toBe(String(admin._id));
    expect(String(log.targetUserId)).toBe(String(target._id));
    expect(log.meta).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED', reason: 'fraud check' });
  });

  it('reactivates and records ACCOUNT_ACTIVATED', async () => {
    const target = await createUser({ status: USER_STATUS.SUSPENDED });

    const res = await request(app).patch(`/api/admin/users/${target._id}/status`).set(auth).send({ status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect((await loginRequest(target.email)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'ACCOUNT_ACTIVATED' })).toBe(1);
  });

  it('will not activate an account that never verified, or accept PENDING as a target', async () => {
    const unverified = await createUser({ status: USER_STATUS.PENDING });

    const activate = await request(app).patch(`/api/admin/users/${unverified._id}/status`).set(auth).send({ status: 'ACTIVE' });
    expect(activate.status).toBe(409);

    const pending = await request(app).patch(`/api/admin/users/${unverified._id}/status`).set(auth).send({ status: 'PENDING' });
    expect(pending.status).toBe(422);
  });

  it('cannot change its own status', async () => {
    const res = await request(app).patch(`/api/admin/users/${admin._id}/status`).set(auth).send({ status: 'SUSPENDED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SELF_CHANGE');
  });

  it('DELETE deactivates (soft delete) and cuts access', async () => {
    const target = await createUser({ role: ROLES.STAFF });

    const res = await request(app).delete(`/api/admin/users/${target._id}`).set(auth);

    expect(res.status).toBe(200);
    expect((await User.findById(target._id)).status).toBe(USER_STATUS.INACTIVE);
    expect((await request(app).get('/api/staff/profile').set(bearer(target))).status).toBe(401);
  });

  it('refuses to remove the last active admin', async () => {
    // Called directly: the only way past the HTTP guards is an actor who is not an active admin.
    await expect(
      userService.updateStatus({ id: '64b7f0f0f0f0f0f0f0f0f0f0' }, admin._id, { status: 'SUSPENDED' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'LAST_ADMIN' });
  });

  it('returns 404 for an unknown user and 422 for a malformed id', async () => {
    expect((await request(app).get('/api/admin/users/64b7f0f0f0f0f0f0f0f0f0f0').set(auth)).status).toBe(404);
    expect((await request(app).get('/api/admin/users/not-an-id').set(auth)).status).toBe(422);
  });
});

describe('role and permission changes', () => {
  it('promotes STAFF to ADMIN (permissions cleared), invalidates their tokens, and audits it', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const oldToken = bearer(staff);

    const res = await request(app).patch(`/api/admin/users/${staff._id}/role`).set(auth).send({ role: ROLES.ADMIN });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: ROLES.ADMIN, permissions: [] });
    expect((await request(app).get('/api/staff/profile').set(oldToken)).status).toBe(401);

    const log = await AuditLog.findOne({ action: 'ROLE_CHANGED' });
    expect(log.meta).toMatchObject({ from: ROLES.STAFF, to: ROLES.ADMIN });
  });

  it('demotes ADMIN to STAFF with the permissions given', async () => {
    const other = await createUser({ role: ROLES.ADMIN });

    const res = await request(app)
      .patch(`/api/admin/users/${other._id}/role`)
      .set(auth)
      .send({ role: ROLES.STAFF, permissions: [PERMISSIONS.REPORT_VIEW] });

    expect(res.body.data).toMatchObject({ role: ROLES.STAFF, permissions: [PERMISSIONS.REPORT_VIEW] });
  });

  it('cannot turn a B2C or B2B account into anything else, or change its own role', async () => {
    const b2c = await createUser({ role: ROLES.B2C });
    const locked = await request(app).patch(`/api/admin/users/${b2c._id}/role`).set(auth).send({ role: ROLES.ADMIN });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('ROLE_LOCKED');

    const self = await request(app).patch(`/api/admin/users/${admin._id}/role`).set(auth).send({ role: ROLES.STAFF });
    expect(self.status).toBe(409);

    expect((await request(app).patch(`/api/admin/users/${b2c._id}/role`).set(auth).send({ role: 'B2C' })).status).toBe(422);
  });

  it('updates staff permissions and audits PERMISSION_CHANGED', async () => {
    const staff = await createUser({ role: ROLES.STAFF });

    const res = await request(app)
      .patch(`/api/admin/users/${staff._id}/permissions`)
      .set(auth)
      .send({ permissions: [PERMISSIONS.B2B_VIEW, PERMISSIONS.B2B_VIEW] });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual([PERMISSIONS.B2B_VIEW]); // de-duplicated
    expect(await AuditLog.countDocuments({ action: 'PERMISSION_CHANGED' })).toBe(1);
    expect((await request(app).get('/api/staff/partners').set(bearer(staff))).status).toBe(200);
  });

  it('only STAFF accounts can hold permissions', async () => {
    const b2c = await createUser({ role: ROLES.B2C });
    const res = await request(app).patch(`/api/admin/users/${b2c._id}/permissions`).set(auth).send({ permissions: [PERMISSIONS.USER_VIEW] });
    expect(res.status).toBe(409);
  });
});

describe('listing users and audit logs', () => {
  it('filters, searches, and paginates', async () => {
    await createUser({ role: ROLES.STAFF, name: 'Alpha Staff' });
    await createUser({ role: ROLES.B2C, name: 'Beta Traveller' });
    await createUser({ role: ROLES.B2C, name: 'Gamma Traveller' });

    const byRole = await request(app).get('/api/admin/users?role=B2C').set(auth);
    expect(byRole.body.data).toHaveLength(2);
    expect(byRole.body.meta.total).toBe(2);

    const search = await request(app).get('/api/admin/users?search=alpha').set(auth);
    expect(search.body.data.map((u) => u.name)).toEqual(['Alpha Staff']);

    const page = await request(app).get('/api/admin/users?limit=2&page=2').set(auth);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ total: 4, page: 2, limit: 2, totalPages: 2 });
  });

  it('never returns password hashes or token versions', async () => {
    await createUser();
    const res = await request(app).get('/api/admin/users').set(auth);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);
  });

  it('treats regex characters in search literally, and refuses operator injection in filters', async () => {
    await createUser({ name: 'Plain Name' });

    const regex = await request(app).get('/api/admin/users?search=.*').set(auth);
    expect(regex.status).toBe(200);
    expect(regex.body.data).toHaveLength(0);

    const injected = await request(app).get('/api/admin/users?role[$ne]=ADMIN').set(auth);
    expect(injected.status).toBe(422);

    expect((await request(app).get('/api/admin/users?status=NOPE').set(auth)).status).toBe(422);
  });

  it('lists audit logs, filterable by action', async () => {
    const target = await createUser();
    await request(app).patch(`/api/admin/users/${target._id}/status`).set(auth).send({ status: 'SUSPENDED' });

    const res = await request(app).get('/api/admin/audit-logs?action=ACCOUNT_SUSPENDED').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe('ACCOUNT_SUSPENDED');
  });
});
