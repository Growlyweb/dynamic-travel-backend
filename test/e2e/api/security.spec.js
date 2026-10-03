const { test, expect } = require('../helpers/test');
const {
  cfg, bearer, json, mailCount, waitForMail, registerCustomer, signUpCustomer, signUpAgency, adminSession, createStaff, emailFor
} = require('../helpers/api');

const STRANGER = 'https://evil.example';

test.describe('security headers', () => {
  test('helmet headers are on, and the framework is not advertised', async ({ client }) => {
    const ctx = await client();
    const headers = (await ctx.get('/health')).headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

test.describe('CORS', () => {
  test('the configured front end gets credentials, and can read Retry-After and the download file name', async ({ client }) => {
    const ctx = await client();
    const headers = (await ctx.get('/health', { headers: { Origin: cfg.CONSOLE_URL } })).headers();

    expect(headers['access-control-allow-origin']).toBe(cfg.CONSOLE_URL);
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(headers['access-control-expose-headers']).toMatch(/Retry-After/i);
    expect(headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
    expect(headers.vary).toMatch(/Origin/i);
  });

  test('a browser preflight from the front end is answered', async ({ client }) => {
    const ctx = await client();
    const res = await ctx.fetch('/api/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: cfg.CONSOLE_URL, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-client-type' }
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe(cfg.CONSOLE_URL);
    expect(res.headers()['access-control-allow-methods']).toMatch(/POST/);
  });

  for (const origin of [STRANGER, 'null', 'http://localhost:9999']) {
    test(`origin "${origin}" is never allowed, for a request or a preflight`, async ({ client }) => {
      const ctx = await client();

      // Without Access-Control-Allow-Origin the browser blocks the response. The cors package still
      // sends Allow-Credentials on its own, which is harmless without an allowed origin.
      const plain = await ctx.get('/health', { headers: { Origin: origin } });
      expect(plain.headers()['access-control-allow-origin']).toBeUndefined();

      const preflight = await ctx.fetch('/api/auth/login', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
      expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
    });
  }
});

test.describe('nothing private leaves the API', () => {
  test('no response carries a password hash, token version, firebase uid or file path', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const customer = await signUpCustomer(await client());
    const agency = await signUpAgency(await client());
    // field names only: an audit entry may legitimately hold the label "via":"password"
    const forbidden = /"(passwordHash|password|tokenVersion|firebaseUid|storagePath|otpHash|codeHash|tokenHash)"\s*:/;

    const urls = [
      ['/api/auth/me', customer.token],
      ['/api/b2c/profile', customer.token],
      ['/api/b2b/profile', agency.token],
      ['/api/b2b/documents', agency.token],
      ['/api/admin/users?limit=100', admin.token],
      ['/api/admin/b2b?limit=100', admin.token],
      [`/api/admin/b2b/${agency.partner._id}`, admin.token],
      ['/api/admin/audit-logs?limit=100', admin.token]
    ];
    for (const [url, token] of urls) {
      const res = await ctx.get(url, { headers: bearer(token) });
      expect({ url, status: res.status() }).toEqual({ url, status: 200 });
      const text = await res.text();
      const hit = forbidden.exec(text);
      expect({ url, leaked: hit && text.slice(Math.max(0, hit.index - 60), hit.index + 60) }).toEqual({ url, leaked: null });
    }

    // the register and verify responses too
    expect(forbidden.test(JSON.stringify(customer.user))).toBe(false);
    expect(forbidden.test(JSON.stringify(agency.body))).toBe(false);
  });

  test('the one-time code and the invite link reach the inbox only, never a response', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);
    const texts = [];
    const secrets = [];

    // sign-up, resend, verify
    const account = await registerCustomer(ctx);
    texts.push(await account.res.text());
    const signUpMail = await waitForMail(account.email, { after: account.mark });
    secrets.push(signUpMail.otp);
    texts.push(await (await ctx.post('/api/auth/resend-otp', { data: { email: account.email } })).text());
    texts.push(await (await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: signUpMail.otp } })).text());

    // forgot password
    const mark = mailCount();
    texts.push(await (await ctx.post('/api/auth/forgot-password', { data: { email: account.email } })).text());
    secrets.push((await waitForMail(account.email, { after: mark, subject: 'Reset' })).otp);

    // staff invite
    const staff = await createStaff(admin.token, { permissions: [] });
    texts.push(await staff.created.text());
    secrets.push(staff.inviteToken);

    expect(secrets.every((secret) => secret && secret.length >= 6)).toBe(true);
    for (const text of texts) {
      secrets.forEach((secret) => expect(text).not.toContain(secret));
      expect(text).not.toMatch(/"(otp|code|passcode|inviteToken|token)"\s*:/);
    }
    expect(JSON.parse(texts[0]).data.otpSent).toBe(true); // it only says an email went out
  });

  test('there is no static folder: uploaded files and project files are not served', async ({ client }) => {
    const ctx = await client();
    for (const path of ['/uploads/trade-license.pdf', '/storage/private/anything.pdf', '/storage', '/.env', '/package.json', '/config/env.js', '/firebase-service-account.json', '/documentation/ToDo.md']) {
      const res = await ctx.get(path);
      expect({ path, status: res.status() }).toEqual({ path, status: 404 });
      expect((await json(res)).success).toBe(false);
    }
  });
});

test.describe('hostile input', () => {
  test('malformed JSON is a clean 400, not a crash or a stack trace', async ({ client }) => {
    const ctx = await client();
    const res = await ctx.post('/api/auth/login', { headers: { 'Content-Type': 'application/json' }, data: '{"email": "a@e2e.test", "password": ' });
    const body = await json(res);

    expect(res.status()).toBe(400);
    expect(body).toMatchObject({ success: false, message: 'Malformed JSON in request body.' });
    expect(JSON.stringify(body)).not.toMatch(/stack|node_modules|at .*\(/);
  });

  test('a body over 100 kb is refused with 413', async ({ client }) => {
    const ctx = await client();
    const res = await ctx.post('/api/auth/login', { data: { email: emailFor('big'), password: 'x'.repeat(120_000) } });

    expect(res.status()).toBe(413);
    expect((await json(res)).success).toBe(false);
  });

  test('NoSQL operators in a login body never reach the database', async ({ client }) => {
    const ctx = await client();
    const { email } = await signUpCustomer(await client());

    const bodies = [
      { email: { $gt: '' }, password: cfg.PASSWORD },
      { email: { $ne: null }, password: { $ne: '' } },
      { email, password: { $ne: '' } },
      { email, password: { $gt: '' } }
    ];
    for (const data of bodies) {
      const res = await ctx.post('/api/auth/login', { data });
      expect({ data, status: res.status() }).toEqual({ data, status: 422 });
    }
  });

  test('NoSQL operators in a query string are stripped, not applied', async ({ client }) => {
    const ctx = await client();
    const admin = await adminSession(ctx);

    // if "$ne" were applied this would hide the admin from the list
    const res = await ctx.get('/api/admin/users?role[$ne]=ADMIN&email[$regex]=.*&limit=100', { headers: bearer(admin.token) });

    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      expect((await json(res)).data.some((u) => u.email === cfg.ADMIN.email)).toBe(true);
    }
  });

  test('a 404 and a validation error use the same envelope, with no stack trace', async ({ client }) => {
    const ctx = await client();
    const missing = await ctx.get('/api/nope');
    const invalid = await ctx.post('/api/auth/login', { data: { email: 'not-an-email' } });

    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toMatch(/application\/json/);
    expect(invalid.status()).toBe(422);
    for (const res of [missing, invalid]) {
      const body = await json(res);
      expect(body.success).toBe(false);
      expect(body.stack).toBeUndefined();
    }
  });
});

test.describe('service endpoints', () => {
  test('root and health answer, health reports the database', async ({ client }) => {
    const ctx = await client();

    expect(await json(await ctx.get('/'))).toMatchObject({ success: true, message: 'API is running.' });
    expect(await json(await ctx.get('/health'))).toMatchObject({ success: true, db: 'up' });
  });

  test('Google sign-in answers 503 FIREBASE_DISABLED when the server has no Firebase key', async ({ client }) => {
    const ctx = await client();
    const res = await ctx.post('/api/auth/firebase', { data: { idToken: 'x'.repeat(40) } });

    expect(res.status()).toBe(503);
    expect((await json(res)).code).toBe('FIREBASE_DISABLED');
  });
});
