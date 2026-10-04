const request = require('supertest');

const app = require('../../app');
const User = require('../../models/User');
const RefreshSession = require('../../models/RefreshSession');
const AuditLog = require('../../models/AuditLog');
const { USER_STATUS } = require('../../config/constants');
const { PASSWORD, createUser, bearer, loginRequest } = require('./helpers/factory');

// "refreshToken=abc; Path=/api/auth; HttpOnly" -> "refreshToken=abc"
const cookieOf = (res) => res.headers['set-cookie'][0].split(';')[0];

const refreshWith = (cookie) => request(app).post('/api/auth/refresh').set('Cookie', cookie);

describe('login', () => {
  it('returns an access token, a refresh cookie, and no password hash', async () => {
    const user = await createUser();

    const res = await loginRequest(user.email);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=.*Path=\/api\/auth.*HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await User.findById(user._id)).lastLoginAt).toBeInstanceOf(Date);
  });

  it('answers identically for an unknown email and a wrong password', async () => {
    const user = await createUser();

    const unknown = await loginRequest('ghost@example.com');
    const wrong = await loginRequest(user.email, 'Wrong!Pass1');

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.message).toBe('Invalid credentials');
  });

  it('records a LOGIN_FAILED audit entry for an existing account', async () => {
    const user = await createUser();
    await loginRequest(user.email, 'Wrong!Pass1');

    const log = await AuditLog.findOne({ action: 'LOGIN_FAILED' });
    expect(String(log.targetUserId)).toBe(String(user._id));
    expect(log.result).toBe('FAILURE');
  });

  it.each([USER_STATUS.SUSPENDED, USER_STATUS.BLOCKED, USER_STATUS.INACTIVE])('denies a %s account', async (status) => {
    const user = await createUser({ status });
    const res = await loginRequest(user.email);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('cannot log in with a password on an account that only uses Firebase', async () => {
    const user = await createUser({ email: 'fb@example.com' });
    await User.updateOne({ _id: user._id }, { $unset: { passwordHash: 1 } });

    const res = await loginRequest('fb@example.com');
    expect(res.status).toBe(401);
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });
});

describe('authenticate middleware', () => {
  it('rejects a missing, malformed, or invalid token with 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Token abc')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });

  it('rejects a refresh token used as an access token', async () => {
    const user = await createUser();
    const login = await loginRequest(user.email);
    const refreshJwt = cookieOf(login).split('=')[1];

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refreshJwt}`);
    expect(res.status).toBe(401);
  });

  it('applies a suspension immediately, even to a token that is still valid', async () => {
    const user = await createUser();
    const headers = bearer(user);
    expect((await request(app).get('/api/auth/me').set(headers)).status).toBe(200);

    await User.updateOne({ _id: user._id }, { status: USER_STATUS.SUSPENDED });

    const res = await request(app).get('/api/auth/me').set(headers);
    expect(res.status).toBe(403);
  });

  it('rejects tokens issued before tokenVersion was bumped', async () => {
    const user = await createUser();
    const headers = bearer(user);

    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });

    expect((await request(app).get('/api/auth/me').set(headers)).status).toBe(401);
  });

  it('rejects a token for a deleted user', async () => {
    const user = await createUser();
    const headers = bearer(user);
    await User.deleteOne({ _id: user._id });

    expect((await request(app).get('/api/auth/me').set(headers)).status).toBe(401);
  });
});

describe('refresh with rotation', () => {
  it('issues a new pair and invalidates the old refresh token', async () => {
    const user = await createUser();
    const login = await loginRequest(user.email);
    const first = cookieOf(login);

    const refreshed = await refreshWith(first);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

    const second = cookieOf(refreshed);
    expect(second).not.toBe(first);
    expect((await refreshWith(second)).status).toBe(200);
  });

  it('treats reuse of an already-rotated token as theft and revokes every session', async () => {
    const user = await createUser();
    const login = await loginRequest(user.email);
    const stolen = cookieOf(login);

    const legit = await refreshWith(stolen);
    const legitCookie = cookieOf(legit);

    const replay = await refreshWith(stolen); // attacker replays the old token
    expect(replay.status).toBe(401);

    // The legitimate holder's newer token is now dead too
    expect((await refreshWith(legitCookie)).status).toBe(401);
    expect(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'TOKEN_REUSE_DETECTED' })).toBe(1);
  });

  it('accepts the token from the body for mobile clients', async () => {
    const user = await createUser();
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Client-Type', 'mobile')
      .send({ email: user.email, password: PASSWORD });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: login.body.data.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  it('refuses without a token, with garbage, or after the account is suspended', async () => {
    expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(401);
    expect((await refreshWith('refreshToken=garbage')).status).toBe(401);

    const user = await createUser();
    const cookie = cookieOf(await loginRequest(user.email));
    await User.updateOne({ _id: user._id }, { status: USER_STATUS.SUSPENDED });
    expect((await refreshWith(cookie)).status).toBe(403);
  });

  it('does not store the raw refresh token', async () => {
    const user = await createUser();
    const login = await loginRequest(user.email);
    const raw = cookieOf(login).split('=')[1];

    const sessions = await RefreshSession.find({ userId: user._id }).lean();
    expect(sessions).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toContain(raw);
  });
});

describe('logout', () => {
  it('revokes this device only', async () => {
    const user = await createUser();
    const deviceA = await loginRequest(user.email);
    const deviceB = await loginRequest(user.email);

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${deviceA.body.data.accessToken}`)
      .set('Cookie', cookieOf(deviceA))
      .send({});
    expect(out.status).toBe(200);

    expect((await refreshWith(cookieOf(deviceA))).status).toBe(401);
    expect((await refreshWith(cookieOf(deviceB))).status).toBe(200);
  });

  it('allDevices signs out everywhere, including live access tokens', async () => {
    const user = await createUser();
    const deviceA = await loginRequest(user.email);
    const deviceB = await loginRequest(user.email);

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${deviceA.body.data.accessToken}`)
      .send({ allDevices: true });
    expect(out.status).toBe(200);

    expect((await refreshWith(cookieOf(deviceB))).status).toBe(401);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${deviceB.body.data.accessToken}`);
    expect(me.status).toBe(401);
    expect(await AuditLog.countDocuments({ action: 'LOGOUT' })).toBe(1);
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/auth/logout').send({})).status).toBe(401);
  });
});
