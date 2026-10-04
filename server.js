const mongoose = require('mongoose');

const env = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const logger = require('./utils/logger');

const SHUTDOWN_TIMEOUT_MS = 10000;

const start = async () => {
  await connectDB();

  // Make sure unique indexes (email, phone, licenseNo, ...) exist before taking traffic.
  await mongoose.syncIndexes();

  const server = app.listen(env.port, () => {
    logger.info(`Server running in ${env.nodeEnv} mode on port ${env.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received. Shutting down.`);

    // Idle keep-alive connections would otherwise hold server.close() open.
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

// After an unhandled error the process state is unknown. Log it and exit so the supervisor
// (pm2, Docker, systemd) restarts a clean process.
const fatal = (label) => (reason) => {
  logger.fatal({ err: reason }, label);
  process.exit(1);
};
process.on('unhandledRejection', fatal('Unhandled rejection'));
process.on('uncaughtException', fatal('Uncaught exception'));

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start the server');
  process.exit(1);
});
