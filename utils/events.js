const { EventEmitter } = require('events');
const logger = require('./logger');

// A small in-process event hook. A module announces what happened ("a visa payment was recorded") and other
// modules (messages, notifications, later accounting) listen, so the first one never imports the others.
//
// A failing listener is logged and never reaches the request that raised the event.
const EVENTS = Object.freeze({
  VISA_APPLICATION_CREATED: 'visa.application.created',
  VISA_APPLICATION_UPDATED: 'visa.application.updated',
  VISA_STATUS_CHANGED: 'visa.status.changed',
  VISA_PAYMENT_RECORDED: 'visa.payment.recorded',
  VISA_PAYMENT_VOIDED: 'visa.payment.voided',
  VISA_QUOTATION_ACCEPTED: 'visa.quotation.accepted'
});

const bus = new EventEmitter();

// Listeners run after the request has answered. Tests wait for them with `idle()`.
const running = new Set();

const on = (event, listener) => {
  bus.on(event, (payload) => {
    const task = (async () => {
      try {
        await listener(payload);
      } catch (err) {
        logger.error({ err }, `Listener for ${event} failed`);
      }
    })();
    running.add(task);
    task.finally(() => running.delete(task));
  });
};

const emit = (event, payload) => {
  bus.emit(event, payload);
};

// Resolves when every listener that has started is done. For tests.
const idle = async () => {
  while (running.size) await Promise.all([...running]);
};

// For tests.
const removeAllListeners = () => bus.removeAllListeners();

module.exports = { EVENTS, on, emit, idle, removeAllListeners };
