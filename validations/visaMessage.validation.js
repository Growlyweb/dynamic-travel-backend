const { z } = require('zod');
const { objectId, pagination, search } = require('./common');
const { MESSAGE_CHANNELS, TEMPLATE_SERVICES } = require('../config/visa');

const text = (label, max) => z.string(`${label} must be text.`).trim().max(max, `${label} must be at most ${max} characters.`);
const required = (label, max) => text(label, max).min(1, `${label} is required.`);

const idParam = z.object({ id: objectId });

const templateFields = {
  name: required('Name', 80),
  channel: z.enum(MESSAGE_CHANNELS, 'Channel must be sms or email.'),
  trigger: required('Trigger', 40),
  serviceType: z.enum(TEMPLATE_SERVICES, `Service must be one of: ${TEMPLATE_SERVICES.join(', ')}.`),
  subject: text('Subject', 150),
  message: required('Message', 5000),
  active: z.boolean()
};

// An email needs a subject. An SMS has none.
const needsSubject = (value) => value.channel !== 'email' || Boolean(value.subject);
const subjectIssue = { message: 'An email template needs a subject.', path: ['subject'] };

const createTemplate = z.object({ ...templateFields, subject: templateFields.subject.optional(), serviceType: templateFields.serviceType.optional(), active: templateFields.active.optional() }).refine(needsSubject, subjectIssue);
const updateTemplate = z.object(Object.fromEntries(Object.entries(templateFields).map(([key, schema]) => [key, schema.optional()])));
const listTemplates = z.object({ channel: z.enum(MESSAGE_CHANNELS).optional(), serviceType: z.enum(TEMPLATE_SERVICES).optional(), active: z.enum(['true', 'false']).optional(), ...pagination });

const listMessages = z.object({
  applicationId: objectId.optional(),
  channel: z.enum(MESSAGE_CHANNELS).optional(),
  status: z.enum(['pending', 'sent', 'failed']).optional(),
  search,
  ...pagination
});

// A person sends a message to the applicant of one application, from a template or with their own words.
const sendMessage = z
  .object({
    templateId: objectId.optional(),
    channel: z.enum(MESSAGE_CHANNELS).optional(),
    subject: text('Subject', 150).optional(),
    message: text('Message', 5000).optional(),
    // For an SMS the person already sent it from their own phone: log it as sent instead of waiting.
    markSent: z.boolean().optional()
  })
  .refine((value) => Boolean(value.templateId) || Boolean(value.channel), { message: 'Choose a template or a channel.', path: ['channel'] })
  .refine((value) => Boolean(value.templateId) || Boolean(value.message), { message: 'Write the message or choose a template.', path: ['message'] });

const markMessage = z.object({ status: z.enum(['pending', 'sent', 'failed']), error: text('Error', 300).optional() });

module.exports = { idParam, createTemplate, updateTemplate, listTemplates, listMessages, sendMessage, markMessage };
