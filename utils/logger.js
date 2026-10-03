const pino = require('pino');
const env = require('../config/env');

// pino-pretty is a dev dependency. Use it only when it is installed, so a production
// install (npm ci --omit=dev) never fails because of it.
const prettyAvailable = () => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch (err) {
    return false;
  }
};

const usePretty = env.logPretty && !env.isTest && prettyAvailable();

// Credentials never reach the log. Keys are matched at the top level and one level down
// (req.body.password, user.passwordHash, ...), plus the auth headers and cookies.
const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'idToken'
];

const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    ...SENSITIVE_KEYS,
    ...SENSITIVE_KEYS.map((key) => `*.${key}`)
  ],
  censor: '[redacted]'
};

// Structured JSON logs.
// Usage: logger.info('message') or logger.error({ err }, 'message')
const logger = pino({
  level: env.isTest ? 'silent' : env.logLevel,
  redact,
  ...(usePretty && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }
    }
  })
});

module.exports = logger;
module.exports.redact = redact;
