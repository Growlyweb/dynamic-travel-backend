const env = require('../config/env');
const logger = require('../utils/logger');
const { cleanupUploadedFiles } = require('../utils/file');

// 404 handler for unmatched routes
const notFound = (req, res, next) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
};

// Central error handler. Every thrown/rejected error ends up here and leaves
// as the same { success: false, message, code?, errors? } envelope.
// Status codes used: 400 401 403 404 409 413 422 429 500 (+ 502/503 for upstream services).
const errorMiddleware = async (err, req, res, next) => {
  let statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  let message = err.message || 'Server Error';
  let { code, errors } = err;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}.`;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }

  // Mongoose duplicate key. The value is not echoed back: it may be somebody else's email or phone.
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || err.keyPattern || {})[0];
    message = field ? `An account or record with this ${field} already exists.` : 'This record already exists.';
  }

  // Multer errors (file too large, too many files, ...)
  if (err.name === 'MulterError') {
    statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.message;
  }

  // Malformed JSON / oversized body
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON in request body.';
  }
  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body is too large.';
  }

  // The request failed, so any file multer already saved for it is an orphan.
  // Doing it here means no route has to remember to clean up.
  if (req.file || req.files) {
    await cleanupUploadedFiles(req).catch(() => {});
  }

  if (statusCode >= 500) {
    logger.error({ err }, `${req.method} ${req.originalUrl} failed`);
    // Do not leak internals (stack traces, DB errors, secrets) to clients in production.
    if (env.isProduction) message = 'Server Error';
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(errors ? { errors } : {}),
    ...(env.nodeEnv === 'development' && statusCode >= 500 ? { stack: err.stack } : {})
  });
};

module.exports = errorMiddleware;
module.exports.notFound = notFound;
