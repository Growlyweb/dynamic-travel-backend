// The chart of accounts and the fixed lists of the accounting module. These are the same codes the dashboard's accounting
// screens already use, so numbers on screen keep their meaning.
//
// Amounts are stored in the smallest unit (paisa) and shown in taka. See services/accounting/money.js.

const ACCOUNT_TYPES = Object.freeze(['Asset', 'Liability', 'Equity', 'Income', 'Expense']);
const DEBIT_TYPES = Object.freeze(['Asset', 'Expense']);

const GROUP_ORDER = Object.freeze([
  'Current Assets',
  'Non-current Assets',
  'Current Liabilities',
  'Non-current Liabilities',
  'Capital & Partners',
  'Operating Revenue',
  'Direct Costs',
  'Operating Expenses'
]);

// `control` marks the two control accounts that carry a customer or supplier sub-ledger. A line on a control account
// must name its party, so the control totals and the party balances can never disagree.
const ACCOUNTS = Object.freeze([
  { code: '1010', name: 'Cash in Hand', type: 'Asset', group: 'Current Assets', cash: true },
  { code: '1020', name: 'City Bank - Current Account', type: 'Asset', group: 'Current Assets', bank: true },
  { code: '1030', name: 'BRAC Bank - Current Account', type: 'Asset', group: 'Current Assets', bank: true },
  { code: '1040', name: 'bKash - Mobile Wallet', type: 'Asset', group: 'Current Assets', cash: true },
  { code: '1100', name: 'Accounts Receivable - Customers & Agents', type: 'Asset', group: 'Current Assets', control: 'AR' },
  { code: '1200', name: 'Advances to Suppliers', type: 'Asset', group: 'Current Assets' },
  { code: '1300', name: 'Prepaid Office Rent', type: 'Asset', group: 'Current Assets' },
  { code: '1500', name: 'Office Equipment', type: 'Asset', group: 'Non-current Assets' },
  { code: '1510', name: 'Furniture & Fixtures', type: 'Asset', group: 'Non-current Assets' },
  { code: '1590', name: 'Less: Accumulated Depreciation', type: 'Asset', group: 'Non-current Assets', contra: true },

  { code: '2010', name: 'Accounts Payable - Suppliers', type: 'Liability', group: 'Current Liabilities', control: 'AP' },
  { code: '2020', name: 'Customer Advances', type: 'Liability', group: 'Current Liabilities' },
  { code: '2030', name: 'Salary & Allowance Payable', type: 'Liability', group: 'Current Liabilities' },
  { code: '2040', name: 'Agent Commission Payable', type: 'Liability', group: 'Current Liabilities' },

  { code: '3010', name: 'Partner A - Capital', type: 'Equity', group: 'Capital & Partners' },
  { code: '3020', name: 'Partner B - Capital', type: 'Equity', group: 'Capital & Partners' },
  { code: '3030', name: 'Partner A - Drawings', type: 'Equity', group: 'Capital & Partners', contra: true },
  { code: '3040', name: 'Partner B - Drawings', type: 'Equity', group: 'Capital & Partners', contra: true },
  { code: '3050', name: 'Retained Earnings - Brought Forward', type: 'Equity', group: 'Capital & Partners' },

  { code: '4010', name: 'Visa Processing Revenue', type: 'Income', group: 'Operating Revenue', segment: 'visa' },
  { code: '4020', name: 'Tour Package Revenue', type: 'Income', group: 'Operating Revenue', segment: 'tour' },
  { code: '4030', name: 'Air Ticketing Revenue', type: 'Income', group: 'Operating Revenue', segment: 'air' },
  { code: '4040', name: 'Hotel Booking Revenue', type: 'Income', group: 'Operating Revenue', segment: 'hotel' },
  { code: '4050', name: 'Transport & Transfer Revenue', type: 'Income', group: 'Operating Revenue', segment: 'transport' },
  { code: '4060', name: 'Other Service Revenue', type: 'Income', group: 'Operating Revenue', segment: 'other' },
  { code: '4090', name: 'Discounts & Adjustments', type: 'Income', group: 'Operating Revenue', contra: true },

  { code: '5010', name: 'Embassy & Consular Fees', type: 'Expense', group: 'Direct Costs', segment: 'visa' },
  { code: '5020', name: 'Visa Processing & Courier', type: 'Expense', group: 'Direct Costs', segment: 'visa' },
  { code: '5030', name: 'Land Package / DMC Cost', type: 'Expense', group: 'Direct Costs', segment: 'tour' },
  { code: '5040', name: 'Airline Fare Cost', type: 'Expense', group: 'Direct Costs', segment: 'air' },
  { code: '5050', name: 'Hotel Supplier Cost', type: 'Expense', group: 'Direct Costs', segment: 'hotel' },
  { code: '5060', name: 'Transport Supplier Cost', type: 'Expense', group: 'Direct Costs', segment: 'transport' },
  { code: '5070', name: 'Agent Commission', type: 'Expense', group: 'Direct Costs' },
  { code: '5080', name: 'Tour Operations & Guide Cost', type: 'Expense', group: 'Direct Costs', segment: 'tour' },
  { code: '5090', name: 'Other Service Cost', type: 'Expense', group: 'Direct Costs', segment: 'other' },

  { code: '6010', name: 'Salaries & Allowances', type: 'Expense', group: 'Operating Expenses' },
  { code: '6020', name: 'Office Rent', type: 'Expense', group: 'Operating Expenses' },
  { code: '6030', name: 'Utilities & Internet', type: 'Expense', group: 'Operating Expenses' },
  { code: '6040', name: 'Marketing & Promotion', type: 'Expense', group: 'Operating Expenses' },
  { code: '6050', name: 'Travel & Conveyance', type: 'Expense', group: 'Operating Expenses' },
  { code: '6060', name: 'Professional & Legal Fees', type: 'Expense', group: 'Operating Expenses' },
  { code: '6070', name: 'Bank Charges & Fees', type: 'Expense', group: 'Operating Expenses' },
  { code: '6080', name: 'Printing & Office Supplies', type: 'Expense', group: 'Operating Expenses' },
  { code: '6090', name: 'Depreciation', type: 'Expense', group: 'Operating Expenses' },
  { code: '6100', name: 'Miscellaneous Expenses', type: 'Expense', group: 'Operating Expenses' }
]);

const AR_ACCOUNT = '1100';
const AP_ACCOUNT = '2010';
const ADVANCE_ACCOUNT = '1200';
const DISCOUNT_ACCOUNT = '4090';
const OPENING_EQUITY_ACCOUNT = '3050';
const OTHER_REVENUE_ACCOUNT = '4060';

// How money is paid or received. `value` is what the dashboard sends.
const PAYMENT_METHODS = Object.freeze([
  { value: 'city', label: 'Bank', account: '1020' },
  { value: 'brac', label: 'Bank (BRAC)', account: '1030' },
  { value: 'cash', label: 'Cash', account: '1010' },
  { value: 'bkash', label: 'bKash', account: '1040' }
]);
const CASH_ACCOUNTS = Object.freeze(['1010', '1020', '1030', '1040']);

// The visa module names its payment methods in words. This maps them onto the books.
const VISA_METHOD_TO_METHOD = Object.freeze({
  'Bank Transfer': 'city',
  Cash: 'cash',
  'Credit / Debit Card': 'city',
  'bKash / Nagad': 'bkash'
});

// What kind of voucher a journal is. It also sets the prefix of its number.
const VOUCHER_TYPES = Object.freeze(['OB', 'SV', 'RV', 'PV', 'JV', 'CV']);

// The business lines. A sale file belongs to one of them.
const SEGMENTS = Object.freeze([
  { id: 'visa', name: 'Visa Processing', revenue: '4010', cost: ['5010', '5020'] },
  { id: 'tour', name: 'Tour Packages', revenue: '4020', cost: ['5030', '5080'] },
  { id: 'air', name: 'Air Ticketing', revenue: '4030', cost: ['5040'] },
  { id: 'hotel', name: 'Hotel Booking', revenue: '4040', cost: ['5050'] },
  { id: 'transport', name: 'Transport & Transfer', revenue: '4050', cost: ['5060'] },
  { id: 'other', name: 'Other Services', revenue: '4060', cost: ['5090'] }
]);

// The categories of the simple Sales screen, and how each one books. Custom categories book as "Other".
const DEFAULT_CATEGORIES = Object.freeze([
  { label: 'Visa', type: 'Visa', segment: 'visa', revenue: '4010', costAccount: '5010', prefix: 'VF', color: '#0879E8', dueDays: 7 },
  { label: 'Tour Package', type: 'Tour', segment: 'tour', revenue: '4020', costAccount: '5030', prefix: 'TF', color: '#16A34A', dueDays: 15 },
  { label: 'Air Ticket', type: 'Air Ticket', segment: 'air', revenue: '4030', costAccount: '5040', prefix: 'AF', color: '#7C3AED', dueDays: 3 },
  { label: 'Hotel', type: 'Hotel', segment: 'hotel', revenue: '4040', costAccount: '5050', prefix: 'HF', color: '#D97706', dueDays: 7 },
  { label: 'Transport', type: 'Transport', segment: 'transport', revenue: '4050', costAccount: '5060', prefix: 'XF', color: '#0D9488', dueDays: 3 }
]);
const CUSTOM_CATEGORY = Object.freeze({ type: 'Other', segment: 'other', revenue: '4060', costAccount: '5090', prefix: 'OF', color: '#64748B', dueDays: 7 });

// How many days overdue each bucket covers. "current" is not yet due.
const AGING_BUCKETS = Object.freeze([
  { key: 'current', label: 'Not due', color: '#16A34A' },
  { key: 'd1_30', label: '1-30 days', color: '#0879E8' },
  { key: 'd31_60', label: '31-60 days', color: '#D97706' },
  { key: 'd61_90', label: '61-90 days', color: '#EA580C' },
  { key: 'd90_plus', label: '90+ days', color: '#DC2626' }
]);

const FILE_STATUSES = Object.freeze(['Processing', 'Completed', 'Cancelled']);

module.exports = {
  ACCOUNT_TYPES,
  DEBIT_TYPES,
  GROUP_ORDER,
  ACCOUNTS,
  AR_ACCOUNT,
  AP_ACCOUNT,
  ADVANCE_ACCOUNT,
  DISCOUNT_ACCOUNT,
  OPENING_EQUITY_ACCOUNT,
  OTHER_REVENUE_ACCOUNT,
  PAYMENT_METHODS,
  CASH_ACCOUNTS,
  VISA_METHOD_TO_METHOD,
  VOUCHER_TYPES,
  SEGMENTS,
  DEFAULT_CATEGORIES,
  CUSTOM_CATEGORY,
  AGING_BUCKETS,
  FILE_STATUSES
};
