const request = require('supertest');

const app = require('../app');
const env = require('../config/env');
const { PASSWORD, createUser, bearer, unique } = require('./helpers/factory');

// Limiters are off in every other suite. Here they are switched on, and the counters start
// empty because each test file gets its own copy of the app.
beforeAll(() => {
  env.rateLimitEnabled = true;
});
afterAll(() => {
  env.rateLimitEnabled = false;
});

const emailFor = (label) => `${unique(label)}@example.com`;

// Sends `count` requests in order and returns every status code.
const hit = async (count, send) => {
  const statuses = [];
  for (let i = 0; i < count; i += 1) statuses.push((await send()).status);
  return statuses;
};

describe('rate limiting', () => {
  it('login: 10 tries per IP + email, then 429 with Retry-After; another email is unaffected', async () => {
    const email = emailFor('login');
    const login = (address) => request(app).post('/api/auth/login').send({ email: address, password: 'Wrong!Pass1' });

    const first = await hit(10, () => login(email));
    expect(first.every((s) => s === 401)).toBe(true);

    const blocked = await login(email);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit']).toBeDefined();

    expect((await login(emailFor('other'))).status).toBe(401);
  });

  it('login: the limit also stops the CORRECT password once the quota is used up', async () => {
    const user = await createUser();
    const login = (password) => request(app).post('/api/auth/login').send({ email: user.email, password });

    await hit(10, () => login('Wrong!Pass1'));

    expect((await login(PASSWORD)).status).toBe(429);
  });

  it('forgot-password: 3 per hour per IP + email', async () => {
    const email = emailFor('forgot');
    const forgot = () => request(app).post('/api/auth/forgot-password').send({ email });

    expect(await hit(3, forgot)).toEqual([200, 200, 200]);
    expect((await forgot()).status).toBe(429);
  });

  it('OTP routes share one quota of 5 per IP + email', async () => {
    const email = emailFor('otp');
    const verify = () => request(app).post('/api/auth/verify-otp').send({ email, otp: '123456' });

    expect(await hit(5, verify)).toEqual([400, 400, 400, 400, 400]);
    expect((await verify()).status).toBe(429);
    // the same quota covers the other OTP-style routes for that email
    expect((await request(app).post('/api/auth/resend-otp').send({ email })).status).toBe(429);
    expect((await request(app).post('/api/auth/reset-password').send({ email, otp: '123456', newPassword: PASSWORD })).status).toBe(429);
  });

  it('register: 10 per hour per IP (invalid attempts count too), for B2C and B2B together', async () => {
    const attempt = () => request(app).post('/api/auth/register').send({});

    expect(await hit(10, attempt)).toEqual(Array(10).fill(422));
    expect((await attempt()).status).toBe(429);
    expect((await request(app).post('/api/auth/b2b/register').field('name', 'x')).status).toBe(429);
  });

  it('refresh: 30 per IP per 15 minutes', async () => {
    const refresh = () => request(app).post('/api/auth/refresh').send({});

    expect((await hit(30, refresh)).every((s) => s === 401)).toBe(true);
    expect((await refresh()).status).toBe(429);
  });

  it('change-password: 5 per signed-in user, so a stolen token cannot guess the current password', async () => {
    const victim = await createUser();
    const bystander = await createUser();
    const change = (user) =>
      request(app)
        .post('/api/auth/change-password')
        .set(bearer(user))
        .send({ currentPassword: 'Wrong!Pass1', newPassword: 'N3w!Passw0rd' });

    expect(await hit(5, () => change(victim))).toEqual([401, 401, 401, 401, 401]);
    expect((await change(victim)).status).toBe(429);

    // the limit is per user, not shared
    expect((await change(bystander)).status).toBe(401);
  });

  it('is skipped when switched off', async () => {
    env.rateLimitEnabled = false;
    try {
      const email = emailFor('off');
      const statuses = await hit(15, () => request(app).post('/api/auth/login').send({ email, password: 'Wrong!Pass1' }));
      expect(statuses.every((s) => s === 401)).toBe(true);
    } finally {
      env.rateLimitEnabled = true;
    }
  });
});
