const MessageTemplate = require('../models/MessageTemplate');
const VisaMessage = require('../models/VisaMessage');
const VisaApplication = require('../models/VisaApplication');
const env = require('../config/env');
const { AUDIT_ACTIONS } = require('../config/constants');
const { MESSAGE_VARIABLES } = require('../config/visa');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const events = require('../utils/events');
const logger = require('../utils/logger');
const mailer = require('../utils/mailer');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const statusService = require('./visaStatusService');
const { findApplication, actorOf, describeService } = require('./visaShared');

const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const VARIABLE = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

// ------------------------------------------------------------------ templates

// A template may only use the words the server knows how to fill, so a typo is caught when it is saved and not in
// front of an applicant.
const unknownVariables = (...texts) => {
  const found = new Set();
  texts.filter(Boolean).forEach((text) => [...text.matchAll(VARIABLE)].forEach((match) => !MESSAGE_VARIABLES.includes(match[1]) && found.add(match[1])));
  return [...found];
};

const checkTemplate = async ({ trigger, subject, message }) => {
  if (trigger !== undefined && !(await statusService.describe(trigger))) {
    throw new ApiError(422, `"${trigger}" is not a visa status.`, { code: 'UNKNOWN_STATUS', errors: [{ field: 'body.trigger', message: 'Choose an existing status.' }] });
  }
  const unknown = unknownVariables(subject, message);
  if (unknown.length) {
    throw new ApiError(422, `Unknown word${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Allowed: ${MESSAGE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}.`, {
      code: 'UNKNOWN_VARIABLE',
      errors: [{ field: 'body.message', message: 'Contains a word that cannot be filled in.' }]
    });
  }
};

const audit = (user, action, resource, context, meta) => auditService.record({ actorUserId: user.id, action, resource, ip: context.ip, meta });

const listTemplates = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.channel) filter.channel = query.channel;
  if (query.serviceType) filter.serviceType = query.serviceType;
  if (query.active !== undefined) filter.active = query.active === 'true';
  const [items, total] = await Promise.all([MessageTemplate.find(filter).sort({ channel: 1, name: 1 }).skip(skip).limit(limit), MessageTemplate.countDocuments(filter)]);
  return { items, meta: buildMeta(total, page, limit) };
};

const getTemplate = async (id) => {
  const template = await MessageTemplate.findById(id);
  if (!template) throw new ApiError(404, 'Template not found.', { code: 'TEMPLATE_NOT_FOUND' });
  return template;
};

const createTemplate = async (user, body, context = {}) => {
  await checkTemplate(body);
  const nameKey = keyOf(body.name);
  if (await MessageTemplate.exists({ channel: body.channel, nameKey })) throw new ApiError(409, 'A template with this name already exists for this channel.', { code: 'TEMPLATE_EXISTS' });
  const template = await MessageTemplate.create({ ...body, nameKey, subject: body.channel === 'sms' ? '' : body.subject });
  await audit(user, AUDIT_ACTIONS.VISA_TEMPLATE_CHANGED, `message-template:${template._id}`, context, { action: 'created' });
  return template;
};

const updateTemplate = async (user, id, body, context = {}) => {
  const template = await getTemplate(id);
  const next = { channel: body.channel ?? template.channel, subject: body.subject ?? template.subject, message: body.message ?? template.message };
  if (next.channel === 'email' && !next.subject) throw new ApiError(422, 'An email template needs a subject.', { code: 'VALIDATION_ERROR', errors: [{ field: 'body.subject', message: 'An email template needs a subject.' }] });
  await checkTemplate({ trigger: body.trigger, subject: next.subject, message: next.message });

  const data = { ...body };
  if (data.name !== undefined || data.channel !== undefined) {
    const nameKey = keyOf(data.name ?? template.name);
    if (await MessageTemplate.exists({ channel: next.channel, nameKey, _id: { $ne: template._id } })) throw new ApiError(409, 'A template with this name already exists for this channel.', { code: 'TEMPLATE_EXISTS' });
    data.nameKey = nameKey;
  }
  template.set(data);
  if (template.channel === 'sms') template.subject = '';
  await template.save();
  await audit(user, AUDIT_ACTIONS.VISA_TEMPLATE_CHANGED, `message-template:${template._id}`, context, { action: 'updated' });
  return template;
};

const removeTemplate = async (user, id, context = {}) => {
  const template = await getTemplate(id);
  await template.deleteOne();
  await audit(user, AUDIT_ACTIONS.VISA_TEMPLATE_CHANGED, `message-template:${template._id}`, context, { action: 'deleted' });
};

// ------------------------------------------------------------------ writing a message

const variablesOf = async (application) => {
  const status = await statusService.describe(application.status);
  return {
    applicantName: application.applicant.fullName,
    applicationNumber: application.number,
    country: application.countryName,
    // A ticket, hotel or tour file has no visa type: the word is the service, so "your Hotel application" still reads well.
    visaType: application.visaTypeName || describeService(application).label,
    status: status ? status.displayName : application.status,
    // The public status page knows visa files only, so any other file gets no link.
    trackingUrl: describeService(application).type === 'visa' ? `${env.visaTrackingUrl}/${application.number}` : ''
  };
};

// Fills the words in. Anything that is not a known word is left as it is.
const render = (text, variables) => String(text || '').replace(VARIABLE, (whole, key) => (key in variables ? variables[key] : whole));

const addTimeline = (applicationId, event, message, actor) =>
  VisaApplication.updateOne({ _id: applicationId }, { $push: { timeline: { event, message, visibility: 'internal', by: actor ? actor.name : 'System', byUserId: actor ? actor.id : undefined } } });

// Sends an email through EmailJS and records the result. A failure is saved with its reason and never thrown: the log
// row is the answer, so one bad address cannot break the status change that caused it.
const deliverEmail = async (message, actor) => {
  try {
    await mailer.send({ to: message.to, toName: message.toName, subject: message.subject, message: message.body });
    message.status = 'sent';
    message.error = '';
    message.sentAt = new Date();
    message.provider = env.mail.provider;
    if (actor) {
      message.sentBy = actor.id;
      message.sentByName = actor.name;
    }
  } catch (err) {
    logger.warn(`Visa email ${message._id} was not sent: ${err.message}`);
    message.status = 'failed';
    message.error = String(err.message).slice(0, 300);
    message.provider = env.mail.provider;
  }
  await message.save();
  await addTimeline(message.application, message.status === 'sent' ? 'Email sent' : 'Email failed', `${message.templateName}: ${message.status === 'sent' ? message.to : message.error}`, actor);
  return message;
};

// Makes the log row. An email is delivered at once. An SMS waits for a person to send it by hand.
const createMessage = async (application, { channel, template, subject, body, source, actor, markSent = false }) => {
  const variables = await variablesOf(application);
  const isEmail = channel === 'email';
  const to = isEmail ? application.applicant.email : application.applicant.mobile;

  const message = new VisaMessage({
    application: application._id,
    applicationNumber: application.number,
    channel,
    to: to || '',
    toName: application.applicant.fullName,
    template: template ? template._id : undefined,
    templateName: template ? template.name : 'Custom message',
    trigger: template ? template.trigger : '',
    subject: isEmail ? render(subject, variables) : '',
    body: render(body, variables),
    source,
    provider: isEmail ? env.mail.provider : 'manual',
    createdBy: actor ? actor.id : undefined,
    createdByName: actor ? actor.name : 'System'
  });

  if (isEmail && !to) {
    message.status = 'failed';
    message.error = 'The applicant has no email address.';
    await message.save();
    return message;
  }
  if (isEmail) {
    await message.save();
    return deliverEmail(message, actor);
  }

  if (markSent) {
    message.status = 'sent';
    message.sentAt = new Date();
    message.sentBy = actor ? actor.id : undefined;
    message.sentByName = actor ? actor.name : '';
  }
  await message.save();
  await addTimeline(application._id, markSent ? 'SMS sent' : 'SMS prepared', `${message.templateName}: ${message.body}`, actor);
  return message;
};

// ------------------------------------------------------------------ automatic messages

// A template made for the service of the file is used; a template for "all" services is used only on a channel where the
// service has none of its own. So a hotel file gets the hotel wording, and the general wording until there is some.
const templatesForService = (templates, serviceType) => {
  const own = new Set(templates.filter((template) => template.serviceType === serviceType).map((template) => template.channel));
  return templates.filter((template) => template.serviceType === serviceType || (template.serviceType === 'all' && !own.has(template.channel)));
};

// When an application reaches a status, every active template for it and its service is used. Email goes out at once,
// an SMS becomes a prepared message in the log.
const runTriggers = async (applicationId, trigger) => {
  const found = await MessageTemplate.find({ trigger, active: true });
  if (!found.length) return [];
  const application = await VisaApplication.findById(applicationId);
  if (!application) return [];

  const templates = templatesForService(found, describeService(application).type);
  const made = [];
  for (const template of templates) {
    made.push(await createMessage(application, { channel: template.channel, template, subject: template.subject, body: template.message, source: 'auto' }));
  }
  return made;
};

// Called once at start-up (app.js). The status service and the application service only raise events.
const register = () => {
  events.on(events.EVENTS.VISA_APPLICATION_CREATED, ({ applicationId }) => runTriggers(applicationId, 'submitted'));
  events.on(events.EVENTS.VISA_STATUS_CHANGED, ({ applicationId, to }) => runTriggers(applicationId, to));
};

// ------------------------------------------------------------------ manual messages

// A person writes or picks a message for the applicant of one application.
const send = async (user, applicationId, body, context = {}) => {
  const application = await findApplication(applicationId);
  const actor = await actorOf(user);

  let template = null;
  if (body.templateId) {
    template = await getTemplate(body.templateId);
    if (body.channel && body.channel !== template.channel) throw new ApiError(422, `This template is for ${template.channel}, not ${body.channel}.`, { code: 'CHANNEL_MISMATCH' });
  }
  const channel = template ? template.channel : body.channel;
  const text = body.message || template.message;
  const subject = body.subject || (template ? template.subject : '');
  if (channel === 'email' && !subject) throw new ApiError(422, 'An email needs a subject.', { code: 'VALIDATION_ERROR', errors: [{ field: 'body.subject', message: 'An email needs a subject.' }] });
  if (channel === 'email' && !application.applicant.email) throw new ApiError(422, 'The applicant has no email address.', { code: 'NO_EMAIL' });
  await checkTemplate({ subject, message: text });

  const message = await createMessage(application, { channel, template, subject, body: text, source: 'manual', actor, markSent: Boolean(body.markSent) });
  await audit(user, AUDIT_ACTIONS.VISA_MESSAGE_CREATED, `visa-application:${application._id}`, context, { channel, status: message.status });
  return message;
};

const getMessage = async (id) => {
  const message = await VisaMessage.findById(id);
  if (!message) throw new ApiError(404, 'Message not found.', { code: 'MESSAGE_NOT_FOUND' });
  return message;
};

// An SMS is sent by hand, so staff say what happened to it. A sent message stays sent.
const mark = async (user, id, { status, error }, context = {}) => {
  const message = await getMessage(id);
  if (message.channel !== 'sms') throw new ApiError(409, 'Only an SMS is marked by hand. An email is sent by the system.', { code: 'NOT_AN_SMS' });
  if (message.status === 'sent') throw new ApiError(409, 'This message is already marked as sent.', { code: 'MESSAGE_ALREADY_SENT' });
  if (status === message.status) throw new ApiError(409, `This message is already ${status}.`, { code: 'INVALID_MESSAGE_CHANGE' });
  if (status === 'failed' && !error) throw new ApiError(422, 'Write why it failed.', { code: 'VALIDATION_ERROR', errors: [{ field: 'body.error', message: 'error is required.' }] });

  const actor = await actorOf(user);
  message.status = status;
  message.error = status === 'failed' ? error : '';
  if (status === 'sent') {
    message.sentAt = new Date();
    message.sentBy = actor.id;
    message.sentByName = actor.name;
  }
  await message.save();
  if (status !== 'pending') await addTimeline(message.application, status === 'sent' ? 'SMS sent' : 'SMS failed', `${message.templateName}${status === 'failed' ? `: ${error}` : ''}`, actor);
  await audit(user, AUDIT_ACTIONS.VISA_MESSAGE_UPDATED, `visa-application:${message.application}`, context, { status });
  return message;
};

// Tries an email that failed again.
const resend = async (user, id, context = {}) => {
  const message = await getMessage(id);
  if (message.channel !== 'email') throw new ApiError(409, 'Only an email can be sent by the system.', { code: 'NOT_AN_EMAIL' });
  if (message.status === 'sent') throw new ApiError(409, 'This email was already sent.', { code: 'MESSAGE_ALREADY_SENT' });
  if (!message.to) throw new ApiError(422, 'The applicant has no email address.', { code: 'NO_EMAIL' });

  const actor = await actorOf(user);
  await deliverEmail(message, actor);
  await audit(user, AUDIT_ACTIONS.VISA_MESSAGE_UPDATED, `visa-application:${message.application}`, context, { status: message.status, resent: true });
  return message;
};

const listMessages = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.applicationId) filter.application = query.applicationId;
  if (query.channel) filter.channel = query.channel;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ applicationNumber: rx }, { toName: rx }, { to: rx }, { templateName: rx }];
  }
  const [items, total] = await Promise.all([VisaMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), VisaMessage.countDocuments(filter)]);
  return { items, meta: buildMeta(total, page, limit) };
};

module.exports = {
  render,
  variablesOf,
  runTriggers,
  register,
  listTemplates,
  createTemplate,
  updateTemplate,
  removeTemplate,
  send,
  mark,
  resend,
  listMessages
};
