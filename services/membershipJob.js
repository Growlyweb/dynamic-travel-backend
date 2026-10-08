const cron = require('node-cron');
const env = require('../config/env');
const logger = require('../utils/logger');
const membershipService = require('./membershipService');

// Rule R5: every night just after midnight (in APP_TIMEZONE, Asia/Dhaka by default) the lapsed memberships get
// their real status saved. It also runs once when the server starts, so a night the server slept through is caught
// up. The API is correct without it (every read reports the effective status), so this only keeps the stored data
// honest. The update is idempotent, so running it on several servers at once does no harm.
const run = async () => {
  try {
    const expired = await membershipService.expireLapsed();
    if (expired) logger.info(`Membership expiry: ${expired} lapsed membership(s) marked as expired.`);
  } catch (err) {
    // A failed run must never take the server down. The next run tries again.
    logger.error({ err }, 'Membership expiry job failed');
  }
};

// Returns the scheduled task (so the caller can stop it), or null when the job is switched off.
const start = () => {
  if (!env.membershipExpiryJob) return null;
  run();
  return cron.schedule('5 0 * * *', run, { timezone: env.timezone });
};

module.exports = { start, run };
