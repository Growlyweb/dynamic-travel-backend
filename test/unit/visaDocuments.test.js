const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const { PRIVATE_ROOT } = require('../../utils/file');
const AuditLog = require('../../models/AuditLog');
const settingService = require('../../services/settingService');
const { createUser, createB2B, bearer } = require('./helpers/factory');
const { createAdmin, createVisaStaff, createCatalog, applicationBody } = require('./helpers/visa');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);

const setup = async (options) => {
  const admin = await createAdmin();
  const catalog = await createCatalog(options);
  const made = await request(app).post('/api/visa/applications').set(bearer(admin)).send(applicationBody(catalog));
  return { admin, catalog, id: made.body.data._id };
};

const upload = (user, id, { type = 'Passport Copy', buffer = PDF, filename = 'passport.pdf', contentType = 'application/pdf', fields = {} } = {}) => {
  let req = request(app).post(`/api/visa/applications/${id}/documents`).set(bearer(user)).field('type', type);
  Object.entries(fields).forEach(([key, value]) => {
    req = req.field(key, value);
  });
  return req.attach('file', buffer, { filename, contentType });
};

const storedFiles = () => {
  const dir = path.join(PRIVATE_ROOT, 'visa');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
};

describe('uploading a document', () => {
  it('stores the file privately and answers without its storage path', async () => {
    const { admin, id } = await setup();
    const res = await upload(admin, id);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'Passport Copy', originalName: 'passport.pdf', mimeType: 'application/pdf', status: 'pending', uploadedByName: 'Admin Person' });
    expect(res.body.data.storagePath).toBeUndefined();
    expect(storedFiles()).toHaveLength(1);

    const full = await request(app).get(`/api/visa/applications/${id}`).set(bearer(admin));
    expect(full.body.data.documents).toHaveLength(1);
    expect(full.body.data.documents[0].storagePath).toBeUndefined();
    expect(full.body.data.timeline[0]).toMatchObject({ event: 'Document Uploaded', visibility: 'both' });
    expect(await AuditLog.countDocuments({ action: 'VISA_DOCUMENT_UPLOADED' })).toBe(1);
  });

  it('refuses a file whose content is not what it claims, and stores nothing', async () => {
    const { admin, id } = await setup();
    const html = Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(60));
    const res = await upload(admin, id, { buffer: html, filename: 'evil.pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(storedFiles()).toHaveLength(0);
  });

  it('refuses a missing file, a missing type and a file over the limit in the settings', async () => {
    const { admin, id } = await setup();
    const noFile = await request(app).post(`/api/visa/applications/${id}/documents`).set(bearer(admin)).field('type', 'Photo');
    expect(noFile.body.code).toBe('FILE_REQUIRED');
    const noType = await request(app).post(`/api/visa/applications/${id}/documents`).set(bearer(admin)).attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(noType.status).toBe(422);

    await settingService.set({ id: admin._id }, 'visa.documents', { maxSizeMb: 1, allowedTypes: ['pdf', 'png'], maxFilesPerItem: 5 });
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 5, 1)]);
    const res = await upload(admin, id, { buffer: big });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(storedFiles()).toHaveLength(0);
  });

  it('follows the allowed types from the settings', async () => {
    const { admin, id } = await setup();
    await settingService.set({ id: admin._id }, 'visa.documents', { maxSizeMb: 10, allowedTypes: ['pdf'], maxFilesPerItem: 5 });
    const res = await upload(admin, id, { buffer: PNG, filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('limits the number of files kept for one item, and a rejected file does not count', async () => {
    const { admin, id } = await setup();
    await settingService.set({ id: admin._id }, 'visa.documents', { maxSizeMb: 10, allowedTypes: ['pdf'], maxFilesPerItem: 2 });
    const one = await upload(admin, id);
    await upload(admin, id);
    const third = await upload(admin, id);
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('TOO_MANY_FILES');
    expect((await upload(admin, id, { type: 'Photo' })).status).toBe(201);

    await request(app).patch(`/api/visa/applications/${id}/documents/${one.body.data._id}`).set(bearer(admin)).send({ status: 'rejected', reviewNote: 'Blurry' });
    expect((await upload(admin, id)).status).toBe(201);
  });

  it('uses the size limit of the checklist item when it is lower', async () => {
    const { admin, catalog, id } = await setup();
    const saved = await request(app)
      .put(`/api/visa/checklists/${catalog.country._id}/${catalog.type._id}/individual`)
      .set(bearer(admin))
      .send({ items: [{ label: 'Tiny file', maxSizeMb: 1 }] });
    const itemId = saved.body.data.items[0]._id;
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 5, 1)]);
    expect((await upload(admin, id, { type: 'Tiny file', buffer: big, fields: { checklistItemId: itemId } })).status).toBe(413);
    expect((await upload(admin, id, { type: 'Tiny file', fields: { checklistItemId: '6ac0a5f0eebc510147c67250' } })).body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
  });

  it('answers 404 for an unknown application and 403 to people without VISA_EDIT', async () => {
    const { id } = await setup();
    const admin = await createAdmin();
    expect((await upload(admin, '6ac0a5f0eebc510147c67250')).status).toBe(404);
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const { user: partner } = await createB2B();
    expect((await upload(reader, id)).status).toBe(403);
    expect((await upload(partner, id)).status).toBe(403);
    expect(storedFiles()).toHaveLength(0);
  });
});

describe('downloading a document', () => {
  it('sends the file with safe headers to staff with VISA_VIEW and DOCUMENT_VIEW', async () => {
    const { admin, id } = await setup();
    const staff = await createVisaStaff();
    const up = await upload(admin, id);
    const url = `/api/visa/applications/${id}/documents/${up.body.data._id}/file`;

    const res = await request(app).get(url).set(bearer(staff)).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.equals(PDF)).toBe(true);
    expect(res.headers).toMatchObject({ 'content-type': 'application/pdf', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['content-disposition']).toContain('passport.pdf');
  });

  it('refuses staff without DOCUMENT_VIEW, customers, partners and visitors', async () => {
    const { admin, id } = await setup();
    const up = await upload(admin, id);
    const url = `/api/visa/applications/${id}/documents/${up.body.data._id}/file`;
    const noDocs = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const customer = await createUser({ role: ROLES.B2C });
    const { user: partner } = await createB2B();

    for (const user of [noDocs, customer, partner]) expect((await request(app).get(url).set(bearer(user))).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('answers 404 for a missing document and when the stored file has disappeared', async () => {
    const { admin, id } = await setup();
    const up = await upload(admin, id);
    expect((await request(app).get(`/api/visa/applications/${id}/documents/6ac0a5f0eebc510147c67250/file`).set(bearer(admin))).status).toBe(404);

    fs.rmSync(path.join(PRIVATE_ROOT, 'visa'), { recursive: true, force: true });
    const gone = await request(app).get(`/api/visa/applications/${id}/documents/${up.body.data._id}/file`).set(bearer(admin));
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('FILE_MISSING');
  });
});

describe('reviewing and deleting a document', () => {
  it('verifies, rejects with a note for the applicant, and logs both', async () => {
    const { admin, id } = await setup();
    const up = await upload(admin, id);
    const docUrl = `/api/visa/applications/${id}/documents/${up.body.data._id}`;

    const noNote = await request(app).patch(docUrl).set(bearer(admin)).send({ status: 'rejected' });
    expect(noNote.status).toBe(422);

    const rejected = await request(app).patch(docUrl).set(bearer(admin)).send({ status: 'rejected', reviewNote: 'Photo is blurry' });
    expect(rejected.body.data.documents[0]).toMatchObject({ status: 'rejected', reviewNote: 'Photo is blurry' });
    expect(rejected.body.data.timeline[0]).toMatchObject({ event: 'Document Rejected', visibility: 'both', message: 'Passport Copy: Photo is blurry' });

    const verified = await request(app).patch(docUrl).set(bearer(admin)).send({ status: 'verified' });
    expect(verified.body.data.documents[0]).toMatchObject({ status: 'verified', reviewNote: '' });
    expect(await AuditLog.countDocuments({ action: 'VISA_DOCUMENT_REVIEWED' })).toBe(2);
  });

  it('needs DOCUMENT_VERIFY to review', async () => {
    const { admin, id } = await setup();
    const up = await upload(admin, id);
    const editor = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });
    const res = await request(app).patch(`/api/visa/applications/${id}/documents/${up.body.data._id}`).set(bearer(editor)).send({ status: 'verified' });
    expect(res.status).toBe(403);
  });

  it('deletes the record and the stored file together', async () => {
    const { admin, id } = await setup();
    const up = await upload(admin, id);
    expect(storedFiles()).toHaveLength(1);
    const res = await request(app).delete(`/api/visa/applications/${id}/documents/${up.body.data._id}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.documents).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
    expect((await request(app).delete(`/api/visa/applications/${id}/documents/${up.body.data._id}`).set(bearer(admin))).status).toBe(404);
  });
});

describe('passport handling', () => {
  const patchPassport = (user, id, body) => request(app).patch(`/api/visa/applications/${id}/passport`).set(bearer(user)).send(body);

  it('follows an office submission through its statuses', async () => {
    const { admin, id } = await setup({ physical: true });
    const received = await patchPassport(admin, id, { passportStatus: 'received_at_office', details: { receivedDate: '2026-10-01', receivedBy: 'Ahmed Karim', remarks: 'Two blank pages' } });
    expect(received.status).toBe(200);
    expect(received.body.data).toMatchObject({ passportStatus: 'received_at_office', passportReceived: { receivedBy: 'Ahmed Karim' } });
    expect(received.body.data.timeline[0].event).toBe('Passport Received at Office');

    const next = await patchPassport(admin, id, { passportStatus: 'submitted_to_embassy', note: 'Courier 4411' });
    expect(next.body.data.timeline[0]).toMatchObject({ event: 'Passport: Submitted To Embassy', message: 'Courier 4411' });

    const collected = await patchPassport(admin, id, { passportStatus: 'picked_up', details: { collectorName: 'Rahim', collectedDate: '2026-10-20' } });
    expect(collected.body.data.passportCollection.collectorName).toBe('Rahim');
  });

  it('runs a pickup request from request to assignment', async () => {
    const { admin, id } = await setup({ physical: true, pickup: true });
    const staff = await createVisaStaff();

    expect((await patchPassport(admin, id, { pickupRequest: { address: 'x' } })).body.code).toBe('INVALID_PASSPORT_CHANGE');
    const method = await patchPassport(admin, id, { passportSubmissionMethod: 'pickup' });
    expect(method.body.data).toMatchObject({ passportSubmissionMethod: 'pickup', passportStatus: 'not_received' });

    const requested = await patchPassport(admin, id, { pickupRequest: { locationType: 'Home', contactName: 'Rahim', phone: '01712556340', address: 'House 42, Dhanmondi', preferredDate: '2026-10-30' } });
    expect(requested.body.data).toMatchObject({ passportStatus: 'pickup_requested', pickupRequest: { status: 'requested', address: 'House 42, Dhanmondi' } });

    const assigned = await patchPassport(admin, id, { assignedStaff: String(staff._id) });
    expect(assigned.body.data).toMatchObject({ passportStatus: 'assigned', pickupRequest: { status: 'assigned', assignedStaffName: 'Staff Person' } });
    expect((await patchPassport(admin, id, { assignedStaff: String((await createUser({ role: ROLES.B2C }))._id) })).body.code).toBe('INVALID_STAFF');
  });

  it('only allows the methods the visa type allows', async () => {
    const online = await setup();
    expect((await patchPassport(online.admin, online.id, { passportSubmissionMethod: 'pickup' })).status).toBe(409);
    expect((await patchPassport(online.admin, online.id, { passportStatus: 'received_at_office' })).status).toBe(409);

    const physical = await setup({ physical: true });
    expect((await patchPassport(physical.admin, physical.id, { passportSubmissionMethod: 'online' })).status).toBe(409);
    expect((await patchPassport(physical.admin, physical.id, { passportStatus: 'not_required' })).status).toBe(409);
    expect((await patchPassport(physical.admin, physical.id, { passportStatus: 'flying' })).status).toBe(422);
  });

  it('needs PASSPORT_UPDATE', async () => {
    const { id } = await setup({ physical: true });
    const staff = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_EDIT] });
    expect((await patchPassport(staff, id, { passportStatus: 'received_at_office' })).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: 'VISA_PASSPORT_UPDATED' })).toBe(0);
  });
});
