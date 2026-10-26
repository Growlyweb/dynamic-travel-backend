const Account = require('../../models/Account');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const SaleCategory = require('../../models/SaleCategory');
const SaleFile = require('../../models/SaleFile');
const { AR_ACCOUNT, AP_ACCOUNT, ADVANCE_ACCOUNT, DISCOUNT_ACCOUNT, CASH_ACCOUNTS, AGING_BUCKETS, DEFAULT_CATEGORIES, CUSTOM_CATEGORY } = require('../../config/accounting');
const { fromMinor } = require('./money');
const dates = require('./dates');
const { sums, linesOf, dateRange } = require('./ledger');

// Every figure is added up from posted journals, never stored twice. This file is where the profit rule lives:
//   revenue      = income accounts (4xxx) after discounts (4090), on the voucher date
//   direct costs = 5xxx accounts, on the voucher date (the vendor bill date)
//   gross profit = revenue - direct costs
//   net profit   = gross profit - operating expenses (6xxx)
// Voided vouchers and cancelled files count for nothing. Cash is shown apart and never mixed into profit.
// Money leaves this file in taka. Inside, everything is whole paisa.

const taka = fromMinor;
const ZERO = Object.freeze({ sale: 0, discount: 0, cost: 0, received: 0, ar: 0 });

// ------------------------------------------------------------------ files

// What each file has earned, cost and collected, from the journals tagged with it.
const fileFigures = async (fileIds = null) => {
  const rows = await sums({
    journal: fileIds ? { file: { $in: fileIds } } : { file: { $exists: true, $ne: null } },
    by: { file: '$file', account: '$lines.account' }
  });
  const figures = new Map();
  for (const { key, debit, credit } of rows) {
    const id = String(key.file);
    const f = figures.get(id) || { ...ZERO };
    const { account } = key;
    if (account === DISCOUNT_ACCOUNT) f.discount += debit - credit;
    else if (account[0] === '4') f.sale += credit - debit;
    else if (account[0] === '5') f.cost += debit - credit;
    else if (CASH_ACCOUNTS.includes(account)) f.received += debit - credit;
    else if (account === AR_ACCOUNT) f.ar += debit - credit;
    figures.set(id, f);
  }
  return figures;
};

const presentFile = (file, figures = ZERO, today = dates.todayISO()) => {
  const net = figures.sale - figures.discount;
  const profit = net - figures.cost;
  const due = Math.max(0, figures.ar);
  const dueDate = file.dueDate || file.date;
  let paymentStatus = 'Unpaid';
  if (figures.sale > 0 && due === 0) paymentStatus = 'Paid';
  else if (figures.received > 0) paymentStatus = 'Partial';
  const party = file.party && file.party._id ? file.party : null;

  return {
    _id: file._id,
    fileNo: file.fileNo,
    type: file.type,
    segment: file.segment,
    category: file.category,
    date: file.date,
    dueDate,
    applicant: file.applicant,
    partyId: String(party ? party._id : file.party),
    partyName: file.partyName,
    partyType: file.partyType,
    partyPhone: party ? party.phone : '',
    destination: file.destination,
    detail: file.detail,
    passportNo: file.passportNo,
    notes: file.notes,
    status: file.status,
    sale: taka(figures.sale),
    discount: taka(figures.discount),
    cost: taka(figures.cost),
    profit: taka(profit),
    margin: net > 0 ? (profit / net) * 100 : 0,
    received: taka(figures.received),
    due: taka(due),
    paymentStatus,
    daysWaiting: due > 0 ? Math.max(0, dates.daysBetween(file.date, today)) : 0,
    daysOverdue: due > 0 ? Math.max(0, dates.daysBetween(dueDate, today)) : 0,
    costLines: (file.costs || []).map((cost) => ({ _id: cost._id, account: cost.account, label: cost.label, amount: taka(cost.amount), date: cost.date })),
    source: file.source && file.source.kind ? file.source : null,
    createdByName: file.createdByName,
    createdAt: file.createdAt
  };
};

const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The conditions of the sales screens. "all" or no status means every file except cancelled ones.
const fileFilter = async ({ type, status, from, to, search, segment, category } = {}) => {
  const filter = {};
  if (type && type !== 'all') filter.type = type;
  if (segment) filter.segment = segment;
  if (category && category !== 'all') filter.category = category;
  filter.status = status && status !== 'all' ? status : { $ne: 'Cancelled' };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (search) {
    const rx = { $regex: escape(search.trim()), $options: 'i' };
    const parties = await Party.find({ $or: [{ phone: rx }, { name: rx }] }).select('_id').lean();
    filter.$or = [{ fileNo: rx }, { applicant: rx }, { destination: rx }, { detail: rx }, { passportNo: rx }, { partyName: rx }, { category: rx }, { party: { $in: parties.map((p) => p._id) } }];
  }
  return filter;
};

const summarize = (rows) => {
  const sale = rows.reduce((sum, row) => sum + row.sale, 0);
  const discount = rows.reduce((sum, row) => sum + row.discount, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const profit = sale - discount - cost;
  return {
    count: rows.length,
    sale,
    discount,
    cost,
    profit,
    margin: sale - discount > 0 ? (profit / (sale - discount)) * 100 : 0,
    received: rows.reduce((sum, row) => sum + row.received, 0),
    due: rows.reduce((sum, row) => sum + row.due, 0),
    averageTicket: rows.length ? sale / rows.length : 0
  };
};

// All files that match, with their figures. The summary covers every match, the rows are one page.
const listFiles = async (filters = {}, { page = 1, limit = 100 } = {}) => {
  const filter = await fileFilter(filters);
  const ids = await SaleFile.find(filter).select('_id').lean();
  const figures = await fileFigures(ids.map((row) => row._id));
  const everyone = await SaleFile.find(filter).populate('party', 'phone').sort({ date: -1, fileNo: -1 });
  const today = dates.todayISO();
  const all = everyone.map((file) => presentFile(file, figures.get(String(file._id)), today));
  const rows = all.slice((page - 1) * limit, page * limit);
  return { rows, summary: summarize(all), total: all.length };
};

// Files that still owe money, oldest first.
const listDues = async ({ page = 1, limit = 100 } = {}) => {
  const figures = await fileFigures();
  const owing = [...figures.entries()].filter(([, f]) => f.ar > 0).map(([id]) => id);
  const files = await SaleFile.find({ _id: { $in: owing }, status: { $ne: 'Cancelled' } }).populate('party', 'phone').sort({ date: 1 });
  const today = dates.todayISO();
  const all = files.map((file) => presentFile(file, figures.get(String(file._id)), today));
  const sum = (kind) => all.filter((row) => row.partyType === kind).reduce((total, row) => total + row.due, 0);
  return {
    rows: all.slice((page - 1) * limit, page * limit),
    totals: { due: all.reduce((total, row) => total + row.due, 0), b2b: sum('B2B'), b2c: sum('B2C'), overdue: all.filter((row) => row.daysOverdue > 0).reduce((total, row) => total + row.due, 0), count: all.length },
    total: all.length
  };
};

// ------------------------------------------------------------------ profit and loss

const accountNames = async () => Object.fromEntries((await Account.find().select('code name group type').lean()).map((a) => [a.code, a]));

const profitAndLoss = async ({ from, to }) => {
  const names = await accountNames();
  const rows = await sums({ journal: dateRange({ from, to }), line: { 'lines.account': { $regex: '^[456]' } }, by: '$lines.account' });
  const unallocated = await sums({ journal: { ...dateRange({ from, to }), file: { $exists: false } }, line: { 'lines.account': { $regex: '^5' } }, by: null });

  let revenue = 0;
  let direct = 0;
  let opex = 0;
  const accounts = [];
  for (const { key, debit, credit } of rows) {
    const income = key[0] === '4';
    const amount = income ? credit - debit : debit - credit;
    if (income) revenue += amount;
    else if (key[0] === '5') direct += amount;
    else opex += amount;
    accounts.push({ code: key, name: (names[key] || {}).name || key, group: (names[key] || {}).group, amount: taka(amount) });
  }
  accounts.sort((a, b) => a.code.localeCompare(b.code));
  const gross = revenue - direct;
  const unallocatedCost = unallocated.length ? unallocated[0].debit - unallocated[0].credit : 0;

  return {
    from,
    to,
    revenue: taka(revenue),
    directCosts: taka(direct),
    unallocatedDirectCosts: taka(unallocatedCost),
    grossProfit: taka(gross),
    operatingExpenses: taka(opex),
    netProfit: taka(gross - opex),
    margin: revenue > 0 ? ((gross - opex) / revenue) * 100 : 0,
    accounts
  };
};

// Revenue, direct cost and expenses for each month between two months ("2026-05" to "2026-10").
const monthlyTotals = async (fromMonth, toMonth) => {
  const rows = await sums({
    journal: { date: { $gte: `${fromMonth}-01`, $lte: `${toMonth}-31` } },
    line: { 'lines.account': { $regex: '^[456]' } },
    by: { month: { $substr: ['$date', 0, 7] }, cls: { $substr: ['$lines.account', 0, 1] } }
  });
  const months = {};
  for (const { key, debit, credit } of rows) {
    const m = months[key.month] || (months[key.month] = { revenue: 0, direct: 0, opex: 0 });
    if (key.cls === '4') m.revenue += credit - debit;
    else if (key.cls === '5') m.direct += debit - credit;
    else m.opex += debit - credit;
  }
  return months;
};

const balanceOf = async (codes, asOf) => {
  const rows = await sums({ journal: asOf ? { date: { $lte: asOf } } : {}, line: { 'lines.account': { $in: codes } }, by: '$lines.account' });
  return Object.fromEntries(rows.map(({ key, debit, credit }) => [key, { debit, credit }]));
};

const cashPosition = async (asOf) => {
  const names = await accountNames();
  const balances = await balanceOf(CASH_ACCOUNTS, asOf);
  return CASH_ACCOUNTS.map((code) => ({ code, name: names[code].name, balance: taka(((balances[code] || {}).debit || 0) - ((balances[code] || {}).credit || 0)) }));
};

const netCapital = (balances, capital, drawings) => {
  const c = balances[capital] || { debit: 0, credit: 0 };
  const d = balances[drawings] || { debit: 0, credit: 0 };
  return c.credit - c.debit - (d.debit - d.credit);
};

// ------------------------------------------------------------------ receivables and payables

const bucketKey = (daysLate) => {
  if (daysLate > 90) return 'd90_plus';
  if (daysLate > 60) return 'd61_90';
  if (daysLate > 30) return 'd31_60';
  if (daysLate > 0) return 'd1_30';
  return 'current';
};
const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, 0]));
const agingRows = (buckets, total) => AGING_BUCKETS.map((bucket) => ({ ...bucket, amount: taka(buckets[bucket.key] || 0), share: total > 0 ? ((buckets[bucket.key] || 0) / total) * 100 : 0 }));

// Customers and agencies: what each file still owes, aged from its due date.
const receivablesAging = async () => {
  const dues = await listDues({ limit: 100000 });
  const buckets = emptyBuckets();
  dues.rows.forEach((row) => {
    buckets[bucketKey(row.daysOverdue)] += Math.round(row.due * 100);
  });
  const total = dues.totals.due * 100;
  return { aging: agingRows(buckets, total), totals: dues.totals, overdue: dues.totals.overdue };
};

// Suppliers: bills are the credits of the payable account, payments the debits. Payments settle the oldest bill first.
const supplierPayables = async (asOf = dates.todayISO()) => {
  const rows = await linesOf(AP_ACCOUNT, { asOf });
  const byParty = new Map();
  for (const row of rows) {
    if (!row.line.party) continue;
    const key = String(row.line.party);
    const entry = byParty.get(key) || { docs: [], paid: 0, lastPaymentDate: null };
    if (row.line.credit > 0) entry.docs.push({ date: row.date, no: row.no, dueDate: row.line.dueDate || dates.addDays(row.date, 15), amount: row.line.credit });
    if (row.line.debit > 0) {
      entry.paid += row.line.debit;
      if (!entry.lastPaymentDate || row.date > entry.lastPaymentDate) entry.lastPaymentDate = row.date;
    }
    byParty.set(key, entry);
  }

  const parties = await Party.find({ _id: { $in: [...byParty.keys()] } }).lean();
  const aging = emptyBuckets();
  const result = [];
  for (const party of parties) {
    const { docs, paid, lastPaymentDate } = byParty.get(String(party._id));
    let pool = paid;
    const open = docs
      .sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no))
      .map((doc) => {
        const applied = Math.min(pool, doc.amount);
        pool -= applied;
        return { ...doc, open: doc.amount - applied };
      });
    const buckets = emptyBuckets();
    let overdue = 0;
    let oldest = 0;
    for (const doc of open) {
      if (doc.open <= 0) continue;
      const late = dates.daysBetween(doc.dueDate, asOf);
      buckets[bucketKey(late)] += doc.open;
      if (late > 0) {
        overdue += doc.open;
        oldest = Math.max(oldest, late);
      }
    }
    const invoiced = docs.reduce((sum, doc) => sum + doc.amount, 0);
    const due = open.reduce((sum, doc) => sum + doc.open, 0);
    Object.keys(buckets).forEach((key) => {
      aging[key] += buckets[key];
    });
    let status = 'Unpaid';
    if (due === 0) status = 'Paid';
    else if (overdue > 0) status = 'Overdue';
    else if (paid > 0) status = 'Partial';

    result.push({
      partyId: String(party._id),
      code: party.code,
      name: party.name,
      phone: party.phone,
      type: party.type,
      creditLimit: taka(party.creditLimit),
      invoices: docs.length,
      invoiced: taka(invoiced),
      collected: taka(paid),
      due: taka(due),
      overdue: taka(overdue),
      oldestDays: oldest,
      buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, taka(value)])),
      status,
      lastPaymentDate,
      creditUsed: party.creditLimit > 0 ? (due / party.creditLimit) * 100 : 0
    });
  }
  result.sort((a, b) => b.due - a.due || b.overdue - a.overdue);

  const totals = {
    count: result.length,
    invoiced: result.reduce((sum, row) => sum + row.invoiced, 0),
    collected: result.reduce((sum, row) => sum + row.collected, 0),
    due: result.reduce((sum, row) => sum + row.due, 0),
    overdue: result.reduce((sum, row) => sum + row.overdue, 0),
    creditLimit: result.reduce((sum, row) => sum + row.creditLimit, 0)
  };
  const total = Object.values(aging).reduce((sum, value) => sum + value, 0);
  return { rows: result, totals, aging: agingRows(aging, total) };
};

// Money paid to suppliers before there is a bill. Bills use it up.
const supplierAdvances = async () => {
  const rows = await linesOf(ADVANCE_ACCOUNT);
  const balances = new Map();
  for (const row of rows) {
    const key = row.line.party ? String(row.line.party) : null;
    if (key) balances.set(key, (balances.get(key) || 0) + row.line.debit - row.line.credit);
  }
  const parties = await Party.find({ _id: { $in: [...balances.keys()] } }).lean();
  const list = parties
    .map((party) => ({ partyId: String(party._id), name: party.name, code: party.code, amount: taka(Math.max(0, balances.get(String(party._id)))) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return { rows: list, total: list.reduce((sum, row) => sum + row.amount, 0) };
};

// ------------------------------------------------------------------ category helpers

const categoryMeta = async (label) => {
  const found = await SaleCategory.findOne({ labelKey: String(label).toLowerCase() }).lean();
  return found || { ...CUSTOM_CATEGORY, label };
};

// One row per category: sale, cost and profit of the files made in the window.
const categoryBuckets = (rows, categories) => {
  const map = new Map(categories.map((category) => [category.label, { label: category.label, color: category.color, sale: 0, cost: 0, profit: 0, count: 0 }]));
  for (const row of rows) {
    const bucket = map.get(row.category) || map.set(row.category, { label: row.category, color: CUSTOM_CATEGORY.color, sale: 0, cost: 0, profit: 0, count: 0 }).get(row.category);
    bucket.sale += row.sale - row.discount;
    bucket.cost += row.cost;
    bucket.profit += row.profit;
    bucket.count += 1;
  }
  return [...map.values()];
};

// ------------------------------------------------------------------ the home screen and monthly reports

const home = async ({ year, month } = {}) => {
  const now = dates.currentMonth();
  const targetYear = year ?? now.year;
  const targetMonth = month ?? now.month;
  const window = dates.monthWindow(targetYear, targetMonth);
  const today = dates.todayISO();

  const [pl, files, allDues, aging, payables, advances, cash, capital] = await Promise.all([
    profitAndLoss(window),
    listFiles({ from: window.from, to: window.to }, { limit: 100000 }),
    listDues({ limit: 100000 }),
    receivablesAging(),
    supplierPayables(window.to),
    supplierAdvances(),
    cashPosition(window.to),
    balanceOf(['3010', '3020', '3030', '3040'])
  ]);

  const previous = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const previousWindow = dates.monthWindow(previous.getUTCFullYear(), previous.getUTCMonth());
  const previousPl = await profitAndLoss(previousWindow);

  const series = [];
  const first = new Date(Date.UTC(targetYear, targetMonth - 5, 1));
  const keyOf = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const months = await monthlyTotals(keyOf(first), `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`);
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(targetYear, targetMonth - i, 1));
    const m = months[keyOf(d)] || { revenue: 0, direct: 0, opex: 0 };
    series.push({ label: dates.MONTHS_SHORT[d.getUTCMonth()], revenue: taka(m.revenue), cost: taka(m.direct + m.opex), profit: taka(m.revenue - m.direct - m.opex) });
  }

  const dueByClient = new Map();
  for (const row of allDues.rows) {
    const entry = dueByClient.get(row.partyId) || { name: row.partyName, type: row.partyType, due: 0, invoices: 0 };
    entry.due += row.due;
    entry.invoices += 1;
    dueByClient.set(row.partyId, entry);
  }

  const categories = await SaleCategory.find().lean();
  const byCategory = categoryBuckets(files.rows, categories).filter((c) => c.count > 0).sort((a, b) => b.sale - a.sale);
  const sumByType = (kind) => files.rows.filter((row) => row.partyType === kind).reduce((sum, row) => sum + (row.sale - row.discount), 0);
  const cashOf = (codes) => cash.filter((row) => codes.includes(row.code)).reduce((sum, row) => sum + row.balance, 0);
  const net = (capitalCode, drawings) => taka(netCapital(capital, capitalCode, drawings));

  return {
    year: targetYear,
    month: targetMonth,
    monthName: `${dates.MONTHS[targetMonth]} ${targetYear}`,
    from: window.from,
    to: window.to,
    sale: pl.revenue,
    cost: pl.directCosts,
    unallocatedCost: pl.unallocatedDirectCosts,
    grossProfit: pl.grossProfit,
    officeExpenses: pl.operatingExpenses,
    profit: pl.netProfit,
    margin: pl.margin,
    previous: { sale: previousPl.revenue, cost: previousPl.directCosts, profit: previousPl.netProfit },
    b2b: sumByType('B2B'),
    b2c: sumByType('B2C'),
    categories: byCategory,
    totalDue: allDues.totals.due,
    overdue: allDues.totals.overdue,
    topClients: [...dueByClient.values()].sort((a, b) => b.due - a.due).slice(0, 10),
    series,
    aging: aging.aging,
    vendorDue: payables.totals.due,
    vendorOverdue: payables.totals.overdue,
    vendorAdvances: advances.total,
    partnerCapital: Math.max(0, net('3010', '3030')) + Math.max(0, net('3020', '3040')),
    money: { cash: cashOf(['1010']), bank: cashOf(['1020', '1030']), bkash: cashOf(['1040']) },
    counts: { sales: files.total, dueClients: dueByClient.size },
    asOf: today
  };
};

const monthly = async (year, monthIndex) => {
  const window = dates.monthWindow(year, monthIndex);
  const [pl, files, perDay, expenseJournals, years] = await Promise.all([
    profitAndLoss(window),
    listFiles({ from: window.from, to: window.to }, { limit: 100000 }),
    sums({ journal: dateRange(window), line: { 'lines.account': { $regex: '^[45]' } }, by: { date: '$date', cls: { $substr: ['$lines.account', 0, 1] } } }),
    Journal.find({ status: 'posted', ...dateRange(window), 'lines.account': { $regex: '^6' } }).sort({ date: -1 }).lean(),
    SaleFile.aggregate([{ $group: { _id: { $substr: ['$date', 0, 4] } } }])
  ]);

  const dayMap = {};
  perDay.forEach(({ key, debit, credit }) => {
    const d = dayMap[key.date] || (dayMap[key.date] = { sale: 0, cost: 0 });
    if (key.cls === '4') d.sale += credit - debit;
    else d.cost += debit - credit;
  });
  const lastDay = Number(window.to.slice(8, 10));
  const filesPerDay = {};
  files.rows.forEach((row) => {
    filesPerDay[row.date] = (filesPerDay[row.date] || 0) + 1;
  });
  const days = Array.from({ length: lastDay }, (_, i) => {
    const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    const d = dayMap[date] || { sale: 0, cost: 0 };
    return { date, day: i + 1, sale: taka(d.sale), cost: taka(d.cost), profit: taka(d.sale - d.cost), count: filesPerDay[date] || 0 };
  });

  const expenses = expenseJournals.map((journal) => {
    const lines = journal.lines.filter((line) => line.account.startsWith('6') && line.debit > 0);
    return {
      _id: journal._id,
      no: journal.no,
      date: journal.date,
      amount: taka(lines.reduce((sum, line) => sum + line.debit, 0)),
      note: lines.map((line) => line.memo).filter(Boolean).join(', ') || journal.narration,
      account: lines[0] ? lines[0].account : ''
    };
  }).filter((row) => row.amount > 0);

  const categories = await SaleCategory.find().lean();
  return {
    year,
    month: monthIndex,
    monthName: `${dates.MONTHS[monthIndex]} ${year}`,
    from: window.from,
    to: window.to,
    sale: pl.revenue,
    cost: pl.directCosts,
    unallocatedCost: pl.unallocatedDirectCosts,
    officeExpenses: pl.operatingExpenses,
    profit: pl.netProfit,
    categories: categoryBuckets(files.rows, categories).filter((c) => c.count > 0),
    days,
    expenses,
    availableYears: years.map((row) => Number(row._id)).sort((a, b) => b - a),
    counts: { sales: files.total, expenses: expenses.length }
  };
};

const yearly = async (year) => {
  const months = await monthlyTotals(`${year}-01`, `${year}-12`);
  const counts = await SaleFile.aggregate([{ $match: { date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` }, status: { $ne: 'Cancelled' } } }, { $group: { _id: { $substr: ['$date', 5, 2] }, count: { $sum: 1 } } }]);
  const countOf = Object.fromEntries(counts.map((row) => [Number(row._id) - 1, row.count]));
  return {
    year,
    rows: Array.from({ length: 12 }, (_, month) => {
      const m = months[`${year}-${String(month + 1).padStart(2, '0')}`] || { revenue: 0, direct: 0, opex: 0 };
      return { month, monthName: dates.MONTHS_SHORT[month], sale: taka(m.revenue), cost: taka(m.direct), officeExpenses: taka(m.opex), profit: taka(m.revenue - m.direct - m.opex), count: countOf[month] || 0 };
    })
  };
};

const categoryReport = async ({ from, to } = {}) => {
  const [files, categories] = await Promise.all([listFiles({ from, to }, { limit: 100000 }), SaleCategory.find().lean()]);
  const buckets = categoryBuckets(files.rows, categories);
  return buckets.map((bucket) => {
    const builtin = categories.find((category) => category.label === bucket.label);
    return { ...bucket, isUsed: bucket.count > 0, removable: !(builtin && builtin.builtin) && bucket.count === 0 };
  });
};

const accountBalances = async () => {
  const rows = await cashPosition(dates.todayISO());
  const find = (code) => rows.find((row) => row.code === code).balance;
  return [
    { key: 'cash', label: 'Cash', amount: find('1010') },
    { key: 'bank', label: 'Bank', amount: find('1020') + find('1030') },
    { key: 'bkash', label: 'bKash', amount: find('1040') }
  ];
};

// The partners' capital and drawings, and the latest movements.
const partners = async () => {
  const [balances, month, lines] = await Promise.all([balanceOf(['3010', '3020', '3030', '3040']), (async () => profitAndLoss(dates.monthWindow(dates.currentMonth().year, dates.currentMonth().month)))(), Promise.all(['3010', '3020', '3030', '3040'].map((code) => linesOf(code)))]);
  const sums2 = (capital, drawings) => {
    const c = balances[capital] || { debit: 0, credit: 0 };
    const d = balances[drawings] || { debit: 0, credit: 0 };
    return { invested: c.credit, withdrawn: Math.max(0, d.debit - d.credit) };
  };
  const netA = netCapital(balances, '3010', '3030');
  const netB = netCapital(balances, '3020', '3040');
  const total = Math.max(0, netA) + Math.max(0, netB);
  const transactions = lines
    .flat()
    .map((row) => ({
      _id: row._id,
      date: row.date,
      partner: ['3010', '3030'].includes(row.line.account) ? 'A' : 'B',
      type: ['3010', '3020'].includes(row.line.account) ? 'in' : 'out',
      amount: taka(row.line.debit || row.line.credit),
      note: row.line.memo || row.narration
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);
  const partnerRow = (id, net, capital, drawings) => ({ id, name: `Partner ${id}`, net: taka(net), invested: taka(sums2(capital, drawings).invested), withdrawn: taka(sums2(capital, drawings).withdrawn), share: total > 0 ? (Math.max(0, net) / total) * 100 : 50 });
  return {
    partners: [partnerRow('A', netA, '3010', '3030'), partnerRow('B', netB, '3020', '3040')],
    monthProfit: month.netProfit,
    monthName: `${dates.MONTHS[dates.currentMonth().month]} ${dates.currentMonth().year}`,
    transactions
  };
};

const defaultCategoryLabels = DEFAULT_CATEGORIES.map((category) => category.label);

module.exports = {
  fileFigures,
  presentFile,
  listFiles,
  listDues,
  profitAndLoss,
  monthlyTotals,
  cashPosition,
  receivablesAging,
  supplierPayables,
  supplierAdvances,
  categoryMeta,
  home,
  monthly,
  yearly,
  categoryReport,
  accountBalances,
  partners,
  defaultCategoryLabels
};
