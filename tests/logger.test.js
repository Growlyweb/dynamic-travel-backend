const { Writable } = require('stream');
const pino = require('pino');

const logger = require('../utils/logger');

// The app logger is silent under test, so build a probe logger with the app's own redaction rules.
const probe = () => {
  const lines = [];
  const stream = new Writable({
    write(chunk, enc, cb) {
      lines.push(chunk.toString());
      cb();
    }
  });
  return { lines, log: pino({ redact: logger.redact }, stream) };
};

describe('log redaction', () => {
  it('hides credentials at the top level, one level down, and in headers', () => {
    const { lines, log } = probe();

    log.info(
      {
        password: 'p1',
        otp: '123456',
        refreshToken: 'r1',
        idToken: 'i1',
        body: { password: 'p2', newPassword: 'p3', currentPassword: 'p4' },
        user: { passwordHash: '$2a$hash' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'refreshToken=xyz' } },
        safe: 'visible'
      },
      'attempt'
    );

    const output = lines.join('');
    ['p1', '123456', 'r1', 'i1', 'p2', 'p3', 'p4', '$2a$hash', 'Bearer abc', 'refreshToken=xyz'].forEach((secret) => {
      expect(output).not.toContain(secret);
    });
    expect(output).toContain('visible');
  });
});
