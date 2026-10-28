const VisaQuotation = require('../models/VisaQuotation');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const Partner = require('../models/Partner');
const { APPROVAL_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const events = require('../utils/events');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const counterService = require('./counterService');
const settingService = require('./settingService');
const money = require('./visaMoney');
const { actorOf } = require('./visaShared');

const DEFAULT_VALID_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

const audit = (user, action, quotation, context, meta) => auditService.record({ actorUserId: user.id, action, resource: `visa-quotation:${quotation._id}`, ip: context.ip, meta });

// A draft or sent quotation past its date is "expired". It is worked out each time, not stored, so extending the date
// of a draft brings it back.
const isExpired = (quotation) => ['draft', 'sent'].includes(quotation.status) && quotation.validUntil < new Date();
const present = (quotation) => {
  const data = quotation.toJSON();
  data.storedStatus = data.status;
  if (isExpired(quotation)) data.status = 'expired';
  return data;
};

const find = async (id) => {
  const quotation = await VisaQuotation.findById(id);
  if (!quotation) throw new ApiError(404, 'Quotation not found.', { code: 'QUOTATION_NOT_FOUND' });
  return quotation;
};

// The partners a quotation can be made for, for the "partner" drop-down. Only approved agencies, with id and name only.
const partnerLookup = async ({ search } = {}) => {
  const filter = { approvalStatus: APPROVAL_STATUS.APPROVED };
  if (search) filter.companyName = { $regex: escapeRegex(search), $options: 'i' };
  return Partner.find(filter).select('companyName').sort({ companyName: 1 }).limit(100).lean();
};

const approvedPartner = async (partnerId) => {
  const partner = await Partner.findById(partnerId).select('companyName approvalStatus');
  if (!partner) throw new ApiError(404, 'Partner not found.', { code: 'PARTNER_NOT_FOUND' });
  if (partner.approvalStatus !== APPROVAL_STATUS.APPROVED) throw new ApiError(422, 'This partner is not approved.', { code: 'PARTNER_NOT_APPROVED' });
  return partner;
};

const catalogOf = async (countryId, visaTypeId) => {
  const country = await VisaCountry.findById(countryId);
  if (!country) throw new ApiError(404, 'Country not found.', { code: 'COUNTRY_NOT_FOUND' });
  const type = await VisaType.findById(visaTypeId);
  if (!type || String(type.country) !== String(country._id)) throw new ApiError(404, 'This visa type does not belong to that country.', { code: 'VISA_TYPE_NOT_FOUND' });
  if (country.status !== 'active' || type.status !== 'active') throw new ApiError(422, 'This country or visa type is paused, so it cannot be quoted.', { code: 'CATALOG_PAUSED' });
  return { country, type };
};

// total = net price x quantity + additional fee, worked out in minor units.
const totalsOf = ({ netPrice, quantity, additionalFee, rateToBase }) => {
  const totalMinor = money.toMinor(netPrice) * quantity + money.toMinor(additionalFee);
  const total = money.fromMinor(totalMinor);
  return { total, totalBase: money.round2(total * rateToBase) };
};

const create = async (user, body, context = {}) => {
  const partner = await approvedPartner(body.partnerId);
  const { country, type } = await catalogOf(body.countryId, body.visaTypeId);
  const rateToBase = await settingService.rateFor(type.currency);
  const quantity = body.quantity || 1;
  const additionalFee = body.additionalFee || 0;
  const actor = await actorOf(user);

  const quotation = await VisaQuotation.create({
    number: await counterService.nextNumber('QT', { width: 4 }),
    partner: partner._id,
    partnerName: partner.companyName,
    clientName: body.clientName,
    country: country._id,
    countryName: country.name,
    visaType: type._id,
    visaTypeName: type.name,
    quantity,
    currency: type.currency,
    rateToBase,
    netPrice: type.b2bNetPrice,
    additionalFee,
    ...totalsOf({ netPrice: type.b2bNetPrice, quantity, additionalFee, rateToBase }),
    validUntil: body.validUntil || new Date(Date.now() + DEFAULT_VALID_DAYS * DAY),
    notes: body.notes || '',
    createdBy: actor.id,
    createdByName: actor.name
  });
  await audit(user, AUDIT_ACTIONS.VISA_QUOTATION_CREATED, quotation, context, { number: quotation.number, total: quotation.total });
  return quotation;
};

const list = async (query) => {
  const { page, limit, skip } = paginate(query);
  const now = new Date();
  const filter = {};
  if (query.partnerId) filter.partner = query.partnerId;
  if (query.status === 'expired') Object.assign(filter, { status: { $in: ['draft', 'sent'] }, validUntil: { $lt: now } });
  else if (query.status === 'draft' || query.status === 'sent') Object.assign(filter, { status: query.status, validUntil: { $gte: now } });
  else if (query.status) filter.status = query.status;
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ number: rx }, { partnerName: rx }, { clientName: rx }, { countryName: rx }];
  }
  const [items, total] = await Promise.all([VisaQuotation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), VisaQuotation.countDocuments(filter)]);
  return { items, meta: buildMeta(total, page, limit) };
};

const get = find;

const locked = () => new ApiError(409, 'Only a draft quotation can be changed. It was already sent.', { code: 'QUOTATION_LOCKED' });

// A draft can be changed. The price is copied again only when the visa type changes, so a quote keeps its own price.
const update = async (user, id, body, context = {}) => {
  const quotation = await find(id);
  if (quotation.status !== 'draft') throw locked();

  if (body.partnerId !== undefined) {
    const partner = await approvedPartner(body.partnerId);
    quotation.partner = partner._id;
    quotation.partnerName = partner.companyName;
  }
  if (body.countryId !== undefined || body.visaTypeId !== undefined) {
    const { country, type } = await catalogOf(body.countryId ?? quotation.country, body.visaTypeId ?? quotation.visaType);
    if (String(type._id) !== String(quotation.visaType)) {
      quotation.rateToBase = await settingService.rateFor(type.currency);
      quotation.currency = type.currency;
      quotation.netPrice = type.b2bNetPrice;
    }
    quotation.country = country._id;
    quotation.countryName = country.name;
    quotation.visaType = type._id;
    quotation.visaTypeName = type.name;
  }
  ['clientName', 'quantity', 'additionalFee', 'notes'].forEach((field) => {
    if (body[field] !== undefined) quotation[field] = body[field];
  });
  if (body.validUntil !== undefined) quotation.validUntil = body.validUntil;

  Object.assign(quotation, totalsOf(quotation));
  await quotation.save();
  await audit(user, AUDIT_ACTIONS.VISA_QUOTATION_UPDATED, quotation, context, { fields: Object.keys(body) });
  return quotation;
};

// draft -> sent -> accepted or rejected. Nothing leaves accepted or rejected. A quotation past its date cannot be sent
// or accepted: extend the date of the draft first.
const MOVES = { draft: ['sent'], sent: ['accepted', 'rejected'], accepted: [], rejected: [] };

const changeStatus = async (user, id, { status }, context = {}) => {
  const quotation = await find(id);
  const from = quotation.status;
  if (!MOVES[from].includes(status)) {
    throw new ApiError(409, `A ${from} quotation cannot become ${status}.`, { code: 'INVALID_STATUS_CHANGE' });
  }
  if (isExpired(quotation) && status !== 'rejected') {
    throw new ApiError(422, 'This quotation has expired. Change its valid until date first.', { code: 'QUOTATION_EXPIRED' });
  }

  quotation.status = status;
  quotation.statusChangedAt = new Date();
  await quotation.save();
  await audit(user, AUDIT_ACTIONS.VISA_QUOTATION_STATUS_CHANGED, quotation, context, { from, to: status });
  if (status === 'accepted') events.emit(events.EVENTS.VISA_QUOTATION_ACCEPTED, { quotationId: String(quotation._id), number: quotation.number, partnerId: String(quotation.partner), total: quotation.total, currency: quotation.currency });
  return quotation;
};

const remove = async (user, id, context = {}) => {
  const quotation = await find(id);
  if (quotation.status !== 'draft') throw new ApiError(409, 'Only a draft quotation can be deleted. This one was already sent.', { code: 'QUOTATION_LOCKED' });
  await quotation.deleteOne();
  await audit(user, AUDIT_ACTIONS.VISA_QUOTATION_DELETED, quotation, context, { number: quotation.number });
};

module.exports = { present, partnerLookup, create, list, get, update, changeStatus, remove, isExpired };
