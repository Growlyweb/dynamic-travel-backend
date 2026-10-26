const crypto = require('crypto');
const SaleFile = require('../../models/SaleFile');
const VisaApplication = require('../../models/VisaApplication');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const { VISA_METHOD_TO_METHOD } = require('../../config/accounting');
const events = require('../../utils/events');
const counterService = require('../counterService');
const books = require('./books');
const dates = require('./dates');
const ledger = require('./ledger');
const { toMinor } = require('./money');

// The link between a visa application and the books. The visa module only raises events ("an application was created",
// "a payment was recorded"); this file listens and posts the matching journals. Nobody types the same money twice.
//
//   application created or changed -> one sale file with the sale, the discount and one cost line per vendor line
//   payment recorded               -> a money receipt on that file
//   payment voided                 -> that receipt is voided
//
// Amounts are turned into taka at the exchange rate saved on the application. Posting is safe to repeat: the journals are
// tied to the application, so a retried event changes nothing. A cancelled or rejected application is NOT cancelled in the
// books on its own: what happens to money already received is a decision for a person (see cancelSale).

const SYSTEM = { id: null, name: 'System (visa)' };
const SOURCE = 'visa-application';
const base = (amount, rate) => Math.round(toMinor(amount) * rate);

const dayOf = dates.dayOf;

const clientOf = async (application) => {
  const b2b = application.channel === 'b2b';
  return books.ensureParty({
    type: b2b ? 'B2B' : 'B2C',
    name: b2b ? application.partnerName || application.applicant.fullName : application.applicant.fullName,
    phone: application.applicant.mobile,
    partner: b2b ? application.partner : undefined
  });
};

// One cost line per vendor line. A vendor typed by name becomes a supplier of that name; a line with no vendor goes to
// "Unassigned supplier", so every payable still has a name.
const vendorFor = async (line) => {
  if (line.vendorId && /^[0-9a-fA-F]{24}$/.test(line.vendorId)) {
    const found = await Party.findOne({ _id: line.vendorId, type: 'Vendor' });
    if (found) return found;
  }
  if (line.name && line.name.trim()) return books.ensureParty({ type: 'Vendor', name: line.name });
  return books.unassignedSupplier();
};

const desired = async (application) => {
  const rate = application.price.rateToBase;
  const costs = [];
  for (const line of application.vendorLines) {
    const amount = base(line.price, rate);
    if (amount <= 0) continue;
    const vendor = await vendorFor(line);
    costs.push({ account: '5010', label: 'Cost price', amount, date: dayOf(application.createdAt), vendor: vendor._id });
  }
  return { sale: base(application.account.totalAmount, rate), discount: base(application.account.discountAmount, rate), costs };
};

// A short fingerprint of what the books should hold. When it is the same, there is nothing to post.
const signature = (want) =>
  crypto.createHash('sha1').update(JSON.stringify([want.sale, want.discount, want.costs.map((c) => [c.amount, String(c.vendor)])])).digest('hex');

const findFile = (applicationId) => SaleFile.findOne({ 'source.kind': SOURCE, 'source.id': String(applicationId) });

// Makes sure the application has its sale file, and that the file matches the application as it is now.
const syncApplication = async (applicationId) => {
  const application = await VisaApplication.findById(applicationId);
  if (!application) return null;
  const want = await desired(application);
  if (want.sale <= 0) return null;
  const sig = signature(want);
  const date = dayOf(application.createdAt);

  let file = await findFile(applicationId);
  if (!file) {
    const party = await clientOf(application);
    try {
      file = await SaleFile.create({
        fileNo: await counterService.nextNumber('VF', { year: date.slice(0, 4), width: 4 }),
        type: 'Visa',
        segment: 'visa',
        category: 'Visa',
        date,
        dueDate: dates.addDays(date, 7),
        applicant: application.applicant.fullName,
        party: party._id,
        partyName: party.name,
        partyType: party.type,
        destination: application.countryName,
        detail: application.visaTypeName,
        passportNo: application.passport.number,
        sale: want.sale,
        discount: want.discount,
        costs: want.costs,
        notes: `Visa application ${application.number}`,
        source: { kind: SOURCE, id: String(application._id) },
        sig,
        createdByName: SYSTEM.name
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      return findFile(applicationId);
    }
    const category = await books.categoryOf('Visa');
    await books.postSaleJournals(file, category, SYSTEM);
    return file;
  }

  if (file.status === 'Cancelled' || file.sig === sig) return file;

  // The application changed: replace the sale, discount and cost vouchers, keep the receipts.
  const category = await books.categoryOf('Visa');
  const old = await Journal.find({ file: file._id, status: 'posted', 'source.kind': 'sale-file', 'source.role': { $regex: `^(sale|discount|cost)#${file.revision}(:[0-9]+)?$` } });
  for (const journal of old) await ledger.voidJournal(journal, { reason: 'The visa application was changed.' });
  const party = await clientOf(application);
  Object.assign(file, { sale: want.sale, discount: want.discount, costs: want.costs, party: party._id, partyName: party.name, partyType: party.type, applicant: application.applicant.fullName, sig, revision: file.revision + 1 });
  await file.save();
  await books.postSaleJournals(file, category, SYSTEM);
  return file;
};

// Posts, or voids, the receipt of one payment of the application.
const syncPayment = async (applicationId, paymentId) => {
  const file = await syncApplication(applicationId);
  if (!file || file.status === 'Cancelled') return;
  const application = await VisaApplication.findById(applicationId);
  const payment = application && application.payments.id(paymentId);
  if (!payment) return;

  const role = `payment:${paymentId}`;
  const existing = await Journal.findOne({ 'source.kind': SOURCE, 'source.id': String(applicationId), 'source.role': role });
  if (payment.voided) {
    if (existing && existing.status === 'posted') await ledger.voidJournal(existing, { reason: `Visa payment voided: ${payment.voidReason}` });
    return;
  }
  if (existing) return;
  await books.postReceiptJournal(
    file,
    {
      amount: base(payment.amount, application.price.rateToBase),
      discount: 0,
      method: VISA_METHOD_TO_METHOD[payment.method] || 'cash',
      date: dayOf(payment.date),
      note: `Visa payment ${application.number}${payment.note ? ` - ${payment.note}` : ''}`,
      source: { kind: SOURCE, id: String(applicationId), role }
    },
    SYSTEM
  );
};

// Events of one application run one after the other. A payment that is posted while the sale is still being posted would be
// refused as "more than the due", and the receipt would be lost.
const queues = new Map();
const inOrder = (applicationId, task) => {
  const key = String(applicationId);
  const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, run);
  const clear = () => queues.get(key) === run && queues.delete(key);
  run.then(clear, clear);
  return run;
};

const register = () => {
  events.on(events.EVENTS.VISA_APPLICATION_CREATED, ({ applicationId }) => inOrder(applicationId, () => syncApplication(applicationId)));
  events.on(events.EVENTS.VISA_APPLICATION_UPDATED, ({ applicationId }) => inOrder(applicationId, () => syncApplication(applicationId)));
  events.on(events.EVENTS.VISA_PAYMENT_RECORDED, ({ applicationId, paymentId }) => inOrder(applicationId, () => syncPayment(applicationId, paymentId)));
  events.on(events.EVENTS.VISA_PAYMENT_VOIDED, ({ applicationId, paymentId }) => inOrder(applicationId, () => syncPayment(applicationId, paymentId)));
};

module.exports = { register, syncApplication, syncPayment };
