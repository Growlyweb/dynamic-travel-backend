const { test, expect } = require('../helpers/test');
const { cfg, bearer, emailFor, mailCount, readMail, waitForMail, registerCustomer, signUpCustomer, login, json } = require('../helpers/api');

const readMailTo = (to, after) => readMail().slice(after).filter((m) => m.to_email === to);

const cookieOf = async (ctx, name = 'refreshToken') => (await ctx.storageState()).cookies.find((c) => c.name === name);

test.describe('customer sign-up, verification and sessions', () => {
  test('registers, is blocked until the email code is entered, then verifies and signs in', async ({ client }) => {
    const ctx = await client();
    const account = await registerCustomer(ctx);

    expect(account.res.status()).toBe(201);
    const created = await json(account.res);
    expect(created.data.user).toMatchObject({ email: account.email, role: 'B2C', status: 'PENDING', emailVerified: false });
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|\$2[aby]\$/);

    // cannot log in yet, and the answer says why
    const early = await ctx.post('/api/auth/login', { data: { email: account.email, password: account.password } });
    expect(early.status()).toBe(403);
    expect((await json(early)).code).toBe('EMAIL_NOT_VERIFIED');

    const mail = await waitForMail(account.email, { after: account.mark });
    expect(mail.otp).toMatch(/^\d{6}$/);
    expect(mail.passcode).toBe(mail.otp);
    expect(mail.time).not.toBe('');

    const wrong = await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: mail.otp === '000000' ? '111111' : '000000' } });
    expect(wrong.status()).toBe(400);
    expect((await json(wrong)).code).toBe('INVALID_CODE');

    const verified = await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: mail.otp } });
    expect(verified.status()).toBe(200);
    const session = await json(verified);
    expect(session.data.user.status).toBe('ACTIVE');
    expect(session.data.refreshToken).toBeUndefined(); // web clients never see it in the body

    const me = await ctx.get('/api/auth/me', { headers: bearer(session.data.accessToken) });
    expect(me.status()).toBe(200);
    expect((await json(me)).data.user.email).toBe(account.email);

    // the code works once
    const again = await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: mail.otp } });
    expect(again.status()).toBe(400);
  });

  test('the refresh token is an httpOnly cookie scoped to /api/auth', async ({ client }) => {
    const ctx = await client();
    const { verify } = await signUpCustomer(ctx);

    const setCookie = verify.headers()['set-cookie'];
    expect(setCookie).toMatch(/refreshToken=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const cookie = await cookieOf(ctx);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/auth' });
  });

  test('role, status and permissions in the request body are ignored', async ({ client }) => {
    const ctx = await client();
    const email = emailFor('inject');
    const res = await ctx.post('/api/auth/register', {
      data: { name: 'Sneaky', email, password: cfg.PASSWORD, role: 'ADMIN', status: 'ACTIVE', permissions: ['USER_MANAGE'], emailVerified: true }
    });

    expect(res.status()).toBe(201);
    expect((await json(res)).data.user).toMatchObject({ role: 'B2C', status: 'PENDING', permissions: [], emailVerified: false });
  });

  test('rejects a weak password with a field list, and a duplicate email', async ({ client }) => {
    const ctx = await client();
    const weak = await ctx.post('/api/auth/register', { data: { name: 'Weak', email: emailFor('weak'), password: 'weak' } });
    expect(weak.status()).toBe(422);
    const body = await json(weak);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.map((e) => e.field)).toContain('body.password');

    const first = await signUpCustomer(ctx);
    const dup = await ctx.post('/api/auth/register', { data: { name: 'Dup', email: first.email, password: cfg.PASSWORD } });
    expect(dup.status()).toBe(409);
    expect((await json(dup)).code).toBe('EMAIL_TAKEN');
  });

  test('resend is throttled, then a new code replaces the old one', async ({ client }) => {
    const ctx = await client();
    const account = await registerCustomer(ctx);
    const first = await waitForMail(account.email, { after: account.mark });

    // asking again straight away is throttled: same friendly answer, but no second e-mail
    const mark = mailCount();
    const early = await ctx.post('/api/auth/resend-otp', { data: { email: account.email } });
    expect(early.status()).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    expect(mailCount()).toBe(mark);

    // after the cooldown (2 s on this server, 60 s in production) a new code is sent
    await new Promise((r) => setTimeout(r, 2000));
    expect((await ctx.post('/api/auth/resend-otp', { data: { email: account.email } })).status()).toBe(200);
    const second = await waitForMail(account.email, { after: mark });

    if (first.otp !== second.otp) {
      const old = await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: first.otp } });
      expect(old.status()).toBe(400);
    }
    expect((await ctx.post('/api/auth/verify-otp', { data: { email: account.email, otp: second.otp } })).status()).toBe(200);
  });

  test('resend answers the same for an unknown email and sends nothing', async ({ client }) => {
    const ctx = await client();
    const mark = mailCount();
    const ghost = emailFor('ghost');

    const res = await ctx.post('/api/auth/resend-otp', { data: { email: ghost } });

    expect(res.status()).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(readMailTo(ghost, mark)).toHaveLength(0);
  });

  test('login gives one answer for an unknown email and a wrong password', async ({ client }) => {
    const ctx = await client();
    const { email } = await signUpCustomer(ctx);

    const unknown = await login(ctx, emailFor('ghost'), 'Wrong!Pass1');
    const wrong = await login(ctx, email, 'Wrong!Pass1');

    expect(unknown.res.status()).toBe(401);
    expect(wrong.res.status()).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.message).toBe('Invalid credentials');
  });
});

test.describe('refresh tokens and logout', () => {
  test('refresh rotates the token, and replaying an old one signs the user out everywhere', async ({ client }) => {
    const owner = await client();
    const { email } = await signUpCustomer(owner);
    const original = (await cookieOf(owner)).value;

    const rotated = await owner.post('/api/auth/refresh');
    expect(rotated.status()).toBe(200);
    const fresh = (await cookieOf(owner)).value;
    expect(fresh).not.toBe(original);

    // an attacker who copied the first cookie replays it
    const attacker = await client();
    const replay = await attacker.post('/api/auth/refresh', { headers: { Cookie: `refreshToken=${original}` } });
    expect(replay.status()).toBe(401);

    // ...and the owner's newer token is now dead too
    expect((await owner.post('/api/auth/refresh')).status()).toBe(401);
    expect((await login(owner, email)).res.status()).toBe(200); // logging in again still works
  });

  test('mobile clients get the refresh token in the body, with no cookie, and can rotate it', async ({ client }) => {
    const ctx = await client();
    const { email } = await signUpCustomer(ctx);
    const mobile = await client(undefined, { extraHTTPHeaders: { 'X-Client-Type': 'mobile' } });

    const res = await mobile.post('/api/auth/login', { data: { email, password: cfg.PASSWORD } });
    const body = await json(res);
    expect(body.data.refreshToken).toEqual(expect.any(String));
    expect(res.headers()['set-cookie']).toBeUndefined();

    const rotated = await mobile.post('/api/auth/refresh', { data: { refreshToken: body.data.refreshToken } });
    expect(rotated.status()).toBe(200);
    const next = await json(rotated);
    expect(next.data.refreshToken).not.toBe(body.data.refreshToken);

    // the old body token is now a stolen token
    expect((await mobile.post('/api/auth/refresh', { data: { refreshToken: body.data.refreshToken } })).status()).toBe(401);
  });

  test('logout ends this device only; logout with allDevices ends every session and live token', async ({ client }) => {
    const phone = await client();
    const laptop = await client();
    const { email } = await signUpCustomer(phone);
    const onLaptop = await login(laptop, email);

    // log out the phone only
    const phoneToken = (await login(phone, email)).token;
    expect((await phone.post('/api/auth/logout', { headers: bearer(phoneToken), data: {} })).status()).toBe(200);
    expect((await phone.post('/api/auth/refresh')).status()).toBe(401);
    expect((await laptop.post('/api/auth/refresh')).status()).toBe(200); // the laptop is untouched

    // now everywhere
    const live = (await laptop.post('/api/auth/refresh').then(json)).data.accessToken;
    expect((await laptop.post('/api/auth/logout', { headers: bearer(live), data: { allDevices: true } })).status()).toBe(200);
    expect((await laptop.get('/api/auth/me', { headers: bearer(onLaptop.token) })).status()).toBe(401);
    expect((await laptop.post('/api/auth/refresh')).status()).toBe(401);
  });

  test('a missing, malformed or forged access token is refused', async ({ client }) => {
    const ctx = await client();
    expect((await ctx.get('/api/auth/me')).status()).toBe(401);
    expect((await ctx.get('/api/auth/me', { headers: { Authorization: 'Token abc' } })).status()).toBe(401);
    expect((await ctx.get('/api/auth/me', { headers: bearer('not.a.jwt') })).status()).toBe(401);

    // a refresh token is not an access token
    const { email } = await signUpCustomer(ctx);
    const refresh = (await ctx.storageState()).cookies.find((c) => c.name === 'refreshToken').value;
    expect((await ctx.get('/api/auth/me', { headers: bearer(refresh) })).status()).toBe(401);
    expect(email).toBeTruthy();
  });
});
