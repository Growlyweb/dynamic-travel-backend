const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../app');
const env = require('../config/env');
const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const { ROLES, USER_STATUS, APPROVAL_STATUS } = require('../config/constants');
const { PASSWORD, createUser, createB2B, bearer, lastEmailTo } = require('./helpers/factory');

const PDF = Buffer.from('%PDF-1.4 test document');

const LICENSE = { field: 'tradeLicense', name: 'license.pdf', type: 'application/pdf' };

// multipart B2B registration. Each file is { field, name, type }. Pass `files: []` for none.
const registerB2B = ({ files = [LICENSE], ...overrides } = {}) => {
  const fields = {
    name: 'Karim Hossain',
    email: 'karim@agency.com',
    phone: '+8801811111111',
    password: PASSWORD,
    companyName: 'Sky Travels Ltd',
    licenseNo: 'TL-2024-0042',
    businessType: 'Travel agency',
    address: '45 Motijheel, Dhaka',
    ...overrides
  };

  let req = request(app).post('/api/auth/b2b/register');
  Object.entries(fields).forEach(([key, value]) => {
    req = req.field(key, value);
  });
  files.forEach((file) => {
    req = req.attach(file.field, PDF, { filename: file.name, contentType: file.type });
  });
  return req;
};

const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const privateDocs = () => filesIn(path.join(env.storage.privateDir, 'partners'));

describe('B2B registration', () => {
  it('creates a PENDING user and a PENDING partner, storing typed documents in the private folder', async () => {
    const res = await registerB2B({
      files: [LICENSE, { field: 'businessCard', name: 'card.pdf', type: 'application/pdf' }]
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ role: ROLES.B2B, status: USER_STATUS.PENDING });
    expect(res.body.data.partner).toMatchObject({ companyName: 'Sky Travels Ltd', approvalStatus: APPROVAL_STATUS.PENDING });
    expect(res.body.data.partner.documents.map((d) => d.type).sort()).toEqual(['BUSINESS_CARD', 'TRADE_LICENSE']);

    // The storage path is internal and never sent to clients
    expect(JSON.stringify(res.body)).not.toMatch(/storagePath|partners\//);

    expect(privateDocs()).toHaveLength(2);

    const user = await User.findOne({ email: 'karim@agency.com' });
    expect(String(user.partnerId)).toBe(res.body.data.partner._id);
    expect(lastEmailTo('karim@agency.com').otp).toMatch(/^\d{6}$/);
  });

  it('ignores role, status and approval fields sent by the client', async () => {
    const res = await registerB2B({ role: 'ADMIN', status: 'ACTIVE', approvalStatus: 'APPROVED', permissions: 'USER_MANAGE' });

    expect(res.status).toBe(201);
    const user = await User.findOne({ email: 'karim@agency.com' });
    expect(user.role).toBe(ROLES.B2B);
    expect(user.status).toBe(USER_STATUS.PENDING);
    expect((await Partner.findOne({ userId: user._id })).approvalStatus).toBe(APPROVAL_STATUS.PENDING);
  });

  it('requires a trade license: a business card alone is not enough, and nothing is left behind', async () => {
    const none = await registerB2B({ files: [] });
    expect(none.status).toBe(422);
    expect(none.body.errors[0].field).toBe('tradeLicense');

    const cardOnly = await registerB2B({ files: [{ field: 'businessCard', name: 'card.pdf', type: 'application/pdf' }] });
    expect(cardOnly.status).toBe(422);

    expect(await User.countDocuments()).toBe(0);
    expect(privateDocs()).toHaveLength(0);
  });

  it('treats the business card as optional', async () => {
    const res = await registerB2B({ files: [LICENSE] });
    expect(res.status).toBe(201);
    expect(res.body.data.partner.documents).toHaveLength(1);
  });

  it('requires an address (the business requirements list it as mandatory)', async () => {
    const res = await registerB2B({ address: '' });
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'body.address')).toBe(true);
    expect(privateDocs()).toHaveLength(0);
  });

  it('rejects a disallowed file type and leaves nothing on disk', async () => {
    const res = await registerB2B({ files: [{ field: 'tradeLicense', name: 'evil.html', type: 'text/html' }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await User.countDocuments()).toBe(0);
    expect(privateDocs()).toHaveLength(0);
  });

  it('rejects files sent in an unknown field', async () => {
    const res = await registerB2B({ files: [LICENSE, { field: 'passportScan', name: 'x.pdf', type: 'application/pdf' }] });

    expect(res.status).toBe(400);
    expect(privateDocs()).toHaveLength(0);
  });

  it('rejects invalid fields (422) and deletes the files multer already saved', async () => {
    const res = await registerB2B({ companyName: '', password: 'weak' });

    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['body.password', 'body.companyName']));
    expect(await User.countDocuments()).toBe(0);
    expect(privateDocs()).toHaveLength(0);
  });

  it('rejects a duplicate license number without creating a user, and cleans up files', async () => {
    await registerB2B();
    const before = privateDocs().length;

    const dup = await registerB2B({ email: 'second@agency.com', phone: '+8801822222222' });

    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('LICENSE_TAKEN');
    expect(await User.countDocuments({ email: 'second@agency.com' })).toBe(0);
    expect(privateDocs()).toHaveLength(before);
  });

  it('rejects a duplicate email and cleans up files', async () => {
    await registerB2B();
    const before = privateDocs().length;

    const dup = await registerB2B({ licenseNo: 'TL-OTHER', phone: '+8801833333333' });

    expect(dup.status).toBe(409);
    expect(await Partner.countDocuments()).toBe(1);
    expect(privateDocs()).toHaveLength(before);
  });

  it('after email verification the owner can log in, but is still not approved', async () => {
    await registerB2B();
    const { otp } = lastEmailTo('karim@agency.com');

    const verify = await request(app).post('/api/auth/verify-otp').send({ email: 'karim@agency.com', otp });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.status).toBe(USER_STATUS.ACTIVE);

    const headers = { Authorization: `Bearer ${verify.body.data.accessToken}` };
    const me = await request(app).get('/api/auth/me').set(headers);
    expect(me.body.data.partner.approvalStatus).toBe(APPROVAL_STATUS.PENDING);
    expect((await request(app).get('/api/b2b/overview').set(headers)).status).toBe(403);
  });
});

describe('admin review of a partner', () => {
  let admin;
  let auth;
  let owner;
  let partner;

  beforeEach(async () => {
    admin = await createUser({ role: ROLES.ADMIN });
    auth = bearer(admin);
    ({ user: owner, partner } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING }));
  });

  const decide = (body, id = partner._id) => request(app).patch(`/api/admin/b2b/${id}/approval`).set(auth).send(body);

  it('approves: operational access opens, the decision is audited, and the owner is emailed', async () => {
    expect((await request(app).get('/api/b2b/overview').set(bearer(owner))).status).toBe(403);

    const res = await decide({ decision: 'APPROVED', note: 'Documents verified' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ approvalStatus: 'APPROVED', reviewNote: 'Documents verified' });
    expect(String(res.body.data.reviewedBy)).toBe(String(admin._id));

    expect((await request(app).get('/api/b2b/overview').set(bearer(owner))).status).toBe(200);

    const log = await AuditLog.findOne({ action: 'B2B_APPROVED' });
    expect(String(log.actorUserId)).toBe(String(admin._id));
    expect(String(log.targetUserId)).toBe(String(owner._id));
    expect(log.meta).toMatchObject({ from: 'PENDING', to: 'APPROVED' });
    expect(lastEmailTo(owner.email).message).toMatch(/APPROVED/);
  });

  it('rejects, and the owner loses nothing but operational access', async () => {
    const res = await decide({ decision: 'REJECTED', note: 'License expired' });

    expect(res.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'B2B_REJECTED' })).toBe(1);
    expect((await request(app).get('/api/b2b/overview').set(bearer(owner))).status).toBe(403);
    expect((await request(app).get('/api/b2b/profile').set(bearer(owner))).status).toBe(200);
  });

  it('suspends an approved partner and records a status change', async () => {
    await decide({ decision: 'APPROVED' });
    await decide({ decision: 'SUSPENDED', note: 'Chargeback dispute' });

    expect((await request(app).get('/api/b2b/overview').set(bearer(owner))).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: 'B2B_STATUS_CHANGED' })).toBe(1);
  });

  it('will not approve a partner without a trade license, even with other documents', async () => {
    const { partner: empty } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING, withDocument: false });
    await Partner.updateOne(
      { _id: empty._id },
      { $push: { documents: { type: 'BUSINESS_CARD', originalName: 'c.pdf', mimeType: 'application/pdf', size: 1, storagePath: 'partners/c.pdf' } } }
    );

    const res = await decide({ decision: 'APPROVED' }, empty._id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRADE_LICENSE_MISSING');
    expect((await Partner.findById(empty._id)).approvalStatus).toBe(APPROVAL_STATUS.PENDING);
  });

  it('validates the decision and the id', async () => {
    expect((await decide({ decision: 'PENDING' })).status).toBe(422);
    expect((await decide({ decision: 'MAYBE' })).status).toBe(422);
    expect((await decide({})).status).toBe(422);
    expect((await decide({ decision: 'APPROVED' }, '64b7f0f0f0f0f0f0f0f0f0f0')).status).toBe(404);
  });

  it('is closed to everyone except ADMIN (a B2B owner cannot approve themselves)', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: ['B2B_MANAGE', 'B2B_VIEW'] });

    for (const who of [owner, staff]) {
      const res = await request(app).patch(`/api/admin/b2b/${partner._id}/approval`).set(bearer(who)).send({ decision: 'APPROVED' });
      expect(res.status).toBe(403);
    }
    expect((await Partner.findById(partner._id)).approvalStatus).toBe(APPROVAL_STATUS.PENDING);
  });

  it('lists and filters partners', async () => {
    await createB2B({ approvalStatus: APPROVAL_STATUS.APPROVED });

    const all = await request(app).get('/api/admin/b2b').set(auth);
    expect(all.body.meta.total).toBe(2);

    const pending = await request(app).get('/api/admin/b2b?approvalStatus=PENDING').set(auth);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].userId).toMatchObject({ email: owner.email });

    const byName = await request(app).get(`/api/admin/b2b?search=${encodeURIComponent(partner.companyName)}`).set(auth);
    expect(byName.body.data).toHaveLength(1);

    expect((await request(app).get('/api/admin/b2b?approvalStatus[$ne]=X').set(auth)).status).toBe(422);
  });
});

describe('B2B document uploads by the owner', () => {
  const upload = (user, files) => {
    let req = request(app).post('/api/b2b/documents').set(bearer(user));
    files.forEach((file) => {
      req = req.attach(file.field || 'tradeLicense', PDF, { filename: file.name, contentType: file.type });
    });
    return req;
  };

  it('adds a typed document while the application is open', async () => {
    const { user } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING, withDocument: false });

    const res = await upload(user, [{ name: 'trade.pdf', type: 'application/pdf' }]);

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ originalName: 'trade.pdf', type: 'TRADE_LICENSE' });
    expect(privateDocs()).toHaveLength(1);
  });

  it('lets a partner that registered without a license add one, after which approval works', async () => {
    const { user, partner } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING, withDocument: false });
    const admin = await createUser({ role: ROLES.ADMIN });
    const approve = () =>
      request(app).patch(`/api/admin/b2b/${partner._id}/approval`).set(bearer(admin)).send({ decision: 'APPROVED' });

    expect((await approve()).status).toBe(409);
    await upload(user, [{ name: 'trade.pdf', type: 'application/pdf' }]);
    expect((await approve()).status).toBe(200);
  });

  it('is allowed again after a rejection', async () => {
    const { user } = await createB2B({ approvalStatus: APPROVAL_STATUS.REJECTED });
    expect((await upload(user, [{ field: 'otherDocuments', name: 'new.pdf', type: 'application/pdf' }])).status).toBe(201);
  });

  it('is locked once approved, and the stray file is removed', async () => {
    const { user } = await createB2B({ approvalStatus: APPROVAL_STATUS.APPROVED });

    const res = await upload(user, [{ name: 'late.pdf', type: 'application/pdf' }]);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCUMENTS_LOCKED');
    expect(privateDocs()).toHaveLength(0);
  });

  it('requires at least one file and refuses other roles', async () => {
    const { user } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING });
    expect((await upload(user, [])).status).toBe(422);

    const b2c = await createUser({ role: ROLES.B2C });
    expect((await upload(b2c, [{ name: 'x.pdf', type: 'application/pdf' }])).status).toBe(403);
  });

  it('stores files under a generated name, never the client-supplied one', async () => {
    const { user } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING, withDocument: false });
    await upload(user, [{ name: '../../evil.pdf', type: 'application/pdf' }]);

    const [stored] = privateDocs();
    expect(stored).toMatch(/^evil-\d+-[0-9a-f]{12}\.pdf$/);
  });
});
