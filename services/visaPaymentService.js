const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const events = require('../utils/events');
const auditService = require('./auditService');
const money = require('./visaMoney');
const { findApplication, actorOf, addTimeline } = require('./visaShared');

// Payments are typed in by hand (there is no payment gateway). After every entry or void the server recalculates the
// advance received, the amount due and the payment status, so the dashboard never has to.

const recalculate = (application) => {
  const { account, payments, vendorLines, price } = application;
  Object.assign(
    account,
    money.calculate({
      total: account.totalAmount,
      discount: account.discountAmount,
      payments,
      vendorCost: vendorLines.reduce((sum, line) => sum + money.toMinor(line.price), 0) / 100,
      rateToBase: price.rateToBase
    })
  );
};

const add = async (user, id, { amount, method, date, note }, context = {}) => {
  const application = await findApplication(id);
  if (money.toMinor(amount) > money.toMinor(application.account.dueAmount)) {
    throw new ApiError(422, `The payment is more than the amount due (${application.account.dueAmount} ${application.price.currency}).`, {
      code: 'PAYMENT_EXCEEDS_DUE',
      errors: [{ field: 'body.amount', message: 'The amount is more than what is due.' }]
    });
  }

  const actor = await actorOf(user);
  application.payments.push({ amount, method, date: date || new Date(), note: note || '', enteredBy: actor.id, enteredByName: actor.name });
  application.account.paymentMethod = method;
  recalculate(application);
  addTimeline(application, { event: 'Payment received', message: `${amount} ${application.price.currency} by ${method}.${note ? ` ${note}` : ''}`, visibility: 'internal', actor });
  await application.save();

  await auditService.record({ actorUserId: user.id, action: AUDIT_ACTIONS.VISA_PAYMENT_RECORDED, resource: `visa-application:${application._id}`, ip: context.ip, meta: { amount, method } });
  events.emit(events.EVENTS.VISA_PAYMENT_RECORDED, { applicationId: String(application._id), paymentId: String(application.payments[application.payments.length - 1]._id), number: application.number, amount, currency: application.price.currency });
  return application;
};

// A wrong entry is never deleted: it is voided with a reason, so the history stays complete.
const voidPayment = async (user, id, paymentId, { reason }, context = {}) => {
  const application = await findApplication(id);
  const payment = application.payments.id(paymentId);
  if (!payment) throw new ApiError(404, 'Payment not found.', { code: 'PAYMENT_NOT_FOUND' });
  if (payment.voided) throw new ApiError(409, 'This payment is already voided.', { code: 'PAYMENT_ALREADY_VOIDED' });

  const actor = await actorOf(user);
  payment.voided = true;
  payment.voidedAt = new Date();
  payment.voidedBy = actor.id;
  payment.voidedByName = actor.name;
  payment.voidReason = reason;
  recalculate(application);
  addTimeline(application, { event: 'Payment voided', message: `${payment.amount} ${application.price.currency} voided. Reason: ${reason}`, visibility: 'internal', actor });
  await application.save();

  await auditService.record({ actorUserId: user.id, action: AUDIT_ACTIONS.VISA_PAYMENT_VOIDED, resource: `visa-application:${application._id}`, ip: context.ip, meta: { paymentId: String(payment._id), amount: payment.amount } });
  events.emit(events.EVENTS.VISA_PAYMENT_VOIDED, { applicationId: String(application._id), paymentId: String(payment._id), number: application.number, amount: payment.amount, currency: application.price.currency });
  return application;
};

module.exports = { add, voidPayment };
