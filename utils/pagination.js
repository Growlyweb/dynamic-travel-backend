const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// Turns ?page=2&limit=20 into { page, limit, skip }. Limit is capped so a
// client cannot ask for the whole collection in one request.
const paginate = (query = {}) => {
  const page = parseInt(query.page, 10) > 0 ? parseInt(query.page, 10) : 1;
  const requested = parseInt(query.limit, 10) > 0 ? parseInt(query.limit, 10) : DEFAULT_LIMIT;
  const limit = Math.min(requested, MAX_LIMIT);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const buildMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.max(Math.ceil(total / limit), 1)
});

module.exports = paginate;
module.exports.buildMeta = buildMeta;
