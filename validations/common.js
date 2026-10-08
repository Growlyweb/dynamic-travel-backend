const { z } = require('zod');

// Shared building blocks. Every schema strips unknown keys (zod default), so a client can
// never smuggle role / status / permissions / partnerId into a request that does not allow it.

const email = z
  .string('Email is required.')
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Email is too long.');

const phone = z
  .string('Phone must be text.')
  .trim()
  .transform((val) => val.replace(/[\s-]/g, ''))
  .refine((val) => val === '' || /^\+?[0-9]{8,15}$/.test(val), {
    message: 'Enter a valid phone number (digits only, optional leading +).'
  });

const name = z
  .string('Name is required.')
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

// bcrypt only reads the first 72 BYTES, so cap by bytes as well as characters.
const password = z
  .string('Password is required.')
  .min(8, 'Password must be at least 8 characters.')
  .max(64, 'Password must be at most 64 characters.')
  .regex(/[a-z]/, 'Password needs a lowercase letter.')
  .regex(/[A-Z]/, 'Password needs an uppercase letter.')
  .regex(/[0-9]/, 'Password needs a number.')
  .regex(/[^A-Za-z0-9]/, 'Password needs a special character.')
  .refine((value) => Buffer.byteLength(value) <= 72, 'Password is too long.');

const otp = z.string('Code is required.').trim().regex(/^\d{6}$/, 'The code must be 6 digits.');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id.');

const idParam = z.object({ id: objectId });

const pagination = {
  page: z.string().regex(/^\d+$/, 'page must be a number.').optional(),
  limit: z.string().regex(/^\d+$/, 'limit must be a number.').optional()
};

const search = z.string().trim().max(100).optional();

module.exports = { email, phone, name, password, otp, objectId, idParam, pagination, search };
