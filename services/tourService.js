const Tour = require('../models/Tour');
const { AUDIT_ACTIONS, TOUR_STATUS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const tourCategoryService = require('./tourCategoryService');
const { viewerOf } = require('./tourAccess');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const CATEGORY_FIELDS = 'name slug legacyId isActive';
const SORTS = { createdAt: 'createdAt', price: 'price', durationDays: 'durationDays', rating: 'rating' };

const invalid = (field, message) => new ApiError(422, message, { code: 'VALIDATION_ERROR', errors: [{ field: `body.${field}`, message }] });

// What leaves the API. b2bPrice is removed for anyone who may not see it, so no route can forget to.
// Works on a lean object (a plain copy), never on a live document.
const present = (tour, viewer) => {
  const out = { ...tour };
  delete out.__v;
  if (!viewer.canSeeB2bPrice) delete out.b2bPrice;
  out.itinerary = [...(out.itinerary || [])].sort((a, b) => a.day - b.day);
  return out;
};

// Rules that depend on several fields at once. `tour` is the full tour as it will be saved.
const checkRules = (tour) => {
  const days = tour.itinerary.map((item) => item.day);
  if (days.some((day) => day > tour.durationDays)) {
    throw invalid('itinerary', `An itinerary day cannot be after the last day of the tour (${tour.durationDays}).`);
  }
  if (tour.status === TOUR_STATUS.PUBLISHED && days.length === 0) {
    throw invalid('itinerary', 'A published tour needs at least one itinerary day.');
  }
};

// The category on a tour must exist and be switched on. Accepts this API's id or the old frontend id.
const resolveCategory = async (id) => {
  const category = await tourCategoryService.findByAnyId(id);
  if (!category || !category.isActive) throw invalid('category', 'That category does not exist or is not active.');
  return category._id;
};

// "cat_beach,64b7..." to a list of real ids. A name nobody has simply matches nothing.
const categoryIdsOf = async (text) => {
  const found = await Promise.all(text.split(',').map((part) => part.trim()).filter(Boolean).map((part) => tourCategoryService.findByAnyId(part)));
  return found.filter(Boolean).map((category) => category._id);
};

const findDoc = (id) => (OBJECT_ID.test(id) ? Tour.findById(id) : Tour.findOne({ legacyId: id }));

const loadPresented = async (id, viewer) => {
  const lean = await (OBJECT_ID.test(id) ? Tour.findById(id) : Tour.findOne({ legacyId: id })).populate('category', CATEGORY_FIELDS).lean();
  return lean ? present(lean, viewer) : null;
};

// ---------------------------------------------------------------- reads

const list = async (query, user) => {
  const viewer = await viewerOf(user);
  const { page, limit, skip } = paginate(query);
  const filter = {};

  // The public sees published tours only (a `status` they send is ignored). Managers see every status
  // except archived unless they ask for it.
  if (viewer.isManager) filter.status = query.status || { $ne: TOUR_STATUS.ARCHIVED };
  else filter.status = TOUR_STATUS.PUBLISHED;

  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: 'i' };
    filter.$or = [{ name: pattern }, { destination: pattern }, { country: pattern }];
  }
  if (query.country) filter.country = { $regex: `^${escapeRegex(query.country)}$`, $options: 'i' };
  if (query.destination) filter.destination = { $regex: escapeRegex(query.destination), $options: 'i' };
  if (query.category) filter.category = { $in: await categoryIdsOf(query.category) };
  if (query.durationDays) filter.durationDays = Number(query.durationDays);
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  const sortKey = (query.sort || '-createdAt').replace(/^-/, '');
  const sort = { [SORTS[sortKey]]: (query.sort || '-createdAt').startsWith('-') ? -1 : 1, _id: -1 };

  const [items, total] = await Promise.all([
    Tour.find(filter).populate('category', CATEGORY_FIELDS).sort(sort).skip(skip).limit(limit).lean(),
    Tour.countDocuments(filter)
  ]);

  return { items: items.map((tour) => present(tour, viewer)), meta: buildMeta(total, page, limit) };
};

const get = async (id, user) => {
  const viewer = await viewerOf(user);
  const tour = await loadPresented(id, viewer);
  // A tour the caller may not see answers exactly like one that does not exist.
  if (!tour || (!viewer.isManager && tour.status !== TOUR_STATUS.PUBLISHED)) throw new ApiError(404, 'Tour not found.');
  return tour;
};

// ---------------------------------------------------------------- writes (tour managers only, enforced by the route)

const create = async (actor, data, context = {}) => {
  const { category, ...rest } = data;
  const tour = { ...rest, ...(category ? { category: await resolveCategory(category) } : {}) };
  checkRules(tour);

  const doc = await Tour.create(tour);
  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.TOUR_CREATED,
    resource: `tour:${doc._id}`,
    ip: context.ip,
    meta: { status: doc.status }
  });
  return loadPresented(String(doc._id), await viewerOf(actor));
};

const update = async (actor, id, patch, context = {}) => {
  const doc = await findDoc(id);
  if (!doc) throw new ApiError(404, 'Tour not found.');

  const { category, ...rest } = patch;
  const changes = { ...rest, ...(category ? { category: await resolveCategory(category) } : {}) };
  checkRules({ ...doc.toObject(), ...changes });

  doc.set(changes);
  await doc.save();
  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.TOUR_UPDATED,
    resource: `tour:${doc._id}`,
    ip: context.ip,
    meta: { fields: Object.keys(patch) } // names only, never values
  });
  return loadPresented(String(doc._id), await viewerOf(actor));
};

// "Delete" archives the tour: it leaves every public list and nothing that points at it breaks.
const archive = async (actor, id, context = {}) => {
  const doc = await findDoc(id);
  if (!doc) throw new ApiError(404, 'Tour not found.');

  if (doc.status !== TOUR_STATUS.ARCHIVED) {
    doc.status = TOUR_STATUS.ARCHIVED;
    await doc.save();
    await auditService.record({ actorUserId: actor.id, action: AUDIT_ACTIONS.TOUR_ARCHIVED, resource: `tour:${doc._id}`, ip: context.ip });
  }
  return loadPresented(String(doc._id), await viewerOf(actor));
};

module.exports = { list, get, create, update, archive, present };
