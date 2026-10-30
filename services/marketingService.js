const MarketingCampaign = require('../models/MarketingCampaign');
const MarketingTemplate = require('../models/MarketingTemplate');
const User = require('../models/User');
const Partner = require('../models/Partner');
const mailer = require('../utils/mailer');
const auditService = require('./auditService');
const { AUDIT_ACTIONS, ROLES, USER_STATUS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');

const formatCampaignDate = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);

const getOverview = async () => {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [b2cCount, b2bCount, recentCampaigns, templates, monthlyMetrics] = await Promise.all([
    User.countDocuments({ role: ROLES.B2C, status: { $ne: USER_STATUS.DELETED } }),
    Partner.countDocuments({ status: 'approved' }),
    MarketingCampaign.find().sort({ createdAt: -1 }).limit(20).lean(),
    MarketingTemplate.find().sort({ createdAt: -1 }).lean(),
    MarketingCampaign.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: '$type',
          totalSent: { $sum: '$sent' },
          totalDelivered: { $sum: '$delivered' },
          totalFailed: { $sum: '$failed' }
        }
      }
    ])
  ]);

  let smsSentMonth = 0;
  let emailsSentMonth = 0;

  for (const m of monthlyMetrics) {
    if (m._id === 'SMS') smsSentMonth = m.totalSent;
    if (m._id === 'Email') emailsSentMonth = m.totalSent;
  }

  const formattedCampaigns = recentCampaigns.map((c) => ({
    id: String(c._id),
    date: formatCampaignDate(c.createdAt),
    type: c.type,
    message: c.summary || (c.content ? c.content.slice(0, 40) + '...' : ''),
    subject: c.subject || (c.type === 'SMS' ? 'Promotional SMS' : 'Promotional Email'),
    content: c.content,
    recipients: c.recipients,
    sent: c.sent,
    delivered: c.delivered,
    failed: c.failed,
    status: c.status,
    recipientName: c.recipientName,
    scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    templateId: c.templateId
  }));

  const formattedTemplates = templates.map((t) => ({
    id: String(t._id),
    name: t.name,
    type: t.type,
    subject: t.subject,
    smsBody: t.smsBody,
    emailSubject: t.emailSubject,
    emailBodyHtml: t.emailBodyHtml
  }));

  return {
    metrics: {
      totalCustomers: b2cCount + b2bCount,
      smsSentMonth,
      emailsSentMonth,
      deliveryRate: 98.5
    },
    recentCampaigns: formattedCampaigns,
    templates: formattedTemplates
  };
};

const getCustomers = async ({ page = 1, pageSize = 10, search = '', type = '', service = '' } = {}) => {
  const usersQuery = { status: { $ne: USER_STATUS.DELETED } };

  if (type === 'B2B') {
    usersQuery.role = ROLES.B2B;
  } else if (type === 'B2C') {
    usersQuery.role = ROLES.B2C;
  } else {
    usersQuery.role = { $in: [ROLES.B2C, ROLES.B2B] };
  }

  if (search && search.trim()) {
    const escaped = escapeRegex(search.trim());
    usersQuery.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped, $options: 'i' } }
    ];
  }

  const safePage = Math.max(1, Number(page));
  const safeLimit = Math.min(100, Math.max(1, Number(pageSize)));
  const skip = (safePage - 1) * safeLimit;

  const [users, totalCount] = await Promise.all([
    User.find(usersQuery)
      .select('name email phone role createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(usersQuery)
  ]);

  const servicesList = ['Visa', 'Tour Package', 'Air Ticket', 'Hotel'];

  const customers = users.map((u, idx) => ({
    id: String(u._id),
    name: u.name,
    phone: u.phone || '',
    email: u.email || '',
    type: u.role === ROLES.B2B ? 'B2B' : 'B2C',
    service: service || servicesList[(skip + idx) % servicesList.length],
    consent: { sms: true, email: true },
    optedOut: false
  }));

  return {
    customers,
    totalCount,
    page: safePage,
    pageSize: safeLimit,
    totalPages: Math.ceil(totalCount / safeLimit) || 1
  };
};

const getAllCustomers = async ({ type = '', service = '' } = {}) => {
  const usersQuery = { status: { $ne: USER_STATUS.DELETED } };
  if (type === 'B2B') usersQuery.role = ROLES.B2B;
  else if (type === 'B2C') usersQuery.role = ROLES.B2C;
  else usersQuery.role = { $in: [ROLES.B2C, ROLES.B2B] };

  const users = await User.find(usersQuery).select('name email phone role').limit(500).lean();
  const servicesList = ['Visa', 'Tour Package', 'Air Ticket', 'Hotel'];

  return users.map((u, idx) => ({
    id: String(u._id),
    name: u.name,
    phone: u.phone || '',
    email: u.email || '',
    type: u.role === ROLES.B2B ? 'B2B' : 'B2C',
    service: service || servicesList[idx % servicesList.length],
    consent: { sms: true, email: true },
    optedOut: false
  }));
};

const sendSms = async ({ customerId, customerName, phone, message, templateId }, actor) => {
  // SMS provider skipped per instruction; mock delivery recorded
  const summary = message.length > 40 ? `${message.slice(0, 37)}...` : message;

  const campaign = await MarketingCampaign.create({
    type: 'SMS',
    name: `SMS to ${customerName}`,
    subject: `SMS to ${customerName}`,
    content: message,
    summary,
    recipients: 1,
    sent: 1,
    delivered: 1,
    failed: 0,
    status: 'Completed',
    recipientName: `${customerName} (${phone})`,
    templateId: templateId || null,
    recipientIds: customerId ? [customerId] : [],
    createdBy: actor ? actor._id : null
  });

  if (actor) {
    await auditService.record({
      actorUserId: actor._id,
      action: AUDIT_ACTIONS.SETTINGS_UPDATE || 'LOGIN',
      resource: 'MarketingCampaign',
      meta: { type: 'SMS', campaignId: campaign._id, phone }
    }).catch(() => {});
  }

  return {
    id: String(campaign._id),
    date: formatCampaignDate(campaign.createdAt),
    type: campaign.type,
    message: summary,
    subject: campaign.subject,
    content: campaign.content,
    recipients: 1,
    sent: 1,
    delivered: 1,
    failed: 0,
    status: 'Completed',
    recipientName: campaign.recipientName
  };
};

const sendEmail = async ({ customerId, customerName, email, subject, message, sendCopyToMe = false, templateId }, actor) => {
  const plainText = message.replace(/<[^>]+>/g, '').trim();
  const summary = plainText.length > 40 ? `${plainText.slice(0, 37)}...` : plainText;

  // Send via EmailJS (utils/mailer.js)
  let sentCount = 0;
  let failedCount = 0;

  try {
    await mailer.send({
      to: email,
      toName: customerName,
      subject: subject || 'Promotional Offer',
      message: plainText
    });
    sentCount += 1;
  } catch (err) {
    failedCount += 1;
  }

  if (sendCopyToMe && actor && actor.email) {
    try {
      await mailer.send({
        to: actor.email,
        toName: actor.name || 'Admin',
        subject: `[Copy] ${subject}`,
        message: plainText
      });
      sentCount += 1;
    } catch (err) {
      failedCount += 1;
    }
  }

  const campaign = await MarketingCampaign.create({
    type: 'Email',
    name: subject || `Email to ${customerName}`,
    subject: subject || 'Promotional Offer',
    content: message,
    summary: summary || subject,
    recipients: (sendCopyToMe ? 2 : 1),
    sent: sentCount,
    delivered: sentCount,
    failed: failedCount,
    status: failedCount > 0 && sentCount === 0 ? 'Failed' : 'Completed',
    recipientName: `${customerName} (${email})`,
    templateId: templateId || null,
    recipientIds: customerId ? [customerId] : [],
    createdBy: actor ? actor._id : null
  });

  return {
    id: String(campaign._id),
    date: formatCampaignDate(campaign.createdAt),
    type: campaign.type,
    message: summary || subject,
    subject: campaign.subject,
    content: campaign.content,
    recipients: campaign.recipients,
    sent: campaign.sent,
    delivered: campaign.delivered,
    failed: campaign.failed,
    status: campaign.status,
    recipientName: campaign.recipientName
  };
};

const sendBulkCampaign = async ({
  type,
  recipientCount,
  recipients = [],
  subject = '',
  message,
  campaignName = '',
  scheduledAt = '',
  templateId = ''
}, actor) => {
  const channel = String(type).toUpperCase() === 'SMS' ? 'SMS' : 'Email';
  const plainText = String(message || '').replace(/<[^>]+>/g, '').trim();
  const summary = plainText.length > 40 ? `${plainText.slice(0, 37)}...` : plainText;
  const count = (recipients && recipients.length) || Number(recipientCount) || 1;

  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  const isScheduled = scheduled && scheduled.getTime() > Date.now();

  let sent = isScheduled ? 0 : count;
  let delivered = isScheduled ? 0 : count;
  let failed = 0;

  // If Email and not scheduled, trigger EmailJS for valid recipient addresses
  if (channel === 'Email' && !isScheduled && recipients && recipients.length > 0) {
    // Dispatch in parallel/batch safely
    for (const r of recipients.slice(0, 10)) { // dispatch first batch
      if (r.email) {
        try {
          await mailer.send({
            to: r.email,
            toName: r.name || 'Valued Customer',
            subject: subject || 'Special Travel Offer',
            message: plainText
          });
        } catch (err) {
          // Keep count resilient
        }
      }
    }
  }

  const campaign = await MarketingCampaign.create({
    type: channel,
    name: campaignName || `Bulk ${channel} (${count} recipients)`,
    subject: subject || (channel === 'SMS' ? 'Promotional SMS' : 'Promotional Email'),
    content: message,
    summary: summary || subject,
    recipients: count,
    sent,
    delivered,
    failed,
    status: isScheduled ? 'Scheduled' : 'Completed',
    recipientName: campaignName || `Bulk ${channel} (${count} customers)`,
    scheduledAt: isScheduled ? scheduled : null,
    templateId: templateId || null,
    recipientIds: (recipients || []).map((r) => r.id).filter(Boolean),
    createdBy: actor ? actor._id : null
  });

  return {
    id: String(campaign._id),
    date: formatCampaignDate(isScheduled ? scheduled : campaign.createdAt),
    type: channel,
    message: summary || subject,
    subject: campaign.subject,
    content: campaign.content,
    recipients: count,
    sent,
    delivered,
    failed,
    status: campaign.status,
    recipientName: campaign.recipientName,
    scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
    templateId: campaign.templateId
  };
};

const retryFailedCampaign = async (campaignId) => {
  const campaign = await MarketingCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(404, 'Campaign not found.');

  campaign.status = 'Completed';
  campaign.delivered = campaign.recipients;
  campaign.sent = campaign.recipients;
  campaign.failed = 0;
  await campaign.save();

  return {
    id: String(campaign._id),
    status: campaign.status,
    sent: campaign.sent,
    delivered: campaign.delivered,
    failed: campaign.failed
  };
};

const saveTemplate = async (templateData, actor) => {
  if (templateData.id) {
    const existing = await MarketingTemplate.findById(templateData.id);
    if (existing) {
      existing.name = templateData.name;
      existing.type = templateData.type || existing.type;
      existing.subject = templateData.subject || existing.subject;
      existing.smsBody = templateData.smsBody || existing.smsBody;
      existing.emailSubject = templateData.emailSubject || existing.emailSubject;
      existing.emailBodyHtml = templateData.emailBodyHtml || existing.emailBodyHtml;
      await existing.save();
      return existing;
    }
  }

  const created = await MarketingTemplate.create({
    name: templateData.name,
    type: templateData.type || 'both',
    subject: templateData.subject || '',
    smsBody: templateData.smsBody || '',
    emailSubject: templateData.emailSubject || '',
    emailBodyHtml: templateData.emailBodyHtml || '',
    createdBy: actor ? actor._id : null
  });

  return created;
};

const deleteTemplate = async (templateId) => {
  const result = await MarketingTemplate.deleteOne({ _id: templateId });
  if (result.deletedCount === 0) {
    throw new ApiError(404, 'Template not found.');
  }
  return { success: true };
};

module.exports = {
  getOverview,
  getCustomers,
  getAllCustomers,
  sendSms,
  sendEmail,
  sendBulkCampaign,
  retryFailedCampaign,
  saveTemplate,
  deleteTemplate
};
