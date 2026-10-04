const mongoose = require('mongoose');

const { password, email, phone } = require('../../validations/common');
const { hashValue, safeEqual, generateOtp } = require('../../utils/crypto');
const { checkOwnership } = require('../../middleware/ownershipMiddleware');
const { requireRole, requirePermission } = require('../../middleware/authorizeMiddleware');
const { ROLES } = require('../../config/constants');
const { PERMISSIONS } = require('../../config/rbac');

describe('password policy', () => {
  it.each([
    ['Str0ng!Pass', true],
    ['short1!A', true],
    ['Sh0rt!A', false], // 7 chars
    ['alllowercase1!', false],
    ['ALLUPPERCASE1!', false],
    ['NoDigitsHere!', false],
    ['NoSpecial123', false],
    ['A1!' + 'a'.repeat(62), false], // 65 chars
    ['Ü1!' + 'ü'.repeat(30), false] // under 64 characters but over 72 bytes
  ])('%s -> %s', (value, valid) => {
    expect(password.safeParse(value).success).toBe(valid);
  });
});

describe('input normalisation', () => {
  it('trims and lower-cases emails', () => {
    expect(email.parse('  Rahim@Example.COM ')).toBe('rahim@example.com');
    expect(email.safeParse('not-an-email').success).toBe(false);
  });

  it('accepts only plausible phone numbers', () => {
    expect(phone.safeParse('+8801712345678').success).toBe(true);
    expect(phone.safeParse('01712345678').success).toBe(true);
    expect(phone.safeParse('12-34').success).toBe(false);
    expect(phone.safeParse('+880 1712 345678').success).toBe(false);
  });
});

describe('FIREBASE_PRIVATE_KEY handling in config/env.js', () => {
  const KEY_ONE_LINE = '-----BEGIN PRIVATE KEY-----\\nABCDEF\\n-----END PRIVATE KEY-----\\n'; // literal backslash-n, as in a .env
  const loadEnvWith = (value) => {
    const saved = process.env.FIREBASE_PRIVATE_KEY;
    process.env.FIREBASE_PRIVATE_KEY = value;
    try {
      let loaded;
      jest.isolateModules(() => {
        loaded = require('../../config/env');
      });
      return loaded;
    } finally {
      if (saved === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
      else process.env.FIREBASE_PRIVATE_KEY = saved;
    }
  };

  it('turns the \\n escapes of a one-line key into real line breaks', () => {
    const loaded = loadEnvWith(KEY_ONE_LINE);
    expect(loaded.firebase.privateKey).toBe('-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----\n');
  });

  it('refuses a key that was cut off at the first line break (a multi-line paste)', () => {
    expect(() => loadEnvWith('-----BEGIN PRIVATE KEY-----')).toThrow(/looks cut off/);
  });

  it('accepts an empty key (Firebase simply stays disabled)', () => {
    expect(loadEnvWith('').firebase.enabled).toBe(false);
  });
});

describe('email payload (utils/mailer.js)', () => {
  const mailer = require('../../utils/mailer');
  const env = require('../../config/env');

  const withEmailJs = (extra, fn) => {
    const saved = { emailjs: env.mail.emailjs, otpTemplateId: env.mail.otpTemplateId };
    env.mail.emailjs = { serviceId: 'svc', templateId: 'tpl_general', publicKey: 'pub', privateKey: 'priv' };
    env.mail.otpTemplateId = extra.otpTemplateId || '';
    try {
      return fn();
    } finally {
      Object.assign(env.mail, saved);
    }
  };

  const otpMail = { to: 'a@b.co', toName: 'Ana', subject: 'Verify', otp: '482913', message: 'Code 482913', expiresAt: new Date('2026-10-03T07:00:00Z') };

  it('sends the recipient, name, subject and code under every name a template might use', () => {
    const params = mailer.buildParams(otpMail);

    expect(params).toMatchObject({ to_email: 'a@b.co', email: 'a@b.co', to_name: 'Ana', name: 'Ana', subject: 'Verify', title: 'Verify', otp: '482913', passcode: '482913' });
  });

  it('formats the expiry as a clock time in the platform time zone', () => {
    expect(mailer.buildParams(otpMail).time).toMatch(/^\d{2}:\d{2} (AM|PM) /);
    expect(mailer.buildParams({ ...otpMail, expiresAt: undefined }).time).toBe('');
  });

  it('sends empty code fields for an email that has no code', () => {
    const params = mailer.buildParams({ to: 'a@b.co', subject: 'Hi', message: 'Hello' });
    expect(params.otp).toBe('');
    expect(params.passcode).toBe('');
  });

  it('uses the general template for everything when no OTP template is configured', () => {
    withEmailJs({}, () => {
      expect(mailer.buildEmailJsPayload(mailer.buildParams(otpMail)).template_id).toBe('tpl_general');
    });
  });

  it('uses the OTP template only for emails that carry a code', () => {
    withEmailJs({ otpTemplateId: 'tpl_otp' }, () => {
      expect(mailer.buildEmailJsPayload(mailer.buildParams(otpMail)).template_id).toBe('tpl_otp');
      const invite = mailer.buildParams({ to: 'a@b.co', subject: 'Invite', message: 'Link' });
      expect(mailer.buildEmailJsPayload(invite).template_id).toBe('tpl_general');
    });
  });

  it('puts the keys where EmailJS expects them', () => {
    withEmailJs({}, () => {
      expect(mailer.buildEmailJsPayload(mailer.buildParams(otpMail))).toMatchObject({ service_id: 'svc', user_id: 'pub', accessToken: 'priv' });
    });
  });
});

describe('crypto helpers', () => {
  it('hashes deterministically with a keyed hash and compares safely', () => {
    expect(hashValue('123456')).toBe(hashValue('123456'));
    expect(hashValue('123456')).not.toBe(hashValue('123457'));
    expect(hashValue('123456')).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('generates 6-digit OTPs that never start with 0', () => {
    for (let i = 0; i < 200; i += 1) expect(generateOtp()).toMatch(/^[1-9]\d{5}$/);
  });
});

// Run a middleware and resolve with whatever it passed to next()
const run = (middleware, req) =>
  new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err));
  });

describe('requireRole / requirePermission', () => {
  it('requireRole needs a user and a listed role', async () => {
    const guard = requireRole(ROLES.ADMIN, ROLES.STAFF);
    expect(await run(guard, { user: { role: ROLES.STAFF } })).toBeUndefined();
    expect((await run(guard, { user: { role: ROLES.B2C } })).statusCode).toBe(403);
    expect((await run(guard, {})).statusCode).toBe(403);
  });

  it('requirePermission needs EVERY key, and ADMIN bypasses', async () => {
    const guard = requirePermission(PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE);

    expect(await run(guard, { user: { role: ROLES.ADMIN, permissions: [] } })).toBeUndefined();
    expect(await run(guard, { user: { role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE] } })).toBeUndefined();
    expect((await run(guard, { user: { role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] } })).statusCode).toBe(403);
    expect((await run(guard, { user: { role: ROLES.B2B, permissions: [PERMISSIONS.VISA_VIEW, PERMISSIONS.VISA_UPDATE] } })).statusCode).toBe(
      403
    );
  });
});

// The pattern the guide gives for B2C records: application.userId === req.user.id
describe('checkOwnership for B2C records', () => {
  const record = { userId: new mongoose.Types.ObjectId() };
  const guard = checkOwnership({
    load: async () => record,
    isOwner: (doc, user) => String(doc.userId) === user.id,
    staffPermission: PERMISSIONS.VISA_VIEW
  });

  const call = (user) => {
    const req = { user };
    return run(guard, req).then((err) => ({ err, req }));
  };

  it('lets the owner through and exposes the record', async () => {
    const { err, req } = await call({ id: String(record.userId), role: ROLES.B2C, permissions: [] });
    expect(err).toBeUndefined();
    expect(req.resource).toBe(record);
  });

  it('hides the record from another B2C user (404, not 403)', async () => {
    const { err } = await call({ id: String(new mongoose.Types.ObjectId()), role: ROLES.B2C, permissions: [] });
    expect(err.statusCode).toBe(404);
  });

  it('lets ADMIN and permitted STAFF through, but not other staff', async () => {
    expect((await call({ id: 'x', role: ROLES.ADMIN, permissions: [] })).err).toBeUndefined();
    expect((await call({ id: 'x', role: ROLES.STAFF, permissions: [PERMISSIONS.VISA_VIEW] })).err).toBeUndefined();
    expect((await call({ id: 'x', role: ROLES.STAFF, permissions: [] })).err.statusCode).toBe(404);
  });

  it('answers 404 when the record does not exist', async () => {
    const missing = checkOwnership({ load: async () => null, isOwner: () => true });
    const err = await run(missing, { user: { id: 'x', role: ROLES.ADMIN, permissions: [] } });
    expect(err.statusCode).toBe(404);
  });
});
