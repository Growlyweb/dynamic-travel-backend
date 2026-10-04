const request = require('supertest');

const app = require('../../app');
const Partner = require('../../models/Partner');
const AuditLog = require('../../models/AuditLog');
const { ROLES, APPROVAL_STATUS } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { createUser, createB2B, bearer } = require('./helpers/factory');

describe('reviewing partner documents', () => {
  let partner;
  let owner;
  let docId;

  beforeEach(async () => {
    ({ user: owner, partner } = await createB2B({ approvalStatus: APPROVAL_STATUS.PENDING }));
    docId = partner.documents[0]._id;
  });

  const adminReview = (user, body, id = docId) =>
    request(app).patch(`/api/admin/b2b/${partner._id}/documents/${id}`).set(bearer(user)).send(body);
  const staffReview = (user, body, id = docId) =>
    request(app).patch(`/api/staff/partners/${partner._id}/documents/${id}`).set(bearer(user)).send(body);

  it('lets an admin verify a document, and records who did it', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    const res = await adminReview(admin, { status: 'VERIFIED' });

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ status: 'VERIFIED', type: 'TRADE_LICENSE' });
    expect(String(res.body.data[0].reviewedBy)).toBe(String(admin._id));

    const log = await AuditLog.findOne({ action: 'DOCUMENT_REVIEWED' });
    expect(String(log.actorUserId)).toBe(String(admin._id));
    expect(String(log.targetUserId)).toBe(String(owner._id));
    expect(log.meta).toMatchObject({ type: 'TRADE_LICENSE', from: 'PENDING', to: 'VERIFIED' });
  });

  it('lets staff with DOCUMENT_VERIFY reject a document with a note the owner can read', async () => {
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.DOCUMENT_VERIFY] });

    const res = await staffReview(staff, { status: 'REJECTED', note: 'Image is blurry' });
    expect(res.status).toBe(200);

    const mine = await request(app).get('/api/b2b/documents').set(bearer(owner));
    expect(mine.body.data[0]).toMatchObject({ status: 'REJECTED', reviewNote: 'Image is blurry' });
    expect(JSON.stringify(mine.body)).not.toMatch(/storagePath/);
  });

  it.each([
    ['no permissions', []],
    ['only DOCUMENT_VIEW', [PERMISSIONS.DOCUMENT_VIEW]],
    ['B2B_MANAGE but not DOCUMENT_VERIFY', [PERMISSIONS.B2B_MANAGE]]
  ])('refuses staff with %s', async (label, permissions) => {
    const staff = await createUser({ role: ROLES.STAFF, permissions });

    expect((await staffReview(staff, { status: 'VERIFIED' })).status).toBe(403);
    expect((await Partner.findById(partner._id)).documents[0].status).toBe('PENDING');
  });

  it('refuses the owner, other partners, and customers', async () => {
    const other = (await createB2B()).user;
    const b2c = await createUser({ role: ROLES.B2C });

    for (const user of [owner, other, b2c]) {
      expect((await adminReview(user, { status: 'VERIFIED' })).status).toBe(403);
      expect((await staffReview(user, { status: 'VERIFIED' })).status).toBe(403);
    }
    expect((await Partner.findById(partner._id)).documents[0].status).toBe('PENDING');
  });

  it('validates the status and the ids', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });

    expect((await adminReview(admin, { status: 'PENDING' })).status).toBe(422);
    expect((await adminReview(admin, { status: 'MAYBE' })).status).toBe(422);
    expect((await adminReview(admin, {})).status).toBe(422);
    expect((await adminReview(admin, { status: 'VERIFIED' }, '64b7f0f0f0f0f0f0f0f0f0f0')).status).toBe(404);
    expect((await adminReview(admin, { status: 'VERIFIED' }, 'not-an-id')).status).toBe(422);
  });

  it('is independent of the partner decision: verifying a document does not approve the partner', async () => {
    const admin = await createUser({ role: ROLES.ADMIN });
    await adminReview(admin, { status: 'VERIFIED' });

    expect((await Partner.findById(partner._id)).approvalStatus).toBe(APPROVAL_STATUS.PENDING);
    expect((await request(app).get('/api/b2b/overview').set(bearer(owner))).status).toBe(403);
  });
});
