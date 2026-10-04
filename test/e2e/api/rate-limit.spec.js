const { test, expect } = require('../helpers/test');
const { cfg, bearer, emailFor, json, signUpCustomer } = require('../helpers/api');

// These run against the SECOND server (LIMITED_API_URL), which has rate limiting switched on.
// It shares the database and secrets with the main server, so accounts and tokens made there work here.
// Counters live in that server's memory and key on IP, so every test uses its own e-mail addresses,
// and the IP-only limiters (register, refresh) are each used by exactly one test.

const limited = (client) => client(cfg.LIMITED_API_URL);

const expectBlocked = async (res, { message } = {}) => {
  const body = await json(res);
  expect(res.status()).toBe(429);
  expect(body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
  if (message) expect(body.message).toMatch(message);
  expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
  expect(res.headers().ratelimit).toBeTruthy();
};

test.describe('rate limits over real HTTP', () => {
  test('login: 10 tries per e-mail, then 429 for the right password too, other e-mails stay open', async ({ client }) => {
    const { email } = await signUpCustomer(await client());
    const bystander = await signUpCustomer(await client());
    const ctx = await limited(client);

    for (let i = 1; i <= 10; i += 1) {
      const res = await ctx.post('/api/auth/login', { data: { email, password: 'Wrong!Pass1' } });
      expect({ attempt: i, status: res.status() }).toEqual({ attempt: i, status: 401 });
    }

    await expectBlocked(await ctx.post('/api/auth/login', { data: { email, password: 'Wrong!Pass1' } }), { message: /login attempts/ });
    await expectBlocked(await ctx.post('/api/auth/login', { data: { email, password: cfg.PASSWORD } })); // the right password is blocked as well
    // same address, different account: not blocked
    expect((await ctx.post('/api/auth/login', { data: { email: bystander.email, password: cfg.PASSWORD } })).status()).toBe(200);
  });

  test('forgot password: 3 per hour per e-mail, the 4th is blocked', async ({ client }) => {
    const { email } = await signUpCustomer(await client());
    const ctx = await limited(client);

    for (let i = 0; i < 3; i += 1) {
      expect((await ctx.post('/api/auth/forgot-password', { data: { email } })).status()).toBe(200);
    }
    await expectBlocked(await ctx.post('/api/auth/forgot-password', { data: { email } }), { message: /password reset requests/ });
    expect((await ctx.post('/api/auth/forgot-password', { data: { email: emailFor('other') } })).status()).toBe(200);
  });

  test('code guessing: verify, resend and reset share one quota of 5 per e-mail', async ({ client }) => {
    const email = emailFor('guess');
    const ctx = await limited(client);

    for (let i = 0; i < 3; i += 1) {
      expect((await ctx.post('/api/auth/verify-otp', { data: { email, otp: '000000' } })).status()).toBe(400);
    }
    expect((await ctx.post('/api/auth/resend-otp', { data: { email } })).status()).toBe(200);
    expect((await ctx.post('/api/auth/reset-password', { data: { email, otp: '000000', newPassword: 'N3w!Passw0rd' } })).status()).toBe(400);

    // five used up across three different routes: any of them is now blocked
    await expectBlocked(await ctx.post('/api/auth/verify-otp', { data: { email, otp: '000000' } }), { message: /Too many attempts/ });
    await expectBlocked(await ctx.post('/api/auth/resend-otp', { data: { email } }));
    await expectBlocked(await ctx.post('/api/auth/reset-password', { data: { email, otp: '000000', newPassword: 'N3w!Passw0rd' } }));
  });

  test('change password: 5 per signed-in user, counted for the user and not the address', async ({ client }) => {
    const victim = await signUpCustomer(await client());
    const other = await signUpCustomer(await client());
    const ctx = await limited(client);
    const attempt = (token) => ctx.post('/api/auth/change-password', { headers: bearer(token), data: { currentPassword: 'Wrong!Pass1', newPassword: 'N3w!Passw0rd' } });

    for (let i = 0; i < 5; i += 1) {
      expect((await attempt(victim.token)).status()).toBe(401);
    }
    await expectBlocked(await attempt(victim.token), { message: /password change attempts/ });
    // a different user from the same address still gets a normal answer (wrong password, not blocked)
    expect((await attempt(other.token)).status()).toBe(401);
  });

  test('register: 10 per address per hour, shared by the customer and the agency form', async ({ client }) => {
    const ctx = await limited(client);

    // invalid bodies: they create nothing, but they still count
    for (let i = 0; i < 5; i += 1) {
      expect((await ctx.post('/api/auth/register', { data: {} })).status()).toBe(422);
      expect((await ctx.post('/api/auth/b2b/register', { multipart: { name: 'x' } })).status()).toBeLessThan(429);
    }

    await expectBlocked(await ctx.post('/api/auth/register', { data: {} }), { message: /registrations/ });
    await expectBlocked(await ctx.post('/api/auth/b2b/register', { multipart: { name: 'x' } }));
  });

  test('refresh: 30 per address, then 429', async ({ client }) => {
    const ctx = await limited(client);

    for (let i = 1; i <= 30; i += 1) {
      const res = await ctx.post('/api/auth/refresh');
      if (res.status() !== 401) throw new Error(`refresh #${i} answered ${res.status()} instead of 401`);
    }
    await expectBlocked(await ctx.post('/api/auth/refresh'), { message: /token refresh/ });
  });

  test('the main server has no limits switched on, so the other suites are never throttled', async ({ client }) => {
    const ctx = await client();
    const email = emailFor('nolimit');

    for (let i = 0; i < 15; i += 1) {
      expect((await ctx.post('/api/auth/login', { data: { email, password: 'Wrong!Pass1' } })).status()).toBe(401);
    }
  });
});
