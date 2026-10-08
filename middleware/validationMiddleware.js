const ApiError = require('../utils/ApiError');

// Declarative request validation with zod.
//
// router.post('/', validate({ body: createPostSchema, params: idParam, query: listSchema }), controller.create);
//
// - Unknown keys are stripped, and the parsed (trimmed, lower-cased, typed) values replace
//   req.body / req.query / req.params, so controllers only ever see validated data.
// - For multipart routes, put the multer middleware BEFORE validate so req.body is parsed.
//   If validation fails, the error middleware deletes any files multer already saved.
// - In the query string, an empty value (`?status=&search=`) means "not given", the same as leaving the key out.
//   Tools such as Postman send blank filters, and a blank filter should not be an error.
const PARTS = ['params', 'query', 'body'];

const withoutBlanks = (query = {}) => Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));

const validate = (schemas) => (req, res, next) => {
  const errors = [];

  PARTS.forEach((part) => {
    if (!schemas[part]) return;

    const input = part === 'query' ? withoutBlanks(req.query) : req[part] || {};
    const result = schemas[part].safeParse(input);
    if (result.success) {
      req[part] = result.data;
      return;
    }

    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.');
      errors.push({ field: path ? `${part}.${path}` : part, message: issue.message });
    });
  });

  if (errors.length) {
    const message = errors.map((e) => e.message).join(' ');
    return next(new ApiError(422, message, { errors, code: 'VALIDATION_ERROR' }));
  }

  next();
};

module.exports = validate;
