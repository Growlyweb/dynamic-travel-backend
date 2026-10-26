const request = require('supertest');

const app = require('../../app');
const events = require('../../utils/events');
const mailer = require('../../utils/mailer');
const env = require('../../config/env');
const VisaStatusCode = require('../../models/VisaStatusCode');
const VisaApplication = require('../../models/VisaApplication');
const { bearer } = require('./helpers/factory');
const { createAdmin, createCatalog, applicationBody } = require('./helpers/visa');

const post = (path, body) => request(app).post(path).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const LINK = (ref) => `/api/visa/public/status/link/${ref}`;
const OTP = '/api/visa/public/status/otp';
const VERIFY = '/api/visa/public/status/verify';

const PHONE = '+8801712556340';

const create = async (admin, catalog, extra = {}) => {
  const res = await request(app).post('/api/visa/applications').set(bearer(admin)).send(applicationBody(catalog, { email: 'rahim@example.com', phone: PHONE, ...extra }));
  await events.idle();
  return res.body.data;
};
const details = (made, extra = {}) => ({ ref: made.number, passportNo: made.passport.number, phone: '01712 556340', ...extra });
const codeFor = (email) => [...mailer.outbox].reverse().find((m) => m.to_email === email && m.subject === 'Your visa status code');
const asking = async (made, extra = {}) => {
  mailer.outbox.length = 0;
  const res = await post(OTP, details(made, extra));
  return { res, mail: codeFor('rahim@example.com') };
};

describe('the status link', () => {
  it('is valid for a real application number, in any case, and not for an unknown one', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    expect((await request(app).get(LINK(made.number.toLowerCase()))).body.data).toEqual({ valid: true });
    expect((await request(app).get(LINK('VISA-2026-999999'))).body.data).toEqual({ valid: false });
  });
});

describe('asking for a status code', () => {
  it('emails a six digit code when the passport and the phone match, however the phone is written', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { res, mail } = await asking(made, { passportNo: made.passport.number.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resendInSeconds: env.otp.resendCooldownSeconds });
    expect(mail).toMatchObject({ to_name: 'Rahim Ahmed', passcode: expect.stringMatching(/^\d{6}$/) });
    expect(await VisaStatusCode.findOne()).toMatchObject({ tokenHash: expect.not.stringContaining(mail.passcode) });
  });

  it('answers NOT_FOUND when the passport or the phone does not match, and sends nothing', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    mailer.outbox.length = 0;
    for (const extra of [{ passportNo: 'ZZ999999' }, { phone: '01800000000' }, { ref: 'VISA-2026-999999' }]) {
      const res = await post(OTP, details(made, extra));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    expect(mailer.outbox.filter((m) => m.subject === 'Your visa status code')).toHaveLength(0);
  });

  it('answers SERVICE_UNAVAILABLE when the application has no email, or the mail fails', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const noMail = await create(admin, catalog, { email: undefined });
    expect((await post(OTP, details(noMail))).body.code).toBe('SERVICE_UNAVAILABLE');

    const withMail = await create(admin, catalog);
    jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('down'));
    const res = await post(OTP, details(withMail));
    jest.restoreAllMocks();
    expect(res.status).toBe(503);
    expect(await VisaStatusCode.countDocuments({ application: withMail._id })).toBe(0);
  });

  it('validates the input', async () => {
    expect((await post(OTP, { ref: '', passportNo: 'x', phone: '1' })).status).toBe(422);
    expect((await post(OTP, { ref: 'VISA-2026-000001' })).status).toBe(422);
  });

  it('keeps one live code per application: a new request replaces the old one', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    await asking(made);
    await asking(made);
    expect(await VisaStatusCode.countDocuments({ usedAt: null })).toBe(1);
  });
});

describe('checking the code', () => {
  it('shows the status in the shape of the storefront page, and a code works once', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { mail } = await asking(made);
    const res = await post(VERIFY, details(made, { otp: mail.passcode }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'submitted',
      applicationNo: made.number,
      applicant: { fullName: 'Rahim Ahmed' },
      country: { code: expect.any(String), name: expect.any(String) },
      visaType: 'Tourist Visa',
      entryType: 'Single Entry'
    });
    expect(res.body.data.events.submitted).toBeTruthy();
    expect((await post(VERIFY, details(made, { otp: mail.passcode }))).body.code).toBe('OTP_EXPIRED');
  });

  it('masks the passport and the phone', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { mail } = await asking(made);
    const { applicant } = (await post(VERIFY, details(made, { otp: mail.passcode }))).body.data;
    expect(applicant.passportNo).toMatch(/^BR\*+\d{2}$/);
    expect(applicant.passportNo).not.toBe(made.passport.number);
    expect(applicant.phone).toMatch(/^\+880\*+40$/);
  });

  it('answers INVALID_OTP for a wrong code and OTP_EXPIRED for an old one', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { mail } = await asking(made);
    const wrong = mail.passcode === '111111' ? '222222' : '111111';
    const bad = await post(VERIFY, details(made, { otp: wrong }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_OTP');
    expect((await post(VERIFY, details(made, { otp: '12345' }))).status).toBe(422);

    await VisaStatusCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await post(VERIFY, details(made, { otp: mail.passcode }))).body.code).toBe('OTP_EXPIRED');
  });

  it('refuses when the passport or phone is wrong', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { mail } = await asking(made);
    expect((await post(VERIFY, details(made, { otp: mail.passcode, passportNo: 'ZZ999999' }))).body.code).toBe('NOT_FOUND');
  });

  it('locks the link for 15 minutes after five wrong codes, even for the right code and for a new request', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    const { mail } = await asking(made);
    const wrong = mail.passcode === '111111' ? '222222' : '111111';
    for (let i = 0; i < env.otp.maxAttempts - 1; i += 1) expect((await post(VERIFY, details(made, { otp: wrong }))).body.code).toBe('INVALID_OTP');
    const locked = await post(VERIFY, details(made, { otp: wrong }));
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: 'TOO_MANY_ATTEMPTS', retryAfter: 900 });

    const right = await post(VERIFY, details(made, { otp: mail.passcode }));
    expect(right.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(right.body.retryAfter).toBeLessThanOrEqual(900);
    expect((await post(OTP, details(made))).body.code).toBe('TOO_MANY_ATTEMPTS');

    await VisaStatusCode.updateMany({}, { lockedUntil: new Date(Date.now() - 1000) });
    expect((await post(OTP, details(made))).status).toBe(200);
  });
});

describe('the status view', () => {
  const view = async (made) => {
    const { mail } = await asking(made);
    return (await post(VERIFY, details(made, { otp: mail.passcode }))).body.data;
  };

  it('maps statuses to the stages of the storefront page and dates each stage reached', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    for (const status of ['under_review', 'processing', 'submitted_to_embassy', 'approved']) await patch(admin, `/api/visa/applications/${made._id}/status`, { status });
    const data = await view(made);
    expect(data.status).toBe('approved');
    expect(Object.keys(data.events).sort()).toEqual(['approved', 'processing', 'submitted']);

    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'passport_ready' });
    expect((await view(made)).status).toBe('ready');
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'completed' });
    const done = await view(made);
    expect(done.status).toBe('collected');
    expect(Object.keys(done.events)).toEqual(expect.arrayContaining(['ready', 'collected']));
  });

  it('shows the stops: documents required, rejected and cancelled, each with its own date', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const one = await create(admin, catalog);
    await patch(admin, `/api/visa/applications/${one._id}/status`, { status: 'under_review' });
    await patch(admin, `/api/visa/applications/${one._id}/status`, { status: 'action_required', customerMessage: 'Send a clearer photo' });
    const asked = await view(one);
    expect(asked.status).toBe('docs_required');
    expect(asked.events.docs_required).toBeTruthy();

    const two = await create(admin, catalog);
    await patch(admin, `/api/visa/applications/${two._id}/status`, { status: 'rejected', customerReason: 'Not enough funds', internalReason: 'Forged statement' });
    const rejected = await view(two);
    expect(rejected.status).toBe('rejected');
    expect(rejected.events.rejected).toBeTruthy();
    expect(JSON.stringify(rejected)).not.toContain('Forged statement');

    const three = await create(admin, catalog);
    await patch(admin, `/api/visa/applications/${three._id}/status`, { status: 'cancelled' });
    const cancelled = await view(three);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.events.cancelled).toBeTruthy();
  });

  it('never contains money, staff names, internal notes, the email or the full passport and phone', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog(), { advancePaid: 1000, paymentMethod: 'Cash', vendorList: [{ name: 'Secret Vendor', service: 'visa', price: 5000 }] });
    await request(app).post(`/api/visa/applications/${made._id}/notes`).set(bearer(admin)).send({ type: 'internal', text: 'Customer is difficult' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    const data = await view(made);
    const text = JSON.stringify(data);
    for (const secret of ['Admin Person', 'Secret Vendor', 'difficult', made.passport.number, '1712556340', 'advancePaid', 'dueAmount', 'payments', 'vendor', 'rahim@example.com', 'byUserId', 'storagePath']) {
      expect(text).not.toContain(secret);
    }
  });
});

const view = async (made) => {
  const { mail } = await asking(made);
  return (await post(VERIFY, details(made, { otp: mail.passcode }))).body.data;
};

describe('a status staff added', () => {
  it('maps through its category', async () => {
    const admin = await createAdmin();
    const made = await create(admin, await createCatalog());
    await request(app).post('/api/visa/statuses').set(bearer(admin)).send({ key: 'waiting_for_embassy', displayName: 'Waiting for embassy', category: 'in_progress' });
    await VisaApplication.updateOne({ _id: made._id }, { status: 'waiting_for_embassy' });
    expect((await view(made)).status).toBe('processing');
  });
});
