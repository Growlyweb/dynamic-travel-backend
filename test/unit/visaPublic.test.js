const request = require('supertest');

const app = require('../../app');
const events = require('../../utils/events');
const mailer = require('../../utils/mailer');
const env = require('../../config/env');
const VisaStatusCode = require('../../models/VisaStatusCode');
const VisaApplication = require('../../models/VisaApplication');
const { bearer } = require('./helpers/factory');
const { createAdmin, createCatalog, applicationBody } = require('./helpers/visa');

const post = (path, body, headers = {}) => request(app).post(path).set(headers).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const CODE = '/api/visa/public/status/code';
const VERIFY = '/api/visa/public/status/verify';

const create = async (admin, catalog, extra = {}) => {
  const res = await request(app).post('/api/visa/applications').set(bearer(admin)).send(applicationBody(catalog, { email: 'rahim@example.com', ...extra }));
  await events.idle();
  return res.body.data;
};
const codeFor = (email) => [...mailer.outbox].reverse().find((m) => m.to_email === email && m.subject === 'Your visa status code');
const asking = async (app1, email = 'rahim@example.com') => {
  mailer.outbox.length = 0;
  await post(CODE, { reference: app1.number, email });
  return codeFor(email);
};

describe('asking for a status code', () => {
  it('emails a six digit code to the address on the application', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const res = await post(CODE, { reference: made.number, email: 'Rahim@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If the details match/);
    const mail = codeFor('rahim@example.com');
    expect(mail).toMatchObject({ to_name: 'Rahim Ahmed', passcode: expect.stringMatching(/^\d{6}$/) });
    expect(mail.message).toContain(mail.passcode);
    expect(await VisaStatusCode.countDocuments()).toBe(1);
    expect(await VisaStatusCode.findOne()).toMatchObject({ tokenHash: expect.not.stringContaining(mail.passcode) });
  });

  it('answers the same for an unknown number or a wrong email, and sends nothing', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    mailer.outbox.length = 0;
    const unknown = await post(CODE, { reference: 'VISA-2026-999999', email: 'rahim@example.com' });
    const wrong = await post(CODE, { reference: made.number, email: 'someone@else.com' });
    const real = await post(CODE, { reference: made.number, email: 'rahim@example.com' });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(wrong.body);
    expect(Object.keys(real.body).sort()).toEqual(Object.keys(unknown.body).sort());
    expect(mailer.outbox.filter((m) => m.subject === 'Your visa status code')).toHaveLength(1);
  });

  it('validates the input, and a failing mail service does not change the answer', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    expect((await post(CODE, { reference: '', email: 'x' })).status).toBe(422);
    expect((await post(CODE, { reference: made.number })).status).toBe(422);
    jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('down'));
    const res = await post(CODE, { reference: made.number, email: 'rahim@example.com' });
    jest.restoreAllMocks();
    expect(res.status).toBe(200);
  });

  it('keeps one live code per application: a new request replaces the old one', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const first = await asking(made);
    const second = await asking(made);
    expect(await VisaStatusCode.countDocuments({ usedAt: null })).toBe(1);
    if (first.passcode !== second.passcode) expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: first.passcode })).status).toBe(400);
  });
});

describe('checking the code', () => {
  it('shows the status and gives a short token, and a code works once', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { passcode } = await asking(made);
    const res = await post(VERIFY, { reference: made.number.toLowerCase(), email: 'rahim@example.com', code: passcode });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      applicationNo: made.number,
      status: 'submitted',
      statusLabel: 'Submitted',
      applicant: { fullName: 'Rahim Ahmed' },
      visaType: 'Tourist Visa',
      stages: ['submitted', 'processing', 'approved', 'ready', 'collected'],
      expiresInSeconds: 900
    });
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.events.submitted).toBeTruthy();
    expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode })).status).toBe(400);
  });

  it('refuses a wrong code, an unknown number and a wrong email the same way', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { passcode } = await asking(made);
    const wrongCode = await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode === '111111' ? '222222' : '111111' });
    const unknown = await post(VERIFY, { reference: 'VISA-2026-999999', email: 'rahim@example.com', code: passcode });
    const wrongMail = await post(VERIFY, { reference: made.number, email: 'x@y.com', code: passcode });
    for (const res of [wrongCode, unknown, wrongMail]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_CODE', message: 'The code is invalid or has expired.' });
    }
    expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: '12345' })).status).toBe(422);
  });

  it('locks a code after five wrong tries, even for the right code', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { passcode } = await asking(made);
    const wrong = passcode === '111111' ? '222222' : '111111';
    for (let i = 0; i < env.otp.maxAttempts; i += 1) expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: wrong })).status).toBe(400);
    expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode })).status).toBe(400);
  });

  it('refuses an expired code', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { passcode } = await asking(made);
    await VisaStatusCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode })).status).toBe(400);
  });
});

describe('the status view', () => {
  const view = async (admin, made) => {
    const { passcode } = await asking(made);
    return (await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode })).body.data;
  };

  it('maps statuses to the stages of the storefront page and dates each stage reached', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    for (const status of ['under_review', 'processing', 'submitted_to_embassy', 'approved']) await patch(admin, `/api/visa/applications/${made._id}/status`, { status });
    const data = await view(admin, made);
    expect(data).toMatchObject({ status: 'approved', statusLabel: 'Approved' });
    expect(Object.keys(data.events).sort()).toEqual(['approved', 'processing', 'submitted']);
    expect(data.message).toContain('Congratulations');

    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'passport_ready' });
    expect((await view(admin, made)).status).toBe('ready');
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'completed' });
    const done = await view(admin, made);
    expect(done.status).toBe('collected');
    expect(Object.keys(done.events)).toEqual(expect.arrayContaining(['ready', 'collected']));
  });

  it('shows what is needed from the applicant, and the reason for a rejection', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const one = await create(admin, catalog);
    await patch(admin, `/api/visa/applications/${one._id}/status`, { status: 'under_review' });
    await patch(admin, `/api/visa/applications/${one._id}/status`, { status: 'action_required', customerMessage: 'Send a clearer photo' });
    const asked = await view(admin, one);
    expect(asked).toMatchObject({ status: 'docs_required', actionRequired: { message: 'Send a clearer photo' } });

    const two = await create(admin, catalog, { passportNumber: 'ZZ123123' });
    await patch(admin, `/api/visa/applications/${two._id}/status`, { status: 'rejected', customerReason: 'Not enough funds', internalReason: 'Forged statement' });
    const rejected = await view(admin, two);
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Not enough funds' });
    expect(JSON.stringify(rejected)).not.toContain('Forged statement');
  });

  it('never contains money, staff names, internal notes, contact data or passport numbers', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await create(admin, catalog, { advancePaid: 1000, paymentMethod: 'Cash', vendorList: [{ name: 'Secret Vendor', service: 'visa', price: 5000 }] });
    await request(app).post(`/api/visa/applications/${made._id}/notes`).set(bearer(admin)).send({ type: 'internal', text: 'Customer is difficult' });
    await request(app).post(`/api/visa/applications/${made._id}/notes`).set(bearer(admin)).send({ type: 'customer', text: 'We called you' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    const data = await view(admin, made);
    const text = JSON.stringify(data);
    for (const secret of ['Admin Person', 'Secret Vendor', 'difficult', '01712556340', 'BR', 'advancePaid', 'dueAmount', 'account', 'payments', 'vendor', 'rahim@example.com', 'byUserId', 'storagePath']) {
      expect(text).not.toContain(secret);
    }
    const events1 = data.timeline.map((t) => t.event);
    expect(events1).toEqual(expect.arrayContaining(['Under Review', 'Application Created', 'Customer Note Added']));
    expect(events1).not.toEqual(expect.arrayContaining(['Internal Note Added']));
    expect(events1).not.toContain('Payment received');
    expect(data.timeline[0].at).toBeTruthy();
    expect(Object.keys(data.timeline[0]).sort()).toEqual(['at', 'event', 'message']);
  });

  it('shows documents with only the note meant for the applicant', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    await VisaApplication.updateOne({ _id: made._id }, { $push: { documents: [{ type: 'Passport', originalName: 'p.pdf', mimeType: 'application/pdf', size: 1, storagePath: 'visa/x/y.pdf', status: 'rejected', reviewNote: 'Blurry, send again' }, { type: 'Photo', originalName: 'f.jpg', mimeType: 'image/jpeg', size: 1, storagePath: 'visa/x/z.jpg', status: 'verified', reviewNote: 'internal remark' }] } });
    const data = await view(admin, made);
    expect(data.documents).toEqual([{ type: 'Passport', status: 'rejected', reviewNote: 'Blurry, send again' }, { type: 'Photo', status: 'verified', reviewNote: '' }]);
    expect(JSON.stringify(data)).not.toContain('visa/x');
  });

  it('shows the passport step only for files that need a physical passport', async () => {
    const admin = await createAdmin();
    const online = await create(admin, await createCatalog());
    expect((await view(admin, online)).passport).toBeNull();
    const physical = await create(admin, await createCatalog({ physical: true }));
    expect((await view(admin, physical)).passport).toEqual({ submissionMethod: 'office', status: 'not_received' });
  });

  it('maps a status staff added through its category', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    await request(app).post('/api/visa/statuses').set(bearer(admin)).send({ displayName: 'Waiting for Slot', category: 'in_progress', customerMessage: 'We wait for an appointment.' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'waiting_for_slot' });
    const data = await view(admin, made);
    expect(data).toMatchObject({ status: 'processing', statusLabel: 'Waiting for Slot', message: 'We wait for an appointment.' });
  });
});

describe('refreshing with the token', () => {
  it('returns the status again for that application only, and expires', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const one = await create(admin, catalog);
    const two = await create(admin, catalog, { passportNumber: 'ZZ999000' });
    const { passcode } = await asking(one);
    const token = (await post(VERIFY, { reference: one.number, email: 'rahim@example.com', code: passcode })).body.data.accessToken;

    const ok = await request(app).get(`/api/visa/public/status/${one.number}`).set('X-Status-Token', token);
    expect(ok.status).toBe(200);
    expect(ok.body.data.applicationNo).toBe(one.number);
    expect(ok.body.data.accessToken).toBeUndefined();

    expect((await request(app).get(`/api/visa/public/status/${two.number}`).set('X-Status-Token', token)).status).toBe(401);
    expect((await request(app).get(`/api/visa/public/status/${one.number}`)).status).toBe(401);
    expect((await request(app).get(`/api/visa/public/status/${one.number}`).set('X-Status-Token', 'nonsense')).status).toBe(401);

    const jwt = require('jsonwebtoken');
    const old = jwt.sign({ sub: one._id, ref: one.number }, env.jwt.accessSecret, { audience: 'visa-status', expiresIn: -10 });
    expect((await request(app).get(`/api/visa/public/status/${one.number}`).set('X-Status-Token', old)).status).toBe(401);
    const wrongAudience = jwt.sign({ sub: one._id, ref: one.number }, env.jwt.accessSecret, { expiresIn: '5m' });
    expect((await request(app).get(`/api/visa/public/status/${one.number}`).set('X-Status-Token', wrongAudience)).status).toBe(401);
  });

  it('is not a way into the staff routes', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { passcode } = await asking(made);
    const token = (await post(VERIFY, { reference: made.number, email: 'rahim@example.com', code: passcode })).body.data.accessToken;
    expect((await request(app).get('/api/visa/applications').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await request(app).get(`/api/visa/applications/${made._id}`).set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });
});
