const Account = require('../../models/Account');
const Journal = require('../../models/Journal');
const { VOUCHER_TYPES } = require('../../config/accounting');
const ApiError = require('../../utils/ApiError');
const counterService = require('../counterService');
const { ensureChartIfEmpty } = require('./chart');
const dates = require('./dates');

// The one place where journals are made and voided. Everything else (sales, receipts, vendor bills, the visa link) builds
// its lines and calls post(). The rules are enforced here, so no screen can bypass them:
//  - at least two lines, whole paisa, each line a debit or a credit and not both
//  - debits equal credits, and the total is above zero
//  - every account code exists, and a line on a control account (receivables, payables) names its party
//  - a posted journal is never edited, only voided with a reason and replaced
//  - a journal with a `source` is posted once: asking again returns the first one

const invalid = (message, code, field) =>
  new ApiError(422, message, { code, errors: [{ field: field || 'body.lines', message }] });

const prepareLines = async (lines) => {
  await ensureChartIfEmpty();
  const accounts = await Account.find().select('code control active').lean();
  const known = Object.fromEntries(accounts.map((account) => [account.code, account]));

  const prepared = (lines || [])
    .filter((line) => line && line.account)
    .map((line) => ({
      account: String(line.account),
      debit: Math.round(Number(line.debit) || 0),
      credit: Math.round(Number(line.credit) || 0),
      party: line.party || undefined,
      memo: line.memo || '',
      dueDate: line.dueDate || undefined,
      kind: line.kind || null
    }))
    .filter((line) => line.debit > 0 || line.credit > 0);

  if (prepared.length < 2) throw invalid('A voucher needs at least two lines with amounts.', 'TOO_FEW_LINES');

  for (const line of prepared) {
    const account = known[line.account];
    if (!account) throw invalid(`Unknown account code: ${line.account}.`, 'UNKNOWN_ACCOUNT');
    if (line.debit < 0 || line.credit < 0) throw invalid('Amounts cannot be negative.', 'INVALID_AMOUNT');
    if (line.debit > 0 && line.credit > 0) throw invalid('A line cannot carry both a debit and a credit.', 'DEBIT_AND_CREDIT');
    if (account.control && !line.party) throw invalid(`A line on account ${line.account} needs a customer or supplier.`, 'PARTY_REQUIRED');
  }

  const debit = prepared.reduce((sum, line) => sum + line.debit, 0);
  const credit = prepared.reduce((sum, line) => sum + line.credit, 0);
  if (debit !== credit) throw invalid(`The voucher is out of balance by ${(Math.abs(debit - credit) / 100).toFixed(2)}.`, 'UNBALANCED');
  if (debit === 0) throw invalid('The voucher total must be above zero.', 'ZERO_TOTAL');
  return prepared;
};

const post = async ({ date, type = 'JV', narration, segment, party, file, ref, manualNo, lines, source, actor }) => {
  if (!dates.isDay(date)) throw invalid('A valid voucher date is required.', 'INVALID_DATE', 'body.date');
  if (!VOUCHER_TYPES.includes(type)) throw invalid(`Unknown voucher type ${type}.`, 'INVALID_TYPE', 'body.type');

  if (source) {
    const existing = await Journal.findOne({ 'source.kind': source.kind, 'source.id': source.id, 'source.role': source.role });
    if (existing) return existing;
  }

  const prepared = await prepareLines(lines);
  const journal = {
    no: await counterService.nextNumber(type, { year: date.slice(0, 4), width: 4 }),
    date,
    type,
    narration: String(narration || '').trim() || 'Journal voucher',
    segment: segment || undefined,
    party: party || undefined,
    file: file || undefined,
    ref: ref || '',
    manualNo: manualNo || undefined,
    lines: prepared,
    source: source || undefined,
    createdBy: actor && actor.id ? actor.id : undefined,
    createdByName: actor ? actor.name : 'System'
  };

  try {
    return await Journal.create(journal);
  } catch (err) {
    // Two requests for the same source arrived together: the other one won, so return its journal.
    if (err.code === 11000 && source) {
      const existing = await Journal.findOne({ 'source.kind': source.kind, 'source.id': source.id, 'source.role': source.role });
      if (existing) return existing;
    }
    throw err;
  }
};

const voidJournal = async (journalOrId, { reason, actor } = {}) => {
  // An ObjectId has an _id of its own, so a document is recognised by its save() instead.
  const journal = journalOrId && typeof journalOrId.save === 'function' ? journalOrId : await Journal.findById(journalOrId);
  if (!journal) throw new ApiError(404, 'Voucher not found.', { code: 'JOURNAL_NOT_FOUND' });
  if (journal.status === 'void') return journal;
  journal.status = 'void';
  journal.voidedAt = new Date();
  journal.voidedBy = actor && actor.id ? actor.id : undefined;
  journal.voidReason = reason || '';
  await journal.save();
  return journal;
};

// ------------------------------------------------------------------ reading the books

// Adds up debits and credits of posted journals, grouped by whatever `by` names.
//   journal: extra conditions on the voucher (date range, file, party)
//   line:    extra conditions on a line (account)
//   by:      the group key as an aggregation expression, for example '$lines.account'
const sums = async ({ journal = {}, line = {}, by = null } = {}) => {
  const rows = await Journal.aggregate([
    { $match: { status: 'posted', ...journal } },
    { $unwind: '$lines' },
    ...(Object.keys(line).length ? [{ $match: line }] : []),
    { $group: { _id: by, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } }
  ]);
  return rows.map((row) => ({ key: row._id, debit: row.debit, credit: row.credit }));
};

// The lines of one account, with their voucher, for sub-ledgers and ageing.
const linesOf = async (account, { asOf, journal = {} } = {}) => {
  const match = { status: 'posted', ...(asOf ? { date: { $lte: asOf } } : {}), ...journal };
  return Journal.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    { $match: { 'lines.account': account } },
    { $project: { _id: 1, no: 1, date: 1, type: 1, file: 1, ref: 1, narration: 1, line: '$lines' } },
    { $sort: { date: 1, no: 1 } }
  ]);
};

const dateRange = ({ from, to, asOf } = {}) => {
  const range = {};
  if (from) range.$gte = from;
  if (to || asOf) range.$lte = to || asOf;
  return Object.keys(range).length ? { date: range } : {};
};

module.exports = { post, voidJournal, sums, linesOf, dateRange };
