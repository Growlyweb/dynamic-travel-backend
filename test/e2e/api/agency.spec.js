const { test, expect } = require('../helpers/test');
const {
  cfg, bearer, mailCount, waitForMail, pdf, file, json,
  agencyForm, signUpAgency, signUpCustomer, adminSession, createStaff, login
} = require('../helpers/api');

const documentUrl = (partnerId, docId) => `/api/documents/partners/${partnerId}/${docId}`;

test.describe('agency registration rules', () => {
  test('a trade license is required, and a bad upload leaves no account behind', async ({ client }) => {
    const ctx = await client();

    const noLicense = agencyForm();
    delete noLicense.tradeLicense;
    const missing = await ctx.post('/api/auth/b2b/register', { multipart: noLicense });
    expect(missing.status()).toBe(422);
    expect((await json(missing)).errors[0].field).toBe('tradeLicense');

    const html = agencyForm({}, { tradeLicense: file('evil.html', Buffer.from('<script>alert(1)</script>'), 'text/html') });
    const rejected = await ctx.post('/api/auth/b2b/register', { multipart: html });
    expect(rejected.status()).toBe(400);
    expect((await json(rejected)).code).toBe('FILE_TYPE_NOT_ALLOWED');

    const stray = agencyForm({}, { passportScan: file('x.pdf', pdf('stray')) });
    expect((await ctx.post('/api/auth/b2b/register', { multipart: stray })).status()).toBe(400);

    // none of the three attempts created anything
    for (const form of [noLicense, html, stray]) {
      expect((await login(ctx, form.email, cfg.PASSWORD)).res.status()).toBe(401);
    }
  });

  test('address, a strong password, a unique license and a unique email are all enforced', async ({ client }) => {
    const ctx = await client();
    const first = await signUpAgency(ctx);

    const noAddress = await ctx.post('/api/auth/b2b/register', { multipart: agencyForm({ address: '' }) });
    expect(noAddress.status()).toBe(422);
    expect((await json(noAddress)).errors.some((e) => e.field === 'body.address')).toBe(true);

    const weak = await ctx.post('/api/auth/b2b/register', { multipart: agencyForm({ password: 'weak' }) });
    expect(weak.status()).toBe(422);

    const sameLicense = await ctx.post('/api/auth/b2b/register', { multipart: agencyForm({ licenseNo: first.form.licenseNo }) });
    expect(sameLicense.status()).toBe(409);
    expect((await json(sameLicense)).code).toBe('LICENSE_TAKEN');

    const sameEmail = await ctx.post('/api/auth/b2b/register', { multipart: agencyForm({ email: first.form.email }) });
    expect(sameEmail.status()).toBe(409);
  });

  test('role and approval status in the form are ignored', async ({ client }) => {
    const ctx = await client();
    const { user, partner } = await signUpAgency(ctx, { role: 'ADMIN', status: 'ACTIVE', approvalStatus: 'APPROVED' });

    expect(user.role).toBe('B2B');
    expect(partner.approvalStatus).toBe('PENDING');
  });
});

test.describe('agency approval lifecycle, with real file download', () => {
  test('register, wait for approval, get approved, and only the right people can download the document', async ({ client }) => {
    const anon = await client();
    const adminCtx = await client();
    const agencyCtx = await client();
    const admin = await adminSession(adminCtx);

    // --- the agency registers and verifies its email
    const agency = await signUpAgency(agencyCtx);
    expect(agency.partner.documents).toHaveLength(1);
    expect(agency.partner.documents[0]).toMatchObject({ type: 'TRADE_LICENSE', status: 'PENDING', originalName: 'trade-license.pdf' });
    expect(JSON.stringify(agency.body)).not.toMatch(/storagePath/); // the internal path is never exposed
    const partnerId = agency.partner._id;
    const docId = agency.partner.documents[0]._id;

    // --- logged in, but the operational routes are closed until approval
    const closed = await agencyCtx.get('/api/b2b/overview', { headers: bearer(agency.token) });
    expect(closed.status()).toBe(403);
    expect((await json(closed)).code).toBe('PARTNER_NOT_APPROVED');
    expect((await agencyCtx.get('/api/b2b/profile', { headers: bearer(agency.token) })).status()).toBe(200);

    // --- admin finds it, verifies the document, approves
    const list = await adminCtx.get('/api/admin/b2b?approvalStatus=PENDING&limit=100', { headers: bearer(admin.token) });
    expect((await json(list)).data.some((p) => p._id === partnerId)).toBe(true);

    const review = await adminCtx.patch(`/api/admin/b2b/${partnerId}/documents/${docId}`, { headers: bearer(admin.token), data: { status: 'VERIFIED', note: 'Checked against the registry.' } });
    expect(review.status()).toBe(200);

    const mark = mailCount();
    const approve = await adminCtx.patch(`/api/admin/b2b/${partnerId}/approval`, { headers: bearer(admin.token), data: { decision: 'APPROVED', note: 'Welcome aboard' } });
    expect(approve.status()).toBe(200);
    expect((await json(approve)).data).toMatchObject({ approvalStatus: 'APPROVED', reviewNote: 'Welcome aboard' });
    expect((await waitForMail(agency.form.email, { after: mark })).message).toMatch(/APPROVED/);

    // --- the same token now opens the operational route
    const open = await agencyCtx.get('/api/b2b/overview', { headers: bearer(agency.token) });
    expect(open.status()).toBe(200);
    expect((await json(open)).data).toMatchObject({ companyName: agency.form.companyName, approvalStatus: 'APPROVED' });

    // --- the owner sees the review result on the document
    const mine = await json(await agencyCtx.get('/api/b2b/documents', { headers: bearer(agency.token) }));
    expect(mine.data[0]).toMatchObject({ status: 'VERIFIED', reviewNote: 'Checked against the registry.' });

    // --- download: the owner gets the exact bytes, as an attachment that is never cached
    const owned = await agencyCtx.get(documentUrl(partnerId, docId), { headers: bearer(agency.token) });
    expect(owned.status()).toBe(200);
    expect(owned.headers()['content-disposition']).toMatch(/attachment; filename="trade-license\.pdf"/);
    expect(owned.headers()['cache-control']).toMatch(/no-store/);
    expect(Buffer.compare(await owned.body(), agency.form.tradeLicense.buffer)).toBe(0);

    // --- everyone else is refused, and refused the same way as "does not exist"
    const otherAgency = await signUpAgency(await client());
    const customer = await signUpCustomer(await client());
    expect((await anon.get(documentUrl(partnerId, docId))).status()).toBe(401);
    expect((await anon.get(documentUrl(partnerId, docId), { headers: bearer(otherAgency.token) })).status()).toBe(404);
    expect((await anon.get(documentUrl(partnerId, docId), { headers: bearer(customer.token) })).status()).toBe(404);
    expect((await anon.get(documentUrl(partnerId, '64b7f0f0f0f0f0f0f0f0f0f0'), { headers: bearer(admin.token) })).status()).toBe(404);

    // --- admin and staff who hold DOCUMENT_VIEW can; staff without it cannot
    expect((await adminCtx.get(documentUrl(partnerId, docId), { headers: bearer(admin.token) })).status()).toBe(200);
    const plain = await createStaff(admin.token, { permissions: [] });
    const viewer = await createStaff(admin.token, { permissions: ['DOCUMENT_VIEW'] });
    expect((await anon.get(documentUrl(partnerId, docId), { headers: bearer(plain.token) })).status()).toBe(404);
    expect((await anon.get(documentUrl(partnerId, docId), { headers: bearer(viewer.token) })).status()).toBe(200);

    // --- after approval the documents are locked
    const late = await agencyCtx.post('/api/b2b/documents', { headers: bearer(agency.token), multipart: { otherDocuments: file('late.pdf', pdf('late')) } });
    expect(late.status()).toBe(409);
    expect((await json(late)).code).toBe('DOCUMENTS_LOCKED');
  });

  test('a rejected agency stays closed, can add a document, and can still be approved later', async ({ client }) => {
    const adminCtx = await client();
    const agencyCtx = await client();
    const admin = await adminSession(adminCtx);
    const agency = await signUpAgency(agencyCtx);
    const partnerId = agency.partner._id;

    const reject = await adminCtx.patch(`/api/admin/b2b/${partnerId}/approval`, { headers: bearer(admin.token), data: { decision: 'REJECTED', note: 'Please upload a clearer copy.' } });
    expect(reject.status()).toBe(200);
    expect((await agencyCtx.get('/api/b2b/overview', { headers: bearer(agency.token) })).status()).toBe(403);
    expect((await agencyCtx.get('/api/b2b/profile', { headers: bearer(agency.token) })).status()).toBe(200); // can still log in and see why

    const extra = await agencyCtx.post('/api/b2b/documents', { headers: bearer(agency.token), multipart: { businessCard: file('card.pdf', pdf('card')) } });
    expect(extra.status()).toBe(201);
    expect((await json(extra)).data.map((d) => d.type).sort()).toEqual(['BUSINESS_CARD', 'TRADE_LICENSE']);

    const approve = await adminCtx.patch(`/api/admin/b2b/${partnerId}/approval`, { headers: bearer(admin.token), data: { decision: 'APPROVED' } });
    expect(approve.status()).toBe(200);
    expect((await agencyCtx.get('/api/b2b/overview', { headers: bearer(agency.token) })).status()).toBe(200);
  });

  test('only an admin can decide: the agency, a customer and staff with every permission cannot', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const agency = await signUpAgency(await client());
    const customer = await signUpCustomer(await client());
    const staff = await createStaff(admin.token, { permissions: ['B2B_VIEW', 'B2B_MANAGE', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'] });
    const url = `/api/admin/b2b/${agency.partner._id}/approval`;

    for (const who of [agency, customer, staff]) {
      const res = await ctx.patch(url, { headers: bearer(who.token), data: { decision: 'APPROVED' } });
      expect(res.status()).toBe(403);
    }
    expect((await ctx.patch(url, { data: { decision: 'APPROVED' } })).status()).toBe(401);

    // none of those attempts changed anything: read the live record as the admin
    const live = await json(await ctx.get(`/api/admin/b2b/${agency.partner._id}`, { headers: bearer(admin.token) }));
    expect(live.data.approvalStatus).toBe('PENDING');
    expect((await ctx.get('/api/b2b/overview', { headers: bearer(agency.token) })).status()).toBe(403);
  });
});

test.describe('staff and agency documents', () => {
  test('staff with DOCUMENT_VERIFY can review a document, staff without it cannot, and the owner sees the note', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const agency = await signUpAgency(await client());
    const verifier = await createStaff(admin.token, { permissions: ['DOCUMENT_VERIFY'] });
    const bystander = await createStaff(admin.token, { permissions: ['DOCUMENT_VIEW'] });
    const url = `/api/staff/partners/${agency.partner._id}/documents/${agency.partner.documents[0]._id}`;

    expect((await ctx.patch(url, { headers: bearer(bystander.token), data: { status: 'VERIFIED' } })).status()).toBe(403);
    const ok = await ctx.patch(url, { headers: bearer(verifier.token), data: { status: 'REJECTED', note: 'Image is blurry' } });
    expect(ok.status()).toBe(200);

    const mine = await json(await ctx.get('/api/b2b/documents', { headers: bearer(agency.token) }));
    expect(mine.data[0]).toMatchObject({ status: 'REJECTED', reviewNote: 'Image is blurry' });
    // reviewing a document is not approving the agency
    expect((await ctx.get('/api/b2b/overview', { headers: bearer(agency.token) })).status()).toBe(403);
  });
});
