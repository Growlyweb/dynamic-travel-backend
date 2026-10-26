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
  VISA_PAYMENT_VOIDED: 'visa.payment.voided'
});

const bus = new EventEmitter();

const on = (event, listener) => {
  bus.on(event, async (payload) => {
    try {
      await listener(payload);
    } catch (err) {
      logger.error({ err }, `Listener for ${event} failed`);
    }
  });
};

const emit = (event, payload) => {
  bus.emit(event, payload);
};

// For tests.
const removeAllListeners = () => bus.removeAllListeners();

module.exports = { EVENTS, on, emit, removeAllListeners };
