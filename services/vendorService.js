const Account = require('../models/Account');
const Party = require('../models/Party');
const SaleFile = require('../models/SaleFile');
const VendorBill = require('../models/VendorBill');
const VendorPayment = require('../models/VendorPayment');
const { AP_ACCOUNT, ADVANCE_ACCOUNT, OPENING_EQUITY_ACCOUNT, PAYMENT_METHODS } = require('../config/accounting');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const counterService = require('./counterService');
const books = require('./accounting/books');
const dates = require('./accounting/dates');
const ledger = require('./accounting/ledger');
const reports = require('./accounting/reports');
const { toMinor, fromMinor } = require('./accounting/money');
const { ensureChartIfEmpty } = require('./accounting/chart');

// Suppliers, what they charged (bills) and what we paid them (payments, and advances before a bill). Every bill and
// payment posts a journal, so the supplier ledger and the accounts payable control account are the same numbers.
//   bill     : cost account / accounts payable
//   payment  : accounts payable / cash or bank
//   advance  : advances to suppliers / cash or bank
// Nothing is deleted. A mistake is voided with a reason.

const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const audit = (actor, resource, meta) => auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.ACCOUNTING_CHANGED, resource, meta });
const fail = (message, code, field, status = 422) => new ApiError(status, message, { code, errors: field ? [{ field: `body.${field}`, message }] : undefined });

const findVendor = async (id) => {
  const vendor = await Party.findOne({ _id: id, type: 'Vendor' });
  if (!vendor) throw new ApiError(404, 'Vendor not found.', { code: 'VENDOR_NOT_FOUND' });
  return vendor;
};

const methodOf = (value) => {
  const method = PAYMENT_METHODS.find((m) => m.value === value);
  if (!method) throw fail('Choose cash, bank or bKash.', 'INVALID_METHOD', 'method');
  return method;
};

const presentVendor = (party, balance = {}) => ({
  _id: party._id,
  code: party.code,
  name: party.name,
  phone: party.phone,
  email: party.email,
  address: party.address,
  contactPerson: party.contactPerson,
  creditLimit: fromMinor(party.creditLimit),
  priceList: (party.priceList || []).map(({ service, country, price }) => ({ service, country, price })),
  active: party.active,
  notes: party.notes,
  since: party.since,
  billed: balance.invoiced || 0,
  paid: balance.collected || 0,
  due: balance.due || 0,
  overdue: balance.overdue || 0,
  advance: balance.advance || 0,
  createdAt: party.createdAt
});

// ------------------------------------------------------------------ vendors

const balancesOf = async () => {
  const [payables, advances] = await Promise.all([reports.supplierPayables(), reports.supplierAdvances()]);
  const map = new Map(payables.rows.map((row) => [row.partyId, { ...row }]));
  advances.rows.forEach((row) => map.set(row.partyId, { ...(map.get(row.partyId) || {}), advance: row.amount }));
  return map;
};

const listVendors = async (query) => {
  await ensureChartIfEmpty();
  const { page, limit, skip } = paginate(query);
  const filter = { type: 'Vendor' };
  if (query.active !== undefined) filter.active = query.active === 'true';
  if (query.search) filter.$or = [{ name: { $regex: escapeRegex(query.search), $options: 'i' } }, { code: { $regex: escapeRegex(query.search), $options: 'i' } }, { phone: { $regex: escapeRegex(query.search), $options: 'i' } }];
  const [items, total, balances] = await Promise.all([Party.find(filter).sort({ name: 1 }).skip(skip).limit(limit), Party.countDocuments(filter), balancesOf()]);
  return { items: items.map((party) => presentVendor(party, balances.get(String(party._id)))), meta: buildMeta(total, page, limit) };
};

const getVendor = async (id) => {
  const vendor = await findVendor(id);
  const balances = await balancesOf();
  return presentVendor(vendor, balances.get(String(vendor._id)));
};

// An opening balance is what the vendor was owed (or owed us as an advance) on the day the vendor was added.
const postOpening = (vendor, { amount, type }, actor) =>
  ledger.post({
    date: vendor.since,
    type: 'OB',
    narration: `Opening ${type} - ${vendor.name}`,
    party: vendor._id,
    ref: `VOPEN:${vendor.code}`,
    source: { kind: 'vendor', id: String(vendor._id), role: 'opening' },
    actor,
    lines:
      type === 'advance'
        ? [{ account: ADVANCE_ACCOUNT, debit: amount, party: vendor._id, memo: 'Opening vendor advance' }, { account: OPENING_EQUITY_ACCOUNT, credit: amount, memo: 'Opening balance' }]
        : [{ account: OPENING_EQUITY_ACCOUNT, debit: amount, memo: 'Opening vendor due' }, { account: AP_ACCOUNT, credit: amount, party: vendor._id, memo: 'Opening vendor due' }]
  });

// One price for each service, and for each country of a visa. A price for anything but a visa has no country.
const cleanPriceList = (list) => {
  const seen = new Set();
  return list.map(({ service, country = '', price }) => {
    const entry = { service, country: service === 'visa' ? country.trim() : '', price };
    const key = `${entry.service}|${entry.country.toLowerCase()}`;
    if (seen.has(key)) throw fail(`The price for ${entry.service}${entry.country ? ` (${entry.country})` : ''} is listed twice.`, 'DUPLICATE_PRICE', 'priceList');
    seen.add(key);
    return entry;
  });
};

const createVendor = async (actor, body) => {
  await ensureChartIfEmpty();
  if (await Party.exists({ type: 'Vendor', nameKey: keyOf(body.name) })) throw new ApiError(409, 'A vendor with this name already exists.', { code: 'VENDOR_EXISTS' });
  const vendor = await books.ensureParty({ type: 'Vendor', name: body.name, phone: body.phone || '', email: body.email || '', creditLimit: toMinor(body.creditLimit) });
  Object.assign(vendor, { address: body.address || '', contactPerson: body.contactPerson || '', notes: body.notes || '', priceList: cleanPriceList(body.priceList || []) });
  await vendor.save();

  const opening = toMinor(body.openingBalance);
  if (opening > 0) {
    try {
      await postOpening(vendor, { amount: opening, type: body.openingBalanceType || 'due' }, actor);
    } catch (err) {
      await vendor.deleteOne();
      throw err;
    }
  }
  await audit(actor, `vendor:${vendor._id}`, { action: 'created' });
  return getVendor(vendor._id);
};

const updateVendor = async (actor, id, body) => {
  const vendor = await findVendor(id);
  if (body.name !== undefined && keyOf(body.name) !== vendor.nameKey) {
    if (await Party.exists({ type: 'Vendor', nameKey: keyOf(body.name), _id: { $ne: vendor._id } })) throw new ApiError(409, 'A vendor with this name already exists.', { code: 'VENDOR_EXISTS' });
    vendor.name = body.name.trim();
    vendor.nameKey = keyOf(body.name);
  }
  ['phone', 'email', 'address', 'contactPerson', 'notes', 'active'].forEach((field) => {
    if (body[field] !== undefined) vendor[field] = body[field];
  });
  if (body.creditLimit !== undefined) vendor.creditLimit = toMinor(body.creditLimit);
  if (body.priceList !== undefined) vendor.priceList = cleanPriceList(body.priceList);
  await vendor.save();
  await audit(actor, `vendor:${vendor._id}`, { action: 'updated', fields: Object.keys(body) });
  return getVendor(vendor._id);
};

// ------------------------------------------------------------------ bills

const presentBill = (bill, paid = 0) => ({
  _id: bill._id,
  billNo: bill.billNo,
  vendorId: String(bill.vendor),
  vendorName: bill.vendorName,
  date: bill.date,
  dueDate: bill.dueDate,
  amount: fromMinor(bill.amount),
  paid: fromMinor(paid),
  due: fromMinor(Math.max(0, bill.amount - paid)),
  invoiceRef: bill.invoiceRef,
  service: bill.service,
  account: bill.account,
  fileId: bill.file ? String(bill.file) : null,
  notes: bill.notes,
  status: bill.status,
  voidReason: bill.voidReason,
  createdByName: bill.createdByName,
  createdAt: bill.createdAt
});

const paidOn = async (billIds) => {
  const rows = await VendorPayment.aggregate([{ $match: { bill: { $in: billIds }, status: 'posted' } }, { $group: { _id: '$bill', paid: { $sum: '$amount' } } }]);
  return Object.fromEntries(rows.map((row) => [String(row._id), row.paid]));
};

const createBill = async (actor, body) => {
  await ensureChartIfEmpty();
  const vendor = await findVendor(body.vendorId);
  if (!vendor.active) throw new ApiError(409, 'This vendor is switched off.', { code: 'VENDOR_INACTIVE' });
  const amount = toMinor(body.amount);
  if (amount <= 0) throw fail('The bill must be above zero.', 'INVALID_AMOUNT', 'amount');
  const account = await Account.findOne({ code: body.account || '5090', type: 'Expense', group: 'Direct Costs' });
  if (!account) throw fail('Choose a direct cost account (5010 to 5090).', 'INVALID_ACCOUNT', 'account');
  const date = body.date || dates.todayISO();
  if (!dates.isDay(date)) throw fail('Enter a valid date.', 'INVALID_DATE', 'date');
  const dueDate = body.dueDate || dates.addDays(date, 15);
  if (!dates.isDay(dueDate) || dueDate < date) throw fail('The due date cannot be before the bill date.', 'INVALID_DATE', 'dueDate');
  let file = null;
  if (body.fileId) {
    file = await SaleFile.findById(body.fileId);
    if (!file) throw new ApiError(404, 'Sale not found.', { code: 'SALE_NOT_FOUND' });
  }

  const bill = await VendorBill.create({
    billNo: await counterService.nextNumber('VB', { year: date.slice(0, 4), width: 4 }),
    vendor: vendor._id,
    vendorName: vendor.name,
    date,
    dueDate,
    amount,
    invoiceRef: body.invoiceRef || '',
    service: body.service || '',
    account: account.code,
    segment: account.segment,
    file: file ? file._id : undefined,
    notes: body.notes || '',
    createdBy: actor.id,
    createdByName: actor.name
  });
  try {
    const journal = await ledger.post({
      date,
      type: 'JV',
      narration: `Vendor bill ${bill.billNo} - ${vendor.name}`,
      segment: account.segment,
      party: vendor._id,
      file: file ? file._id : undefined,
      ref: `VBILL:${bill.billNo}`,
      source: { kind: 'vendor-bill', id: String(bill._id), role: 'bill' },
      actor,
      lines: [
        { account: account.code, debit: amount, memo: `${body.service || 'Vendor service'}${body.invoiceRef ? ` - ${body.invoiceRef}` : ''}` },
        { account: AP_ACCOUNT, credit: amount, party: vendor._id, dueDate, memo: `Bill ${bill.billNo}` }
      ]
    });
    bill.journal = journal._id;
    await bill.save();
  } catch (err) {
    await bill.deleteOne();
    throw err;
  }
  await audit(actor, `vendor-bill:${bill._id}`, { action: 'created', amount });
  return presentBill(bill);
};

const listBills = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.vendorId) filter.vendor = query.vendorId;
  if (query.status) filter.status = query.status;
  if (query.from || query.to) filter.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  if (query.search) filter.$or = [{ billNo: { $regex: escapeRegex(query.search), $options: 'i' } }, { vendorName: { $regex: escapeRegex(query.search), $options: 'i' } }, { invoiceRef: { $regex: escapeRegex(query.search), $options: 'i' } }];
  const [items, total] = await Promise.all([VendorBill.find(filter).sort({ date: -1, billNo: -1 }).skip(skip).limit(limit), VendorBill.countDocuments(filter)]);
  const paid = await paidOn(items.map((bill) => bill._id));
  return { items: items.map((bill) => presentBill(bill, paid[String(bill._id)] || 0)), meta: buildMeta(total, page, limit) };
};

const voidBill = async (actor, id, { reason }) => {
  const bill = await VendorBill.findById(id);
  if (!bill) throw new ApiError(404, 'Bill not found.', { code: 'BILL_NOT_FOUND' });
  if (bill.status === 'void') throw new ApiError(409, 'This bill is already voided.', { code: 'ALREADY_VOID' });
  if ((await paidOn([bill._id]))[String(bill._id)]) throw new ApiError(409, 'Payments are linked to this bill. Void them first.', { code: 'BILL_HAS_PAYMENTS' });
  await ledger.voidJournal(bill.journal, { reason, actor });
  bill.status = 'void';
  bill.voidReason = reason;
  bill.voidedAt = new Date();
  await bill.save();
  await audit(actor, `vendor-bill:${bill._id}`, { action: 'voided', reason });
  return presentBill(bill);
};

// ------------------------------------------------------------------ payments and advances

const presentPayment = (payment) => ({
  _id: payment._id,
  voucherNo: payment.voucherNo,
  vendorId: String(payment.vendor),
  vendorName: payment.vendorName,
  date: payment.date,
  amount: fromMinor(payment.amount),
  method: payment.method,
  isAdvance: payment.isAdvance,
  billId: payment.bill ? String(payment.bill) : null,
  note: payment.note,
  status: payment.status,
  voidReason: payment.voidReason,
  createdByName: payment.createdByName,
  createdAt: payment.createdAt
});

const payableOf = async (vendorId) => {
  const rows = await reports.supplierPayables();
  const row = rows.rows.find((r) => r.partyId === String(vendorId));
  return row ? Math.round(row.due * 100) : 0;
};

const createPayment = async (actor, body) => {
  await ensureChartIfEmpty();
  const vendor = await findVendor(body.vendorId);
  const amount = toMinor(body.amount);
  if (amount <= 0) throw fail('The payment must be above zero.', 'INVALID_AMOUNT', 'amount');
  const method = methodOf(body.method || 'cash');
  const date = body.date || dates.todayISO();
  if (!dates.isDay(date)) throw fail('Enter a valid date.', 'INVALID_DATE', 'date');

  let bill = null;
  if (!body.isAdvance) {
    const due = await payableOf(vendor._id);
    if (amount > due) throw fail(`The payment is more than what is owed to this vendor (${fromMinor(due)}). Record the extra as an advance.`, 'PAYMENT_EXCEEDS_DUE', 'amount');
    if (body.billId) {
      bill = await VendorBill.findOne({ _id: body.billId, vendor: vendor._id, status: 'posted' });
      if (!bill) throw new ApiError(404, 'Bill not found for this vendor.', { code: 'BILL_NOT_FOUND' });
      const open = bill.amount - ((await paidOn([bill._id]))[String(bill._id)] || 0);
      if (amount > open) throw fail(`The payment is more than what is left on this bill (${fromMinor(open)}).`, 'PAYMENT_EXCEEDS_BILL', 'amount');
    }
  }

  const payment = await VendorPayment.create({
    voucherNo: await counterService.nextNumber('VP', { year: date.slice(0, 4), width: 4 }),
    vendor: vendor._id,
    vendorName: vendor.name,
    date,
    amount,
    method: method.value,
    isAdvance: Boolean(body.isAdvance),
    bill: bill ? bill._id : undefined,
    note: body.note || '',
    createdBy: actor.id,
    createdByName: actor.name
  });
  try {
    const journal = await ledger.post({
      date,
      type: 'PV',
      narration: `${body.isAdvance ? 'Advance' : 'Payment'} ${payment.voucherNo} - ${vendor.name}`,
      party: vendor._id,
      ref: `VPAY:${payment.voucherNo}`,
      source: { kind: 'vendor-payment', id: String(payment._id), role: 'payment' },
      actor,
      lines: [
        body.isAdvance ? { account: ADVANCE_ACCOUNT, debit: amount, party: vendor._id, memo: body.note || 'Advance to supplier' } : { account: AP_ACCOUNT, debit: amount, party: vendor._id, memo: body.note || `Payment ${payment.voucherNo}` },
        { account: method.account, credit: amount, memo: 'Paid' }
      ]
    });
    payment.journal = journal._id;
    await payment.save();
  } catch (err) {
    await payment.deleteOne();
    throw err;
  }
  await audit(actor, `vendor-payment:${payment._id}`, { action: 'created', amount, advance: payment.isAdvance });
  return presentPayment(payment);
};

const listPayments = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.vendorId) filter.vendor = query.vendorId;
  if (query.status) filter.status = query.status;
  if (query.isAdvance !== undefined) filter.isAdvance = query.isAdvance === 'true';
  if (query.from || query.to) filter.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  const [items, total] = await Promise.all([VendorPayment.find(filter).sort({ date: -1, voucherNo: -1 }).skip(skip).limit(limit), VendorPayment.countDocuments(filter)]);
  return { items: items.map(presentPayment), meta: buildMeta(total, page, limit) };
};

const voidPayment = async (actor, id, { reason }) => {
  const payment = await VendorPayment.findById(id);
  if (!payment) throw new ApiError(404, 'Payment not found.', { code: 'PAYMENT_NOT_FOUND' });
  if (payment.status === 'void') throw new ApiError(409, 'This payment is already voided.', { code: 'ALREADY_VOID' });
  await ledger.voidJournal(payment.journal, { reason, actor });
  payment.status = 'void';
  payment.voidReason = reason;
  payment.voidedAt = new Date();
  await payment.save();
  await audit(actor, `vendor-payment:${payment._id}`, { action: 'voided', reason });
  return presentPayment(payment);
};

module.exports = { listVendors, getVendor, createVendor, updateVendor, createBill, listBills, voidBill, createPayment, listPayments, voidPayment };
