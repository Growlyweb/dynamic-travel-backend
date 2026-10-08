const TourCategory = require('../models/TourCategory');
const Tour = require('../models/Tour');
const { AUDIT_ACTIONS, TOUR_STATUS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const escapeRegex = require('../utils/escapeRegex');
const paginate = require('../utils/pagination');
const { buildMeta } = require('../utils/pagination');
const auditService = require('./auditService');
const { isTourManager } = require('./tourAccess');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// "Beach  &   Resort" and "beach & resort" are the same name.
const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const slugOf = (name) =>
  keyOf(name)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// "Beach & Resort" and "Beach and Resort" give the same slug, so the second gets -2.
const freeSlug = async (name) => {
  const base = slugOf(name) || 'category';
  let slug = base;
  for (let n = 2; await TourCategory.exists({ slug }); n += 1) slug = `${base}-${n}`;
  return slug;
};

// Finds a category by its id, or by the id the frontend used before (cat_beach). Null when missing.
const findByAnyId = (id) => (OBJECT_ID.test(id) ? TourCategory.findById(id) : TourCategory.findOne({ legacyId: id }));

const list = async (query, user) => {
  const { page, limit, skip } = paginate(query);

  const filter = {};
  // The public sees active categories only. A tour manager may ask for the rest too.
  if (!(isTourManager(user) && query.includeInactive === 'true')) filter.isActive = true;
  if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: 'i' };

  const [items, total] = await Promise.all([
    TourCategory.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    TourCategory.countDocuments(filter)
  ]);

  return { items, meta: buildMeta(total, page, limit) };
};

const get = async (id, user) => {
  const category = await findByAnyId(id);
  if (!category || (!category.isActive && !isTourManager(user))) throw new ApiError(404, 'Category not found.');
  return category;
};

// A name that already exists, in any letter case, returns the existing record instead of a second one.
// `created` tells the controller whether to answer 201 or 200.
const create = async (actor, { name }, context = {}) => {
  const nameKey = keyOf(name);
  let category = await TourCategory.findOne({ nameKey });
  let created = false;
  let reactivated = false;

  if (!category) {
    try {
      category = await TourCategory.create({ name, nameKey, slug: await freeSlug(name) });
      created = true;
    } catch (err) {
      // Two requests with the same name arrived together: the other one won, so return that record.
      if (err.code !== 11000) throw err;
      category = await TourCategory.findOne({ nameKey });
      if (!category) throw err;
    }
  } else if (!category.isActive) {
    // Asking for a name that was removed brings that category back rather than adding a duplicate.
    category.isActive = true;
    await category.save();
    reactivated = true;
  }

  if (created || reactivated) {
    await auditService.record({
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.CATEGORY_CREATED,
      resource: `tour-category:${category._id}`,
      ip: context.ip,
      meta: reactivated ? { reactivated: true } : undefined
    });
  }
  return { category, created };
};

// "Delete" switches the category off. A category that active tours still use stays, so no tour is left
// pointing at something the public cannot see.
const deactivate = async (actor, id, context = {}) => {
  const category = await findByAnyId(id);
  if (!category) throw new ApiError(404, 'Category not found.');
  if (!category.isActive) return category;

  const inUse = await Tour.countDocuments({ category: category._id, status: { $ne: TOUR_STATUS.ARCHIVED } });
  if (inUse > 0) {
    throw new ApiError(409, `This category is used by ${inUse} tour${inUse === 1 ? '' : 's'}. Move or archive them first.`, {
      code: 'CATEGORY_IN_USE'
    });
  }

  category.isActive = false;
  await category.save();
  await auditService.record({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.CATEGORY_DEACTIVATED,
    resource: `tour-category:${category._id}`,
    ip: context.ip
  });
  return category;
};

module.exports = { list, get, create, deactivate, findByAnyId, keyOf, slugOf };
