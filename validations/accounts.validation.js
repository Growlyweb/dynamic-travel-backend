const { z } = require('zod');
const { objectId, phone, email } = require('./common');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);
const amount = (label) => z.number(`${label} must be a number.`).min(0, `${label} cannot be negative.`).max(1_000_000_000, `${label} is too large.`);
const positive = (label) => z.number(`${label} must be a number.`).gt(0, `${label} must be above zero.`).max(1_000_000_000, `${label} is too large.`);
const day = (label) => z.string(`${label} must be a date.`).trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date like 2026-10-26.`);
const blank = (schema) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());
const whole = (label) => z.string().regex(/^\d+$/, `${label} must be a number.`).transform(Number);
const paging = { page: z.string().regex(/^\d+$/).optional(), limit: z.string().regex(/^\d+$/).optional() };
const method = z.enum(['city', 'brac', 'cash', 'bkash'], 'Choose cash, bank or bKash.');

const idParam = z.object({ id: objectId });

// ---- sales
const listSales = z.object({ type: text('Type', 30).optional(), status: z.enum(['all', 'Processing', 'Completed', 'Cancelled']).optional(), from: day('From').optional(), to: day('To').optional(), search: text('Search', 100).optional(), segment: text('Segment', 20).optional(), category: text('Category', 60).optional(), ...paging });

const saleFields = {
  date: blank(day('The date')),
  category: required('Category', 60),
  clientType: z.enum(['B2B', 'B2C']).optional(),
  clientName: required('Client name', 150),
  agencyName: blank(text('Agency name', 150)),
  phone: blank(text('Phone', 40)),
  sale: positive('The selling price'),
  cost: amount('The cost price').optional(),
  received: amount('The amount received').optional(),
  discount: amount('The discount').optional(),
  method: method.optional(),
  note: text('Note', 1000).optional(),
  destination: text('Destination', 150).optional(),
  detail: text('Detail', 300).optional(),
  passportNo: text('Passport number', 30).optional()
};
const createSale = z.object(saleFields);
const updateSale = z.object({ ...saleFields, category: saleFields.category.optional(), clientName: saleFields.clientName.optional() });
const cancelSale = z.object({ reason: required('The reason', 300), settlement: z.enum(['refund', 'keep']).optional() });
const addCost = z.object({ amount: positive('The cost'), note: text('Note', 150).optional(), date: blank(day('The date')), vendorId: objectId.optional() });

// ---- receipts, expenses, partners
const listReceipts = z.object({ from: day('From').optional(), to: day('To').optional(), search: text('Search', 100).optional(), ...paging });
const createReceipt = z.object({ invoiceId: objectId, amount: amount('The amount').optional(), discount: amount('The discount').optional(), method: method.optional(), date: blank(day('The date')), receiptNo: blank(text('Receipt number', 40)), note: text('Note', 300).optional() });
const voidBody = z.object({ reason: required('The reason', 300) });
const createExpense = z.object({ amount: positive('The expense'), date: blank(day('The date')), account: z.string().regex(/^6\d{3}$/, 'Choose an expense account (6xxx).').optional(), method: method.optional(), note: text('Note', 300).optional() });
const partnerTransaction = z.object({ partner: z.enum(['A', 'B']), direction: z.enum(['in', 'out']), amount: positive('The amount'), date: blank(day('The date')), method: method.optional(), note: text('Note', 300).optional() });

// ---- clients and categories
const listParties = z.object({ type: z.enum(['B2B', 'B2C']) });
const createParty = z.object({ type: z.enum(['B2B', 'B2C']), name: required('Name', 150), phone: blank(text('Phone', 40)), email: blank(email), address: text('Address', 300).optional(), creditLimit: amount('The credit limit').optional() });
const createCategory = z.object({ label: required('Category name', 60), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'The color is like #0879E8.').optional() });
const range = z.object({ from: day('From').optional(), to: day('To').optional() });

// ---- reports
const homeQuery = z.object({ year: whole('Year').optional(), month: whole('Month').refine((m) => m <= 11, 'Month is 0 to 11.').optional() });
const monthlyQuery = z.object({ year: whole('Year'), month: whole('Month').refine((m) => m <= 11, 'Month is 0 to 11.') });
const yearlyQuery = z.object({ year: whole('Year') });
const receiptParam = z.object({ id: z.string().trim().min(3).max(40) });

const listDues = z.object({ ...paging, search: text('Search', 100).optional(), type: z.enum(['B2B', 'B2C']).optional() });

module.exports = { idParam, listDues, receiptParam, listSales, createSale, updateSale, cancelSale, addCost, listReceipts, createReceipt, voidBody, createExpense, partnerTransaction, listParties, createParty, createCategory, range, homeQuery, monthlyQuery, yearlyQuery, paging, pagingQuery: z.object(paging) };
