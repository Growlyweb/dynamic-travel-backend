const { z } = require('zod');
const { objectId, email } = require('./common');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);
const amount = (label) => z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(1_000_000_000, `${label} is too large.`);
const positive = (label) => z.number(`${label} must be a number.`).gt(0, `${label} must be above zero.`).max(1_000_000_000, `${label} is too large.`);
const day = (label) => z.string(`${label} must be a date.`).trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date like 2026-10-26.`);
const blank = (schema) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());
const paging = { page: z.string().regex(/^\d+$/).optional(), limit: z.string().regex(/^\d+$/).optional() };
const method = z.enum(['city', 'brac', 'cash', 'bkash'], 'Choose cash, bank or bKash.');

const idParam = z.object({ id: objectId });
const voidBody = z.object({ reason: required('The reason', 300) });

const vendorFields = {
  name: required('Name', 150),
  phone: blank(text('Phone', 40)),
  email: blank(email),
  address: text('Address', 300),
  contactPerson: text('Contact person', 100),
  creditLimit: amount('The credit limit'),
  notes: text('Notes', 1000)
};
const listVendors = z.object({ search: text('Search', 100).optional(), active: z.enum(['true', 'false']).optional(), ...paging });
const createVendor = z.object({
  ...Object.fromEntries(Object.entries(vendorFields).map(([key, schema]) => [key, key === 'name' ? schema : schema.optional()])),
  openingBalance: amount('The opening balance').optional(),
  openingBalanceType: z.enum(['due', 'advance']).optional()
});
const updateVendor = z.object({ ...Object.fromEntries(Object.entries(vendorFields).map(([key, schema]) => [key, schema.optional()])), active: z.boolean().optional() });

const listBills = z.object({ vendorId: objectId.optional(), status: z.enum(['posted', 'void']).optional(), from: day('From').optional(), to: day('To').optional(), search: text('Search', 100).optional(), ...paging });
const createBill = z.object({
  vendorId: objectId,
  date: blank(day('The date')),
  dueDate: blank(day('The due date')),
  amount: positive('The bill'),
  invoiceRef: text('Invoice reference', 80).optional(),
  service: text('Service', 100).optional(),
  account: z.string().regex(/^5\d{3}$/, 'Choose a direct cost account (5010 to 5090).').optional(),
  fileId: objectId.optional(),
  notes: text('Notes', 500).optional()
});

const listPayments = z.object({ vendorId: objectId.optional(), status: z.enum(['posted', 'void']).optional(), isAdvance: z.enum(['true', 'false']).optional(), from: day('From').optional(), to: day('To').optional(), ...paging });
const createPayment = z.object({ vendorId: objectId, amount: positive('The payment'), method: method.optional(), date: blank(day('The date')), isAdvance: z.boolean().optional(), billId: objectId.optional(), note: text('Note', 300).optional() });

module.exports = { idParam, voidBody, listVendors, createVendor, updateVendor, listBills, createBill, listPayments, createPayment };
