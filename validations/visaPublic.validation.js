const { z } = require('zod');
const { email, otp } = require('./common');

const reference = z.string('The application number is required.').trim().min(5, 'Enter the application number.').max(40, 'The application number is too long.');

const requestCode = z.object({ reference, email });
const verifyCode = z.object({ reference, email, code: otp });
const statusParam = z.object({ reference });

module.exports = { requestCode, verifyCode, statusParam };
