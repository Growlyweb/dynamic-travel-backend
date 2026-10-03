const request = require('supertest');

const app = require('../app');
const User = require('../models/User');
const env = require('../config/env');
const { createUser } = require('./helpers/factory');

describe('hardening and error envelope', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('only allows configured CORS origins, with credentials', async () => {
    const allowed = env.corsOrigins[0];

    const ok = await request(app).get('/').set('Origin', allowed);
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app).get('/').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the headers a cross-origin frontend needs (Retry-After, rate limit info, file name)', async () => {
    const res = await request(app).get('/').set('Origin', env.corsOrigins[0]);
    const exposed = (res.headers['access-control-expose-headers'] || '').toLowerCase().split(',').map((h) => h.trim());

    expect(exposed).toEqual(expect.arrayContaining(['retry-after', 'ratelimit', 'ratelimit-policy', 'content-disposition']));
  });

  it('does not read the developer .env under test', () => {
    // The sandbox of a real project has a .env with real keys. Tests must run on built-in values.
    expect(env.firebase.enabled).toBe(false);
    expect(env.mail.provider).toBe('memory');
    expect(env.jwt.accessSecret).toMatch(/^test-/);
  });

  it('has no public static folder for uploads', async () => {
    expect((await request(app).get('/uploads/anything.png')).status).toBe(404);
    expect((await request(app).get('/storage/private/partners/anything.pdf')).status).toBe(404);
  });

  it('reports health with database status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, db: 'up' });
  });

  it('returns the same envelope for 404, malformed JSON and oversized bodies', async () => {
    const notFound = await request(app).get('/api/nope');
    expect(notFound.status).toBe(404);
    expect(notFound.body).toMatchObject({ success: false });

    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(badJson.status).toBe(400);
    expect(badJson.body).toEqual({ success: false, message: 'Malformed JSON in request body.' });

    const huge = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200 * 1024) });
    expect(huge.status).toBe(413);
    expect(huge.body.success).toBe(false);
  });

  it('never leaks stack traces or internals in a 4xx/5xx body', async () => {
    const res = await request(app).get('/api/admin/users/not-an-id');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules|mongoose/i);
  });

  it('strips NoSQL operators from bodies, so they cannot reach a query', async () => {
    const user = await createUser({ email: 'victim@example.com' });

    // Classic login bypass: { "email": { "$ne": null }, "password": { "$ne": null } }
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });

    expect(res.status).toBe(422);
    expect(await User.countDocuments({ _id: user._id })).toBe(1);
  });

  it('collapses duplicated query parameters (HTTP parameter pollution)', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const { bearer } = require('./helpers/factory');

    const res = await request(app).get('/api/admin/users?role=B2C&role=ADMIN').set(bearer(admin));
    expect(res.status).toBe(200); // hpp keeps the last value instead of passing an array to zod
  });
});
