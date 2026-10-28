const ApiError = require('./../utils/ApiError');

// The money of one visa application. Every number is calculated here from the total, the discount and the payments
// that are not voided; the browser only ever sends the total and the discount. Amounts are worked out in minor units
// (paise) so 0.1 + 0.2 never drifts, then stored as ordinary numbers with two decimals.
const toMinor = (amount) => Math.round((Number(amount) || 0) * 100);
const fromMinor = (minor) => minor / 100;
const round2 = (amount) => fromMinor(toMinor(amount));

const paymentStatusOf = (totalMinor, dueMinor, advanceMinor) => {
  if (totalMinor > 0 && dueMinor === 0) return 'Paid';
  if (advanceMinor > 0 && dueMinor > 0) return 'Partial';
  return 'Unpaid';
};

// `payments` are the application's payment entries. A voided entry counts for nothing.
// `vendorCost` is the sum of the vendor lines. `rateToBase` turns this currency into BDT for accounting.
const calculate = ({ total, discount = 0, payments = [], vendorCost = 0, rateToBase = 1 }) => {
  const totalMinor = toMinor(total);
  const discountMinor = toMinor(discount);
  if (totalMinor < 0 || discountMinor < 0) throw new ApiError(422, 'Amounts cannot be negative.', { code: 'INVALID_AMOUNT' });
  if (discountMinor > totalMinor) throw new ApiError(422, 'The discount cannot be more than the total.', { code: 'DISCOUNT_TOO_HIGH' });

  const netMinor = totalMinor - discountMinor;
  const advanceMinor = payments.filter((payment) => !payment.voided).reduce((sum, payment) => sum + toMinor(payment.amount), 0);
  if (advanceMinor > netMinor) {
    throw new ApiError(422, 'The payments received are more than the amount to pay. Void or correct a payment first.', { code: 'PAYMENTS_EXCEED_NET' });
  }
  const dueMinor = netMinor - advanceMinor;
  const costMinor = toMinor(vendorCost);

  return {
    totalAmount: fromMinor(totalMinor),
    discountAmount: fromMinor(discountMinor),
    netAmount: fromMinor(netMinor),
    advancePaid: fromMinor(advanceMinor),
    dueAmount: fromMinor(dueMinor),
    paymentStatus: paymentStatusOf(totalMinor, dueMinor, advanceMinor),
    costPrice: fromMinor(costMinor),
    profit: fromMinor(netMinor - costMinor),
    netAmountBase: round2(fromMinor(netMinor) * rateToBase)
  };
};

// Converts an amount between two currencies through BDT.
const convert = (amount, fromRate, toRate) => round2((Number(amount) * fromRate) / toRate);

module.exports = { calculate, convert, round2, toMinor, fromMinor };
