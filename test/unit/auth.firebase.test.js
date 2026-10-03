const request = require('supertest');

const app = require('../../app');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const firebaseService = require('../../services/firebaseService');
const { ROLES, USER_STATUS, AUTH_PROVIDERS } = require('../../config/constants');
const { PASSWORD, createUser, loginRequest, lastEmailTo } = require('./helpers/factory');

const ID_TOKEN = 'x'.repeat(40);

const signIn = (headers = {}) => request(app).post('/api/auth/firebase').set(headers).send({ idToken: ID_TOKEN });

const mockFirebase = (claims) =>
  jest.spyOn(firebaseService, 'verifyIdToken').mockResolvedValue({
    uid: 'fb-uid-1',
    email: 'nadia@example.com',
    email_verified: true,
    name: 'Nadia Rahman',
    firebase: { sign_in_provider: 'google.com' },
    ...claims
  });

afterEach(() => jest.restoreAllMocks());

describe('POST /api/auth/firebase (B2C)', () => {
  it('creates an ACTIVE B2C account on first sign-in and issues our own tokens', async () => {
    mockFirebase();

    const res = await signIn();

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
    expect(res.body.data.user).toMatchObject({
      email: 'nadia@example.com',
      role: ROLES.B2C,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      authProvider: AUTH_PROVIDERS.FIREBASE
    });
    expect(res.body.data.user.firebaseUid).toBeUndefined(); // internal id is not exposed

    const me = await request(app).get('/api/b2c/profile').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);

    const actions = (await AuditLog.find().lean()).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(['REGISTER', 'LOGIN']));
  });

  it('reuses the same account on the next sign-in', async () => {
    mockFirebase();
    const first = await signIn();
    const second = await signIn();

    expect(second.status).toBe(200);
    expect(second.body.data.user._id).toBe(first.body.data.user._id);
    expect(await User.countDocuments()).toBe(1);
  });

  it('gives mobile clients the refresh token in the body', async () => {
    mockFirebase();
    const res = await signIn({ 'X-Client-Type': 'mobile' });

    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('links to an existing verified B2C account with the same email and keeps its password', async () => {
    const existing = await createUser({ role: ROLES.B2C, email: 'nadia@example.com' });
    mockFirebase();

    const res = await signIn();

    expect(res.status).toBe(200);
    expect(res.body.data.user._id).toBe(String(existing._id));
    expect(await User.countDocuments()).toBe(1);
    expect((await loginRequest('nadia@example.com', PASSWORD)).status).toBe(200);
  });

  it('defeats pre-hijacking: an unverified password registered by someone else is wiped on link', async () => {
    // An attacker registered the victim's email with a password they know and never verified it.
    const squatted = await createUser({ role: ROLES.B2C, email: 'nadia@example.com', status: USER_STATUS.PENDING });
    mockFirebase();

    const res = await signIn();
    expect(res.status).toBe(200);

    const stored = await User.findById(squatted._id).select('+passwordHash');
    expect(stored.passwordHash).toBeUndefined();
    expect(stored.tokenVersion).toBe(1);
    expect((await loginRequest('nadia@example.com', PASSWORD)).status).toBe(401);
  });

  it('never links a Firebase identity to an admin, staff or business account', async () => {
    await createUser({ role: ROLES.ADMIN, email: 'nadia@example.com' });
    mockFirebase();

    const res = await signIn();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACCOUNT_TYPE_MISMATCH');
  });

  it('refuses when neither the email nor a phone number is verified', async () => {
    mockFirebase({ email_verified: false, phone_number: undefined });

    const res = await signIn();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FIREBASE_UNVERIFIED');
    expect(await User.countDocuments()).toBe(0);
  });

  it('accepts only Google by default: Firebase email and password is refused, and no account is created', async () => {
    // A perfectly valid, verified Firebase token that came from an email + password account
    mockFirebase({ email_verified: true, firebase: { sign_in_provider: 'password' } });

    const res = await signIn();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FIREBASE_PROVIDER_NOT_ALLOWED');
    expect(res.body.message).toMatch(/Google|register/);
    expect(await User.countDocuments()).toBe(0);
  });

  it.each(['password', 'phone', 'custom', 'anonymous', 'facebook.com', undefined])(
    'refuses a token whose sign-in method is %s while only Google is allowed',
    async (provider) => {
      mockFirebase({ firebase: provider ? { sign_in_provider: provider } : undefined });

      const res = await signIn();

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FIREBASE_PROVIDER_NOT_ALLOWED');
    }
  );

  it('does not let a refused token touch an existing account either', async () => {
    const existing = await createUser({ role: ROLES.B2C, email: 'nadia@example.com' });
    mockFirebase({ firebase: { sign_in_provider: 'password' } });

    expect((await signIn()).status).toBe(403);
    expect((await User.findById(existing._id)).firebaseUid).toBeUndefined();
  });

  it('the allowed methods come from config, so phone can be switched on without a code change', async () => {
    const saved = env.firebase.allowedProviders;
    env.firebase.allowedProviders = ['google.com', 'phone'];
    try {
      mockFirebase({
        uid: 'fb-phone',
        email: undefined,
        email_verified: false,
        phone_number: '+8801712345678',
        name: undefined,
        firebase: { sign_in_provider: 'phone' }
      });

      const res = await signIn();

      expect(res.status).toBe(200);
      expect(res.body.data.user).toMatchObject({ phone: '+8801712345678', phoneVerified: true, role: ROLES.B2C });
      expect(res.body.data.user.email).toBeUndefined();

      // password is still not allowed
      mockFirebase({ firebase: { sign_in_provider: 'password' } });
      expect((await signIn()).status).toBe(403);
    } finally {
      env.firebase.allowedProviders = saved;
    }
  });

  it('denies a suspended account even though Firebase accepted the token', async () => {
    await createUser({ role: ROLES.B2C, email: 'nadia@example.com', status: USER_STATUS.SUSPENDED });
    mockFirebase();

    const res = await signIn();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('returns 401 when Firebase rejects the token', async () => {
    jest
      .spyOn(firebaseService, 'verifyIdToken')
      .mockRejectedValue(new ApiError(401, 'Invalid or expired Firebase token.', { code: 'FIREBASE_TOKEN_INVALID' }));

    const res = await signIn();
    expect(res.status).toBe(401);
  });

  it('returns 503 when Firebase is not configured on the server', async () => {
    const res = await signIn(); // no mock: the real service sees no credentials in the test env
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('FIREBASE_DISABLED');
  });

  it('a Google-created account can add an email password through forgot-password, then use BOTH ways in', async () => {
    mockFirebase();
    const google = await signIn();
    const userId = google.body.data.user._id;

    // No password yet: the email + password route says "Invalid credentials"
    expect((await loginRequest('nadia@example.com', PASSWORD)).status).toBe(401);

    // Set one with the normal email-OTP reset flow
    await request(app).post('/api/auth/forgot-password').send({ email: 'nadia@example.com' });
    const { otp } = lastEmailTo('nadia@example.com');
    const reset = await request(app).post('/api/auth/reset-password').send({ email: 'nadia@example.com', otp, newPassword: PASSWORD });
    expect(reset.status).toBe(200);

    // Now email + password works, and it is the SAME account
    const viaPassword = await loginRequest('nadia@example.com', PASSWORD);
    expect(viaPassword.status).toBe(200);
    expect(viaPassword.body.data.user._id).toBe(userId);

    // And Google sign-in still works, still the same account
    const again = await signIn();
    expect(again.status).toBe(200);
    expect(again.body.data.user._id).toBe(userId);
    expect(await User.countDocuments()).toBe(1);
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/auth/firebase').send({});
    expect(res.status).toBe(422);
  });
});
