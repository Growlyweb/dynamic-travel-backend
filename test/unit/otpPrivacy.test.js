const util = require('util');
const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { outbox } = require('../../utils/mailer');
const notificationService = require('../../services/notificationService');
const { ROLES } = require('../../config/constants');
const { PASSWORD, createUser, bearer, lastEmailTo, unique } = require('./helpers/factory');

// A one-time code or an invite link reaches a person by email and nowhere else:
// not in an API response, not in the server log, not in the terminal.

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

// Records everything the server could print, without printing it.
const listenToOutput = () => {
  const spies = [
    ...LEVELS.map((level) => jest.spyOn(logger, level).mockImplementation(() => {})),
    ...['log', 'info', 'warn', 'error'].map((method) => jest.spyOn(console, method).mockImplementation(() => {}))
  ];
  return {
    everything: () => util.inspect(spies.flatMap((spy) => spy.mock.calls), { depth: 6, maxStringLength: null }),
    stop: () => spies.forEach((spy) => spy.mockRestore())
  };
};

describe('codes and links are never printed or returned', () => {
  let output;
  beforeEach(() => {
    output = listenToOutput();
  });
  afterEach(() => output.stop());

  it('sign-up, resend, forgot password and a staff invite keep the code and the link out of responses and logs', async () => {
    const secrets = [];
    const responses = [];

    // sign-up, then resend (a second code)
    const email = `${unique('priv')}@example.com`;
    responses.push(await request(app).post('/api/auth/register').send({ name: 'Priv Person', email, password: PASSWORD }));
    secrets.push(lastEmailTo(email).otp);
    responses.push(await request(app).post('/api/auth/resend-otp').send({ email }));
    secrets.push(lastEmailTo(email).otp);

    // forgot password
    const known = await createUser();
    responses.push(await request(app).post('/api/auth/forgot-password').send({ email: known.email }));
    secrets.push(lastEmailTo(known.email).otp);

    // staff invite: the link carries a token
    const admin = await createUser({ role: ROLES.ADMIN });
    const invited = `${unique('inv')}@example.com`;
    responses.push(await request(app).post('/api/admin/staff').set(bearer(admin)).send({ name: 'Invited Staff', email: invited, permissions: [] }));
    secrets.push(/token=([0-9a-f]+)/.exec(lastEmailTo(invited).message)[1]);

    expect(responses.map((r) => r.status)).toEqual([201, 200, 200, 201]);
    expect(secrets.every((s) => s.length >= 6)).toBe(true);

    const seen = output.everything();
    secrets.forEach((secret) => {
      responses.forEach((res) => expect(JSON.stringify(res.body)).not.toContain(secret));
      expect(seen).not.toContain(secret);
    });
    // the e-mail itself still carries them (that is the point)
    expect(lastEmailTo(email).message).toContain(secrets[1]);
  });

  it('with EmailJS not configured nothing is sent, nothing is printed, and sign-up says the email did not go out', async () => {
    const saved = { provider: env.mail.provider, configured: env.mail.configured };
    env.mail.provider = 'emailjs';
    env.mail.configured = false;
    // With nothing delivered, the only way to learn the code is to watch it go into the notification layer.
    const issued = jest.spyOn(notificationService, 'verificationOtp');
    try {
      const email = `${unique('noml')}@example.com`;
      const res = await request(app).post('/api/auth/register').send({ name: 'No Mail', email, password: PASSWORD });
      const code = issued.mock.calls[0][1];
      expect(code).toMatch(/^\d{6}$/);

      expect(res.status).toBe(201);
      expect(res.body.data.otpSent).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/otp"?\s*:\s*"?\d{6}/i);
      expect(outbox).toHaveLength(0);

      const seen = output.everything();
      expect(seen).toContain('Failed to send email');
      expect(seen).toContain('EmailJS is not configured');
      expect(seen).not.toContain(code);
      expect(seen).not.toMatch(/otp=/);
      expect(JSON.stringify(res.body)).not.toContain(code);
    } finally {
      issued.mockRestore();
      Object.assign(env.mail, { provider: saved.provider, configured: saved.configured });
    }
  });
});

describe('mail provider settings (config/env.js)', () => {
  const SECRETS = {
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    TOKEN_HASH_SECRET: 'c'.repeat(40)
  };
  const EMAILJS = {
    EMAILJS_SERVICE_ID: 'svc',
    EMAILJS_TEMPLATE_ID: 'tpl',
    EMAILJS_PUBLIC_KEY: 'pub',
    EMAILJS_PRIVATE_KEY: 'priv'
  };

  // Loads a fresh copy of config/env.js as if the server had started with exactly these variables.
  const loadEnv = (vars) => {
    const saved = { ...process.env };
    Object.keys(process.env)
      .filter((key) => /^(EMAIL|EMAILJS|MAIL_|NODE_ENV|MONGODB_URI|SKIP_DOTENV)/.test(key))
      .forEach((key) => delete process.env[key]);
    Object.assign(process.env, { SKIP_DOTENV: 'true', NODE_ENV: 'development', ...SECRETS, ...vars });
    try {
      let loaded;
      jest.isolateModules(() => {
        loaded = require('../../config/env');
      });
      return loaded;
    } finally {
      Object.keys(process.env).forEach((key) => delete process.env[key]);
      Object.assign(process.env, saved);
    }
  };

  it('uses EmailJS by default, and says when it is not configured', () => {
    expect(loadEnv({}).mail).toMatchObject({ provider: 'emailjs', configured: false });
    expect(loadEnv(EMAILJS).mail).toMatchObject({ provider: 'emailjs', configured: true });
  });

  it('has no provider that prints emails: the old "console" value is refused at start-up', () => {
    expect(() => loadEnv({ EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER "console" is not supported/);
    expect(() => loadEnv({ EMAIL_PROVIDER: 'memory' })).toThrow(/not supported/); // memory is for Jest only
  });

  it('the file provider needs its file, and production refuses to start without EmailJS', () => {
    expect(() => loadEnv({ EMAIL_PROVIDER: 'file' })).toThrow(/needs MAIL_OUTBOX_FILE/);
    expect(loadEnv({ EMAIL_PROVIDER: 'file', MAIL_OUTBOX_FILE: '/tmp/x.jsonl' }).mail.provider).toBe('file');

    const production = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1/x', JWT_REFRESH_SECRET: 'd'.repeat(40) };
    expect(() => loadEnv(production)).toThrow(/Production needs EmailJS/);
    expect(() => loadEnv({ ...production, EMAIL_PROVIDER: 'file', MAIL_OUTBOX_FILE: '/tmp/x.jsonl' })).toThrow(/Production needs EmailJS/);
    expect(loadEnv({ ...production, ...EMAILJS }).mail.configured).toBe(true);
  });
});
