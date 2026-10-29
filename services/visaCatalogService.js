const { FilterXSS } = require('xss');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const VisaChecklist = require('../models/VisaChecklist');
const VisaChecklistEntry = require('../models/VisaChecklistEntry');
const VisaStatusConfig = require('../models/VisaStatusConfig');
const VisaApplication = require('../models/VisaApplication');
const { SYSTEM_STATUSES, systemStatus, isSystemFinal, REQUIRED_TEXT, REOPEN_TO } = require('../config/visa');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const settingService = require('./settingService');

const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

// The checklist text is written in a rich text editor and shown in the dashboard and later on the storefront, so only
// a small set of formatting tags survives. Scripts, event handlers and odd links are removed.
const richTextFilter = new FilterXSS({
  whiteList: { h1: [], h2: [], h3: [], h4: [], p: [], br: [], ul: [], ol: [], li: [], strong: [], b: [], em: [], i: [], u: [], blockquote: [], a: ['href'], img: ['src', 'alt'] },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  css: false
});
const cleanRichText = (html) => richTextFilter.process(html);

const audit = (actor, resource, context, meta) =>
  auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.VISA_CATALOG_CHANGED, resource, ip: context.ip, meta });

const paged = async (model, filter, sort, query) => {
  const { page, limit, skip } = paginate(query);
  const [items, total] = await Promise.all([model.find(filter).sort(sort).skip(skip).limit(limit), model.countDocuments(filter)]);
  return { items, meta: buildMeta(total, page, limit) };
};

// ------------------------------------------------------------------ countries

const listCountries = (query) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = [{ name: { $regex: escapeRegex(query.search), $options: 'i' } }, { code: { $regex: escapeRegex(query.search), $options: 'i' } }];
  return paged(VisaCountry, filter, { displayOrder: 1, name: 1 }, query);
};

const getCountry = async (id) => {
  const country = await VisaCountry.findById(id);
  if (!country) throw new ApiError(404, 'Country not found.', { code: 'COUNTRY_NOT_FOUND' });
  return country;
};

const createCountry = async (actor, body, context = {}) => {
  const nameKey = keyOf(body.name);
  if (await VisaCountry.exists({ nameKey })) throw new ApiError(409, 'A country with this name already exists.', { code: 'COUNTRY_EXISTS' });

  const data = { ...body, nameKey };
  if (data.richChecklist !== undefined) data.richChecklist = cleanRichText(data.richChecklist);
  if (data.displayOrder === undefined) data.displayOrder = (await VisaCountry.countDocuments()) + 1;

  const country = await VisaCountry.create(data);
  await audit(actor, `visa-country:${country._id}`, context, { action: 'created' });
  return country;
};

const updateCountry = async (actor, id, body, context = {}) => {
  const country = await getCountry(id);
  const data = { ...body };

  if (data.name !== undefined) {
    const nameKey = keyOf(data.name);
    if (await VisaCountry.exists({ nameKey, _id: { $ne: country._id } })) throw new ApiError(409, 'A country with this name already exists.', { code: 'COUNTRY_EXISTS' });
    data.nameKey = nameKey;
  }
  if (data.richChecklist !== undefined) data.richChecklist = cleanRichText(data.richChecklist);

  country.set(data);
  await country.save();
  await audit(actor, `visa-country:${country._id}`, context, { action: 'updated' });
  return country;
};

// A country that applications use is paused, never deleted, so no file loses its country. An unused country goes
// together with its visa types and checklists.
const removeCountry = async (actor, id, context = {}) => {
  const country = await getCountry(id);
  const used = await VisaApplication.countDocuments({ country: country._id });
  if (used > 0) {
    throw new ApiError(409, `This country has ${used} application${used === 1 ? '' : 's'}. Pause it instead of deleting it.`, { code: 'COUNTRY_IN_USE' });
  }
  await Promise.all([VisaChecklist.deleteMany({ country: country._id }), VisaChecklistEntry.deleteMany({ country: country._id }), VisaType.deleteMany({ country: country._id })]);
  await country.deleteOne();
  await audit(actor, `visa-country:${country._id}`, context, { action: 'deleted' });
};

// ------------------------------------------------------------------ visa types

const listTypes = (query) => {
  const filter = {};
  if (query.countryId) filter.country = query.countryId;
  if (query.status) filter.status = query.status;
  if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
  return paged(VisaType, filter, { country: 1, name: 1 }, query);
};

const getType = async (id) => {
  const type = await VisaType.findById(id);
  if (!type) throw new ApiError(404, 'Visa type not found.', { code: 'VISA_TYPE_NOT_FOUND' });
  return type;
};

// The input uses countryId, the database stores `country`.
const typeData = async (body) => {
  const { countryId, ...rest } = body;
  const data = { ...rest };
  if (countryId !== undefined) {
    await getCountry(countryId);
    data.country = countryId;
  }
  if (data.currency !== undefined) await settingService.rateFor(data.currency);
  if (data.name !== undefined) data.nameKey = keyOf(data.name);
  return data;
};

const nameTaken = (country, nameKey, exceptId) => VisaType.exists({ country, nameKey, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

const createType = async (actor, body, context = {}) => {
  const data = await typeData(body);
  if (await nameTaken(data.country, data.nameKey)) throw new ApiError(409, 'This country already has a visa type with this name.', { code: 'VISA_TYPE_EXISTS' });
  const type = await VisaType.create(data);
  await audit(actor, `visa-type:${type._id}`, context, { action: 'created' });
  return type;
};

const updateType = async (actor, id, body, context = {}) => {
  const type = await getType(id);
  const data = await typeData(body);
  const country = data.country || type.country;
  const nameKey = data.nameKey || type.nameKey;
  if (await nameTaken(country, nameKey, type._id)) throw new ApiError(409, 'This country already has a visa type with this name.', { code: 'VISA_TYPE_EXISTS' });

  const moved = data.country && String(data.country) !== String(type.country);
  if (moved && (await VisaApplication.exists({ visaType: type._id }))) {
    throw new ApiError(409, 'This visa type has applications, so it cannot move to another country.', { code: 'VISA_TYPE_IN_USE' });
  }
  type.set(data);
  await type.save();
  await audit(actor, `visa-type:${type._id}`, context, { action: 'updated' });
  return type;
};

const removeType = async (actor, id, context = {}) => {
  const type = await getType(id);
  const used = await VisaApplication.countDocuments({ visaType: type._id });
  if (used > 0) {
    throw new ApiError(409, `This visa type has ${used} application${used === 1 ? '' : 's'}. Pause it instead of deleting it.`, { code: 'VISA_TYPE_IN_USE' });
  }
  await Promise.all([VisaChecklist.deleteMany({ visaType: type._id }), VisaChecklistEntry.deleteMany({ visaType: type._id })]);
  await type.deleteOne();
  await audit(actor, `visa-type:${type._id}`, context, { action: 'deleted' });
};

// ------------------------------------------------------------------ checklists

// Shown until staff save their own list for that country, visa type and applicant type.
const DEFAULT_CHECKLIST_ITEMS = [
  { label: 'Passport (valid at least 6 months)', requirement: 'required', submissionMode: 'both' },
  { label: 'Recent Passport-size Photograph', requirement: 'required', submissionMode: 'digital' },
  { label: 'Bank Statement (last 6 months)', requirement: 'required', submissionMode: 'digital' }
].map((item) => ({ active: true, fileFormats: 'PDF/JPG/PNG', maxSizeMb: 10, ...item }));

const checkChecklistTarget = async ({ countryId, visaTypeId }) => {
  const type = await getType(visaTypeId);
  if (String(type.country) !== String(countryId)) throw new ApiError(404, 'This visa type does not belong to that country.', { code: 'VISA_TYPE_NOT_FOUND' });
  return type;
};

const getChecklist = async (params) => {
  await checkChecklistTarget(params);
  const saved = await VisaChecklist.findOne({ country: params.countryId, visaType: params.visaTypeId, applicantType: params.applicantType });
  if (saved) return { ...saved.toJSON(), isDefault: false };
  return { _id: null, country: params.countryId, visaType: params.visaTypeId, applicantType: params.applicantType, items: DEFAULT_CHECKLIST_ITEMS, isDefault: true };
};

const saveChecklist = async (actor, params, { items }, context = {}) => {
  await checkChecklistTarget(params);
  const checklist = await VisaChecklist.findOneAndUpdate(
    { country: params.countryId, visaType: params.visaTypeId, applicantType: params.applicantType },
    { items },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  await audit(actor, `visa-checklist:${checklist._id}`, context, { action: 'saved', items: items.length });
  return { ...checklist.toJSON(), isDefault: false };
};

// ------------------------------------------------------------------ statuses

// Creates the 11 system statuses that are missing. A status staff already edited is never overwritten.
const ensureSystemStatuses = async () => {
  await Promise.all(
    SYSTEM_STATUSES.map((status) =>
      VisaStatusConfig.updateOne(
        { key: status.key },
        {
          $setOnInsert: {
            key: status.key,
            displayName: status.displayName,
            customerMessage: status.customerMessage,
            internalDescription: status.internalDescription,
            category: status.category,
            displayOrder: status.displayOrder,
            active: true,
            isSystem: true
          }
        },
        { upsert: true }
      )
    )
  );
};

const listStatuses = async (query) => {
  await ensureSystemStatuses();
  const filter = {};
  if (query.active !== undefined) filter.active = query.active === 'true';
  const { items, meta } = await paged(VisaStatusConfig, filter, { displayOrder: 1, displayName: 1 }, { limit: 100, ...query });
  // What the dashboard needs to offer only the moves the server accepts: where a system status can go, and what it asks for.
  return {
    items: items.map((status) => {
      const system = systemStatus(status.key);
      return { ...status.toJSON(), transitions: system ? system.transitions : null, final: system ? isSystemFinal(status.key) : ['failed', 'cancelled'].includes(status.category), requiredText: REQUIRED_TEXT[status.key] || null, reopenTarget: status.key === REOPEN_TO };
    }),
    meta
  };
};

const getStatus = async (id) => {
  const status = await VisaStatusConfig.findById(id);
  if (!status) throw new ApiError(404, 'Status not found.', { code: 'STATUS_NOT_FOUND' });
  return status;
};

const slugKey = (name) =>
  keyOf(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);

const createStatus = async (actor, body, context = {}) => {
  await ensureSystemStatuses();
  const key = body.key || slugKey(body.displayName);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new ApiError(422, 'Could not make a key from this name. Enter a key of lower case letters.', { code: 'VALIDATION_ERROR' });
  if (await VisaStatusConfig.exists({ key })) throw new ApiError(409, `A status with the key "${key}" already exists.`, { code: 'STATUS_EXISTS' });

  const status = await VisaStatusConfig.create({ ...body, key, isSystem: false });
  await audit(actor, `visa-status:${status._id}`, context, { action: 'created', key });
  return status;
};

// A system status keeps its key, category and place in the flow. Its wording and order can change.
const updateStatus = async (actor, id, body, context = {}) => {
  const status = await getStatus(id);
  if (status.isSystem) {
    if (body.category !== undefined && body.category !== status.category) throw new ApiError(409, 'The category of a system status cannot change.', { code: 'STATUS_LOCKED' });
    if (body.active === false) throw new ApiError(409, 'A system status cannot be turned off.', { code: 'STATUS_LOCKED' });
  }
  status.set(body);
  await status.save();
  await audit(actor, `visa-status:${status._id}`, context, { action: 'updated' });
  return status;
};

const removeStatus = async (actor, id, context = {}) => {
  const status = await getStatus(id);
  if (status.isSystem) throw new ApiError(409, 'A system status cannot be deleted.', { code: 'STATUS_LOCKED' });
  const used = await VisaApplication.countDocuments({ status: status.key });
  if (used > 0) throw new ApiError(409, `${used} application${used === 1 ? ' is' : 's are'} in this status. Move them first, or turn the status off.`, { code: 'STATUS_IN_USE' });
  await status.deleteOne();
  await audit(actor, `visa-status:${status._id}`, context, { action: 'deleted', key: status.key });
};

module.exports = {
  cleanRichText,
  listCountries,
  getCountry,
  createCountry,
  updateCountry,
  removeCountry,
  listTypes,
  getType,
  createType,
  updateType,
  removeType,
  getChecklist,
  saveChecklist,
  ensureSystemStatuses,
  listStatuses,
  createStatus,
  updateStatus,
  removeStatus
};
