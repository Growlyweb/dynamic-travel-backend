const request = require('supertest');

const app = require('../../app');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const { ROLES, USER_STATUS } = require('../../config/constants');
const { PASSWORD, createUser, lastEmailTo } = require('./helpers/factory');

const register = (body = {}) =>
  request(app)
    .post('/api/auth/register')
    .send({ name: 'Rahim Uddin', email: 'rahim@example.com', password: PASSWORD, ...body });

describe('B2C registration and email verification', () => {
  it('creates a PENDING B2C account, emails an OTP, and never returns the hash', async () => {
    const res = await register({ phone: '+8801712345678' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'rahim@example.com', role: ROLES.B2C, status: USER_STATUS.PENDING });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const mail = lastEmailTo('rahim@example.com');
    expect(mail.otp).toMatch(/^\d{6}$/);
    expect(mail.passcode).toBe(mail.otp); // for templates that use {{passcode}}
    expect(mail.time).not.toBe(''); // "valid till ..." for templates that use {{time}}

    const stored = await User.findOne({ email: 'rahim@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('ignores role, status, permissions and partnerId sent in the body', async () => {
    const res = await register({
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      permissions: ['USER_MANAGE'],
      partnerId: '64b7f0f0f0f0f0f0f0f0f0f0',
      emailVerified: true
    });

    expect(res.status).toBe(201);
    const stored = await User.findOne({ email: 'rahim@example.com' });
    expect(stored.role).toBe(ROLES.B2C);
    expect(stored.status).toBe(USER_STATUS.PENDING);
    expect(stored.permissions).toEqual([]);
    expect(stored.partnerId).toBeUndefined();
    expect(stored.emailVerified).toBe(false);
  });

  it('rejects a weak password with field errors (422)', async () => {
    const res = await register({ password: 'weak' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.some((e) => e.field === 'body.password')).toBe(true);
  });

  it('rejects a duplicate email (409) and a duplicate phone (409)', async () => {
    await register({ phone: '+8801712345678' });

    const sameEmail = await register({ phone: '+8801799999999' });
    expect(sameEmail.status).toBe(409);

    const samePhone = await register({ email: 'other@example.com', phone: '+8801712345678' });
    expect(samePhone.status).toBe(409);
  });

  it('blocks login until the email is verified', async () => {
    await register();

    const res = await request(app).post('/api/auth/login').send({ email: 'rahim@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('activates the account with the right OTP and returns tokens (cookie for web)', async () => {
    await register();
    const { otp } = lastEmailTo('rahim@example.com');

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toBeUndefined(); // web gets it as a cookie only
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=.*HttpOnly/i);
    expect(res.body.data.user.status).toBe(USER_STATUS.ACTIVE);
    expect(res.body.data.user.emailVerified).toBe(true);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('rahim@example.com');
  });

  it('gives mobile clients the refresh token in the body instead of a cookie', async () => {
    await register();
    const { otp } = lastEmailTo('rahim@example.com');

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .set('X-Client-Type', 'mobile')
      .send({ email: 'rahim@example.com', otp });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a wrong OTP and an OTP that was already used', async () => {
    await register();
    const { otp } = lastEmailTo('rahim@example.com');
    const wrong = otp === '000000' ? '111111' : '000000';

    const bad = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp: wrong });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp });
    expect(ok.status).toBe(200);

    const reuse = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp });
    expect(reuse.status).toBe(400);
  });

  it('locks an OTP after 5 wrong attempts, even if the right code follows', async () => {
    await register();
    const { otp } = lastEmailTo('rahim@example.com');
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp: wrong });
      expect(res.status).toBe(400);
    }

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp });
    expect(res.status).toBe(400);
  });

  it('resend-otp replaces the old code and answers the same for unknown emails', async () => {
    await register();
    const first = lastEmailTo('rahim@example.com').otp;

    const resend = await request(app).post('/api/auth/resend-otp').send({ email: 'rahim@example.com' });
    expect(resend.status).toBe(200);
    const second = lastEmailTo('rahim@example.com').otp;

    if (first !== second) {
      const old = await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp: first });
      expect(old.status).toBe(400);
    }

    const ghost = await request(app).post('/api/auth/resend-otp').send({ email: 'nobody@example.com' });
    expect(ghost.status).toBe(200);
    expect(ghost.body.message).toBe(resend.body.message);
  });

  it('does not re-activate a suspended account through OTP verification', async () => {
    const user = await createUser({ status: USER_STATUS.SUSPENDED, email: 'sus@example.com' });
    const res = await request(app).post('/api/auth/resend-otp').send({ email: user.email });
    expect(res.status).toBe(200);
    expect(lastEmailTo(user.email)).toBeUndefined(); // only PENDING accounts get a code
  });

  it('writes REGISTER and EMAIL_VERIFIED audit records', async () => {
    await register();
    const { otp } = lastEmailTo('rahim@example.com');
    await request(app).post('/api/auth/verify-otp').send({ email: 'rahim@example.com', otp });

    const actions = (await AuditLog.find().lean()).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(['REGISTER', 'EMAIL_VERIFIED', 'LOGIN']));
  });
});
