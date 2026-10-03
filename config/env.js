// Tests are hermetic: they never read a developer's .env (real keys, Firebase, EmailJS).
// They get safe built-in values instead (see isTest below). The end-to-end stack (test/e2e/stack.js) runs a
// real server and sets SKIP_DOTENV=true for the same reason.
if (process.env.NODE_ENV !== 'test' && process.env.SKIP_DOTENV !== 'true') require('dotenv').config();
const os = require('os');
const path = require('path');

// Single source of truth for configuration.
// Read process.env here and nowhere else; import this module everywhere.

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const list = (value, fallback = []) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const GENERATE_HINT = `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`;

// Secrets have no default outside tests. A missing or placeholder value stops the boot.
const requireSecret = (name, testFallback) => {
  const value = process.env[name];

  if (!value) {
    if (isTest) return testFallback;
    throw new Error(`${name} is required. Generate one with: ${GENERATE_HINT}`);
  }
  if (value.startsWith('replace-me')) {
    throw new Error(`${name} still has the placeholder value. Generate one with: ${GENERATE_HINT}`);
  }
  if (isProduction && value.length < 32) {
    throw new Error(`${name} must be at least 32 characters in production.`);
  }
  return value;
};

const clientUrls = list(process.env.CLIENT_URL, ['http://localhost:5173']);
const adminUrls = list(process.env.ADMIN_URL, ['http://localhost:5174']);

const mailConfig = {
  serviceId: process.env.EMAILJS_SERVICE_ID || '',
  templateId: process.env.EMAILJS_TEMPLATE_ID || '',
  publicKey: process.env.EMAILJS_PUBLIC_KEY || '',
  privateKey: process.env.EMAILJS_PRIVATE_KEY || ''
};
const emailJsConfigured = Object.values(mailConfig).every(Boolean);

// 'emailjs' sends for real, 'console' prints the message (development only), 'memory' keeps it for tests.
const mailProvider = isTest
  ? 'memory'
  : process.env.EMAIL_PROVIDER || (emailJsConfigured ? 'emailjs' : 'console');

const env = {
  nodeEnv,
  isProduction,
  isTest,
  port: int(process.env.PORT, 5000),
  logLevel: process.env.LOG_LEVEL || 'info',
  // Human-readable colored logs. On by default only when developing in a real terminal;
  // piped or production output stays JSON.
  logPretty: process.env.LOG_PRETTY ? process.env.LOG_PRETTY === 'true' : nodeEnv === 'development' && Boolean(process.stdout.isTTY),

  // Rate limits are off under test (so suites are not throttled). The rate-limit tests switch
  // this flag on for their own run; it is read on every request, so changing it takes effect at once.
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED ? process.env.RATE_LIMIT_ENABLED === 'true' : !isTest,

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/my_app',

  // Where business documents are stored. Never served directly. Tests use a throwaway temp
  // folder so they never touch real files.
  storage: {
    privateDir:
      process.env.PRIVATE_STORAGE_DIR ||
      (isTest ? path.join(os.tmpdir(), `app-test-${process.pid}`, 'private') : path.join(__dirname, '..', 'storage', 'private'))
  },

  // Set to the number of reverse proxies in front of the app (1 for nginx / most PaaS).
  trustProxy: process.env.TRUST_PROXY ? int(process.env.TRUST_PROXY, 1) : false,

  jwt: {
    accessSecret: requireSecret('JWT_ACCESS_SECRET', 'test-access-secret-test-access-secret'),
    refreshSecret: requireSecret('JWT_REFRESH_SECRET', 'test-refresh-secret-test-refresh-secret'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // Keyed hash for OTPs and refresh tokens stored in the database.
  tokenHashSecret: requireSecret('TOKEN_HASH_SECRET', 'test-hash-secret-test-hash-secret'),

  bcryptCost: int(process.env.BCRYPT_COST, isTest ? 4 : 12),

  clientUrls,
  adminUrls,
  corsOrigins: [...clientUrls, ...adminUrls],
  // Base URL the frontend uses in emailed links (staff account setup).
  appUrl: (process.env.APP_URL || clientUrls[0]).replace(/\/$/, ''),

  cookie: {
    // Use 'none' only when the frontend and API sit on different sites; it requires HTTPS.
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
    domain: process.env.COOKIE_DOMAIN || undefined
  },

  otp: {
    expiresMinutes: int(process.env.OTP_EXPIRES_MINUTES, 10),
    maxAttempts: 5,
    // Minimum gap between two codes for the same account. 60 s for real; 0 under Jest; the E2E server uses 2 s.
    resendCooldownSeconds: int(process.env.OTP_RESEND_COOLDOWN_SECONDS, isTest ? 0 : 60)
  },
  staffInviteExpiresHours: int(process.env.STAFF_INVITE_EXPIRES_HOURS, 48),

  mail: {
    provider: mailProvider,
    appName: process.env.APP_NAME || 'Travel Management Platform',
    emailjs: mailConfig,
    // Optional second EmailJS template used only for emails that carry a one-time code. When it is
    // empty, EMAILJS_TEMPLATE_ID is used for everything.
    otpTemplateId: process.env.EMAILJS_OTP_TEMPLATE_ID || '',
    // EMAIL_PROVIDER=file appends every email as one JSON line to this file. Used by the end-to-end
    // tests to read OTP codes from a real server process. Refused in production.
    outboxFile: process.env.MAIL_OUTBOX_FILE || ''
  },

  // Used to print "valid till 12:48 PM" in emails. Set APP_TIMEZONE to your users' IANA zone.
  timezone: process.env.APP_TIMEZONE || 'Asia/Dhaka',

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    // Alternative to the three values above: path to a service-account JSON file.
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    // Which Firebase sign-in methods the API accepts. Email and password is deliberately NOT in the
    // list: customers who want a password use this API's own register and login.
    // Add 'phone' (or others) here, comma separated, to allow them.
    allowedProviders: list(process.env.FIREBASE_ALLOWED_PROVIDERS, ['google.com'])
  },

  adminSeed: {
    name: process.env.ADMIN_SEED_NAME || 'Super Admin',
    email: process.env.ADMIN_SEED_EMAIL || '',
    password: process.env.ADMIN_SEED_PASSWORD || ''
  }
};

env.firebase.enabled = Boolean(
  env.firebase.serviceAccountPath ||
    (env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey)
);

// A private key pasted with real line breaks (instead of one line with \n) loads only its first
// line. Stop at boot with a clear message rather than failing cryptically at the first sign-in.
if (env.firebase.privateKey && !env.firebase.privateKey.includes('-----END PRIVATE KEY-----')) {
  throw new Error(
    'FIREBASE_PRIVATE_KEY looks cut off. Put the whole key on ONE line with \\n for line breaks, inside double quotes, ' +
      'or use FIREBASE_SERVICE_ACCOUNT_PATH (a path to the downloaded JSON file) instead.'
  );
}

// Fail fast on unsafe production configuration.
if (isProduction) {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in production.');
  if (env.jwt.accessSecret === env.jwt.refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }
  if (env.mail.provider !== 'emailjs') {
    throw new Error('Production needs EmailJS configured (EMAILJS_* variables) to send OTP emails.');
  }
  if (env.cookie.sameSite === 'none' && !env.cookie.secure) {
    throw new Error('COOKIE_SAME_SITE=none requires secure cookies.');
  }
}

module.exports = env;
