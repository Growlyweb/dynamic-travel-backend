const { z } = require('zod');
const { idParam, pagination, search } = require('./common');

const listMarketingCustomers = z.object({
  ...pagination,
  search,
  type: z.enum(['B2B', 'B2C']).optional(),
  service: z.string().optional()
});

const sendSingleSms = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(1),
  phone: z.string().min(6),
  message: z.string().min(1).max(1000),
  templateId: z.string().optional()
});

const sendSingleEmail = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(1),
  email: z.string().email(),
  subject: z.string().min(1).max(255),
  message: z.string().min(1),
  sendCopyToMe: z.boolean().optional(),
  templateId: z.string().optional()
});

const sendBulkCampaign = z.object({
  type: z.enum(['Email', 'SMS', 'email', 'sms']),
  recipientCount: z.coerce.number().int().min(1).max(2000).optional(),
  recipients: z.array(z.record(z.any())).optional(),
  subject: z.string().optional(),
  message: z.string().min(1),
  campaignName: z.string().optional(),
  scheduledAt: z.string().optional(),
  templateId: z.string().optional()
});

const saveTemplate = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(150),
  type: z.enum(['email', 'sms', 'both']).default('both'),
  subject: z.string().optional(),
  smsBody: z.string().optional(),
  emailSubject: z.string().optional(),
  emailBodyHtml: z.string().optional()
});

module.exports = {
  listMarketingCustomers,
  sendSingleSms,
  sendSingleEmail,
  sendBulkCampaign,
  saveTemplate,
  idParam
};
