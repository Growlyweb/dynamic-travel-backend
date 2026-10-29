const VisaApplication = require('../models/VisaApplication');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const VisaStatusConfig = require('../models/VisaStatusConfig');
const Partner = require('../models/Partner');
const User = require('../models/User');
const { ROLES, USER_STATUS, APPROVAL_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { SYSTEM_STATUSES, SERVICE_TYPES, SERVICE_NUMBER_PREFIXES, isSystemFinal } = require('../config/visa');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const events = require('../utils/events');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const counterService = require('./counterService');
const settingService = require('./settingService');
const money = require('./visaMoney');
const { findApplication, actorOf, addTimeline, VISA_FILES } = require('./visaShared');

const POPULATE = { path: 'assignedStaff', select: 'name' };
const load = (id) => VisaApplication.findById(id).populate(POPULATE);

// A passport is the same passport whatever the spacing and case: "ab 123-456" equals "AB123456".
const passportKey = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

// Only an active admin or staff member can be given an application.
const checkStaff = async (userId) => {
  const user = await User.findOne({ _id: userId, role: { $in: [ROLES.ADMIN, ROLES.STAFF] }, status: USER_STATUS.ACTIVE }).select('name');
  if (!user) throw new ApiError(422, 'Choose an active staff member.', { code: 'INVALID_STAFF' });
  return user;
};

const sumVendorLines = (lines) => lines.reduce((sum, line) => sum + money.toMinor(line.price), 0) / 100;

const vendorLinesOf = (list = []) => list.map(({ vendorId = '', name = '', service = 'visa', country = '', price, reference = '', notes = '' }) => ({ vendorId, name, service, country, price, reference, notes }));

// Statuses that end an application: the system ones, and staff-made ones in the failed or cancelled category.
const finalStatusKeys = async () => {
  const custom = await VisaStatusConfig.find({ isSystem: false, category: { $in: ['failed', 'cancelled'] } }).select('key').lean();
  return [...SYSTEM_STATUSES.filter((status) => isSystemFinal(status.key)).map((status) => status.key), ...custom.map((status) => status.key)];
};

// The duplicate rule.
//  - Same passport, country and visa type with an application still open: refused, nothing overrides it.
//  - Same passport and country with any earlier application inside the window (90 days by default), except a rejected
//    one: allowed only with a confirmation note that is kept on the file.
// Re-applying after a rejection is always allowed.
const checkDuplicate = async ({ numberKey, country, visaType, confirmNote }) => {
  const final = await finalStatusKeys();
  const open = await VisaApplication.findOne({ 'passport.numberKey': numberKey, country, visaType, status: { $nin: final } }).select('number status').lean();
  if (open) {
    throw new ApiError(409, `This passport already has an open application for this visa (${open.number}).`, {
      code: 'DUPLICATE_OPEN_APPLICATION',
      errors: [{ field: 'body.passportNumber', message: `Open application ${open.number}.` }]
    });
  }

  const { days } = await settingService.get('visa.duplicateWindowDays');
  if (days === 0) return '';
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recent = await VisaApplication.findOne({ 'passport.numberKey': numberKey, country, status: { $ne: 'rejected' }, createdAt: { $gte: since } })
    .select('number status')
    .sort({ createdAt: -1 })
    .lean();
  if (!recent) return '';
  if (!confirmNote) {
    throw new ApiError(409, `This passport had application ${recent.number} for this country in the last ${days} days. Add a confirmation note to create another.`, {
      code: 'DUPLICATE_RECENT_APPLICATION',
      errors: [{ field: 'body.confirmDuplicate', message: 'A confirmation note is required.' }]
    });
  }
  return confirmNote;
};

// The visa country and type the file is for. A paused one cannot take new applications.
const catalogOf = async (body) => {
  const country = await VisaCountry.findById(body.countryId);
  if (!country) throw new ApiError(404, 'Country not found.', { code: 'COUNTRY_NOT_FOUND' });
  const type = await VisaType.findById(body.visaTypeId);
  if (!type || String(type.country) !== String(country._id)) throw new ApiError(404, 'This visa type does not belong to that country.', { code: 'VISA_TYPE_NOT_FOUND' });
  if (country.status !== 'active' || type.status !== 'active') throw new ApiError(422, 'This country or visa type is paused, so no new application can be created.', { code: 'CATALOG_PAUSED' });
  return { country, type };
};

// Price of a visa file: copied from the visa type, converted when the file is in another currency, and kept on the file.
const visaTerms = async (body, channel, { country, type }) => {
  const currency = body.currency || type.currency;
  const [typeRate, rate] = await Promise.all([settingService.rateFor(type.currency), settingService.rateFor(currency)]);
  const listPrice = channel === 'b2b' ? type.b2bNetPrice : type.b2cPrice;
  const listInCurrency = currency === type.currency ? listPrice : money.convert(listPrice, typeRate, rate);
  const totalAmount = body.totalAmount === undefined ? listInCurrency : body.totalAmount;
  const overridden = money.toMinor(totalAmount) !== money.toMinor(listInCurrency);
  if (overridden && !body.totalOverrideReason) {
    throw new ApiError(422, 'The total is different from the price list. Write the reason.', {
      code: 'OVERRIDE_REASON_REQUIRED',
      errors: [{ field: 'body.totalOverrideReason', message: 'A reason is required when the total changes.' }]
    });
  }
  const numberKey = passportKey(body.passportNumber);
  return {
    currency,
    rate,
    totalAmount,
    listInCurrency,
    overridden,
    price: { currency, rateToBase: rate, b2c: currency === type.currency ? type.b2cPrice : money.convert(type.b2cPrice, typeRate, rate), b2b: currency === type.currency ? type.b2bNetPrice : money.convert(type.b2bNetPrice, typeRate, rate), fees: type.fees },
    duplicateCheck: () => checkDuplicate({ numberKey, country: country._id, visaType: type._id, confirmNote: body.confirmDuplicate })
  };
};

// A ticket, a hotel booking or a tour package has no price list: the total is what staff agreed with the client.
const plainTerms = async (body) => {
  const currency = body.currency || settingService.BASE_CURRENCY;
  const rate = await settingService.rateFor(currency);
  return { currency, rate, totalAmount: body.totalAmount, listInCurrency: body.totalAmount, overridden: false, price: { currency, rateToBase: rate, b2c: 0, b2b: 0 }, duplicateCheck: async () => '' };
};

// Where the client is going, as the short label kept on the file.
const destinationOf = (body) => {
  if (body.serviceType === 'ticket') return body.ticket.arrival;
  if (body.serviceType === 'hotel') return body.hotel.country;
  return [...new Set(body.tour.destinations.map((stop) => stop.country))].join(', ');
};

const create = async (user, body, context = {}) => {
  const serviceType = body.serviceType || 'visa';
  const visa = serviceType === 'visa';
  const catalog = visa ? await catalogOf(body) : null;

  const channel = body.clientType === 'b2b' ? 'b2b' : 'b2c';
  let partner = null;
  if (channel === 'b2b') {
    if (!body.partnerId) throw new ApiError(422, 'Choose the B2B partner.', { code: 'PARTNER_REQUIRED', errors: [{ field: 'body.partnerId', message: 'partnerId is required.' }] });
    partner = await Partner.findById(body.partnerId).select('companyName approvalStatus');
    if (!partner) throw new ApiError(404, 'Partner not found.', { code: 'PARTNER_NOT_FOUND' });
    if (partner.approvalStatus !== APPROVAL_STATUS.APPROVED) throw new ApiError(422, 'This partner is not approved.', { code: 'PARTNER_NOT_APPROVED' });
  }
  if (body.assignedStaff) await checkStaff(body.assignedStaff);

  const { currency, rate, totalAmount, listInCurrency, overridden, price, duplicateCheck } = visa ? await visaTerms(body, channel, catalog) : await plainTerms(body);
  if (money.toMinor(totalAmount) <= 0) throw new ApiError(422, 'The total amount must be above zero.', { code: 'INVALID_AMOUNT' });
  const duplicateNote = await duplicateCheck();

  const actor = await actorOf(user);
  const advance = body.advancePaid || 0;
  const payments = advance > 0 ? [{ amount: advance, method: body.paymentMethod || 'Cash', date: body.paymentDate || new Date(), note: 'Advance at application', enteredBy: actor.id, enteredByName: actor.name }] : [];
  const vendorLines = vendorLinesOf(body.vendorList);
  const account = money.calculate({ total: totalAmount, discount: body.discountAmount || 0, payments, vendorCost: sumVendorLines(vendorLines), rateToBase: rate });

  const passportRequired = visa && catalog.type.passportRequirement === 'physical_required';
  const passportNumberText = body.passportNumber ? body.passportNumber.trim() : '';
  const application = new VisaApplication({
    number: await counterService.nextNumber(SERVICE_NUMBER_PREFIXES[serviceType]),
    serviceType,
    channel,
    partner: partner ? partner._id : undefined,
    partnerName: partner ? partner.companyName : '',
    ...(visa
      ? { country: catalog.country._id, countryName: catalog.country.name, visaType: catalog.type._id, visaTypeName: catalog.type.name }
      : { countryName: destinationOf(body), [serviceType]: body[serviceType] }),
    applicant: {
      fullName: body.name,
      dob: body.dob,
      gender: body.gender,
      nationality: body.nationality,
      mobile: body.phone,
      email: body.email,
      address: body.address,
      city: body.city,
      applicantType: body.applicantType
    },
    passport: { number: passportNumberText, numberKey: passportNumberText ? passportKey(passportNumberText) : '', expiry: body.passportExpiry, issueDate: body.passportIssueDate, issuingCountry: body.passportIssuingCountry },
    service: visa ? { entries: body.entries || catalog.type.entries, duration: body.visaDuration || '' } : { entries: '', duration: '' },
    assignedStaff: body.assignedStaff,
    price,
    account: { ...account, paymentMethod: advance > 0 ? payments[0].method : body.paymentMethod || '', totalOverrideReason: overridden ? body.totalOverrideReason : '' },
    payments,
    vendorLines,
    passportRequirement: visa ? catalog.type.passportRequirement : 'online_processing',
    passportSubmissionMethod: passportRequired ? 'office' : 'online',
    passportStatus: passportRequired ? 'not_received' : 'not_required',
    duplicateNote,
    createdBy: actor.id,
    statusHistory: [{ status: 'submitted', at: new Date() }]
  });

  addTimeline(application, { event: 'Application Created', message: 'Application created successfully.', visibility: 'both', actor });
  if (overridden) addTimeline(application, { event: 'Price changed', message: `Total set to ${totalAmount} ${currency} instead of ${listInCurrency}. Reason: ${body.totalOverrideReason}`, visibility: 'internal', actor });
  if (duplicateNote) addTimeline(application, { event: 'Duplicate confirmed', message: duplicateNote, visibility: 'internal', actor });
  if (advance > 0) addTimeline(application, { event: 'Payment received', message: `${advance} ${currency} by ${payments[0].method}.`, visibility: 'internal', actor });
  if (body.assignedStaff) addTimeline(application, { event: 'Assigned to Staff', message: 'Assigned when the application was created.', visibility: 'internal', actor });

  await application.save();
  await auditService.record({ actorUserId: user.id, action: AUDIT_ACTIONS.VISA_APPLICATION_CREATED, resource: `visa-application:${application._id}`, ip: context.ip, meta: { number: application.number, serviceType } });
  events.emit(events.EVENTS.VISA_APPLICATION_CREATED, { applicationId: String(application._id), number: application.number });
  if (advance > 0) events.emit(events.EVENTS.VISA_PAYMENT_RECORDED, { applicationId: String(application._id), paymentId: String(application.payments[0]._id), number: application.number, amount: advance, currency });
  return load(application._id);
};

// ------------------------------------------------------------------ reading

const list = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.serviceType) filter.serviceType = query.serviceType === 'visa' ? VISA_FILES : query.serviceType;
  if (query.status) filter.status = query.status;
  if (query.countryId) filter.country = query.countryId;
  if (query.channel) filter.channel = query.channel;
  if (query.paymentStatus) filter['account.paymentStatus'] = query.paymentStatus;
  if (query.staff === 'unassigned') filter.assignedStaff = { $exists: false };
  else if (query.staff) filter.assignedStaff = query.staff;
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: new Date(query.to.getTime() + 24 * 60 * 60 * 1000 - 1) } : {}) };
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    const key = passportKey(query.search);
    filter.$or = [
      { number: rx },
      { 'applicant.fullName': rx },
      { 'applicant.mobile': rx },
      { 'applicant.email': rx },
      { countryName: rx },
      { partnerName: rx },
      { 'hotel.name': rx },
      { 'ticket.departure': rx },
      { 'ticket.arrival': rx },
      { 'tour.packageName': rx },
      ...(key ? [{ 'passport.numberKey': { $regex: escapeRegex(key) } }] : [])
    ];
  }

  const [items, total] = await Promise.all([
    VisaApplication.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(POPULATE),
    VisaApplication.countDocuments(filter)
  ]);
  return { items, meta: buildMeta(total, page, limit) };
};

const get = async (id) => {
  const application = await load(id);
  if (!application) throw new ApiError(404, 'Visa application not found.', { code: 'APPLICATION_NOT_FOUND' });
  return application;
};

// ------------------------------------------------------------------ editing

// Edits the file. Status and payments have their own routes. Changing the total or the discount recalculates the
// money, and is refused if it would leave the payments received above the amount to pay.
const update = async (user, id, body, context = {}) => {
  const application = await findApplication(id);
  const actor = await actorOf(user);
  const changes = [];

  const a = application.applicant;
  const map = { name: 'fullName', phone: 'mobile', email: 'email', dob: 'dob', gender: 'gender', nationality: 'nationality', address: 'address', city: 'city', applicantType: 'applicantType' };
  Object.entries(map).forEach(([field, target]) => {
    if (body[field] === undefined || a[target] === body[field]) return;
    a[target] = body[field];
    changes.push(target);
  });

  const visa = application.serviceType === 'visa';

  if (body.passportNumber !== undefined) {
    const numberKey = passportKey(body.passportNumber);
    if (visa && numberKey !== application.passport.numberKey) {
      const final = await finalStatusKeys();
      const clash = await VisaApplication.exists({ _id: { $ne: application._id }, 'passport.numberKey': numberKey, country: application.country, visaType: application.visaType, status: { $nin: final } });
      if (clash) throw new ApiError(409, 'Another open application already uses this passport for this visa.', { code: 'DUPLICATE_OPEN_APPLICATION' });
    }
    application.passport.number = body.passportNumber.trim();
    application.passport.numberKey = numberKey;
    changes.push('passport number');
  }
  if (body.passportExpiry !== undefined) application.passport.expiry = body.passportExpiry;
  if (body.passportIssueDate !== undefined) application.passport.issueDate = body.passportIssueDate;
  if (body.passportIssuingCountry !== undefined) application.passport.issuingCountry = body.passportIssuingCountry;
  if (visa && body.entries !== undefined) application.service.entries = body.entries;
  if (visa && body.visaDuration !== undefined) application.service.duration = body.visaDuration;

  if (body.assignedStaff !== undefined) {
    if (body.assignedStaff === null) {
      if (application.assignedStaff) addTimeline(application, { event: 'Unassigned', message: 'Taken off its staff member.', visibility: 'internal', actor });
      application.assignedStaff = undefined;
    } else if (String(application.assignedStaff) !== String(body.assignedStaff)) {
      const staff = await checkStaff(body.assignedStaff);
      application.assignedStaff = staff._id;
      addTimeline(application, { event: 'Assigned to Staff', message: `Assigned to ${staff.name}.`, visibility: 'internal', actor });
    }
  }

  const moneyChanged = ['totalAmount', 'discountAmount', 'vendorList'].some((field) => body[field] !== undefined);
  if (moneyChanged) {
    if (body.vendorList !== undefined) application.vendorLines = vendorLinesOf(body.vendorList);
    const account = application.account;
    const total = body.totalAmount === undefined ? account.totalAmount : body.totalAmount;
    const channelPrice = application.channel === 'b2b' ? application.price.b2b : application.price.b2c;
    if (body.totalAmount !== undefined && money.toMinor(total) !== money.toMinor(account.totalAmount)) {
      if (money.toMinor(total) <= 0) throw new ApiError(422, 'The total amount must be above zero.', { code: 'INVALID_AMOUNT' });
      // Only a visa has a price list to differ from.
      const offList = visa && money.toMinor(total) !== money.toMinor(channelPrice);
      if (offList && !body.totalOverrideReason) {
        throw new ApiError(422, 'The total is different from the price list. Write the reason.', {
          code: 'OVERRIDE_REASON_REQUIRED',
          errors: [{ field: 'body.totalOverrideReason', message: 'A reason is required when the total changes.' }]
        });
      }
      addTimeline(application, { event: 'Price changed', message: `Total changed from ${account.totalAmount} to ${total}.${body.totalOverrideReason ? ` Reason: ${body.totalOverrideReason}` : ''}`, visibility: 'internal', actor });
      account.totalOverrideReason = offList ? body.totalOverrideReason : '';
    }
    if (body.discountAmount !== undefined && money.toMinor(body.discountAmount) !== money.toMinor(account.discountAmount)) {
      addTimeline(application, { event: 'Discount changed', message: `Discount changed from ${account.discountAmount} to ${body.discountAmount}.`, visibility: 'internal', actor });
    }
    const next = money.calculate({
      total,
      discount: body.discountAmount === undefined ? account.discountAmount : body.discountAmount,
      payments: application.payments,
      vendorCost: sumVendorLines(application.vendorLines),
      rateToBase: application.price.rateToBase
    });
    Object.assign(account, next);
  }

  if (changes.length) addTimeline(application, { event: 'Details updated', message: `Changed: ${changes.join(', ')}.`, visibility: 'internal', actor });
  await application.save();
  await auditService.record({ actorUserId: user.id, action: AUDIT_ACTIONS.VISA_APPLICATION_UPDATED, resource: `visa-application:${application._id}`, ip: context.ip, meta: { fields: Object.keys(body) } });
  events.emit(events.EVENTS.VISA_APPLICATION_UPDATED, { applicationId: String(application._id), number: application.number });
  return load(application._id);
};

const addNote = async (user, id, { type, text }) => {
  const application = await findApplication(id);
  const actor = await actorOf(user);
  const note = { by: actor.name, byUserId: actor.id, text };
  if (type === 'customer') application.customerNotes.push(note);
  else application.internalNotes.push(note);
  addTimeline(application, { event: type === 'customer' ? 'Customer Note Added' : 'Internal Note Added', message: text, visibility: type === 'customer' ? 'customer' : 'internal', actor });
  await application.save();
  return load(application._id);
};

// ------------------------------------------------------------------ staff lookup and statistics

// A small list for the "assign to" drop-down. Only active admins and staff, and only their id and name.
const staffLookup = async ({ search } = {}) => {
  const filter = { role: { $in: [ROLES.ADMIN, ROLES.STAFF] }, status: USER_STATUS.ACTIVE };
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };
  return User.find(filter).select('name role').sort({ name: 1 }).limit(100).lean();
};

const APPROVED = ['approved', 'passport_ready', 'completed'];
const camel = (key) => key.replace(/_([a-z])/g, (m, c) => c.toUpperCase());

const dashboard = async () => {
  const [byStatus, byChannel, byService, unassigned, perCountry, recent, countries] = await Promise.all([
    VisaApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    VisaApplication.aggregate([{ $group: { _id: '$channel', count: { $sum: 1 } } }]),
    VisaApplication.aggregate([{ $group: { _id: { $ifNull: ['$serviceType', 'visa'] }, count: { $sum: 1 } } }]),
    VisaApplication.countDocuments({ assignedStaff: { $exists: false }, status: { $nin: await finalStatusKeys() } }),
    VisaApplication.aggregate([
      // The country table is about visas: the other services have no visa country.
      { $match: { country: { $exists: true } } },
      { $group: { _id: '$country', applications: { $sum: 1 }, approved: { $sum: { $cond: [{ $in: ['$status', APPROVED] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } } } }
    ]),
    VisaApplication.find().sort({ createdAt: -1 }).limit(10).populate(POPULATE),
    VisaCountry.find().select('name flag').lean()
  ]);

  const counts = Object.fromEntries(byStatus.map((row) => [row._id, row.count]));
  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const result = { total };
  SYSTEM_STATUSES.forEach((status) => {
    result[camel(status.key)] = counts[status.key] || 0;
  });
  const channels = Object.fromEntries(byChannel.map((row) => [row._id, row.count]));
  const approved = APPROVED.reduce((sum, key) => sum + (counts[key] || 0), 0);
  const decided = approved + (counts.rejected || 0);

  const names = Object.fromEntries(countries.map((country) => [String(country._id), country]));
  return {
    ...result,
    b2c: channels.b2c || 0,
    b2b: channels.b2b || 0,
    services: Object.fromEntries(SERVICE_TYPES.map((type) => [type, (byService.find((row) => row._id === type) || {}).count || 0])),
    unassigned,
    approvedTotal: approved,
    decisionRate: decided ? Math.round((approved / decided) * 100) : 0,
    countries: perCountry
      .map((row) => {
        const decidedHere = row.approved + row.rejected;
        const country = names[String(row._id)];
        return { countryId: row._id, country: country ? country.name : 'Unknown', flag: country ? country.flag : '🌐', applications: row.applications, approved: row.approved, approvalRate: decidedHere ? Math.round((row.approved / decidedHere) * 100) : 0 };
      })
      .sort((a, b) => b.applications - a.applications),
    recent
  };
};

module.exports = { create, list, get, update, addNote, staffLookup, dashboard, passportKey, finalStatusKeys, checkStaff };
