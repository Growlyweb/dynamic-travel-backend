const Account = require('../../models/Account');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const SaleCategory = require('../../models/SaleCategory');
const SaleFile = require('../../models/SaleFile');
const { AR_ACCOUNT, AP_ACCOUNT, DISCOUNT_ACCOUNT, OTHER_REVENUE_ACCOUNT, PAYMENT_METHODS, CASH_ACCOUNTS, CUSTOM_CATEGORY } = require('../../config/accounting');
const { AUDIT_ACTIONS } = require('../../config/constants');
const ApiError = require('../../utils/ApiError');
const counterService = require('../counterService');
const auditService = require('../auditService');
const { toMinor, fromMinor } = require('./money');
const dates = require('./dates');
const ledger = require('./ledger');
const { ensureChartIfEmpty } = require('./chart');
const reports = require('./reports');

// Sales, receipts, costs, expenses, clients and partner money. Every action posts journals through ledger.post() and
// nothing here keeps a second copy of a number. If a step fails after an earlier one posted, the earlier journals are
// voided again, so the books never hold half of a sale.

const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const audit = (actor, resource, meta) => actor && actor.id && auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.ACCOUNTING_CHANGED, resource, meta });
const methodAccount = (method) => (PAYMENT_METHODS.find((m) => m.value === method) || PAYMENT_METHODS[0]).account;
const checkMethod = (method) => {
  if (method && !PAYMENT_METHODS.some((m) => m.value === method)) throw new ApiError(422, `Unknown payment method "${method}".`, { code: 'INVALID_METHOD', errors: [{ field: 'body.method', message: 'Choose cash, bank or bKash.' }] });
};
const failure = (message, code, field, status = 422) => new ApiError(status, message, { code, errors: field ? [{ field: `body.${field}`, message }] : undefined });

// ------------------------------------------------------------------ parties

const nextPartyCode = async (type) => {
  const prefix = { B2B: 'A', B2C: 'C', Vendor: 'VND' }[type];
  const n = await counterService.next(`party:${prefix}`);
  return `${prefix}-${String(n).padStart(4, '0')}`;
};

const ensureParty = async ({ type, name, phone = '', email = '', creditLimit, partner }) => {
  const clean = String(name || '').trim();
  if (!clean) throw failure('Client name is required.', 'NAME_REQUIRED', 'clientName');
  const nameKey = keyOf(clean);
  const existing = await Party.findOne({ type, nameKey });
  if (existing) {
    if (phone && existing.phone !== phone) {
      existing.phone = phone;
      await existing.save();
    }
    return existing;
  }
  try {
    return await Party.create({
      type,
      code: await nextPartyCode(type),
      name: clean,
      nameKey,
      phone,
      email,
      creditLimit: creditLimit ?? (type === 'B2B' ? 10000000 : 0),
      since: dates.todayISO(),
      partner
    });
  } catch (err) {
    if (err.code === 11000) return Party.findOne({ type, nameKey });
    throw err;
  }
};

const unassignedSupplier = () => ensureParty({ type: 'Vendor', name: 'Unassigned supplier' });

const listParties = async (type) => {
  const parties = await Party.find({ type }).lean();
  const figures = await reports.fileFigures();
  const files = await SaleFile.find({ partyType: type, status: { $ne: 'Cancelled' } }).select('party date').lean();
  return parties
    .map((party) => {
      const mine = files.filter((file) => String(file.party) === String(party._id));
      const sum = (key) => mine.reduce((total, file) => total + ((figures.get(String(file._id)) || {})[key] || 0), 0);
      const invoiced = sum('sale') - sum('discount');
      const due = Math.max(0, mine.reduce((total, file) => total + Math.max(0, (figures.get(String(file._id)) || { ar: 0 }).ar), 0));
      return {
        _id: party._id,
        code: party.code,
        type: party.type,
        name: party.name,
        phone: party.phone,
        email: party.email,
        address: party.address,
        creditLimit: fromMinor(party.creditLimit),
        active: party.active,
        since: party.since,
        invoices: mine.length,
        invoiced: fromMinor(invoiced),
        received: fromMinor(sum('received')),
        due: fromMinor(due),
        lastDate: mine.map((file) => file.date).sort().at(-1) || null,
        creditUsed: party.creditLimit > 0 ? (due / party.creditLimit) * 100 : 0
      };
    })
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
};

const addParty = async (actor, { type, name, phone, email, address, creditLimit }) => {
  const nameKey = keyOf(name);
  if (await Party.exists({ type, nameKey })) throw new ApiError(409, `${type === 'B2B' ? 'Agent' : 'Client'} "${name.trim()}" already exists.`, { code: 'PARTY_EXISTS' });
  const party = await ensureParty({ type, name, phone, email, creditLimit: creditLimit === undefined ? undefined : toMinor(creditLimit) });
  if (address) {
    party.address = address;
    await party.save();
  }
  await audit(actor, `party:${party._id}`, { action: 'created' });
  return { _id: party._id, code: party.code, type: party.type, name: party.name, phone: party.phone, email: party.email, address: party.address, creditLimit: fromMinor(party.creditLimit), active: party.active, since: party.since, invoices: 0, invoiced: 0, received: 0, due: 0, lastDate: null, creditUsed: 0 };
};

// ------------------------------------------------------------------ categories

const categoryList = async () => {
  await ensureChartIfEmpty();
  const [categories, used] = await Promise.all([SaleCategory.find().sort({ builtin: -1, label: 1 }).lean(), SaleFile.distinct('category')]);
  const known = new Set(categories.map((category) => category.label));
  return [...categories, ...used.filter((label) => !known.has(label)).map((label) => ({ label, color: CUSTOM_CATEGORY.color, type: CUSTOM_CATEGORY.type }))].map((c) => ({ _id: c._id, label: c.label, color: c.color, type: c.type, builtin: Boolean(c.builtin) }));
};

const ensureCategory = async (label) => {
  const clean = String(label || '').trim();
  const found = await SaleCategory.findOne({ labelKey: clean.toLowerCase() });
  if (found) return found;
  return SaleCategory.create({ label: clean, labelKey: clean.toLowerCase(), ...CUSTOM_CATEGORY, builtin: false });
};

const addCategory = async (actor, { label, color }) => {
  const clean = label.trim();
  if (await SaleCategory.exists({ labelKey: clean.toLowerCase() })) throw new ApiError(409, `Category "${clean}" already exists.`, { code: 'CATEGORY_EXISTS' });
  const category = await SaleCategory.create({ label: clean, labelKey: clean.toLowerCase(), ...CUSTOM_CATEGORY, ...(color ? { color } : {}), builtin: false });
  await audit(actor, `category:${category._id}`, { action: 'created' });
  return category;
};

const removeCategory = async (actor, id) => {
  const category = await SaleCategory.findById(id);
  if (!category) throw new ApiError(404, 'Category not found.', { code: 'CATEGORY_NOT_FOUND' });
  if (category.builtin) throw new ApiError(409, 'The default categories cannot be deleted.', { code: 'CATEGORY_LOCKED' });
  if (await SaleFile.exists({ category: category.label, status: { $ne: 'Cancelled' } })) throw new ApiError(409, 'This category is used by sales and cannot be deleted.', { code: 'CATEGORY_IN_USE' });
  await category.deleteOne();
  await audit(actor, `category:${category._id}`, { action: 'deleted' });
};

// ------------------------------------------------------------------ sales

const nextFileNo = (prefix, date) => counterService.nextNumber(prefix, { year: date.slice(0, 4), width: 4 });

const loadFile = async (id) => {
  const file = await SaleFile.findById(id);
  if (!file) throw new ApiError(404, 'Sale not found.', { code: 'SALE_NOT_FOUND' });
  return file;
};

const figuresOf = async (file) => (await reports.fileFigures([file._id])).get(String(file._id)) || { sale: 0, discount: 0, cost: 0, received: 0, ar: 0 };

const present = async (file) => {
  const [populated, figures] = await Promise.all([SaleFile.findById(file._id).populate('party', 'phone'), figuresOf(file)]);
  return reports.presentFile(populated, figures);
};

// The journals of a sale: the sale itself, and the cost price. `revision` changes when the sale is edited, so a new
// posting never clashes with the one it replaces.
const postSaleJournals = async (file, meta, actor) => {
  const made = [];
  try {
    made.push(
      await ledger.post({
        date: file.date,
        type: 'SV',
        narration: `Sale - ${file.fileNo}`,
        segment: meta.segment,
        party: file.party,
        file: file._id,
        ref: file.fileNo,
        source: { kind: 'sale-file', id: String(file._id), role: `sale#${file.revision}` },
        actor,
        lines: [
          { account: AR_ACCOUNT, debit: file.sale, party: file.party, dueDate: file.dueDate, memo: `${file.category} - ${file.partyName}` },
          { account: meta.revenue, credit: file.sale, memo: file.category }
        ]
      })
    );
    if (file.discount > 0) {
      made.push(
        await ledger.post({
          date: file.date,
          type: 'JV',
          narration: `Discount - ${file.fileNo}`,
          segment: meta.segment,
          party: file.party,
          file: file._id,
          ref: file.fileNo,
          source: { kind: 'sale-file', id: String(file._id), role: `discount#${file.revision}` },
          actor,
          lines: [
            { account: DISCOUNT_ACCOUNT, debit: file.discount, kind: 'discount', memo: 'Discount allowed' },
            { account: AR_ACCOUNT, credit: file.discount, party: file.party, memo: file.fileNo }
          ]
        })
      );
    }
    const priced = file.costs.filter((c) => c.amount > 0 && c.label === 'Cost price');
    for (const [index, cost] of priced.entries()) {
      const vendor = cost.vendor || (await unassignedSupplier())._id;
      made.push(await postCostJournal(file, cost, vendor, meta, `cost#${file.revision}:${index}`, actor));
    }
    return made;
  } catch (err) {
    for (const journal of made) await ledger.voidJournal(journal, { reason: 'The sale could not be saved.' });
    throw err;
  }
};

const postCostJournal = (file, cost, vendor, meta, role, actor) =>
  ledger.post({
    date: cost.date || file.date,
    type: 'JV',
    narration: `${cost.label} - ${file.fileNo}`,
    segment: meta.segment,
    party: vendor,
    file: file._id,
    ref: file.fileNo,
    source: { kind: 'sale-file', id: String(file._id), role },
    actor,
    lines: [
      { account: cost.account, debit: cost.amount, memo: cost.label },
      { account: AP_ACCOUNT, credit: cost.amount, party: vendor, dueDate: dates.addDays(cost.date || file.date, 30), memo: 'Supplier cost' }
    ]
  });

const postReceiptJournal = (file, { amount, discount, method, date, note, manualNo, source }, actor) => {
  const lines = [];
  if (amount > 0) lines.push({ account: methodAccount(method), debit: amount, memo: 'Money received' });
  if (discount > 0) lines.push({ account: DISCOUNT_ACCOUNT, debit: discount, kind: 'discount', memo: 'Discount allowed' });
  lines.push({ account: AR_ACCOUNT, credit: amount + discount, party: file.party, memo: file.fileNo });
  return ledger.post({
    date,
    type: 'RV',
    narration: (note || '').trim() || `Money receipt - ${file.fileNo}`,
    segment: file.segment,
    party: file.party,
    file: file._id,
    ref: file.fileNo,
    manualNo,
    source,
    actor,
    lines
  });
};

const categoryOf = async (label) => {
  await ensureChartIfEmpty();
  const category = await ensureCategory(label);
  return category.toObject ? category.toObject() : category;
};

const createSale = async (actor, payload) => {
  checkMethod(payload.method);
  const sale = toMinor(payload.sale);
  const cost = toMinor(payload.cost);
  const received = toMinor(payload.received);
  const discount = toMinor(payload.discount);
  if (sale <= 0) throw failure('The selling price must be above zero.', 'INVALID_AMOUNT', 'sale');
  if (cost < 0) throw failure('The cost price cannot be negative.', 'INVALID_AMOUNT', 'cost');
  if (received + discount > sale) throw failure('The money received and the discount cannot be more than the selling price.', 'RECEIVED_TOO_HIGH', 'received');
  if (payload.date && !dates.isDay(payload.date)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');

  const category = await categoryOf(payload.category);
  const date = payload.date || dates.todayISO();
  const isB2B = payload.clientType === 'B2B';
  const party = await ensureParty({ type: isB2B ? 'B2B' : 'B2C', name: (isB2B ? payload.agencyName : payload.clientName) || payload.clientName, phone: payload.phone });

  const file = await SaleFile.create({
    fileNo: await nextFileNo(category.prefix, date),
    type: category.type,
    segment: category.segment,
    category: category.label,
    date,
    dueDate: dates.addDays(date, category.dueDays),
    applicant: (payload.clientName || party.name).trim(),
    party: party._id,
    partyName: party.name,
    partyType: party.type,
    destination: payload.destination || category.label,
    detail: payload.detail || payload.phone || '',
    passportNo: payload.passportNo || '',
    sale,
    discount,
    costs: cost > 0 ? [{ account: category.costAccount, label: 'Cost price', amount: cost, date }] : [],
    notes: payload.note || '',
    createdBy: actor.id,
    createdByName: actor.name
  });

  const posted = [];
  try {
    posted.push(...(await postSaleJournals(file, category, actor)));
    if (received > 0) posted.push(await postReceiptJournal(file, { amount: received, discount: 0, method: payload.method || 'cash', date, note: 'Received at sale', source: { kind: 'sale-file', id: String(file._id), role: 'receipt#initial' } }, actor));
  } catch (err) {
    for (const journal of posted) await ledger.voidJournal(journal, { reason: 'The sale could not be saved.' });
    await file.deleteOne();
    throw err;
  }
  await audit(actor, `sale:${file._id}`, { action: 'created', fileNo: file.fileNo });
  return present(file);
};

// Editing replaces the sale and its cost price with new vouchers. Receipts and extra costs stay.
const updateSale = async (actor, id, payload) => {
  const file = await loadFile(id);
  if (file.status === 'Cancelled') throw new ApiError(409, 'Cancelled sales cannot be edited.', { code: 'SALE_CANCELLED' });
  const sale = toMinor(payload.sale);
  const cost = toMinor(payload.cost);
  const discount = payload.discount === undefined ? file.discount : toMinor(payload.discount);
  if (sale <= 0) throw failure('The selling price must be above zero.', 'INVALID_AMOUNT', 'sale');
  if (cost < 0) throw failure('The cost price cannot be negative.', 'INVALID_AMOUNT', 'cost');
  if (payload.date && !dates.isDay(payload.date)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');

  const figures = await figuresOf(file);
  // Money already received, plus any discount taken on receipts, must still fit under the new selling price.
  const settled = figures.received + (figures.discount - file.discount);
  if (sale < settled + discount) throw failure('The selling price cannot be less than what was already received.', 'SALE_BELOW_RECEIVED', 'sale');

  const category = await categoryOf(payload.category || file.category);
  const isB2B = payload.clientType ? payload.clientType === 'B2B' : file.partyType === 'B2B';
  const name = (isB2B ? payload.agencyName : payload.clientName) || payload.clientName;
  const party = name ? await ensureParty({ type: isB2B ? 'B2B' : 'B2C', name, phone: payload.phone }) : await Party.findById(file.party);

  const previous = await Journal.find({ file: file._id, status: 'posted', 'source.kind': 'sale-file', 'source.role': { $regex: `^(sale|discount|cost)#${file.revision}(:[0-9]+)?$` } });
  for (const journal of previous) await ledger.voidJournal(journal, { reason: 'The sale was edited.', actor });

  const extras = file.costs.filter((line) => line.label !== 'Cost price');
  const date = payload.date || file.date;
  Object.assign(file, {
    type: category.type,
    segment: category.segment,
    category: category.label,
    date,
    dueDate: dates.addDays(date, category.dueDays),
    applicant: (payload.clientName || party.name).trim(),
    party: party._id,
    partyName: party.name,
    partyType: party.type,
    sale,
    discount,
    costs: [...(cost > 0 ? [{ account: category.costAccount, label: 'Cost price', amount: cost, date }] : []), ...extras],
    notes: payload.note === undefined ? file.notes : payload.note,
    revision: file.revision + 1
  });
  await file.save();
  await postSaleJournals(file, category, actor);
  await audit(actor, `sale:${file._id}`, { action: 'updated', fileNo: file.fileNo });
  return present(file);
};

// An extra cost on a sale (a vendor charge that came later).
const addCost = async (actor, id, { amount, note, date, vendorId }) => {
  const file = await loadFile(id);
  if (file.status === 'Cancelled') throw new ApiError(409, 'Cancelled sales cannot take new costs.', { code: 'SALE_CANCELLED' });
  const minor = toMinor(amount);
  if (minor <= 0) throw failure('The cost must be above zero.', 'INVALID_AMOUNT', 'amount');
  const day = date || dates.todayISO();
  if (!dates.isDay(day)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');

  const category = await categoryOf(file.category);
  const vendor = vendorId ? await Party.findOne({ _id: vendorId, type: 'Vendor' }) : await unassignedSupplier();
  if (!vendor) throw new ApiError(404, 'Supplier not found.', { code: 'VENDOR_NOT_FOUND' });

  file.costs.push({ account: category.costAccount, label: (note || '').trim() || 'Extra cost', amount: minor, date: day, vendor: vendor._id });
  const line = file.costs[file.costs.length - 1];
  const journal = await postCostJournal(file, line, vendor._id, category, `cost:${line._id}`, actor).catch((err) => {
    file.costs.pull(line._id);
    throw err;
  });
  await file.save().catch(async (err) => {
    await ledger.voidJournal(journal, { reason: 'The cost could not be saved.' });
    throw err;
  });
  await audit(actor, `sale:${file._id}`, { action: 'cost-added', amount: minor });
  return present(file);
};

// Cancelling a sale takes it out of every report. Money already received needs a decision, because only the business
// knows whether it is given back or kept:
//   refund : everything is voided, the money goes back to the client
//   keep   : everything is voided, and the money received is kept as income (a cancellation fee)
const cancelSale = async (actor, id, { reason, settlement }) => {
  const file = await loadFile(id);
  if (file.status === 'Cancelled') throw new ApiError(409, 'This sale is already cancelled.', { code: 'SALE_CANCELLED' });
  const figures = await figuresOf(file);
  if (figures.received > 0 && !['refund', 'keep'].includes(settlement)) {
    throw new ApiError(422, `${fromMinor(figures.received)} has been received on this sale. Choose what happens to it: refund it, or keep it as income.`, {
      code: 'SETTLEMENT_REQUIRED',
      errors: [{ field: 'body.settlement', message: 'Choose refund or keep.' }]
    });
  }

  // What was collected, by cash or bank account, before the receipts are voided.
  const receipts = await Journal.find({ file: file._id, status: 'posted', type: 'RV' }).lean();
  const collected = {};
  receipts.forEach((journal) =>
    journal.lines.filter((line) => CASH_ACCOUNTS.includes(line.account)).forEach((line) => {
      collected[line.account] = (collected[line.account] || 0) + line.debit - line.credit;
    })
  );

  const journals = await Journal.find({ file: file._id, status: 'posted' });
  for (const journal of journals) await ledger.voidJournal(journal, { reason: `Sale cancelled: ${reason}`, actor });

  if (settlement === 'keep') {
    const lines = Object.entries(collected).filter(([, amount]) => amount > 0).map(([account, amount]) => ({ account, debit: amount, memo: 'Money kept' }));
    const total = lines.reduce((sum, line) => sum + line.debit, 0);
    if (total > 0) {
      await ledger.post({
        date: dates.todayISO(),
        type: 'JV',
        narration: `Cancellation fee kept - ${file.fileNo}`,
        segment: file.segment,
        party: file.party,
        ref: file.fileNo,
        source: { kind: 'sale-file', id: String(file._id), role: 'cancel-keep' },
        actor,
        lines: [...lines, { account: OTHER_REVENUE_ACCOUNT, credit: total, memo: 'Cancellation fee' }]
      });
    }
  }

  file.status = 'Cancelled';
  file.cancelledAt = new Date();
  file.cancelReason = reason;
  file.cancelSettlement = figures.received > 0 ? settlement : 'none';
  await file.save();
  await audit(actor, `sale:${file._id}`, { action: 'cancelled', settlement: file.cancelSettlement });
  return present(file);
};

// ------------------------------------------------------------------ receipts

const methodLabel = (account) => (PAYMENT_METHODS.find((m) => m.account === account) || {}).label || '';

const presentReceipts = async (journals) => {
  const [parties, files] = await Promise.all([
    Party.find({ _id: { $in: journals.map((j) => j.party).filter(Boolean) } }).lean(),
    SaleFile.find({ _id: { $in: journals.map((j) => j.file).filter(Boolean) } }).lean()
  ]);
  const figures = await reports.fileFigures(files.map((f) => f._id));
  const partyOf = Object.fromEntries(parties.map((p) => [String(p._id), p]));
  const fileOf = Object.fromEntries(files.map((f) => [String(f._id), f]));
  return journals.map((journal) => {
    const cashLines = journal.lines.filter((line) => CASH_ACCOUNTS.includes(line.account) && line.debit > 0);
    const amount = cashLines.reduce((sum, line) => sum + line.debit, 0);
    const discount = journal.lines.filter((line) => line.account === DISCOUNT_ACCOUNT && line.kind === 'discount').reduce((sum, line) => sum + line.debit, 0);
    const file = journal.file ? fileOf[String(journal.file)] : null;
    const party = partyOf[String(journal.party)] || null;
    const accountCode = cashLines[0] ? cashLines[0].account : '';
    const paymentType = accountCode === '1010' ? 'Cash' : accountCode === '1040' ? 'bKash' : accountCode ? 'Bank' : '';
    return {
      _id: journal._id,
      no: journal.no,
      manualNo: journal.manualNo || '',
      date: journal.date,
      createdAt: journal.createdAt,
      status: journal.status,
      voidReason: journal.voidReason,
      clientName: party ? party.name : file ? file.partyName : '',
      clientPhone: party ? party.phone : '',
      partyCode: party ? party.code : '',
      partyType: party ? party.type : '',
      invoiceType: file ? 'Invoice' : 'Overall',
      invoiceNo: file ? file.fileNo : '',
      category: file ? file.category : 'Overall',
      paymentType,
      methodLabel: methodLabel(accountCode) || paymentType,
      accountCode,
      amount: fromMinor(amount),
      discount: fromMinor(discount),
      totalApplied: fromMinor(amount + discount),
      note: journal.narration,
      fileId: file ? file._id : null,
      sale: file ? fromMinor(((figures.get(String(file._id)) || {}).sale) || 0) : 0,
      dueNow: file ? fromMinor(Math.max(0, (figures.get(String(file._id)) || { ar: 0 }).ar)) : 0,
      createdByName: journal.createdByName
    };
  });
};

const listReceipts = async ({ from, to, search, page = 1, limit = 100 } = {}) => {
  const filter = { status: 'posted', type: 'RV', ...ledger.dateRange({ from, to }) };
  if (search) {
    const rx = { $regex: String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const parties = await Party.find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').lean();
    const files = await SaleFile.find({ $or: [{ fileNo: rx }, { category: rx }] }).select('_id').lean();
    filter.$or = [{ no: rx }, { manualNo: rx }, { narration: rx }, { party: { $in: parties.map((p) => p._id) } }, { file: { $in: files.map((f) => f._id) } }];
  }
  // One page is read from the database. The summary is added up by the database over every match.
  const [pageRows, total, sums] = await Promise.all([
    Journal.find(filter).sort({ date: -1, no: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Journal.countDocuments(filter),
    Journal.aggregate([
      { $match: filter },
      { $unwind: '$lines' },
      { $match: { $or: [{ 'lines.account': { $in: CASH_ACCOUNTS }, 'lines.debit': { $gt: 0 } }, { 'lines.account': DISCOUNT_ACCOUNT, 'lines.kind': 'discount' }] } },
      { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' } } }
    ])
  ]);
  const taken = (codes) => fromMinor(sums.filter((row) => codes.includes(row._id)).reduce((sum, row) => sum + row.debit, 0));
  const cash = taken(['1010']);
  const bank = taken(['1020', '1030']);
  const bkash = taken(['1040']);
  return {
    rows: await presentReceipts(pageRows),
    total,
    summary: { count: total, total: taken(CASH_ACCOUNTS), cash, bank, bkash, discount: taken([DISCOUNT_ACCOUNT]) }
  };
};

const getReceipt = async (idOrNo) => {
  const isId = /^[0-9a-fA-F]{24}$/.test(idOrNo);
  const journal = await Journal.findOne({ type: 'RV', ...(isId ? { _id: idOrNo } : { no: idOrNo }) }).lean();
  if (!journal) throw new ApiError(404, 'Money receipt not found.', { code: 'RECEIPT_NOT_FOUND' });
  return (await presentReceipts([journal]))[0];
};

// Money received on a sale, with an optional discount. It can never be more than what is due.
const addReceipt = async (actor, payload) => {
  checkMethod(payload.method);
  const file = await loadFile(payload.invoiceId);
  if (file.status === 'Cancelled') throw new ApiError(409, 'This sale is cancelled.', { code: 'SALE_CANCELLED' });
  const amount = toMinor(payload.amount);
  const discount = toMinor(payload.discount);
  if (amount + discount <= 0) throw failure('Enter an amount received or a discount.', 'INVALID_AMOUNT', 'amount');
  const figures = await figuresOf(file);
  if (amount + discount > Math.max(0, figures.ar)) {
    throw failure(`The amount and the discount cannot be more than the amount due (${fromMinor(Math.max(0, figures.ar))}).`, 'RECEIPT_EXCEEDS_DUE', 'amount');
  }
  const date = payload.date || dates.todayISO();
  if (!dates.isDay(date)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');
  const manualNo = payload.receiptNo && payload.receiptNo.trim() ? payload.receiptNo.trim() : undefined;
  if (manualNo && (await Journal.exists({ manualNo }))) throw failure(`Receipt number ${manualNo} is already used.`, 'RECEIPT_NO_USED', 'receiptNo', 409);

  const journal = await postReceiptJournal(file, { amount, discount, method: payload.method || 'cash', date, note: payload.note, manualNo }, actor);
  await audit(actor, `receipt:${journal._id}`, { action: 'created', fileNo: file.fileNo, amount, discount });
  return (await presentReceipts([journal.toObject()]))[0];
};

const voidReceipt = async (actor, id, { reason }) => {
  const journal = await Journal.findOne({ _id: id, type: 'RV' });
  if (!journal) throw new ApiError(404, 'Money receipt not found.', { code: 'RECEIPT_NOT_FOUND' });
  if (journal.status === 'void') throw new ApiError(409, 'This receipt is already voided.', { code: 'ALREADY_VOID' });
  await ledger.voidJournal(journal, { reason, actor });
  await audit(actor, `receipt:${journal._id}`, { action: 'voided', reason });
  return (await presentReceipts([journal.toObject()]))[0];
};

// ------------------------------------------------------------------ expenses and partner money

const expenseAccounts = async () =>
  (await Account.find({ type: 'Expense', group: 'Operating Expenses' }).sort({ code: 1 }).lean()).map((account) => ({ code: account.code, name: account.name }));

const addExpense = async (actor, { amount, date, account = '6100', method = 'cash', note }) => {
  checkMethod(method);
  const minor = toMinor(amount);
  if (minor <= 0) throw failure('The expense must be above zero.', 'INVALID_AMOUNT', 'amount');
  const row = await Account.findOne({ code: account, type: 'Expense', group: 'Operating Expenses' });
  if (!row) throw failure('Choose an expense account.', 'INVALID_ACCOUNT', 'account');
  const day = date || dates.todayISO();
  if (!dates.isDay(day)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');
  const journal = await ledger.post({
    date: day,
    type: 'PV',
    narration: (note || '').trim() || 'Office expense',
    ref: 'EXPENSE',
    actor,
    lines: [{ account, debit: minor, memo: (note || '').trim() || 'Office expense' }, { account: methodAccount(method), credit: minor, memo: 'Paid' }]
  });
  await audit(actor, `expense:${journal._id}`, { action: 'created', amount: minor });
  return { _id: journal._id, no: journal.no, date: day, amount: fromMinor(minor), account, note: journal.narration };
};

// Partners put money in (capital) or take it out (drawings).
const addPartnerTransaction = async (actor, { partner, direction, amount, date, method = 'city', note }) => {
  checkMethod(method);
  const minor = toMinor(amount);
  if (minor <= 0) throw failure('The amount must be above zero.', 'INVALID_AMOUNT', 'amount');
  const capital = partner === 'B' ? '3020' : '3010';
  const drawings = partner === 'B' ? '3040' : '3030';
  const day = date || dates.todayISO();
  if (!dates.isDay(day)) throw failure('Enter a valid date.', 'INVALID_DATE', 'date');
  const out = direction === 'out';
  const journal = await ledger.post({
    date: day,
    type: 'PV',
    narration: (note || '').trim() || `Partner ${partner} ${out ? 'withdrawal' : 'capital'}`,
    ref: 'PARTNER',
    actor,
    lines: out
      ? [{ account: drawings, debit: minor, memo: note || 'Money out' }, { account: methodAccount(method), credit: minor, memo: 'Partner withdrawal' }]
      : [{ account: methodAccount(method), debit: minor, memo: note || 'Money in' }, { account: capital, credit: minor, memo: 'Partner capital' }]
  });
  await audit(actor, `partner:${journal._id}`, { action: 'created', partner, direction, amount: minor });
  return { _id: journal._id, no: journal.no, date: day, partner, direction, amount: fromMinor(minor) };
};

// The price list is worked out from what was really sold. A category with no sales shows a starting price.
const PRICE_DEFAULTS = { Visa: { b2b: 12000, b2c: 15000, cost: 9000 }, 'Tour Package': { b2b: 52000, b2c: 60000, cost: 45000 }, 'Air Ticket': { b2b: 47000, b2c: 50000, cost: 43000 }, Hotel: { b2b: 21000, b2c: 25000, cost: 18000 }, Transport: { b2b: 4000, b2c: 5000, cost: 3000 } };
const priceList = async () => {
  await ensureChartIfEmpty();
  const { rows } = await reports.listFiles({}, { limit: 100000 });
  const categories = await SaleCategory.find({ builtin: true }).sort({ label: 1 }).lean();
  const average = (list, key) => (list.length ? Math.round(list.reduce((sum, row) => sum + row[key], 0) / list.length / 100) * 100 : 0);
  return categories.map((category) => {
    const items = rows.filter((row) => row.category === category.label);
    const fallback = PRICE_DEFAULTS[category.label] || { b2b: 0, b2c: 0, cost: 0 };
    return {
      label: category.label,
      b2b: average(items.filter((row) => row.partyType === 'B2B'), 'sale') || fallback.b2b,
      b2c: average(items.filter((row) => row.partyType === 'B2C'), 'sale') || fallback.b2c,
      cost: average(items, 'cost') || fallback.cost,
      count: items.length
    };
  });
};

module.exports = {
  ensureParty,
  unassignedSupplier,
  listParties,
  addParty,
  categoryList,
  addCategory,
  removeCategory,
  ensureCategory,
  createSale,
  updateSale,
  addCost,
  cancelSale,
  getSale: async (id) => present(await loadFile(id)),
  listReceipts,
  getReceipt,
  addReceipt,
  voidReceipt,
  expenseAccounts,
  addExpense,
  addPartnerTransaction,
  priceList,
  postReceiptJournal,
  postSaleJournals,
  categoryOf,
  methodAccount,
  loadFile,
  figuresOf,
  present
};
