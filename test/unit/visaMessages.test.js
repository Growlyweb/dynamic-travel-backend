const request = require('supertest');

const app = require('../../app');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');
const events = require('../../utils/events');
const mailer = require('../../utils/mailer');
const AuditLog = require('../../models/AuditLog');
const VisaMessage = require('../../models/VisaMessage');
const { createUser, bearer } = require('./helpers/factory');
const { createAdmin, createVisaStaff, createCatalog, applicationBody } = require('./helpers/visa');

const post = (user, path, body) => request(app).post(path).set(bearer(user)).send(body);
const patch = (user, path, body) => request(app).patch(path).set(bearer(user)).send(body);
const get = (user, path) => request(app).get(path).set(bearer(user));

const template = (user, body) => post(user, '/api/visa/templates', { name: 'Under Review', channel: 'sms', trigger: 'under_review', message: 'Dear {{applicantName}}, {{applicationNumber}} is under review.', ...body });
const application = async (admin, catalog, overrides) => (await post(admin, '/api/visa/applications', applicationBody(catalog, overrides))).body.data;
const messagesOf = async (admin, id) => (await get(admin, `/api/visa/messages?applicationId=${id}&limit=50`)).body.data;

describe('message templates', () => {
  it('creates, lists, changes and deletes templates', async () => {
    const admin = await createAdmin();
    const sms = await template(admin);
    expect(sms.status).toBe(201);
    expect(sms.body.data).toMatchObject({ channel: 'sms', trigger: 'under_review', active: true, subject: '' });
    expect(sms.body.data.nameKey).toBeUndefined();

    const email = await template(admin, { name: 'Under Review', channel: 'email', subject: 'Update on {{applicationNumber}}' });
    expect(email.status).toBe(201);

    expect((await get(admin, '/api/visa/templates')).body.data).toHaveLength(2);
    expect((await get(admin, '/api/visa/templates?channel=email')).body.data).toHaveLength(1);

    const off = await patch(admin, `/api/visa/templates/${sms.body.data._id}`, { active: false });
    expect(off.body.data.active).toBe(false);
    expect((await get(admin, '/api/visa/templates?active=false')).body.data).toHaveLength(1);

    expect((await request(app).delete(`/api/visa/templates/${sms.body.data._id}`).set(bearer(admin))).status).toBe(200);
    expect((await patch(admin, `/api/visa/templates/${sms.body.data._id}`, { active: true })).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'VISA_TEMPLATE_CHANGED' })).toBe(4);
  });

  it('refuses an email without a subject, an unknown status and a word that cannot be filled in', async () => {
    const admin = await createAdmin();
    const noSubject = await template(admin, { channel: 'email' });
    expect(noSubject.status).toBe(422);
    expect(noSubject.body.errors[0].field).toBe('body.subject');

    expect((await template(admin, { trigger: 'flying' })).body.code).toBe('UNKNOWN_STATUS');

    const typo = await template(admin, { message: 'Dear {{applicantNam}}, hello' });
    expect(typo.status).toBe(422);
    expect(typo.body.code).toBe('UNKNOWN_VARIABLE');
    expect(typo.body.message).toContain('{{applicantNam}}');
  });

  it('refuses a second template with the same name for the same channel only', async () => {
    const admin = await createAdmin();
    await template(admin);
    expect((await template(admin, { name: ' under  review ' })).body.code).toBe('TEMPLATE_EXISTS');
    expect((await template(admin, { channel: 'email', subject: 'Hello' })).status).toBe(201);
  });

  it('accepts a template for a status staff added', async () => {
    const admin = await createAdmin();
    await post(admin, '/api/visa/statuses', { displayName: 'Waiting for Slot', category: 'in_progress' });
    expect((await template(admin, { name: 'Slot', trigger: 'waiting_for_slot' })).status).toBe(201);
  });

  it('checks the new text when only the message changes', async () => {
    const admin = await createAdmin();
    const made = await template(admin);
    expect((await patch(admin, `/api/visa/templates/${made.body.data._id}`, { message: 'Hello {{nope}}' })).body.code).toBe('UNKNOWN_VARIABLE');
    expect((await patch(admin, `/api/visa/templates/${made.body.data._id}`, { channel: 'email' })).status).toBe(422);
  });
});

describe('messages made when an application changes status', () => {
  afterEach(() => jest.restoreAllMocks());

  it('prepares an SMS for staff to send, with the words filled in', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await template(admin);
    const made = await application(admin, catalog);
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await events.idle();

    const [message] = await messagesOf(admin, made._id);
    expect(message).toMatchObject({ channel: 'sms', status: 'pending', source: 'auto', provider: 'manual', templateName: 'Under Review', trigger: 'under_review', to: '+8801712556340', toName: 'Rahim Ahmed' });
    expect(message.body).toBe(`Dear Rahim Ahmed, ${made.number} is under review.`);

    const full = await get(admin, `/api/visa/applications/${made._id}`);
    expect(full.body.data.timeline.find((t) => t.event === 'SMS prepared')).toMatchObject({ visibility: 'internal' });
  });

  it('sends an email at once through the mail service when the application is created', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await template(admin, { name: 'Received', channel: 'email', trigger: 'submitted', subject: 'We got {{applicationNumber}}', message: 'Hi {{applicantName}}. Track: {{trackingUrl}} Status: {{status}}' });
    const made = await application(admin, catalog, { email: 'rahim@example.com' });
    await events.idle();

    const [message] = await messagesOf(admin, made._id);
    expect(message).toMatchObject({ channel: 'email', status: 'sent', source: 'auto', to: 'rahim@example.com', subject: `We got ${made.number}`, provider: 'memory' });
    expect(message.body).toContain(`/visa-status/${made.number}`);
    expect(message.body).toContain('Status: Submitted');

    const mail = require('../../utils/mailer').outbox.find((m) => m.to_email === 'rahim@example.com' && m.subject === `We got ${made.number}`);
    expect(mail).toMatchObject({ to_name: 'Rahim Ahmed', title: `We got ${made.number}` });
  });

  it('does nothing for a template that is switched off or for another status', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const off = await template(admin, { name: 'Off', active: false });
    await template(admin, { name: 'Other', trigger: 'processing' });
    const made = await application(admin, catalog);
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await events.idle();
    expect(await messagesOf(admin, made._id)).toHaveLength(0);

    await patch(admin, `/api/visa/templates/${off.body.data._id}`, { active: true });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'action_required', customerMessage: 'x' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await events.idle();
    expect(await messagesOf(admin, made._id)).toHaveLength(1);
  });

  it('records a failed email with its reason and does not break the status change', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await template(admin, { name: 'Mail', channel: 'email', subject: 'Hi', message: 'Hello {{applicantName}}' });
    jest.spyOn(mailer, 'send').mockRejectedValue(new Error('EmailJS responded 429: limit reached'));
    const made = await application(admin, catalog);
    const changed = await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await events.idle();

    expect(changed.status).toBe(200);
    const [message] = await messagesOf(admin, made._id);
    expect(message).toMatchObject({ channel: 'email', status: 'failed', error: 'EmailJS responded 429: limit reached' });
    const full = await get(admin, `/api/visa/applications/${made._id}`);
    expect(full.body.data.timeline.some((t) => t.event === 'Email failed')).toBe(true);
  });

  it('records an email for an applicant without an address as failed, so staff can see it', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    await template(admin, { name: 'Mail', channel: 'email', subject: 'Hi', message: 'Hello' });
    const made = await application(admin, catalog, { email: '' });
    await patch(admin, `/api/visa/applications/${made._id}/status`, { status: 'under_review' });
    await events.idle();
    const [message] = await messagesOf(admin, made._id);
    expect(message).toMatchObject({ status: 'failed', error: 'The applicant has no email address.' });
  });
});

describe('writing a message by hand', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends an email at once and logs who sent it', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog, { email: 'rahim@example.com' });
    const res = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'email', subject: 'About {{applicationNumber}}', message: 'Please call us, {{applicantName}}.' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ channel: 'email', status: 'sent', source: 'manual', subject: `About ${made.number}`, body: 'Please call us, Rahim Ahmed.', createdByName: 'Admin Person', sentByName: 'Admin Person', templateName: 'Custom message' });
    expect(await AuditLog.countDocuments({ action: 'VISA_MESSAGE_CREATED' })).toBe(1);
  });

  it('prepares an SMS, or logs it as sent when the person already sent it', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog);
    const prepared = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'Call us about {{applicationNumber}}' });
    expect(prepared.body.data).toMatchObject({ status: 'pending', provider: 'manual', body: `Call us about ${made.number}` });
    const sent = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'Done', markSent: true });
    expect(sent.body.data).toMatchObject({ status: 'sent', sentByName: 'Admin Person' });
    expect(sent.body.data.sentAt).toBeTruthy();
  });

  it('uses a template, and lets the person change its words', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog);
    const tpl = await template(admin);
    const plain = await post(admin, `/api/visa/applications/${made._id}/messages`, { templateId: tpl.body.data._id });
    expect(plain.body.data).toMatchObject({ templateName: 'Under Review', trigger: 'under_review', channel: 'sms' });
    const edited = await post(admin, `/api/visa/applications/${made._id}/messages`, { templateId: tpl.body.data._id, message: 'Edited for {{applicantName}}' });
    expect(edited.body.data.body).toBe('Edited for Rahim Ahmed');
  });

  it('refuses a message that cannot be sent', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog, { email: '' });
    const url = `/api/visa/applications/${made._id}/messages`;
    const tpl = await template(admin);

    expect((await post(admin, url, { channel: 'email', subject: 'Hi', message: 'x' })).body.code).toBe('NO_EMAIL');
    expect((await post(admin, url, { channel: 'sms', message: 'Hi {{oops}}' })).body.code).toBe('UNKNOWN_VARIABLE');
    expect((await post(admin, url, { templateId: tpl.body.data._id, channel: 'email' })).body.code).toBe('CHANNEL_MISMATCH');
    expect((await post(admin, url, {})).status).toBe(422);
    expect((await post(admin, url, { channel: 'sms' })).status).toBe(422);
    expect((await post(admin, '/api/visa/applications/6ac0a5f0eebc510147c67250/messages', { channel: 'sms', message: 'x' })).status).toBe(404);
    const withEmail = await application(admin, catalog, { email: 'a@example.com' });
    expect((await post(admin, `/api/visa/applications/${withEmail._id}/messages`, { channel: 'email', message: 'No subject' })).status).toBe(422);
  });
});

describe('marking and resending', () => {
  afterEach(() => jest.restoreAllMocks());

  const prepared = async (admin, catalog) => {
    const made = await application(admin, catalog, { email: 'rahim@example.com' });
    const sms = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'Hello' });
    return { made, sms: sms.body.data };
  };

  it('marks an SMS as sent by hand, with who and when, and keeps it sent', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { made, sms } = await prepared(admin, catalog);

    const res = await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'sent' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'sent', sentByName: 'Admin Person' });
    expect(res.body.data.sentAt).toBeTruthy();
    expect((await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'failed', error: 'x' })).body.code).toBe('MESSAGE_ALREADY_SENT');

    const full = await get(admin, `/api/visa/applications/${made._id}`);
    expect(full.body.data.timeline.some((t) => t.event === 'SMS sent')).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'VISA_MESSAGE_UPDATED' })).toBe(1);
  });

  it('needs a reason to mark failed, and allows a failed SMS to be marked sent later', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const { sms } = await prepared(admin, catalog);

    expect((await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'failed' })).status).toBe(422);
    const failed = await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'failed', error: 'Phone was off' });
    expect(failed.body.data).toMatchObject({ status: 'failed', error: 'Phone was off' });
    expect((await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'failed', error: 'again' })).body.code).toBe('INVALID_MESSAGE_CHANGE');
    const sent = await patch(admin, `/api/visa/messages/${sms._id}`, { status: 'sent' });
    expect(sent.body.data).toMatchObject({ status: 'sent', error: '' });
  });

  it('does not let staff mark an email by hand, and answers 404 for an unknown message', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog, { email: 'rahim@example.com' });
    const mail = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'email', subject: 'Hi', message: 'x' });
    expect((await patch(admin, `/api/visa/messages/${mail.body.data._id}`, { status: 'sent' })).body.code).toBe('NOT_AN_SMS');
    expect((await patch(admin, '/api/visa/messages/6ac0a5f0eebc510147c67250', { status: 'sent' })).status).toBe(404);
  });

  it('sends a failed email again, and refuses one that was sent', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog, { email: 'rahim@example.com' });
    const spy = jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('network down'));
    const failed = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'email', subject: 'Hi', message: 'x' });
    expect(failed.body.data).toMatchObject({ status: 'failed', error: 'network down' });

    const again = await post(admin, `/api/visa/messages/${failed.body.data._id}/send`, {});
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ status: 'sent', error: '', sentByName: 'Admin Person' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await post(admin, `/api/visa/messages/${failed.body.data._id}/send`, {})).body.code).toBe('MESSAGE_ALREADY_SENT');

    const sms = await post(admin, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'x' });
    expect((await post(admin, `/api/visa/messages/${sms.body.data._id}/send`, {})).body.code).toBe('NOT_AN_EMAIL');
  });
});

describe('the message log', () => {
  it('filters by application, channel, status and search, and pages', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const one = await application(admin, catalog, { name: 'Karim Uddin', email: 'k@example.com' });
    const two = await application(admin, catalog, { name: 'Salma Begum' });
    await post(admin, `/api/visa/applications/${one._id}/messages`, { channel: 'sms', message: 'a' });
    await post(admin, `/api/visa/applications/${one._id}/messages`, { channel: 'email', subject: 's', message: 'b' });
    await post(admin, `/api/visa/applications/${two._id}/messages`, { channel: 'sms', message: 'c', markSent: true });

    const count = async (query) => (await get(admin, `/api/visa/messages?${query}`)).body.data.length;
    expect(await count('')).toBe(3);
    expect(await count(`applicationId=${one._id}`)).toBe(2);
    expect(await count('channel=sms')).toBe(2);
    expect(await count('status=pending')).toBe(1);
    expect(await count('status=sent')).toBe(2);
    expect(await count('search=salma')).toBe(1);
    expect(await count(`search=${two.number}`)).toBe(1);
    const page = await get(admin, '/api/visa/messages?limit=2&page=2');
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2 });
    expect(await VisaMessage.countDocuments()).toBe(3);
  });

  it('is readable with VISA_VIEW but only changeable with VISA_EDIT', async () => {
    const admin = await createAdmin();
    const catalog = await createCatalog();
    const made = await application(admin, catalog);
    const reader = await createUser({ role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] });
    const editor = await createVisaStaff();

    expect((await get(reader, '/api/visa/messages')).status).toBe(200);
    expect((await get(reader, '/api/visa/templates')).status).toBe(200);
    expect((await post(reader, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'x' })).status).toBe(403);
    expect((await template(reader)).status).toBe(403);
    expect((await post(editor, `/api/visa/applications/${made._id}/messages`, { channel: 'sms', message: 'x' })).status).toBe(201);
  });
});
