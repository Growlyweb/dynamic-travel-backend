// Starts everything the end-to-end tests need, then stays alive until Playwright stops it:
//   1. a throwaway in-memory MongoDB
//   2. the first admin (the real seed script)
//   3. the API on :5100 with rate limiting OFF
//   4. a second API on :5101 with rate limiting ON (for the rate-limit tests), sharing the same database
//   5. the browser test console on :5273
// Emails are appended to test/.output/tmp/mail.jsonl, so tests can read OTP codes from a real server process.
// Your .env is never read (SKIP_DOTENV), and the dev servers on 5000 / 5173 are never touched.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');
const cfg = require('./config');

const ROOT = path.join(__dirname, '..', '..');
const children = [];
let mongod;

// Runs scripts/seedAdmin.js without blocking this process.
const seedAdmin = (env) =>
  new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/seedAdmin.js'], { cwd: ROOT, env });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Seeding the admin failed (exit ${code}):\n${output}`))));
  });

const log = (msg) => console.log(`[e2e-stack] ${msg}`);

const waitFor = async (url, label, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (err) {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not come up at ${url}`);
};

const shutdown = async (code = 0) => {
  children.forEach((c) => c.kill('SIGTERM'));
  if (mongod) await mongod.stop().catch(() => {});
  process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

(async () => {
  fs.rmSync(cfg.TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(cfg.TMP_DIR, 'private'), { recursive: true });
  fs.writeFileSync(cfg.MAIL_FILE, '');

  mongod = await MongoMemoryServer.create();
  log(`MongoDB (in memory) ready`);

  // Every setting is explicit, so nothing leaks in from the developer's environment or .env.
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    SKIP_DOTENV: 'true',
    MONGODB_URI: `${mongod.getUri()}e2e`,
    JWT_ACCESS_SECRET: 'e2e-access-secret-e2e-access-secret-0001',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-e2e-refresh-secret-02',
    TOKEN_HASH_SECRET: 'e2e-hash-secret-e2e-hash-secret-000003',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    BCRYPT_COST: '4',
    LOG_LEVEL: 'warn',
    LOG_PRETTY: 'false',
    TRUST_PROXY: '',
    CLIENT_URL: cfg.CONSOLE_URL,
    ADMIN_URL: 'http://localhost:5274',
    APP_URL: cfg.CONSOLE_URL,
    COOKIE_SAME_SITE: 'lax',
    COOKIE_SECURE: 'false',
    COOKIE_DOMAIN: '',
    OTP_EXPIRES_MINUTES: '10',
    OTP_RESEND_COOLDOWN_SECONDS: '2',
    // No nightly timer in a test run: tests make a membership lapse themselves when they need one.
    MEMBERSHIP_EXPIRY_JOB: 'false', // real servers use 60; short here so the replacement can be tested
    STAFF_INVITE_EXPIRES_HOURS: '48',
    EMAIL_PROVIDER: 'file',
    MAIL_OUTBOX_FILE: cfg.MAIL_FILE,
    EMAILJS_SERVICE_ID: '',
    EMAILJS_TEMPLATE_ID: '',
    EMAILJS_OTP_TEMPLATE_ID: '',
    EMAILJS_PUBLIC_KEY: '',
    EMAILJS_PRIVATE_KEY: '',
    FIREBASE_PROJECT_ID: '',
    FIREBASE_CLIENT_EMAIL: '',
    FIREBASE_PRIVATE_KEY: '',
    FIREBASE_SERVICE_ACCOUNT_PATH: '',
    FIREBASE_ALLOWED_PROVIDERS: '',
    PRIVATE_STORAGE_DIR: path.join(cfg.TMP_DIR, 'private'),
    ADMIN_SEED_NAME: cfg.ADMIN.name,
    ADMIN_SEED_EMAIL: cfg.ADMIN.email,
    ADMIN_SEED_PASSWORD: cfg.ADMIN.password
  };

  // Async on purpose: this process also reads the in-memory MongoDB's output, and a blocking spawnSync here
  // lets that pipe fill up, which freezes mongod and with it the seed.
  await seedAdmin(env);
  log('admin seeded');

  const start = (label, file, extraEnv) => {
    const child = spawn('node', [file], { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = (stream) => stream.on('data', (d) => process.env.E2E_DEBUG && process.stdout.write(`[${label}] ${d}`));
    relay(child.stdout);
    relay(child.stderr);
    child.on('exit', (code) => {
      if (code && code !== 143) {
        log(`${label} exited with code ${code}`);
        shutdown(1);
      }
    });
    children.push(child);
  };

  start('api', 'server.js', { PORT: String(cfg.ports.api), RATE_LIMIT_ENABLED: 'false' });
  start('api-limited', 'server.js', { PORT: String(cfg.ports.limitedApi), RATE_LIMIT_ENABLED: 'true' });
  await waitFor(`${cfg.API_URL}/health`, 'API');
  await waitFor(`${cfg.LIMITED_API_URL}/health`, 'rate-limited API');
  log(`APIs ready on :${cfg.ports.api} and :${cfg.ports.limitedApi}`);

  start('console', 'test/console/server.js', { TEST_CONSOLE_PORT: String(cfg.ports.console) });
  await waitFor(cfg.CONSOLE_URL, 'test console');
  log(`READY: test console on :${cfg.ports.console}`);
})().catch((err) => {
  console.error(`[e2e-stack] FAILED: ${err.message}`);
  shutdown(1);
});
