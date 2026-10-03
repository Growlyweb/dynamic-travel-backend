const request = require('supertest');

const app = require('../../app');
const User = require('../../models/User');
const RefreshSession = require('../../models/RefreshSession');
const OtpToken = require('../../models/OtpToken');
const AuditLog = require('../../models/AuditLog');
const { PASSWORD, createUser, bearer, lastEmailTo, loginRequest } = require('./helpers/factory');

const NEW_PASSWORD = 'N3w!Passw0rd';
const cookieOf = (res) => res.headers['set-cookie'][0].split(';')[0];

describe('forgot / verify / reset password', () => {
  it('answers the same for an unknown email and sends no email', async () => {
    const known = await createUser({ email: 'known@example.com' });
    const a = await request(app).post('/api/auth/forgot-password').send({ email: known.email });
    const b = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(lastEmailTo('known@example.com').otp).toMatch(/^\d{6}$/);
    expect(lastEmailTo('ghost@example.com')).toBeUndefined();
  });

  it('stores only a hash of the OTP', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const { otp } = lastEmailTo(user.email);

    const record = await OtpToken.findOne({ userId: user._id }).lean();
    expect(record.tokenHash).not.toContain(otp);
    expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verify-reset-token checks the code without using it up', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const { otp } = lastEmailTo(user.email);

    expect((await request(app).post('/api/auth/verify-reset-token').send({ email: user.email, otp })).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-reset-token').send({ email: user.email, otp })).status).toBe(200);
    expect(
      (await request(app).post('/api/auth/verify-reset-token').send({ email: user.email, otp: otp === '123456' ? '654321' : '123456' }))
        .status
    ).toBe(400);
  });

  it('resets the password, signs out all devices, and the code works once', async () => {
    const user = await createUser();
    const session = await loginRequest(user.email);

    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const { otp } = lastEmailTo(user.email);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, otp, newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    expect((await loginRequest(user.email, PASSWORD)).status).toBe(401);
    expect((await loginRequest(user.email, NEW_PASSWORD)).status).toBe(200);

    // old devices are dead
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.body.data.accessToken}`)).status
    ).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookieOf(session))).status).toBe(401);

    // single use
    const again = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, otp, newPassword: 'An0ther!Pass' });
    expect(again.status).toBe(400);

    expect(await AuditLog.countDocuments({ action: 'PASSWORD_RESET' })).toBe(1);
    expect(lastEmailTo(user.email).subject).toMatch(/password was changed/i);
  });

  it('rejects a weak new password and a wrong code', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const { otp } = lastEmailTo(user.email);

    const weak = await request(app).post('/api/auth/reset-password').send({ email: user.email, otp, newPassword: 'short' });
    expect(weak.status).toBe(422);

    const wrongCode = otp === '123456' ? '654321' : '123456';
    const bad = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, otp: wrongCode, newPassword: NEW_PASSWORD });
    expect(bad.status).toBe(400);
  });

  it('locks the code after 5 wrong tries', async () => {
    const user = await createUser();
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const { otp } = lastEmailTo(user.email);
    const wrong = otp === '123456' ? '654321' : '123456';

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/reset-password').send({ email: user.email, otp: wrong, newPassword: NEW_PASSWORD });
    }

    const res = await request(app).post('/api/auth/reset-password').send({ email: user.email, otp, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect((await loginRequest(user.email, PASSWORD)).status).toBe(200); // password unchanged
  });

  it('does not issue a reset code for a suspended account', async () => {
    const user = await createUser({ status: 'SUSPENDED' });
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(lastEmailTo(user.email)).toBeUndefined();
  });
});

describe('change password', () => {
  it('requires the current password', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: 'Wrong!Pass1', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('rejects reusing the same password and weak passwords', async () => {
    const user = await createUser();
    const same = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);

    const weak = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: PASSWORD, newPassword: 'abc' });
    expect(weak.status).toBe(422);
  });

  it('logs out other devices but keeps this one signed in with fresh tokens', async () => {
    const user = await createUser();
    const thisDevice = await loginRequest(user.email);
    const otherDevice = await loginRequest(user.email);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${thisDevice.body.data.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    // the new access token works
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`)).status).toBe(200);
    // the old one and the other device do not
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${thisDevice.body.data.accessToken}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookieOf(otherDevice))).status).toBe(401);

    expect((await loginRequest(user.email, NEW_PASSWORD)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'PASSWORD_CHANGED' })).toBe(1);
    expect((await User.findById(user._id)).tokenVersion).toBe(1);
    expect(await RefreshSession.countDocuments({ userId: user._id, revokedAt: null })).toBeGreaterThanOrEqual(1);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
