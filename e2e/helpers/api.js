// Helpers for the API end-to-end tests. Everything goes over real HTTP to a real server process.
const fs = require('fs');
const { request: playwrightRequest } = require('@playwright/test');
const cfg = require('../config');

const unique = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const emailFor = (prefix = 'user') => `${unique(prefix)}@e2e.test`;
const phoneFor = () => `+8801${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// A tiny valid PDF. The bytes are checked after a download to prove the right file came back.
const pdf = (label = 'license') => Buffer.from(`%PDF-1.4\n% e2e ${label} ${unique('pdf')}\n%%EOF\n`);
const file = (name, buffer, mimeType = 'application/pdf') => ({ name, mimeType, buffer });

// ---------------------------------------------------------------- mail (the server writes e-mails to a file)

const readMail = () =>
  fs
    .readFileSync(cfg.MAIL_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const mailCount = () => readMail().length;

// Waits for an e-mail to `to`. Pass `after: mailCount()` taken BEFORE the action to ignore older mail.
const waitForMail = async (to, { after = 0, subject, timeout = 8000 } = {}) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const mail = readMail()
      .slice(after)
      .reverse()
      .find((m) => m.to_email === to && (!subject || m.subject.includes(subject)));
    if (mail) return mail;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No e-mail to ${to}${subject ? ` about "${subject}"` : ''} arrived within ${timeout} ms`);
};

// ---------------------------------------------------------------- clients (each has its own cookie jar)

const newClient = (baseURL = cfg.API_URL, options = {}) => playwrightRequest.newContext({ baseURL, ...options });

const json = async (response) => response.json();

// ---------------------------------------------------------------- accounts

const registerCustomer = async (ctx, overrides = {}) => {
  const account = { name: 'E2E Customer', email: emailFor('cust'), password: cfg.PASSWORD, ...overrides };
  const mark = mailCount();
  const res = await ctx.post('/api/auth/register', { data: account });
  return { ...account, res, mark };
};

// Registers, reads the code from the mailbox, verifies. The client then holds the refresh cookie.
const signUpCustomer = async (ctx, overrides = {}) => {
  const account = await registerCustomer(ctx, overrides);
  const mail = await waitForMail(account.email, { after: account.mark });
  const verify = await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: mail.otp } });
  const body = await json(verify);
  return { ...account, verify, token: body.data.accessToken, user: body.data.user };
};

const login = async (ctx, email, password = cfg.PASSWORD) => {
  const res = await ctx.post('/api/auth/login', { data: { email, password } });
  const body = await json(res);
  return { res, body, token: body.data && body.data.accessToken, user: body.data && body.data.user };
};

const adminSession = async (ctx) => {
  const { token, user } = await login(ctx, cfg.ADMIN.email, cfg.ADMIN.password);
  return { token, user };
};

// Admin creates staff, the invitation e-mail carries a token, the person sets a password and logs in.
const createStaff = async (adminToken, { permissions = [], ctx } = {}) => {
  const client = ctx || (await newClient());
  const email = emailFor('staff');
  const mark = mailCount();
  const created = await client.post('/api/admin/staff', { headers: bearer(adminToken), data: { name: 'E2E Staff', email, permissions } });
  const invite = await waitForMail(email, { after: mark });
  const inviteToken = /token=([0-9a-f]+)/.exec(invite.message)[1];
  const setup = await client.post('/api/auth/setup-account', { data: { token: inviteToken, password: cfg.PASSWORD } });
  const session = await login(client, email);
  return { email, created, setup, ...session, inviteToken, ctx: client };
};

const agencyForm = (overrides = {}, files = {}) => ({
  name: 'E2E Agent',
  email: emailFor('agency'),
  phone: phoneFor(),
  password: cfg.PASSWORD,
  companyName: 'E2E Travels Ltd',
  licenseNo: unique('LIC').toUpperCase(),
  businessType: 'Travel agency',
  address: '45 Motijheel, Dhaka',
  tradeLicense: file('trade-license.pdf', pdf('trade')),
  ...overrides,
  ...files
});

// Registers an agency and verifies its email. Returns the license bytes so a download can be compared.
const signUpAgency = async (ctx, overrides = {}) => {
  const form = agencyForm(overrides);
  const mark = mailCount();
  const res = await ctx.post('/api/auth/b2b/register', { multipart: form });
  const body = await json(res);
  const mail = await waitForMail(form.email, { after: mark });
  const verify = await ctx.post('/api/auth/verify-otp', { data: { email: form.email, otp: mail.otp } });
  const session = await json(verify);
  return { form, res, body, token: session.data.accessToken, user: session.data.user, partner: body.data.partner };
};

module.exports = {
  cfg, unique, emailFor, phoneFor, bearer, pdf, file,
  readMail, mailCount, waitForMail,
  newClient, json,
  registerCustomer, signUpCustomer, login, adminSession, createStaff, agencyForm, signUpAgency
};
