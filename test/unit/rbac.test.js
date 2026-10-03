const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');
const User = require('../../models/User');
const Partner = require('../../models/Partner');
const { ROLES, APPROVAL_STATUS } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { createUser, createB2B, createRoleSet, bearer } = require('./helpers/factory');

// Every role against every protected route group. 200 = allowed, 403 = wrong role, 401 = no token.
const MATRIX = [
  // path                      ADMIN STAFF B2B   B2C
  ['/api/auth/me', 200, 200, 200, 200],
  ['/api/admin/users', 200, 403, 403, 403],
  ['/api/admin/b2b', 200, 403, 403, 403],
  ['/api/admin/audit-logs', 200, 403, 403, 403],
  ['/api/admin/rbac', 200, 403, 403, 403],
  ['/api/staff/profile', 403, 200, 403, 403],
  ['/api/b2b/profile', 403, 403, 200, 403],
  ['/api/b2b/documents', 403, 403, 200, 403],
  ['/api/b2b/overview', 403, 403, 200, 403],
  ['/api/b2c/profile', 403, 403, 403, 200]
];

describe('role matrix', () => {
  let users;
  beforeEach(async () => {
    users = await createRoleSet();
  });

  it.each(MATRIX)('%s -> ADMIN %i, STAFF %i, B2B %i, B2C %i', async (url, admin, staff, b2b, b2c) => {
    const expected = { admin, staff, b2b, b2c };

    for (const [name, status] of Object.entries(expected)) {
      const res = await request(app).get(url).set(bearer(users[name]));
      expect({ role: name, status: res.status }).toEqual({ role: name, status });
    }
  });

  it.each(MATRIX)('%s rejects anonymous requests with 401', async (url) => {
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('a B2C user cannot reach any other role area by sending extra fields', async () => {
    const res = await request(app).get('/api/admin/users?role=ADMIN').set(bearer(users.b2c));
    expect(res.status).toBe(403);
  });
});

describe('permission checks (STAFF)', () => {
  it('denies a staff member who was given no permissions', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [] });
    const res = await request(app).get('/api/staff/partners').set(bearer(staff));
    expect(res.status).toBe(403);
  });

  it('denies a staff member who holds a different permission', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const res = await request(app).get('/api/staff/partners').set(bearer(staff));
    expect(res.status).toBe(403);
  });

  it('allows the staff member who holds the permission, and applies a revocation immediately', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.B2B_VIEW] });
    await createB2B();

    const ok = await request(app).get('/api/staff/partners').set(bearer(staff));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(1);

    await User.updateOne({ _id: staff._id }, { permissions: [] });
    const revoked = await request(app).get('/api/staff/partners').set(bearer(staff));
    expect(revoked.status).toBe(403);
  });
});

describe('B2B partner approval gate', () => {
  it.each([
    [APPROVAL_STATUS.PENDING, 403],
    [APPROVAL_STATUS.UNDER_REVIEW, 403],
    [APPROVAL_STATUS.REJECTED, 403],
    [APPROVAL_STATUS.SUSPENDED, 403],
    [APPROVAL_STATUS.APPROVED, 200]
  ])('operational routes with a %s partner -> %i', async (approvalStatus, expected) => {
    const { user } = await createB2B({ approvalStatus });

    const res = await request(app).get('/api/b2b/overview').set(bearer(user));
    expect(res.status).toBe(expected);
    if (expected === 403) expect(res.body.code).toBe('PARTNER_NOT_APPROVED');

    // profile and documents stay available while the application is reviewed
    expect((await request(app).get('/api/b2b/profile').set(bearer(user))).status).toBe(200);
    expect((await request(app).get('/api/b2b/documents').set(bearer(user))).status).toBe(200);
  });

  it('a B2B account with no partner record is treated as not approved', async () => {
    const user = await createUser({ role: ROLES.B2B });
    expect((await request(app).get('/api/b2b/overview').set(bearer(user))).status).toBe(403);
  });
});

describe('profiles', () => {
  it('only lets a user change whitelisted fields of their OWN profile', async () => {
    const b2c = await createUser({ role: ROLES.B2C });
    const other = await createUser({ role: ROLES.B2C });

    const res = await request(app)
      .patch('/api/b2c/profile')
      .set(bearer(b2c))
      .send({
        name: 'New Name',
        role: ROLES.ADMIN,
        status: 'ACTIVE',
        permissions: [PERMISSIONS.USER_MANAGE],
        partnerId: '64b7f0f0f0f0f0f0f0f0f0f0',
        email: 'hijack@example.com',
        _id: String(other._id)
      });

    expect(res.status).toBe(200);
    const stored = await User.findById(b2c._id);
    expect(stored.name).toBe('New Name');
    expect(stored.role).toBe(ROLES.B2C);
    expect(stored.permissions).toEqual([]);
    expect(stored.email).toBe(b2c.email);
    expect(stored.partnerId).toBeUndefined();
    expect((await User.findById(other._id)).name).not.toBe('New Name');
  });

  it('marks a changed phone number as unverified', async () => {
    const user = await createUser({ role: ROLES.B2C, phone: '+8801711111111', phoneVerified: true });

    const res = await request(app).patch('/api/b2c/profile').set(bearer(user)).send({ phone: '+8801722222222' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ phone: '+8801722222222', phoneVerified: false });
  });

  it('lets a B2B owner edit contact details but never company name or license number', async () => {
    const { user, partner } = await createB2B();

    const res = await request(app)
      .patch('/api/b2b/profile')
      .set(bearer(user))
      .send({
        address: '12 Gulshan Ave',
        companyName: 'Renamed Ltd',
        licenseNo: 'STOLEN-1',
        approvalStatus: APPROVAL_STATUS.APPROVED
      });

    expect(res.status).toBe(200);
    const stored = await Partner.findById(partner._id);
    expect(stored.address).toBe('12 Gulshan Ave');
    expect(stored.companyName).toBe(partner.companyName);
    expect(stored.licenseNo).toBe(partner.licenseNo);
  });

  it('rejects an invalid phone with 422', async () => {
    const user = await createUser({ role: ROLES.B2C });
    const res = await request(app).patch('/api/b2c/profile').set(bearer(user)).send({ phone: 'abc' });
    expect(res.status).toBe(422);
  });
});

describe('private document download (ownership)', () => {
  let owner;
  let partner;
  let docUrl;

  beforeEach(async () => {
    ({ user: owner, partner } = await createB2B());
    const dir = path.join(env.storage.privateDir, 'partners');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'missing.pdf'), '%PDF-1.4 secret');
    docUrl = `/api/documents/partners/${partner._id}/${partner.documents[0]._id}`;
  });

  it('lets the owning B2B user download, as an attachment, never cached', async () => {
    const res = await request(app).get(docUrl).set(bearer(owner));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('answers 404 for another partner, so the document does not appear to exist', async () => {
    const { user: stranger } = await createB2B();
    expect((await request(app).get(docUrl).set(bearer(stranger))).status).toBe(404);
  });

  it('answers 404 for a B2C user and 401 for anonymous', async () => {
    const b2c = await createUser({ role: ROLES.B2C });
    expect((await request(app).get(docUrl).set(bearer(b2c))).status).toBe(404);
    expect((await request(app).get(docUrl)).status).toBe(401);
  });

  it('allows ADMIN, and STAFF only with DOCUMENT_VIEW', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    const plainStaff = await createUser({ role: ROLES.STAFF });
    const docStaff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.DOCUMENT_VIEW] });

    expect((await request(app).get(docUrl).set(bearer(admin))).status).toBe(200);
    expect((await request(app).get(docUrl).set(bearer(plainStaff))).status).toBe(404);
    expect((await request(app).get(docUrl).set(bearer(docStaff))).status).toBe(200);
  });

  it('answers 404 for an unknown document id and for a stored path that escapes the private folder', async () => {
    expect(
      (await request(app).get(`/api/documents/partners/${partner._id}/64b7f0f0f0f0f0f0f0f0f0f0`).set(bearer(owner))).status
    ).toBe(404);

    await Partner.updateOne({ _id: partner._id }, { 'documents.0.storagePath': '../../../../etc/passwd' });
    expect((await request(app).get(docUrl).set(bearer(owner))).status).toBe(404);
  });

  it('is not reachable through the public /uploads folder', async () => {
    expect((await request(app).get('/uploads/partners/missing.pdf')).status).toBe(404);
    expect((await request(app).get('/storage/private/partners/missing.pdf')).status).toBe(404);
  });
});
