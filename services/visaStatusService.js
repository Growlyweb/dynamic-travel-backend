const VisaStatusConfig = require('../models/VisaStatusConfig');
const { systemStatus, isSystemFinal, SYSTEM_STATUSES, REOPEN_TO, REQUIRED_TEXT } = require('../config/visa');
const { PERMISSIONS } = require('../config/rbac');
const { ROLES, AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const events = require('../utils/events');
const auditService = require('./auditService');
const catalog = require('./visaCatalogService');
const { findApplication, actorOf, addTimeline, hasPermission } = require('./visaShared');

// WHO may move an application to a status. Every change needs VISA_UPDATE today. To make approving or rejecting
// stricter later, add a key such as VISA_APPROVE to config/rbac.json and return it here for those statuses.
const permissionForStatusChange = () => PERMISSIONS.VISA_UPDATE;

// Only an admin may bring a finished application (completed, rejected, cancelled) back.
const REOPEN_ROLES = [ROLES.ADMIN];

// A status staff added counts as final when it sits in the failed or cancelled category.
const FINAL_CUSTOM_CATEGORIES = ['failed', 'cancelled'];

const describe = async (key) => {
  const system = systemStatus(key);
  if (system) return { key, system: true, final: isSystemFinal(key), displayName: system.displayName, customerMessage: system.customerMessage };
  const custom = await VisaStatusConfig.findOne({ key });
  if (!custom) return null;
  return {
    key,
    system: false,
    final: FINAL_CUSTOM_CATEGORIES.includes(custom.category),
    active: custom.active,
    displayName: custom.displayName,
    customerMessage: custom.customerMessage
  };
};

// Is moving from one status to another allowed? Returns an error message, or null when it is fine.
const refuse = async (from, to, user) => {
  if (from.key === to.key) return `The application is already ${from.displayName}.`;

  if (from.final) {
    if (!REOPEN_ROLES.includes(user.role)) return 'Only an admin can reopen a finished application.';
    return to.key === REOPEN_TO ? null : `A finished application can only be reopened to ${systemStatus(REOPEN_TO).displayName}.`;
  }

  if (from.system && to.system) {
    return systemStatus(from.key).transitions.includes(to.key) ? null : `An application cannot move from ${from.displayName} to ${to.displayName}.`;
  }
  // A custom status can be entered from any open status, and left for any open system status except the first one.
  if (!from.system && to.system && to.key === SYSTEM_STATUSES[0].key) return `An application cannot go back to ${to.displayName}.`;
  if (to.active === false) return `${to.displayName} is turned off.`;
  return null;
};

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

// The one place where a status changes. It checks the move and the required wording, writes the timeline, the audit
// log and raises an event, so every other part of the system (messages, notifications, accounting) hears about it.
const changeStatus = async (user, id, body, context = {}) => {
  const application = await findApplication(id);
  await catalog.ensureSystemStatuses();

  const to = await describe(body.status);
  if (!to) throw new ApiError(422, `Unknown status "${body.status}".`, { code: 'UNKNOWN_STATUS' });
  const from = (await describe(application.status)) || { key: application.status, system: false, final: false, displayName: application.status };

  const permission = permissionForStatusChange(to.key);
  if (!hasPermission(user, permission)) throw new ApiError(403, 'Forbidden', { code: 'FORBIDDEN' });

  const reason = await refuse(from, to, user);
  if (reason) throw new ApiError(409, reason, { code: 'INVALID_STATUS_CHANGE' });

  const customerMessage = textOf(body.customerMessage);
  const customerReason = textOf(body.customerReason);
  const internalReason = textOf(body.internalReason);
  const note = textOf(body.note);
  const reopening = from.final;

  const needed = reopening ? 'internalReason' : REQUIRED_TEXT[to.key];
  const given = { customerMessage, customerReason, internalReason };
  if (needed && !given[needed]) {
    const label = { customerMessage: 'a message for the customer', customerReason: 'a reason for the customer', internalReason: 'an internal reason' }[needed];
    throw new ApiError(422, `Moving to ${to.displayName} needs ${label}.`, { code: 'STATUS_TEXT_REQUIRED', errors: [{ field: `body.${needed}`, message: `${needed} is required.` }] });
  }

  const actor = await actorOf(user);
  const now = new Date();
  const previous = application.status;

  application.status = to.key;
  application.statusChangedAt = now;
  application.statusHistory.push({ status: to.key, at: now });
  application.actionRequired = to.key === 'action_required' ? { message: customerMessage, requestedAt: now, requestedBy: actor.name } : null;
  if (to.key === 'rejected') application.rejection = { internalReason, customerReason, decidedAt: now };
  if (reopening) application.rejection = null;

  // The line the applicant may read: what staff wrote for them, else the standard wording of the status.
  const customerLine = to.key === 'rejected' ? customerReason : note || customerMessage || to.customerMessage || `Status changed to ${to.displayName}.`;
  addTimeline(application, { event: to.displayName, message: customerLine, visibility: 'both', actor });
  if (internalReason) addTimeline(application, { event: `${to.displayName}: internal reason`, message: internalReason, visibility: 'internal', actor });
  if (reopening) addTimeline(application, { event: 'Application reopened', message: `Reopened from ${from.displayName}.`, visibility: 'internal', actor });

  await application.save();

  await auditService.record({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.VISA_STATUS_CHANGED,
    resource: `visa-application:${application._id}`,
    ip: context.ip,
    meta: { from: previous, to: to.key }
  });
  events.emit(events.EVENTS.VISA_STATUS_CHANGED, { applicationId: String(application._id), number: application.number, from: previous, to: to.key, actorId: user.id });

  return application;
};

module.exports = { changeStatus, describe, permissionForStatusChange, REOPEN_ROLES };
