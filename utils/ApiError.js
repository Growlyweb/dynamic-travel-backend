// Throw this from services/middleware to produce a clean HTTP error response.
// Example: throw new ApiError(404, 'User not found.');
// Optional machine-readable code for clients: new ApiError(403, 'Verify your email.', { code: 'EMAIL_NOT_VERIFIED' })
// Optional field errors (validation): new ApiError(422, 'Validation failed.', { errors: [{ field, message }] })
class ApiError extends Error {
  constructor(statusCode, message, { code, errors } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    if (code) this.code = code;
    if (errors) this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
