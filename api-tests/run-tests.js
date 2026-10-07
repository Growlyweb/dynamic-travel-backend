#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Automated API test runner for Dynamic Travel Backend.
 *
 *   node run-tests.js                      run every test
 *   node run-tests.js --only AUTH,B2B      run tests whose ID starts with one of these prefixes
 *   node run-tests.js --rate-limit         also run SEC-02 (needs RATE_LIMIT_ENABLED=true on the server)
 *
 * What it does
 *   1. Reads the server settings from ../.env (PORT, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, MAIL_OUTBOX_FILE).
 *   2. Calls the API exactly like Postman would (same endpoints, same bodies).
 *   3. Reads OTP codes and invite tokens from mail.jsonl by itself.
 *   4. Writes results/report-<time>.html, results/results-<time>.json and a filled copy of the Excel sheet.
 *
 * Needs Node 20+. The only dependency is exceljs (for the Excel sheet).
 */
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------- config
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const PROJECT_ROOT = path.resolve(opt('project', path.join(__dirname, '..')));
const readDotEnv = (file) => {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
};
const dotenv = readDotEnv(path.join(PROJECT_ROOT, '.env'));
const pick = (name, fallback = '') => process.env[name] || dotenv[name] || fallback;

const BASE = (opt('base-url', pick('TEST_BASE_URL')) || `http://localhost:${pick('PORT', '5000')}`).replace(/\/$/, '');
const ADMIN_EMAIL = pick('TEST_ADMIN_EMAIL', pick('ADMIN_SEED_EMAIL'));
const ADMIN_PASSWORD = pick('TEST_ADMIN_PASSWORD', pick('ADMIN_SEED_PASSWORD'));
const MAIL_FILE = path.resolve(PROJECT_ROOT, pick('MAIL_OUTBOX_FILE', './mail.jsonl'));
const SHEET_IN = path.resolve(opt('sheet', path.join(__dirname, 'Dynamic-Travel-API-Test-Sheet.xlsx')));
const OUT_DIR = path.join(__dirname, 'results');
const RUN_RATE_LIMIT = flag('rate-limit');
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const OTP_WAIT_MS = 6000;

// ----------------------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now().toString(36);
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const phone = () => `+8801${rnd(9)}`;
const mkEmail = (tag) => `auto.${tag}.${RUN}@example.com`;
const PW = 'Str0ng!Pass';
const PW2 = 'N3w!Passw0rd';

const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const green = (s) => color(32, s);
const red = (s) => color(31, s);
const yellow = (s) => color(33, s);
const dim = (s) => color(90, s);

async function call(method, urlPath, o = {}) {
  const headers = { ...(o.headers || {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.mobile) headers['X-Client-Type'] = 'mobile';
  if (o.cookie) headers.Cookie = o.cookie;
  let body;
  if (o.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof o.json === 'string' ? o.json : JSON.stringify(o.json);
  } else if (o.form) {
    body = o.form;
  }
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + urlPath, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {
      status: r.status, headers: r.headers, json, text, bytes: buf.length,
      setCookie: typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [],
      ms: Date.now() - t0
    };
  } catch (err) {
    return { status: 0, headers: new Headers(), json: null, text: '', bytes: 0, setCookie: [], ms: Date.now() - t0, error: err.cause?.code || err.message };
  }
}

const cookieValue = (res, name) => {
  for (const c of res.setCookie) if (c.startsWith(`${name}=`)) return c.split(';')[0].slice(name.length + 1);
  return null;
};
const data = (res) => (res.json && res.json.data) || {};
const code = (res) => res.json && res.json.code;

// ---- files for upload tests
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const filePart = (bytes, type) => new Blob([bytes], { type });
const pdf = () => filePart(PDF_BYTES, 'application/pdf');
const txt = () => filePart(Buffer.from('not allowed'), 'text/plain');
const big = () => filePart(Buffer.alloc(5 * 1024 * 1024 + 2048, 0x20), 'application/pdf');

const agencyForm = (email, { license = pdf(), licenseName = 'license.pdf', suffix = RUN } = {}) => {
  const f = new FormData();
  f.set('name', 'Auto Agency Owner');
  f.set('email', email);
  f.set('phone', phone());
  f.set('password', PW);
  f.set('companyName', `Auto Travels ${suffix}`);
  f.set('licenseNo', `TL-${suffix}`.toUpperCase());
  f.set('businessType', 'Travel agency');
  f.set('address', '45 Motijheel, Dhaka');
  if (license) f.set('tradeLicense', license, licenseName);
  return f;
};

// ---- mail.jsonl
const readMails = () => {
  if (!fs.existsSync(MAIL_FILE)) return [];
  return fs.readFileSync(MAIL_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
};
const mailCount = () => readMails().length;
/** Newest email to `to` that is newer than `afterCount` mails and has an otp (or invite link). Waits up to OTP_WAIT_MS. */
async function waitMail(to, { afterCount = 0, kind = 'otp' } = {}) {
  const end = Date.now() + OTP_WAIT_MS;
  const target = to.toLowerCase();
  for (;;) {
    const mails = readMails().slice(afterCount).filter((m) => String(m.to_email || m.email || '').toLowerCase() === target);
    for (let i = mails.length - 1; i >= 0; i--) {
      const m = mails[i];
      if (kind === 'otp' && m.otp) return m.otp;
      if (kind === 'invite') {
        const hit = /token=([A-Za-z0-9._~-]+)/.exec(`${m.message || ''}`);
        if (hit) return hit[1];
      }
    }
    if (Date.now() > end) return null;
    await sleep(250);
  }
}

// ----------------------------------------------------------------------------- test engine
const registry = [];
/** Define a test. fn(ctx) must return { res, checks?, note?, skip? } - res is the last HTTP response. */
const test = (id, fn) => registry.push({ id, fn });
const results = new Map();
const S = {}; // shared state across tests

const must = (cond, msg) => ({ ok: !!cond, msg });

async function execute(id, fn, expected) {
  const t0 = Date.now();
  try {
    const out = await fn();
    if (out && out.skip) return { id, status: null, pass: null, result: 'Blocked', note: out.skip, ms: 0 };
    const res = out.res;
    const failed = [];
    if (res.error) failed.push(`Could not reach the server (${res.error})`);
    if (expected != null && res.status !== expected) failed.push(`Expected status ${expected} but got ${res.status}${res.json && res.json.code ? ` (${res.json.code})` : ''}`);
    for (const c of out.checks || []) if (!c.ok) failed.push(`Check failed: ${c.msg}`);
    const pass = failed.length === 0;
    const info = [];
    if (res.json && res.json.code) info.push(`code ${res.json.code}`);
    if (res.json && res.json.message && !pass) info.push(`message "${String(res.json.message).slice(0, 100)}"`);
    return { id, status: res.status, pass, result: pass ? 'Pass' : 'Fail', note: pass ? (out.note || info.join(', ')) : failed.join('; '), ms: Date.now() - t0 };
  } catch (err) {
    return { id, status: null, pass: false, result: 'Blocked', note: `Runner error: ${err.message}`, ms: Date.now() - t0 };
  }
}

// ----------------------------------------------------------------------------- tests
function defineTests() {
  const A = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
  S.cust = { email: mkEmail('cust'), password: PW, name: 'Auto Customer', phone: phone() };
  S.agency = { email: mkEmail('agency'), password: PW };
  S.agency2 = { email: mkEmail('agency2'), password: PW };
  S.staff = { email: mkEmail('staff'), password: 'Sara@Pass12', name: 'Auto Staff', phone: phone() };
  S.staff2 = { email: mkEmail('staffnone'), password: 'Sara@Pass12', name: 'Auto Staff No Perms' };
  S.admin2 = { email: mkEmail('admin2'), name: 'Auto Admin Two' };
  S.victim = { email: mkEmail('victim'), password: PW, name: 'Auto Victim' };

  const login = (u, extra = {}) => call('POST', '/api/auth/login', { json: { email: u.email, password: u.password }, ...extra });
  const registerCustomer = (u) => call('POST', '/api/auth/register', { json: { name: u.name, email: u.email, phone: u.phone || phone(), password: u.password } });
  /** register + verify + login (setup helper, not a test row) */
  async function makeCustomer(u) {
    const n = mailCount();
    const r = await registerCustomer(u);
    if (r.status !== 201) throw new Error(`setup: could not register ${u.email} (${r.status} ${code(r) || ''})`);
    const otp = await waitMail(u.email, { afterCount: n });
    if (!otp) throw new Error(`setup: no OTP in ${MAIL_FILE} for ${u.email}`);
    const v = await call('POST', '/api/auth/verify-otp', { json: { email: u.email, otp } });
    if (v.status !== 200) throw new Error(`setup: verify failed for ${u.email} (${v.status})`);
    const l = await login(u);
    if (l.status !== 200) throw new Error(`setup: login failed for ${u.email} (${l.status})`);
    u.token = data(l).accessToken; u.id = data(l).user._id;
    return u;
  }
  async function makeStaff(u, permissions) {
    const n = mailCount();
    const c = await call('POST', '/api/admin/staff', { token: S.adminToken, json: { name: u.name, email: u.email, ...(u.phone ? { phone: u.phone } : {}), permissions } });
    if (c.status !== 201) throw new Error(`setup: could not create staff ${u.email} (${c.status} ${code(c) || ''})`);
    u.id = (data(c).user || data(c))._id;
    u.inviteToken = await waitMail(u.email, { afterCount: n, kind: 'invite' });
    return { create: c, n };
  }

  // ======= setup (not part of the sheet)
  S.setup = async () => {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD are empty. Fill them in .env, run "npm run seed", then try again.');
    const h = await call('GET', '/health');
    if (h.status !== 200) throw new Error(`Server not reachable at ${BASE} (${h.error || h.status}). Start it with "npm run dev".`);
    if (h.json && h.json.db !== 'up') throw new Error('Server is running but the database is down. Check MONGODB_URI (Atlas).');
    const l = await login(A);
    if (l.status !== 200) throw new Error(`Admin login failed (${l.status} ${code(l) || ''}). adminEmail/adminPassword must match ADMIN_SEED_* in .env and "npm run seed" must have been run.`);
    S.adminToken = data(l).accessToken;
    S.adminId = data(l).user._id;
    if (!fs.existsSync(MAIL_FILE)) {
      // The file is created by the server on the first email. Make sure the folder exists so we can tell.
      console.log(dim(`mail file not there yet: ${MAIL_FILE} (it is created on the first "sent" email)`));
    }
  };

  // ======= SYSTEM
  test('SYS-01', async () => {
    const res = await call('GET', '/health');
    return { res, checks: [must(res.json && res.json.success === true, 'success is true'), must(res.json && res.json.db === 'up', 'db is "up"')] };
  });
  test('SYS-02', async () => {
    const res = await call('GET', '/');
    return { res, checks: [must(res.json && res.json.success === true, 'success is true')] };
  });

  // ======= AUTH: register & OTP (customer)
  test('REG-01', async () => {
    S.mailN = mailCount();
    const res = await registerCustomer(S.cust);
    S.custId = (data(res).user || {})._id;
    return { res, checks: [must(data(res).user && data(res).user.role === 'B2C', 'user.role is B2C'), must(data(res).otpSent !== false, 'otpSent is not false')] };
  });
  test('REG-02', async () => ({ res: await registerCustomer({ ...S.cust, phone: phone() }) }));
  test('REG-03', async () => ({ res: await call('POST', '/api/auth/register', { json: { name: 'Weak Pw', email: mkEmail('weak'), password: 'abc12345' } }) }));
  test('REG-04', async () => ({ res: await call('POST', '/api/auth/register', { json: { name: 'Bad Mail', email: 'not-an-email', password: PW } }) }));
  test('REG-05', async () => ({ res: await login(S.cust) }));
  test('REG-06', async () => ({ res: await call('POST', '/api/auth/verify-otp', { json: { email: S.cust.email, otp: '000000' } }) }));
  test('REG-07', async () => {
    const otp = await waitMail(S.cust.email, { afterCount: S.mailN });
    if (!otp) return { skip: `No OTP found in ${MAIL_FILE}. Set EMAIL_PROVIDER=file and MAIL_OUTBOX_FILE=./mail.jsonl in .env and restart the server.` };
    return { res: await call('POST', '/api/auth/verify-otp', { json: { email: S.cust.email, otp } }) };
  });
  test('REG-08', async () => {
    const n = mailCount();
    const res = await call('POST', '/api/auth/resend-otp', { json: { email: S.cust.email } });
    await sleep(300);
    return { res, note: `new mail lines: ${mailCount() - n}` };
  });

  // ======= AUTH: login & session
  test('LOG-01', async () => {
    const res = await login(S.cust);
    S.cust.token = data(res).accessToken; S.cust.id = (data(res).user || {})._id;
    return { res, checks: [must(data(res).accessToken, 'accessToken present'), must(data(res).user && data(res).user.role === 'B2C', 'role is B2C')] };
  });
  test('LOG-02', async () => {
    const res = await login(A);
    S.adminToken = data(res).accessToken || S.adminToken;
    return { res, checks: [must(data(res).user && data(res).user.role === 'ADMIN', 'role is ADMIN')] };
  });
  test('LOG-03', async () => ({ res: await login({ email: S.cust.email, password: 'WrongPass1!' }), checks: [] }));
  test('LOG-04', async () => ({ res: await login({ email: 'nobody.' + RUN + '@example.com', password: PW }) }));
  test('LOG-05', async () => ({ res: await call('POST', '/api/auth/login', { json: { email: '', password: PW } }) }));
  test('LOG-06', async () => {
    const res = await login(S.cust);
    const cookie = cookieValue(res, 'refreshToken');
    S.webRefresh = cookie;
    const flags = res.setCookie.find((c) => c.startsWith('refreshToken=')) || '';
    return { res, checks: [must(cookie, 'refreshToken cookie is set'), must(/httponly/i.test(flags), 'cookie is HttpOnly'), must(!data(res).refreshToken, 'no refreshToken in body')] };
  });
  test('LOG-07', async () => {
    const res = await login(S.cust, { mobile: true });
    S.mobileRefresh = data(res).refreshToken;
    return { res, checks: [must(data(res).refreshToken, 'refreshToken is in the body'), must(!cookieValue(res, 'refreshToken'), 'no refreshToken cookie')] };
  });
  test('LOG-08', async () => {
    const res = await call('GET', '/api/auth/me', { token: S.cust.token });
    const txt = res.text.toLowerCase();
    return { res, checks: [must(!txt.includes('passwordhash') && !txt.includes('"password"'), 'no password fields in response')] };
  });
  test('LOG-09', async () => ({ res: await call('GET', '/api/auth/me') }));
  test('LOG-10', async () => ({ res: await call('GET', '/api/auth/me', { token: 'abc.def.ghi' }) }));
  test('LOG-11', async () => {
    const res = await call('POST', '/api/auth/refresh', { cookie: `refreshToken=${S.webRefresh}`, json: {} });
    return { res, checks: [must(data(res).accessToken, 'new accessToken returned')] };
  });
  test('LOG-12', async () => {
    // Mobile mode: use the token once (rotates it), then replay the OLD one.
    const first = await call('POST', '/api/auth/refresh', { mobile: true, json: { refreshToken: S.mobileRefresh } });
    S.mobileRefreshNew = data(first).refreshToken;
    const replay = await call('POST', '/api/auth/refresh', { mobile: true, json: { refreshToken: S.mobileRefresh } });
    return { res: replay, checks: [must(first.status === 200, `first refresh succeeded (got ${first.status})`)], note: 'first refresh 200, replay refused' };
  });
  test('LOG-13', async () => {
    const l = await login(S.cust);
    S.logoutToken = data(l).accessToken; S.logoutCookie = cookieValue(l, 'refreshToken');
    const res = await call('POST', '/api/auth/logout', { token: S.logoutToken, cookie: `refreshToken=${S.logoutCookie}`, json: { allDevices: false } });
    return { res };
  });
  test('LOG-14', async () => ({ res: await call('POST', '/api/auth/refresh', { cookie: `refreshToken=${S.logoutCookie}`, json: {} }) }));
  test('LOG-15', async () => ({ skip: 'Needs a 15 minute wait (access token lifetime). Test it manually, or set JWT_ACCESS_EXPIRES_IN=5s on the server and call /me after 6 seconds.' }));

  // ======= AUTH: passwords
  test('PWD-01', async () => {
    S.mailN = mailCount();
    const res = await call('POST', '/api/auth/forgot-password', { json: { email: S.cust.email } });
    const otp = await waitMail(S.cust.email, { afterCount: S.mailN });
    S.resetOtp = otp;
    return { res, checks: [must(otp, 'a reset code was written to mail.jsonl')] };
  });
  test('PWD-02', async () => {
    const n = mailCount();
    const res = await call('POST', '/api/auth/forgot-password', { json: { email: `nobody.${RUN}@example.com` } });
    await sleep(300);
    return { res, checks: [must(mailCount() === n, 'no email was sent for an unknown address')] };
  });
  test('PWD-03', async () => ({ res: await call('POST', '/api/auth/verify-reset-token', { json: { email: S.cust.email, otp: '000000' } }) }));
  test('PWD-04', async () => ({ res: await call('POST', '/api/auth/verify-reset-token', { json: { email: S.cust.email, otp: S.resetOtp } }) }));
  test('PWD-05', async () => {
    const res = await call('POST', '/api/auth/reset-password', { json: { email: S.cust.email, otp: S.resetOtp, newPassword: PW2 } });
    const newLogin = await login({ email: S.cust.email, password: PW2 });
    const oldLogin = await login({ email: S.cust.email, password: PW });
    if (newLogin.status === 200) { S.cust.password = PW2; S.cust.token = data(newLogin).accessToken; }
    return { res, checks: [must(newLogin.status === 200, `login with the new password works (got ${newLogin.status})`), must(oldLogin.status === 401, `old password is refused (got ${oldLogin.status})`)] };
  });
  test('PWD-06', async () => ({ res: await call('POST', '/api/auth/reset-password', { json: { email: S.cust.email, otp: S.resetOtp, newPassword: 'An0ther!Pass1' } }) }));
  test('PWD-07', async () => {
    const res = await call('POST', '/api/auth/change-password', { token: S.cust.token, json: { currentPassword: S.cust.password, newPassword: 'Ch4nged!Pass9' } });
    if (res.status === 200) {
      S.cust.password = 'Ch4nged!Pass9';
      const l = await login(S.cust); S.cust.token = data(l).accessToken;
    }
    return { res };
  });
  test('PWD-08', async () => ({ res: await call('POST', '/api/auth/change-password', { token: S.cust.token, json: { currentPassword: 'WrongPass1!', newPassword: 'Ch4nged!Pass8' } }) }));
  test('PWD-09', async () => ({ res: await call('POST', '/api/auth/change-password', { token: S.cust.token, json: { currentPassword: S.cust.password, newPassword: '12345678' } }) }));

  // ======= CUSTOMER
  test('B2C-01', async () => ({ res: await call('GET', '/api/b2c/profile', { token: S.cust.token }) }));
  test('B2C-02', async () => {
    const newName = 'Auto Customer Updated';
    const res = await call('PATCH', '/api/b2c/profile', { token: S.cust.token, json: { name: newName } });
    const again = await call('GET', '/api/b2c/profile', { token: S.cust.token });
    return { res, checks: [must(JSON.stringify(again.json).includes(newName), 'GET shows the updated name')] };
  });
  test('B2C-03', async () => ({ res: await call('PATCH', '/api/b2c/profile', { token: S.cust.token, json: { phone: '123' } }) }));
  test('B2C-04', async () => ({ res: await call('GET', '/api/b2c/profile') }));
  test('B2C-05', async () => ({ res: await call('GET', '/api/admin/users', { token: S.cust.token }) }));
  test('B2C-06', async () => ({ res: await call('GET', '/api/b2b/profile', { token: S.cust.token }) }));
  test('B2C-07', async () => ({ res: await call('GET', '/api/staff/partners', { token: S.cust.token }) }));

  // ======= AGENCY (up to approval)
  test('B2B-01', async () => {
    S.mailN = mailCount();
    const res = await call('POST', '/api/auth/b2b/register', { form: agencyForm(S.agency.email) });
    S.agencyUserId = (data(res).user || {})._id;
    S.partnerId = (data(res).partner || {})._id;
    return { res, checks: [must(data(res).user && data(res).user.role === 'B2B', 'user.role is B2B')] };
  });
  test('B2B-02', async () => ({ res: await call('POST', '/api/auth/b2b/register', { form: agencyForm(mkEmail('nofile'), { license: null, suffix: RUN + 'n' }) }) }));
  test('B2B-03', async () => ({ res: await call('POST', '/api/auth/b2b/register', { form: agencyForm(mkEmail('badtype'), { license: txt(), licenseName: 'notes.txt', suffix: RUN + 'b' }) }) }));
  test('B2B-04', async () => ({ res: await call('POST', '/api/auth/b2b/register', { form: agencyForm(mkEmail('big'), { license: big(), licenseName: 'big.pdf', suffix: RUN + 'g' }) }) }));
  test('B2B-05', async () => ({ res: await call('POST', '/api/auth/b2b/register', { form: agencyForm(S.agency.email, { suffix: RUN + 'd' }) }) }));
  test('B2B-06', async () => ({ res: await login(S.agency) }));
  test('B2B-07', async () => {
    const otp = await waitMail(S.agency.email, { afterCount: S.mailN });
    if (!otp) return { skip: `No OTP found in ${MAIL_FILE} for the agency.` };
    return { res: await call('POST', '/api/auth/verify-otp', { json: { email: S.agency.email, otp } }) };
  });
  test('B2B-08', async () => {
    const res = await login(S.agency);
    S.agency.token = data(res).accessToken;
    return { res, checks: [must(data(res).user && data(res).user.role === 'B2B', 'role is B2B')] };
  });
  test('B2B-09', async () => {
    const res = await call('GET', '/api/b2b/profile', { token: S.agency.token });
    const p = data(res).partner || data(res);
    if (p && p._id) S.partnerId = S.partnerId || p._id;
    return { res };
  });
  test('B2B-10', async () => ({ res: await call('PATCH', '/api/b2b/profile', { token: S.agency.token, json: { address: '99 Gulshan Avenue, Dhaka', businessType: 'Tour operator' } }) }));
  test('B2B-11', async () => {
    const res = await call('GET', '/api/b2b/documents', { token: S.agency.token });
    return { res, checks: [must(/TRADE_LICENSE/.test(res.text), 'TRADE_LICENSE is listed')] };
  });
  test('B2B-12', async () => {
    const f = new FormData(); f.set('businessCard', pdf(), 'card.pdf');
    const res = await call('POST', '/api/b2b/documents', { token: S.agency.token, form: f });
    return { res };
  });
  test('B2B-13', async () => {
    const f = new FormData(); f.set('businessCard', txt(), 'notes.txt');
    return { res: await call('POST', '/api/b2b/documents', { token: S.agency.token, form: f }) };
  });
  test('B2B-14', async () => ({ res: await call('GET', '/api/b2b/overview', { token: S.agency.token }) }));
  // B2B-15 runs after the admin approves (see below)
  test('B2B-16', async () => ({ res: await call('GET', '/api/admin/b2b', { token: S.agency.token }) }));
  test('B2B-17', async () => ({ res: await call('GET', '/api/staff/partners', { token: S.agency.token }) }));

  // ======= ADMIN: users
  test('ADU-01', async () => {
    const res = await call('GET', '/api/admin/users', { token: S.adminToken });
    return { res, checks: [must(Array.isArray(res.json && res.json.data), 'data is a list'), must(res.json && res.json.meta, 'meta (paging) is present')] };
  });
  test('ADU-02', async () => {
    const res = await call('GET', '/api/admin/users?role=B2C', { token: S.adminToken });
    const rows = (res.json && res.json.data) || [];
    return { res, checks: [must(rows.length > 0 && rows.every((u) => u.role === 'B2C'), 'every row is B2C')] };
  });
  test('ADU-03', async () => ({ res: await call('GET', '/api/admin/users?limit=abc', { token: S.adminToken }) }));
  test('ADU-04', async () => {
    const res = await call('GET', `/api/admin/users/${S.cust.id}`, { token: S.adminToken });
    return { res, checks: [must(JSON.stringify(res.json).includes(S.cust.email), 'returns the right user')] };
  });
  test('ADU-05', async () => ({ res: await call('GET', '/api/admin/users/123', { token: S.adminToken }) }));
  test('ADU-06', async () => ({ res: await call('GET', '/api/admin/users/64b7f0f0f0f0f0f0f0f0f0f0', { token: S.adminToken }) }));
  test('ADU-07', async () => ({ res: await call('PATCH', `/api/admin/users/${S.cust.id}`, { token: S.adminToken, json: { name: 'Edited By Admin' } }) }));
  test('ADU-08', async () => {
    const { create } = await makeStaff(S.staff, ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY']);
    return { res: create, checks: [must(data(create).inviteSent !== false, 'inviteSent is not false'), must(S.staff.inviteToken, 'invite token found in mail.jsonl')] };
  });
  test('ADU-09', async () => ({ res: await call('POST', '/api/admin/staff', { token: S.adminToken, json: { name: S.staff.name, email: S.staff.email, permissions: ['B2B_VIEW'] } }) }));
  test('ADU-10', async () => ({ res: await call('POST', '/api/admin/staff', { token: S.adminToken, json: { name: 'Bad Perm', email: mkEmail('badperm'), permissions: ['FLY_PLANES'] } }) }));
  test('ADU-11', async () => {
    const n = mailCount();
    const res = await call('POST', '/api/admin/users', { token: S.adminToken, json: { name: S.admin2.name, email: S.admin2.email, role: 'ADMIN' } });
    S.admin2.id = (data(res).user || data(res))._id;
    S.admin2.n = n;
    return { res, checks: [must(data(res).inviteSent !== false, 'inviteSent is not false')] };
  });
  test('ADU-12', async () => {
    if (!S.staff.inviteToken) return { skip: 'No invite token in mail.jsonl (staff was not created).' };
    return { res: await call('POST', '/api/auth/setup-account', { json: { token: S.staff.inviteToken, password: S.staff.password } }) };
  });
  test('ADU-13', async () => ({ res: await call('POST', '/api/auth/setup-account', { json: { token: 'abc-this-token-is-wrong-abc', password: PW } }) }));
  test('ADU-14', async () => {
    const res = await login(S.staff);
    S.staff.token = data(res).accessToken;
    return { res, checks: [must(data(res).user && data(res).user.role === 'STAFF', 'role is STAFF')] };
  });
  test('ADU-15', async () => {
    const n = mailCount();
    const res = await call('POST', `/api/admin/users/${S.admin2.id}/resend-invite`, { token: S.adminToken });
    const token = await waitMail(S.admin2.email, { afterCount: n, kind: 'invite' });
    return { res, checks: [must(token, 'a new invite is in mail.jsonl')] };
  });
  test('ADU-16', async () => {
    await makeCustomer(S.victim);
    return { res: await call('PATCH', `/api/admin/users/${S.victim.id}/status`, { token: S.adminToken, json: { status: 'SUSPENDED', reason: 'automated test' } }) };
  });
  test('ADU-17', async () => ({ res: await login(S.victim) }));
  test('ADU-18', async () => {
    const res = await call('PATCH', `/api/admin/users/${S.victim.id}/status`, { token: S.adminToken, json: { status: 'ACTIVE' } });
    const l = await login(S.victim);
    return { res, checks: [must(l.status === 200, `user can log in again (got ${l.status})`)] };
  });
  test('ADU-19', async () => ({ res: await call('PATCH', `/api/admin/users/${S.adminId}/status`, { token: S.adminToken, json: { status: 'SUSPENDED' } }) }));
  test('ADU-20', async () => ({ res: await call('PATCH', `/api/admin/users/${S.admin2.id}/role`, { token: S.adminToken, json: { role: 'STAFF', permissions: ['B2B_VIEW'] } }) }));
  test('ADU-21', async () => ({ res: await call('PATCH', `/api/admin/users/${S.victim.id}/role`, { token: S.adminToken, json: { role: 'STAFF' } }) }));
  test('ADU-22', async () => ({ res: await call('PATCH', `/api/admin/users/${S.staff.id}/permissions`, { token: S.adminToken, json: { permissions: ['B2B_VIEW', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY'] } }) }));
  test('ADU-23', async () => ({ res: await call('PATCH', `/api/admin/users/${S.victim.id}/permissions`, { token: S.adminToken, json: { permissions: ['B2B_VIEW'] } }) }));
  test('ADU-24', async () => {
    const res = await call('DELETE', `/api/admin/users/${S.victim.id}`, { token: S.adminToken });
    const l = await login(S.victim);
    return { res, checks: [must(l.status !== 200, `deactivated user cannot log in (got ${l.status})`)] };
  });
  test('ADU-25', async () => ({ res: await call('DELETE', `/api/admin/users/${S.adminId}`, { token: S.adminToken }) }));
  test('ADU-26', async () => ({ res: await call('GET', '/api/admin/rbac', { token: S.adminToken }) }));
  test('ADU-27', async () => ({ res: await call('GET', '/api/admin/profile', { token: S.adminToken }) }));
  test('ADU-28', async () => {
    const res = await call('GET', '/api/admin/audit-logs', { token: S.adminToken });
    return { res, checks: [must(Array.isArray(res.json && res.json.data) && res.json.data.length > 0, 'audit log has entries')] };
  });

  // ======= ADMIN: agencies
  test('ADA-01', async () => {
    const res = await call('GET', '/api/admin/b2b', { token: S.adminToken });
    const rows = (res.json && res.json.data) || [];
    const mine = rows.find((p) => p._id === S.partnerId) || rows[0];
    return { res, checks: [must(Array.isArray(rows), 'data is a list'), must(mine, 'agency is listed')] };
  });
  test('ADA-02', async () => {
    const res = await call('GET', `/api/admin/b2b/${S.partnerId}`, { token: S.adminToken });
    const docs = (data(res).documents) || [];
    S.docs = docs;
    const lic = docs.find((d) => /TRADE_LICENSE/.test(d.type || d.docType || '')) || docs[0];
    S.licenseDoc = lic && lic._id;
    const extra = docs.find((d) => d._id !== S.licenseDoc);
    S.extraDoc = extra && extra._id;
    return { res, checks: [must(S.licenseDoc, 'trade license document found')] };
  });
  test('ADA-03', async () => ({ res: await call('PATCH', `/api/admin/b2b/${S.partnerId}`, { token: S.adminToken, json: { companyName: `Auto Travels ${RUN} Ltd` } }) }));
  test('ADA-04', async () => ({ res: await call('PATCH', `/api/admin/b2b/${S.partnerId}/documents/${S.licenseDoc}`, { token: S.adminToken, json: { status: 'VERIFIED', note: 'License checked.' } }) }));
  test('ADA-05', async () => {
    if (!S.extraDoc) return { skip: 'No second document to reject (B2B-12 upload may have failed).' };
    return { res: await call('PATCH', `/api/admin/b2b/${S.partnerId}/documents/${S.extraDoc}`, { token: S.adminToken, json: { status: 'REJECTED', note: 'Image is blurry, please upload again.' } }) };
  });
  test('ADA-06', async () => {
    const res = await call('PATCH', `/api/admin/b2b/${S.partnerId}/approval`, { token: S.adminToken, json: { decision: 'APPROVED', note: 'All documents checked.' } });
    S.approved = res.status === 200;
    return { res };
  });
  test('B2B-15', async () => {
    const l = await login(S.agency); S.agency.token = data(l).accessToken || S.agency.token;
    return { res: await call('GET', '/api/b2b/overview', { token: S.agency.token }) };
  });
  test('ADA-07', async () => {
    const res = await call('PATCH', `/api/admin/b2b/${S.partnerId}/approval`, { token: S.adminToken, json: { decision: 'SUSPENDED', note: 'Suspended by automated test.' } });
    const ov = await call('GET', '/api/b2b/overview', { token: S.agency.token });
    return { res, checks: [must(ov.status === 403, `agency overview is refused after suspension (got ${ov.status})`)] };
  });
  test('ADA-08', async () => ({ res: await call('GET', '/api/admin/b2b/abc', { token: S.adminToken }) }));

  // ======= STAFF (staff1 has B2B_VIEW, DOCUMENT_VIEW, DOCUMENT_VERIFY)
  test('STF-01', async () => ({ res: await call('GET', '/api/staff/profile', { token: S.staff.token }) }));
  test('STF-02', async () => ({ res: await call('PATCH', '/api/staff/profile', { token: S.staff.token, json: { name: 'Auto Staff Renamed' } }) }));
  test('STF-03', async () => ({ res: await call('GET', '/api/staff/partners', { token: S.staff.token }) }));
  test('STF-04', async () => {
    // A second staff account with no permissions at all.
    const { n } = await makeStaff(S.staff2, []);
    if (!S.staff2.inviteToken) throw new Error('setup: no invite token for the no-permission staff');
    const su = await call('POST', '/api/auth/setup-account', { json: { token: S.staff2.inviteToken, password: S.staff2.password } });
    if (su.status !== 200) throw new Error(`setup: setup-account failed (${su.status})`);
    const l = await login(S.staff2);
    S.staff2.token = data(l).accessToken;
    return { res: await call('GET', '/api/staff/partners', { token: S.staff2.token }), note: `second staff, no permissions (mail ${n})` };
  });
  test('STF-05', async () => {
    // A fresh agency so the review does not depend on earlier approval/suspension state.
    const n = mailCount();
    const r = await call('POST', '/api/auth/b2b/register', { form: agencyForm(S.agency2.email, { suffix: RUN + 'x' }) });
    if (r.status !== 201) throw new Error(`setup: second agency not created (${r.status} ${code(r) || ''})`);
    S.partner2Id = (data(r).partner || {})._id;
    const otp = await waitMail(S.agency2.email, { afterCount: n });
    if (otp) await call('POST', '/api/auth/verify-otp', { json: { email: S.agency2.email, otp } });
    const l = await login(S.agency2); S.agency2.token = data(l).accessToken;
    const d = await call('GET', '/api/admin/b2b/' + S.partner2Id, { token: S.adminToken });
    const doc = (data(d).documents || [])[0];
    S.doc2 = doc && doc._id;
    if (!S.doc2) throw new Error('setup: second agency has no document');
    return { res: await call('PATCH', `/api/staff/partners/${S.partner2Id}/documents/${S.doc2}`, { token: S.staff.token, json: { status: 'VERIFIED', note: 'Checked by staff.' } }) };
  });
  test('STF-06', async () => ({ res: await call('GET', '/api/admin/users', { token: S.staff.token }) }));
  test('STF-07', async () => ({ res: await call('PATCH', `/api/admin/b2b/${S.partnerId}/approval`, { token: S.staff.token, json: { decision: 'APPROVED' } }) }));

  // ======= DOCUMENTS
  const dl = (token, partnerId, docId) => call('GET', `/api/documents/partners/${partnerId}/${docId}`, token ? { token } : {});
  test('DOC-01', async () => {
    const res = await dl(S.adminToken, S.partnerId, S.licenseDoc);
    return { res, checks: [must(res.bytes > 0 && !res.headers.get('content-type')?.includes('json'), 'a file (not JSON) was returned'), must(res.text.startsWith('%PDF'), 'file content matches the upload')] };
  });
  test('DOC-02', async () => {
    const res = await dl(S.agency.token, S.partnerId, S.licenseDoc);
    return { res, checks: [must(res.bytes > 0, 'file returned')] };
  });
  test('DOC-03', async () => {
    const res = await dl(S.agency2.token, S.partnerId, S.licenseDoc);
    return { res, checks: [must(!res.text.startsWith('%PDF'), 'the file was NOT returned')] };
  });
  test('DOC-04', async () => {
    const res = await dl(S.cust.token, S.partnerId, S.licenseDoc);
    return { res, checks: [must(!res.text.startsWith('%PDF'), 'the file was NOT returned')] };
  });
  test('DOC-05', async () => ({ res: await dl(null, S.partnerId, S.licenseDoc) }));

  // ======= SECURITY
  test('SEC-01', async () => {
    const res = await call('POST', '/api/auth/login', { json: '{"email": {"$gt": ""}, "password": "x"}' });
    return { res, checks: [must(res.status !== 200, 'login did not succeed')] };
  });
  test('SEC-02', async () => {
    if (!RUN_RATE_LIMIT) return { skip: 'Skipped on purpose. Rate limiting is normally switched OFF for test runs (RATE_LIMIT_ENABLED=false). To run it: set RATE_LIMIT_ENABLED=true, restart the server, then run: node run-tests.js --only SEC-02 --rate-limit' };
    let last; const target = mkEmail('ratelimit');
    for (let i = 0; i < 14; i++) { last = await call('POST', '/api/auth/login', { json: { email: target, password: 'WrongPass1!' } }); if (last.status === 429) break; }
    return { res: last, checks: [must(last.headers.get('retry-after'), 'Retry-After header present')] };
  });
  test('SEC-03', async () => ({ res: await call('POST', '/api/auth/register', { json: { name: 'x'.repeat(150 * 1024), email: mkEmail('huge'), password: PW } }) }));
  test('SEC-04', async () => {
    const l = await login(S.cust); const m = await call('GET', '/api/auth/me', { token: S.cust.token });
    const u = await call('GET', '/api/admin/users', { token: S.adminToken });
    const all = `${l.text}${m.text}${u.text}`;
    const bad = ['passwordHash', '"password"', 'tokenHash', 'otpHash', '"otp"'].filter((k) => all.includes(k));
    return { res: m, checks: [must(bad.length === 0, `secret fields found in responses: ${bad.join(', ')}`)] };
  });
  test('SEC-05', async () => {
    const res = await call('GET', '/health');
    const need = ['x-content-type-options', 'strict-transport-security', 'x-frame-options'];
    const missing = need.filter((h) => !res.headers.get(h));
    return { res, checks: [must(missing.length === 0, `missing headers: ${missing.join(', ')}`)] };
  });
}

// ----------------------------------------------------------------------------- reports
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function writeHtml(file, rows, meta) {
  const count = (r) => rows.filter((x) => x.result === r).length;
  const pass = count('Pass'), fail = count('Fail'), blocked = count('Blocked'), notRun = count('Not Run');
  const executed = pass + fail;
  const rate = executed ? ((pass / executed) * 100).toFixed(1) : '0.0';
  const mods = [...new Set(rows.map((r) => r.module))];
  const modRows = mods.map((m) => {
    const x = rows.filter((r) => r.module === m);
    const p = x.filter((r) => r.result === 'Pass').length, f = x.filter((r) => r.result === 'Fail').length, b = x.filter((r) => r.result === 'Blocked').length;
    return `<tr><td>${esc(m)}</td><td>${x.length}</td><td class="p">${p}</td><td class="f">${f}</td><td class="b">${b}</td><td>${p + f ? ((p / (p + f)) * 100).toFixed(0) : 0}%</td></tr>`;
  }).join('');
  const body = rows.map((r) => `<tr class="${r.result.replace(' ', '')}" data-r="${r.result}"><td>${esc(r.id)}</td><td>${esc(r.module)}</td><td>${esc(r.title)}</td><td>${esc(r.method)} ${esc(r.endpoint)}</td><td class="c">${esc(r.expected)}</td><td class="c">${r.status ?? ''}</td><td class="c res">${esc(r.result)}</td><td>${esc(r.note)}</td></tr>`).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dynamic Travel API Test Report</title>
<style>
:root{--bg:#fff;--fg:#1c1e21;--mut:#5f6368;--line:#dadce0;--card:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e8eaed;--mut:#9aa0a6;--line:#3c4043;--card:#20232a}}
body{font:14px/1.45 Arial,Helvetica,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
main{max-width:1280px;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:24px;color:#1f3864}@media(prefers-color-scheme:dark){h1{color:#8ab4f8}}
.sub{color:var(--mut);margin-bottom:20px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 18px;min-width:120px}
.card b{display:block;font-size:26px}.card span{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.card.p b{color:#188038}.card.f b{color:#d93025}.card.b b{color:#b06000}
table{border-collapse:collapse;width:100%;margin-bottom:28px;background:var(--bg)}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{background:#1f3864;color:#fff;position:sticky;top:0}
.c{text-align:center}.res{font-weight:700}
tr.Pass .res{color:#188038}tr.Fail{background:rgba(217,48,37,.10)}tr.Fail .res{color:#d93025}tr.Blocked .res{color:#b06000}
td.p{color:#188038;font-weight:700}td.f{color:#d93025;font-weight:700}td.b{color:#b06000;font-weight:700}
.bar{display:flex;gap:8px;margin:0 0 10px;flex-wrap:wrap}.bar button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:5px 12px;cursor:pointer}
.bar button.on{background:#1f3864;color:#fff}
.scroll{overflow-x:auto}
</style></head><body><main>
<h1>Dynamic Travel Backend - API Test Report</h1>
<div class="sub">${esc(meta.started)} &middot; ${esc(meta.base)} &middot; took ${esc(meta.seconds)} s &middot; Node ${esc(process.version)}</div>
<div class="cards">
<div class="card"><b>${rows.length}</b><span>Total</span></div>
<div class="card p"><b>${pass}</b><span>Pass</span></div>
<div class="card f"><b>${fail}</b><span>Fail</span></div>
<div class="card b"><b>${blocked}</b><span>Blocked</span></div>
<div class="card"><b>${notRun}</b><span>Not run</span></div>
<div class="card"><b>${rate}%</b><span>Pass rate</span></div>
</div>
<h2>By module</h2>
<table><thead><tr><th>Module</th><th>Total</th><th>Pass</th><th>Fail</th><th>Blocked</th><th>Pass %</th></tr></thead><tbody>${modRows}</tbody></table>
<h2>All tests</h2>
<div class="bar" id="bar"><button class="on" data-f="">All</button><button data-f="Fail">Fail</button><button data-f="Blocked">Blocked</button><button data-f="Pass">Pass</button><button data-f="Not Run">Not run</button></div>
<div class="scroll"><table id="t"><thead><tr><th>ID</th><th>Module</th><th>Test case</th><th>Request</th><th>Expected</th><th>Actual</th><th>Result</th><th>Notes</th></tr></thead><tbody>
${body}
</tbody></table></div>
<script>
document.getElementById('bar').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
[].forEach.call(this.children,function(x){x.classList.toggle('on',x===b)});
var f=b.getAttribute('data-f');[].forEach.call(document.querySelectorAll('#t tbody tr'),function(r){r.style.display=(!f||r.getAttribute('data-r')===f)?'':'none'})});
</script>
</main></body></html>`;
  fs.writeFileSync(file, html);
}

async function writeExcel(file, byId) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET_IN);
  const ws = wb.getWorksheet('Test Cases');
  const today = new Date();
  const note = (r) => (r.note || '').slice(0, 400);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const id = row.getCell(1).value;
    const r = byId.get(String(id));
    if (!r || r.result === 'Not Run') return;
    row.getCell(11).value = r.status === null ? null : r.status;
    row.getCell(12).value = r.result;
    row.getCell(13).value = note(r);
    row.getCell(14).value = today;
    row.getCell(14).numFmt = 'yyyy-mm-dd';
  });
  ws.autoFilter = `A1:N${ws.rowCount}`;
  await wb.xlsx.writeFile(file);
}

// ----------------------------------------------------------------------------- sheet reader
async function readSheet() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET_IN);
  const ws = wb.getWorksheet('Test Cases');
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1 || !row.getCell(1).value) return;
    rows.push({
      id: String(row.getCell(1).value), module: String(row.getCell(2).value || ''), title: String(row.getCell(3).value || ''),
      method: String(row.getCell(5).value || ''), endpoint: String(row.getCell(6).value || ''),
      expected: Number(row.getCell(9).value) || null
    });
  });
  return rows;
}

// ----------------------------------------------------------------------------- main
(async () => {
  const started = new Date();
  console.log(`\nDynamic Travel API tests\n  server : ${BASE}\n  admin  : ${ADMIN_EMAIL || '(not set)'}\n  mail   : ${MAIL_FILE}\n`);
  if (!fs.existsSync(SHEET_IN)) { console.error(red(`Test sheet not found: ${SHEET_IN}\nPut Dynamic-Travel-API-Test-Sheet.xlsx next to run-tests.js (or use --sheet <path>).`)); process.exit(2); }

  defineTests();
  try { await S.setup(); } catch (err) { console.error(red(`\nSetup failed: ${err.message}\n`)); process.exit(2); }

  const sheet = await readSheet();
  const sheetById = new Map(sheet.map((r) => [r.id, r]));
  const wanted = (id) => !ONLY.length || ONLY.some((p) => id.toUpperCase().startsWith(p));
  // The 429-limited routes need a warning: if one shows up very early the run is meaningless.
  let rateLimited = 0;

  for (const t of registry) {
    const row = sheetById.get(t.id);
    if (!row) { console.log(yellow(`  ?     ${t.id} is not in the sheet, skipped`)); continue; }
    if (!wanted(t.id)) continue;
    const r = await execute(t.id, t.fn, row.expected);
    results.set(t.id, r);
    if (r.status === 429 && t.id !== 'SEC-02') rateLimited++;
    const tag = r.result === 'Pass' ? green('PASS   ') : r.result === 'Fail' ? red('FAIL   ') : yellow('BLOCKED');
    console.log(`  ${tag} ${t.id.padEnd(7)} ${row.title.slice(0, 58).padEnd(58)} ${dim(`exp ${row.expected} got ${r.status ?? '-'}`)}${r.result !== 'Pass' ? `\n          ${r.note}` : ''}`);
  }

  // Merge sheet rows with results (tests not run stay "Not Run")
  const finalRows = sheet.map((r) => {
    const x = results.get(r.id);
    return { ...r, status: x ? x.status : null, result: x ? x.result : 'Not Run', note: x ? x.note : (registry.find((t) => t.id === r.id) ? 'Not selected for this run' : 'No automated test for this case') };
  });

  const seconds = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlFile = path.join(OUT_DIR, `report-${stamp}.html`);
  const jsonFile = path.join(OUT_DIR, `results-${stamp}.json`);
  const xlsxFile = path.join(OUT_DIR, `Dynamic-Travel-API-Test-Sheet-RESULT-${stamp}.xlsx`);
  writeHtml(htmlFile, finalRows, { started: started.toLocaleString(), base: BASE, seconds });
  fs.writeFileSync(jsonFile, JSON.stringify({ started, base: BASE, seconds, results: finalRows }, null, 2));
  await writeExcel(xlsxFile, new Map(finalRows.map((r) => [r.id, r])));

  const c = (r) => finalRows.filter((x) => x.result === r).length;
  console.log(`\n  ${green(`Pass ${c('Pass')}`)}   ${c('Fail') ? red(`Fail ${c('Fail')}`) : 'Fail 0'}   ${yellow(`Blocked ${c('Blocked')}`)}   Not run ${c('Not Run')}   (${seconds}s)`);
  if (rateLimited) console.log(yellow('\n  Some requests got 429 (rate limit). Set RATE_LIMIT_ENABLED=false in .env, restart the server and run again.'));
  console.log(`\n  HTML report : ${htmlFile}\n  Excel sheet : ${xlsxFile}\n  JSON        : ${jsonFile}\n`);
  process.exit(c('Fail') ? 1 : 0);
})().catch((err) => { console.error(red(`\nUnexpected error: ${err.stack || err.message}`)); process.exit(2); });
