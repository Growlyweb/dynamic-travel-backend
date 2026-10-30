// Loads the visa status list and the allowed moves between statuses from config/visaStatuses.json, and checks the file
// is well formed, so a typo stops the boot instead of leaving an application stuck.
const raw = require('./visaStatuses.json');

const STATUS_CATEGORIES = Object.freeze(['in_progress', 'action_required', 'success', 'failed', 'cancelled']);
const APPLICANT_TYPES = Object.freeze(['individual', 'business', 'student', 'employee', 'sponsored']);
const CHECKLIST_REQUIREMENTS = Object.freeze(['required', 'optional', 'conditional']);
const SUBMISSION_MODES = Object.freeze(['digital', 'physical', 'both']);
const PASSPORT_REQUIREMENTS = Object.freeze(['online_processing', 'physical_required']);
const PAYMENT_METHODS = Object.freeze(['Bank Transfer', 'Cash', 'Credit / Debit Card', 'bKash / Nagad']);
// What an application is for. Only a visa has a price list, a passport rule, a checklist and a public status page.
const SERVICE_TYPES = Object.freeze(['visa', 'ticket', 'hotel', 'tour']);
const SERVICE_LABELS = Object.freeze({ visa: 'Visa', ticket: 'Ticket', hotel: 'Hotel', tour: 'Tour Package' });
// The number of a file starts with these letters: VISA-2026-000001, TKT-2026-000001.
const SERVICE_NUMBER_PREFIXES = Object.freeze({ visa: 'VISA', ticket: 'TKT', hotel: 'HTL', tour: 'TOUR' });
// A message template is for one service, or for every service that has no template of its own.
const TEMPLATE_SERVICES = Object.freeze(['all', ...SERVICE_TYPES]);
const TRIP_TYPES = Object.freeze(['One Way', 'Round Way', 'Multi City']);
const TICKET_CLASSES = Object.freeze(['Economy', 'Premium Economy', 'Business', 'First Class']);
const PASSPORT_SUBMISSION_METHODS = Object.freeze(['online', 'office', 'pickup']);
const PASSPORT_STATUSES = Object.freeze([
  'not_received',
  'pickup_requested',
  'confirmed',
  'assigned',
  'pickup_in_progress',
  'picked_up',
  'received_at_office',
  'submitted_to_visa_center',
  'submitted_to_embassy',
  'returned_to_office',
  'ready_for_collection',
  'ready_for_delivery',
  'client_visited_office',
  'out_for_delivery',
  'delivered',
  'not_required'
]);

// The words a message template can use. The server fills them in from the application.
const MESSAGE_VARIABLES = Object.freeze(['applicantName', 'applicationNumber', 'country', 'visaType', 'status', 'trackingUrl']);
const MESSAGE_CHANNELS = Object.freeze(['sms', 'email']);
const MESSAGE_STATUSES = Object.freeze(['pending', 'sent', 'failed']);
const QUOTATION_STATUSES = Object.freeze(['draft', 'sent', 'accepted', 'rejected']);

// What each action needs besides the new status. The message goes to the applicant, the reason stays inside.
const REQUIRED_TEXT = Object.freeze({
  action_required: 'customerMessage',
  rejected: 'customerReason',
  cancelled: 'internalReason'
});

const build = (config) => {
  const keys = new Set();
  config.statuses.forEach((status) => {
    ['key', 'displayName', 'category', 'publicStage', 'customerMessage'].forEach((field) => {
      if (typeof status[field] !== 'string' || !status[field]) throw new Error(`config/visaStatuses.json: status needs "${field}".`);
    });
    if (!/^[a-z][a-z0-9_]*$/.test(status.key)) throw new Error(`config/visaStatuses.json: status key "${status.key}" must be lower_snake_case.`);
    if (!STATUS_CATEGORIES.includes(status.category)) throw new Error(`config/visaStatuses.json: "${status.key}" has an unknown category.`);
    if (keys.has(status.key)) throw new Error(`config/visaStatuses.json: status "${status.key}" is listed twice.`);
    keys.add(status.key);
  });
  config.statuses.forEach((status) => {
    status.transitions.forEach((target) => {
      if (!keys.has(target)) throw new Error(`config/visaStatuses.json: "${status.key}" moves to unknown status "${target}".`);
    });
  });
  if (!keys.has(config.reopenTo)) throw new Error('config/visaStatuses.json: "reopenTo" must be a listed status.');

  const byKey = Object.fromEntries(config.statuses.map((status) => [status.key, status]));
  const isFinal = (status) => status.transitions.length === 0;

  return Object.freeze({
    SYSTEM_STATUSES: Object.freeze(config.statuses.map((status) => Object.freeze({ ...status }))),
    SYSTEM_STATUS_KEYS: Object.freeze([...keys]),
    REOPEN_TO: config.reopenTo,
    systemStatus: (key) => byKey[key] || null,
    // Final statuses (completed, rejected, cancelled) have no way out except an admin reopening the application.
    isSystemFinal: (key) => Boolean(byKey[key]) && isFinal(byKey[key])
  });
};

module.exports = {
  ...build(raw),
  build,
  STATUS_CATEGORIES,
  APPLICANT_TYPES,
  CHECKLIST_REQUIREMENTS,
  SUBMISSION_MODES,
  PASSPORT_REQUIREMENTS,
  PAYMENT_METHODS,
  SERVICE_TYPES,
  SERVICE_LABELS,
  SERVICE_NUMBER_PREFIXES,
  TEMPLATE_SERVICES,
  TRIP_TYPES,
  TICKET_CLASSES,
  PASSPORT_SUBMISSION_METHODS,
  PASSPORT_STATUSES,
  MESSAGE_VARIABLES,
  MESSAGE_CHANNELS,
  MESSAGE_STATUSES,
  QUOTATION_STATUSES,
  REQUIRED_TEXT
};
