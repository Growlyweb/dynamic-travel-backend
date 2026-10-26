const { z } = require('zod');
const { otp } = require('./common');

const ref = z.string('The application number is required.').trim().min(5, 'Enter the application number.').max(40, 'The application number is too long.');
const passportNo = z.string('The passport number is required.').trim().min(5, 'Enter the passport number.').max(20, 'The passport number is too long.');
const phone = z.string('The phone number is required.').trim().min(7, 'Enter the phone number.').max(20, 'The phone number is too long.');

const linkParam = z.object({ ref });
const requestCode = z.object({ ref, passportNo, phone });
const verifyCode = z.object({ ref, passportNo, phone, otp });

module.exports = { linkParam, requestCode, verifyCode };
