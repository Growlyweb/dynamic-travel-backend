// Accounting seed. The chart of accounts and the five built-in sale categories are always created (the system needs them).
// Sample vendors, bills, payments, sales, receipts, expenses and the books of the sample visa applications are demo data and
// are created only outside production, and only while there are no journals yet.
//
// Run `npm run seed` (first admin) and `npm run seed:visa` first. The seed posts through the same services as the API.
const Account = require('../../models/Account');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const SaleCategory = require('../../models/SaleCategory');
const SaleFile = require('../../models/SaleFile');
const VendorBill = require('../../models/VendorBill');
const VendorPayment = require('../../models/VendorPayment');
const VisaApplication = require('../../models/VisaApplication');
const Counter = require('../../models/Counter');
const User = require('../../models/User');
const { ROLES, USER_STATUS } = require('../../config/constants');
const { ensureChart } = require('../../services/accounting/chart');
const books = require('../../services/accounting/books');
const dates = require('../../services/accounting/dates');
const visaLink = require('../../services/accounting/visaLink');
const vendors = require('../../services/vendorService');
const events = require('../../utils/events');

const daysAgo = (n) => dates.addDays(dates.todayISO(), -n);

const VENDORS = [
  { name: 'Skyline Visa Services', phone: '+8801711482905', contactPerson: 'Mr. Alam', creditLimit: 500000, openingBalance: 20000, openingBalanceType: 'due' },
  { name: 'Grand Hotels Supplier', phone: '+8801913670248', contactPerson: 'Ms. Rima', creditLimit: 300000 },
  { name: 'Air Connect Agency', phone: '+8801819356074', contactPerson: 'Mr. Tarek', creditLimit: 800000 }
];

// [vendor index, days ago, amount, account, service, invoice]
const BILLS = [
  [0, 20, 45000, '5010', 'Embassy fees', 'INV-1001'],
  [1, 12, 80000, '5050', 'Hotel block booking', 'INV-2040'],
  [2, 6, 120000, '5040', 'Group air tickets', 'INV-3300']
];

// [category, B2B or B2C, client, phone, sale, cost, received, discount, days ago]
const SALES = [
  ['Visa', 'B2C', 'Mizanur Rahman', '+8801712945360', 12000, 8500, 12000, 0, 25],
  ['Visa', 'B2B', 'Sunrise Tours', '+8801819027653', 36000, 28000, 20000, 0, 18],
  ['Tour Package', 'B2C', 'Farzana Akter', '+8801534861290', 60000, 45000, 30000, 0, 14],
  ['Air Ticket', 'B2B', 'Nimbus Travels', '+8801973410856', 94000, 86000, 50000, 0, 9],
  ['Hotel', 'B2C', 'Imran Hossain', '+8801684729513', 25000, 18000, 24000, 1000, 5],
  ['Transport', 'B2C', 'Shirin Sultana', '+8801765038294', 5000, 3000, 0, 0, 2]
];

const EXPENSES = [
  [18, '6020', 35000, 'city', 'Office rent'],
  [10, '6030', 6200, 'cash', 'Internet and electricity'],
  [3, '6040', 12000, 'bkash', 'Facebook ads']
];

const adminActor = async () => {
  const admin = await User.findOne({ role: ROLES.ADMIN, status: USER_STATUS.ACTIVE });
  return admin ? { id: String(admin._id), name: admin.name, role: ROLES.ADMIN, permissions: [] } : null;
};

const seedDemo = async (actor) => {
  const result = { vendors: 0, bills: 0, payments: 0, sales: 0, expenses: 0 };

  const made = [];
  for (const vendor of VENDORS) {
    made.push(await vendors.createVendor(actor, vendor));
    result.vendors += 1;
  }
  for (const [index, days, amount, account, service, invoiceRef] of BILLS) {
    const date = daysAgo(days);
    await vendors.createBill(actor, { vendorId: String(made[index]._id), date, dueDate: dates.addDays(date, 15), amount, account, service, invoiceRef });
    result.bills += 1;
  }
  await vendors.createPayment(actor, { vendorId: String(made[0]._id), amount: 20000, method: 'city', date: daysAgo(10), note: 'Part payment' });
  await vendors.createPayment(actor, { vendorId: String(made[2]._id), amount: 15000, method: 'city', date: daysAgo(4), isAdvance: true, note: 'Advance for next group' });
  result.payments = 2;

  for (const [category, clientType, clientName, phone, sale, cost, received, discount, days] of SALES) {
    await books.createSale(actor, { category, clientType, clientName, agencyName: clientType === 'B2B' ? clientName : undefined, phone, sale, cost, received, discount, method: 'cash', date: daysAgo(days) });
    result.sales += 1;
  }
  for (const [days, account, amount, method, note] of EXPENSES) {
    await books.addExpense(actor, { amount, date: daysAgo(days), account, method, note });
    result.expenses += 1;
  }
  await books.addPartnerTransaction(actor, { partner: 'A', direction: 'in', amount: 500000, date: daysAgo(28), method: 'city', note: 'Starting capital' });
  await books.addPartnerTransaction(actor, { partner: 'B', direction: 'in', amount: 500000, date: daysAgo(28), method: 'city', note: 'Starting capital' });
  return result;
};

// The books of the visa applications that already exist (the visa module raises events, but a command line seed has no
// listeners).
const syncVisa = async () => {
  let count = 0;
  for (const application of await VisaApplication.find().sort({ createdAt: 1 })) {
    await visaLink.syncApplication(application._id);
    for (const payment of application.payments) await visaLink.syncPayment(application._id, payment._id);
    count += 1;
  }
  return count;
};

module.exports = {
  name: 'accounting',

  async seed({ demo = false } = {}) {
    await ensureChart();
    const result = { accounts: await Account.countDocuments(), categories: await SaleCategory.countDocuments() };
    if (!demo) return result;

    await events.idle();
    result.visaFiles = await syncVisa();
    if (await Journal.exists({ 'source.kind': { $in: ['vendor-bill', 'vendor-payment'] } })) return { ...result, note: 'demo books already exist' };
    const actor = await adminActor();
    if (!actor) return { ...result, note: 'no admin account found: run `npm run seed` first' };
    return { ...result, ...(await seedDemo(actor)) };
  },

  async clear() {
    await events.idle();
    const [journals, files, parties, bills, payments, counters] = await Promise.all([
      Journal.deleteMany({}),
      SaleFile.deleteMany({}),
      Party.deleteMany({}),
      VendorBill.deleteMany({}),
      VendorPayment.deleteMany({}),
      Counter.deleteMany({ _id: /^(SV|RV|PV|JV|OB|CV|VF|TF|AF|HF|XF|OF|VB|VP|party):/ })
    ]);
    return { journals: journals.deletedCount, files: files.deletedCount, parties: parties.deletedCount, bills: bills.deletedCount, payments: payments.deletedCount, counters: counters.deletedCount };
  }
};
