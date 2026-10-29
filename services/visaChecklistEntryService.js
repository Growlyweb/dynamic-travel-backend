const VisaChecklistEntry = require('../models/VisaChecklistEntry');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const counterService = require('./counterService');
const { cleanRichText } = require('./visaCatalogService');

// The "Visa Check List" pages: one for each country and visa type, written in rich text for staff to read.

const POPULATE = [
  { path: 'country', select: 'name code flag' },
  { path: 'visaType', select: 'name entries processingTime' }
];

const audit = (actor, entry, context, meta) =>
  auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.VISA_CATALOG_CHANGED, resource: `visa-checklist-entry:${entry._id}`, ip: context.ip, meta });

// What the dashboard reads: the page with its country and visa type spelled out.
const present = (entry) => {
  const data = entry.toJSON();
  const { country, visaType } = data;
  return {
    ...data,
    country: country ? country._id : undefined,
    countryName: country ? country.name : '',
    countryCode: country ? country.code : '',
    flag: country ? country.flag : '',
    visaType: visaType ? visaType._id : undefined,
    visaTypeName: visaType ? visaType.name : '',
    entries: visaType ? visaType.entries : ''
  };
};

const load = (id) => VisaChecklistEntry.findById(id).populate(POPULATE);

const find = async (id) => {
  const entry = await load(id);
  if (!entry) throw new ApiError(404, 'Checklist not found.', { code: 'CHECKLIST_ENTRY_NOT_FOUND' });
  return entry;
};

const list = async (query) => {
  const { page, limit, skip } = paginate(query);
  const filter = {};
  if (query.countryId) filter.country = query.countryId;
  if (query.status) filter.status = query.status;
  if (query.entries) filter.visaType = { $in: await VisaType.find({ entries: query.entries }).distinct('_id') };
  if (query.search) {
    const rx = { $regex: escapeRegex(query.search), $options: 'i' };
    const countries = await VisaCountry.find({ name: rx }).distinct('_id');
    filter.$or = [{ title: rx }, { code: rx }, { country: { $in: countries } }];
  }

  const [items, total] = await Promise.all([
    VisaChecklistEntry.find(filter).sort({ displayOrder: 1, createdAt: 1 }).skip(skip).limit(limit).populate(POPULATE),
    VisaChecklistEntry.countDocuments(filter)
  ]);
  return { items: items.map(present), meta: buildMeta(total, page, limit) };
};

const get = async (id) => present(await find(id));

const create = async (actor, body, context = {}) => {
  const country = await VisaCountry.findById(body.countryId);
  if (!country) throw new ApiError(404, 'Country not found.', { code: 'COUNTRY_NOT_FOUND' });
  const type = await VisaType.findById(body.visaTypeId);
  if (!type || String(type.country) !== String(country._id)) throw new ApiError(404, 'This visa type does not belong to that country.', { code: 'VISA_TYPE_NOT_FOUND' });
  if (await VisaChecklistEntry.exists({ country: country._id, visaType: type._id })) {
    throw new ApiError(409, 'This country and visa type already has a checklist.', { code: 'CHECKLIST_ENTRY_EXISTS', errors: [{ field: 'body.visaTypeId', message: 'A checklist already exists for this visa type.' }] });
  }

  const seq = await counterService.next('VI');
  const entry = await VisaChecklistEntry.create({
    code: `VI${String(seq).padStart(4, '0')}`,
    country: country._id,
    visaType: type._id,
    title: body.title,
    description: cleanRichText(body.description || ''),
    processingTime: body.processingTime === undefined ? type.processingTime : body.processingTime,
    media: body.media || [],
    displayOrder: body.displayOrder === undefined ? (await VisaChecklistEntry.countDocuments()) + 1 : body.displayOrder,
    status: body.status || 'active'
  });
  await audit(actor, entry, context, { action: 'created' });
  return get(entry._id);
};

const update = async (actor, id, body, context = {}) => {
  const entry = await find(id);
  const data = { ...body };
  if (data.description !== undefined) data.description = cleanRichText(data.description);
  entry.set(data);
  await entry.save();
  await audit(actor, entry, context, { action: 'updated', fields: Object.keys(body) });
  return get(entry._id);
};

// A checklist page is only reading material, so it can be deleted at any time.
const remove = async (actor, id, context = {}) => {
  const entry = await find(id);
  await entry.deleteOne();
  await audit(actor, entry, context, { action: 'deleted' });
};

module.exports = { list, get, create, update, remove };
