// Building blocks for the OpenAPI document: reusable schemas, example data and small helpers.
// Request bodies, query strings and path parameters are NOT written here: they are exported from the
// zod schemas in validations/, so the documentation can never disagree with what the API validates.
const { z } = require('zod');

const ID = '64b7f0f0f0f0f0f0f0f0f0f0';
const NOW = '2026-10-03T06:51:28.261Z';

// ---------------------------------------------------------------- zod -> OpenAPI JSON Schema

const PASSWORD_RULES =
  'At least 8 and at most 64 characters, with an upper case letter, a lower case letter, a number and a symbol.';

const decorate = (name, prop) => {
  if (prop.allOf && prop.minLength === 8) {
    // Four separate rules (lower, upper, number, symbol) become ONE pattern. Same meaning, but a list of
    // `allOf` rules makes Postman invent filler text instead of showing the example.
    delete prop.allOf;
    prop.pattern = '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,64}$';
    prop.description = PASSWORD_RULES;
    // No `format: password`: Postman blanks out the example of a password-format field.
    prop.example = prop.example || 'Str0ng!Pass';
  }
  if (prop.format === 'email') {
    delete prop.pattern; // the generated email regex is long and adds nothing for a reader
    prop.example = prop.example || 'rahim@example.com';
  }
  return prop;
};

const toSchema = (zodSchema) => {
  const json = z.toJSONSchema(zodSchema, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' });
  delete json.$schema;
  Object.entries(json.properties || {}).forEach(([name, prop]) => decorate(name, prop));
  return json;
};

const PARAM_DOCS = {
  page: 'Page number, starting at 1. Default 1.',
  limit: 'Items per page. Default 10, maximum 100.',
  search: 'Free text. Matched literally (special characters are escaped), case-insensitive.',
  role: 'Only accounts with this role.',
  status: 'Only accounts with this status.',
  approvalStatus: 'Only partners in this approval state.',
  action: 'Audit action, for example LOGIN or ROLE_CHANGED.',
  actorUserId: 'Only events caused by this user (ObjectId).',
  targetUserId: 'Only events about this user (ObjectId).',
  id: 'Resource id (MongoDB ObjectId, 24 hex characters).',
  docId: 'Document id (MongoDB ObjectId), from the partner\'s `documents` list.',
  partnerId: 'Partner id (MongoDB ObjectId), the `_id` of the Partner record.'
};

// zod object -> list of OpenAPI parameters (query or path)
const parametersFrom = (zodObject, where, examples = {}, docs = {}) => {
  const json = toSchema(zodObject);
  return Object.entries(json.properties || {}).map(([name, schema]) => {
    const param = {
      name,
      in: where,
      required: where === 'path' || (json.required || []).includes(name),
      description: docs[name] || PARAM_DOCS[name] || name,
      schema
    };
    // An empty query value is accepted by the API (it means "not given"), so the documented schema allows it.
    // This also lets a blank example survive the Postman import instead of being swapped for a random value.
    if (where === 'query' && examples[name] === '') {
      if (schema.enum) schema.enum = [...schema.enum, ''];
      if (schema.pattern) schema.pattern = `^$|${schema.pattern}`;
    }
    if (examples[name] !== undefined) param.example = examples[name];
    else if (where === 'path') param.example = ID;
    return param;
  });
};

// ---------------------------------------------------------------- reusable response shapes

const SUCCESS = (message, data, extra = {}) => ({ success: true, message, ...(data !== undefined ? { data } : {}), ...extra });

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = (example, extra = {}) => ({ type: 'string', ...(example !== undefined ? { example } : {}), ...extra });
const bool = (example) => ({ type: 'boolean', example });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items) => ({ type: 'array', items });

// { success, message, data?, meta?, pagination? } wrapped around a data schema
const envelope = (dataSchema, { paginated = false, message = 'OK' } = {}) =>
  obj(
    {
      success: bool(true),
      message: str(message),
      ...(dataSchema ? { data: dataSchema } : {}),
      ...(paginated ? { meta: ref('PaginationMeta'), pagination: { description: 'The same object as `meta`, under the name the tour handoff uses.', ...ref('PaginationMeta') } } : {})
    },
    ['success', 'message']
  );

const ROLES_ENUM = ['ADMIN', 'STAFF', 'B2B', 'B2C'];
const STATUS_ENUM = ['PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE'];
const APPROVAL_ENUM = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const DOC_TYPE_ENUM = ['TRADE_LICENSE', 'BUSINESS_CARD', 'OTHER'];
const DOC_STATUS_ENUM = ['PENDING', 'VERIFIED', 'REJECTED'];
const AUDIT_ENUM = [
  'REGISTER', 'EMAIL_VERIFIED', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PASSWORD_CHANGED',
  'PASSWORD_RESET', 'USER_CREATED', 'ACCOUNT_ACTIVATED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_STATUS_CHANGED', 'ROLE_CHANGED',
  'PERMISSION_CHANGED', 'B2B_APPROVED', 'B2B_REJECTED', 'B2B_STATUS_CHANGED', 'DOCUMENT_REVIEWED', 'PROFILE_UPDATED',
  'CATEGORY_CREATED', 'CATEGORY_DEACTIVATED', 'TOUR_CREATED', 'TOUR_UPDATED', 'TOUR_ARCHIVED', 'CUSTOM_TOUR_REQUESTED', 'CUSTOM_TOUR_STATUS_CHANGED'
];
const TOUR_STATUS_ENUM = ['draft', 'published', 'unpublished', 'archived'];
const CURRENCY_ENUM = ['BDT', 'USD', 'EUR'];
const REQUEST_STATUS_ENUM = ['NEW', 'IN_REVIEW', 'QUOTED', 'CONFIRMED', 'CANCELLED'];

// ---------------------------------------------------------------- example data

const exUser = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c6722a',
  name: 'Rahim Uddin',
  email: 'rahim@example.com',
  phone: '+8801712345678',
  role: 'B2C',
  permissions: [],
  status: 'ACTIVE',
  emailVerified: true,
  phoneVerified: false,
  authProvider: 'local',
  lastLoginAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

const exDocument = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c67230',
  type: 'TRADE_LICENSE',
  originalName: 'trade-license.pdf',
  mimeType: 'application/pdf',
  size: 184320,
  status: 'PENDING',
  reviewNote: '',
  uploadedAt: NOW,
  ...over
});

const exPartner = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c6722f',
  userId: '6ac0a5f0eebc510147c6722e',
  companyName: 'Sky Travels Ltd',
  licenseNo: 'TL-2024-0042',
  businessType: 'Travel agency',
  address: '45 Motijheel, Dhaka',
  documents: [exDocument()],
  approvalStatus: 'PENDING',
  reviewNote: '',
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

const exCategory = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c67240',
  name: 'Beach & Resort',
  slug: 'beach-and-resort',
  legacyId: 'cat_beach',
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

const exItinerary = [
  { day: 1, title: 'Arrival & Beach Sunset', description: 'Check-in, relax at Laboni Beach, enjoy sunset.' },
  { day: 2, title: 'Inani Beach & Himchari', description: 'Day trip to Inani rocky beach and Himchari waterfall.' },
  { day: 3, title: 'Departure', description: 'Morning shopping at Burmese market, airport transfer.' }
];

// b2bPrice is left out of the default example because the public does not receive it.
const exTour = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c67241',
  legacyId: 'tour_205',
  name: "Cox's Bazar Beach Escape",
  country: 'Bangladesh',
  destination: "Cox's Bazar, Bangladesh",
  category: { _id: '6ac0a5f0eebc510147c67240', name: 'Beach & Resort', slug: 'beach-and-resort', legacyId: 'cat_beach', isActive: true },
  durationDays: 3,
  priceCurrency: 'BDT',
  price: 12500,
  seats: 25,
  status: 'published',
  rating: 4.9,
  coverImage: 'https://picsum.photos/seed/coxs-bazar/900/560',
  gallery: [],
  description: 'Experience the world longest natural sea beach with luxury resort stay and fresh seafood.',
  included: ['2 nights hotel stay', 'Breakfast included', 'Beach tour & sunset view'],
  excluded: ['Personal expenses', 'Shopping'],
  hotels: ['Ocean Paradise Hotel & Resort'],
  itinerary: exItinerary,
  terms: 'Standard cancellation rules apply.',
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

const exCustomRequest = (over = {}) => ({
  _id: '6ac0a5f0eebc510147c67242',
  userId: '6ac0a5f0eebc510147c6722a',
  customer: 'Rahim Uddin',
  phone: '+8801712345678',
  destination: 'Sajek Valley',
  travelers: 4,
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2026-12-05T00:00:00.000Z',
  hotel: '3-star',
  transportation: 'Private car',
  activities: ['Trekking', 'Bonfire'],
  requirements: 'Vegetarian meals',
  itinerary: [{ day: 1, title: 'Arrival', description: 'Check in' }],
  status: 'NEW',
  reviewNote: '',
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

const exSession = (withUser = true) => ({
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YWMwYTVmMC4uLiJ9.signature',
  expiresIn: '15m',
  ...(withUser ? { user: exUser() } : {})
});

const exMeta = { total: 42, page: 1, limit: 10, totalPages: 5 };

// ---------------------------------------------------------------- components

const schemas = {
  PaginationMeta: obj(
    { total: { type: 'integer', example: 42 }, page: { type: 'integer', example: 1 }, limit: { type: 'integer', example: 10 }, totalPages: { type: 'integer', example: 5 } },
    ['total', 'page', 'limit', 'totalPages']
  ),
  ErrorResponse: obj(
    {
      success: bool(false),
      message: str('Invalid credentials'),
      code: str('INVALID_CREDENTIALS', { description: 'Machine-readable reason. Branch on this, not on the message.' }),
      errors: {
        type: 'array',
        description: 'Present on validation failures (422): one entry per bad field.',
        items: obj({ field: str('body.password'), message: str('Password needs a number.') }, ['field', 'message'])
      }
    },
    ['success', 'message']
  ),
  User: obj(
    {
      _id: str('6ac0a5f0eebc510147c6722a'),
      name: str('Rahim Uddin'),
      email: str('rahim@example.com', { description: 'Absent for a phone-only Firebase account.' }),
      phone: str('+8801712345678'),
      role: { type: 'string', enum: ROLES_ENUM, example: 'B2C' },
      permissions: { type: 'array', items: str('VISA_VIEW'), description: 'Only STAFF accounts carry permissions.' },
      status: { type: 'string', enum: STATUS_ENUM, example: 'ACTIVE' },
      emailVerified: bool(true),
      phoneVerified: bool(false),
      partnerId: str(undefined, { description: 'B2B only: the id of the Partner record.' }),
      authProvider: { type: 'string', enum: ['local', 'firebase'], example: 'local' },
      lastLoginAt: str(NOW, { format: 'date-time' }),
      createdAt: str(NOW, { format: 'date-time' }),
      updatedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'name', 'role', 'status']
  ),
  PartnerDocument: obj(
    {
      _id: str('6ac0a5f0eebc510147c67230'),
      type: { type: 'string', enum: DOC_TYPE_ENUM, example: 'TRADE_LICENSE' },
      originalName: str('trade-license.pdf'),
      mimeType: str('application/pdf'),
      size: { type: 'integer', example: 184320, description: 'Bytes.' },
      status: { type: 'string', enum: DOC_STATUS_ENUM, example: 'PENDING' },
      reviewedBy: str(undefined, { description: 'User id of the reviewer.' }),
      reviewedAt: str(NOW, { format: 'date-time' }),
      reviewNote: str(''),
      uploadedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'type', 'originalName', 'status']
  ),
  Partner: obj(
    {
      _id: str('6ac0a5f0eebc510147c6722f'),
      userId: {
        description: 'The owner. A plain id, or (in admin and staff lists) an object with name, email, phone and status.',
        oneOf: [str('6ac0a5f0eebc510147c6722e'), obj({ _id: str(), name: str('Karim Hossain'), email: str('karim@agency.com'), phone: str('+8801811111111'), status: { type: 'string', enum: STATUS_ENUM } })]
      },
      companyName: str('Sky Travels Ltd'),
      licenseNo: str('TL-2024-0042'),
      businessType: str('Travel agency'),
      address: str('45 Motijheel, Dhaka'),
      documents: arrayOf(ref('PartnerDocument')),
      approvalStatus: { type: 'string', enum: APPROVAL_ENUM, example: 'PENDING' },
      reviewedBy: str(),
      reviewedAt: str(NOW, { format: 'date-time' }),
      reviewNote: str(''),
      createdAt: str(NOW, { format: 'date-time' }),
      updatedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'companyName', 'licenseNo', 'approvalStatus']
  ),
  Session: obj(
    {
      accessToken: str(undefined, { description: 'JWT. Send it as `Authorization: Bearer <accessToken>`. Valid 15 minutes.' }),
      expiresIn: str('15m'),
      refreshToken: str(undefined, { description: 'Only when the request had the header `X-Client-Type: mobile`. Web clients receive it as an httpOnly cookie instead.' }),
      user: ref('User')
    },
    ['accessToken', 'expiresIn']
  ),
  AuditLog: obj(
    {
      _id: str(),
      actorUserId: str(),
      action: { type: 'string', enum: AUDIT_ENUM, example: 'LOGIN' },
      targetUserId: str(),
      resource: str('partner:6ac0a5f0eebc510147c6722f'),
      result: { type: 'string', enum: ['SUCCESS', 'FAILURE'], example: 'SUCCESS' },
      ip: str('::1'),
      meta: { type: 'object', additionalProperties: true, example: { via: 'password' } },
      createdAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'action', 'result']
  ),
  ItineraryDay: obj(
    { day: { type: 'integer', minimum: 1, maximum: 365, example: 1 }, title: str('Arrival & Beach Sunset'), description: str('Check-in, relax at Laboni Beach, enjoy sunset.') },
    ['day', 'title', 'description']
  ),
  TourCategory: obj(
    {
      _id: str('6ac0a5f0eebc510147c67240'),
      name: str('Beach & Resort'),
      slug: str('beach-and-resort'),
      legacyId: str('cat_beach', { description: 'The id the frontend used before the backend existed. Any endpoint that takes a category id accepts it.' }),
      isActive: bool(true),
      createdAt: str(NOW, { format: 'date-time' }),
      updatedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'name', 'slug', 'isActive']
  ),
  Tour: obj(
    {
      _id: str('6ac0a5f0eebc510147c67241'),
      legacyId: str('tour_205', { description: 'The id the frontend used before the backend existed. Any endpoint that takes a tour id accepts it.' }),
      name: str("Cox's Bazar Beach Escape"),
      country: str('Bangladesh'),
      destination: str("Cox's Bazar, Bangladesh"),
      category: { description: 'The category, expanded to its name, slug and legacy id.', ...ref('TourCategory') },
      durationDays: { type: 'integer', minimum: 1, maximum: 365, example: 3 },
      priceCurrency: { type: 'string', enum: CURRENCY_ENUM, example: 'BDT' },
      price: { type: 'number', minimum: 0, example: 12500, description: 'The public (B2C) price.' },
      b2bPrice: { type: 'number', minimum: 0, example: 10000, description: 'The partner price. **Only present** for an admin, staff with TOUR_MANAGE, or a B2B user whose partner is APPROVED. It is never in a public answer.' },
      seats: { type: 'integer', minimum: 0, example: 25, description: 'Total capacity.' },
      status: { type: 'string', enum: TOUR_STATUS_ENUM, example: 'published' },
      rating: { type: 'number', minimum: 0, maximum: 5, example: 4.9 },
      coverImage: str('https://picsum.photos/seed/coxs-bazar/900/560'),
      gallery: arrayOf(str('https://picsum.photos/seed/coxs-bazar-2/900/560')),
      description: str('Experience the world longest natural sea beach.'),
      included: arrayOf(str('2 nights hotel stay')),
      excluded: arrayOf(str('Personal expenses')),
      hotels: arrayOf(str('Ocean Paradise Hotel & Resort')),
      itinerary: { ...arrayOf(ref('ItineraryDay')), description: 'Always in ascending day order.' },
      terms: str('Standard cancellation rules apply.'),
      createdAt: str(NOW, { format: 'date-time' }),
      updatedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'name', 'country', 'destination', 'durationDays', 'priceCurrency', 'price', 'status', 'description', 'itinerary']
  ),
  CustomTourRequest: obj(
    {
      _id: str('6ac0a5f0eebc510147c67242'),
      userId: {
        description: 'The customer who sent it. A plain id for the customer; an object with name, email and phone for a tour manager.',
        oneOf: [str('6ac0a5f0eebc510147c6722a'), obj({ _id: str(), name: str('Rahim Uddin'), email: str('rahim@example.com'), phone: str('+8801712345678') })]
      },
      customer: str('Rahim Uddin'),
      phone: str('+8801712345678'),
      destination: str('Sajek Valley'),
      travelers: { type: 'integer', minimum: 1, maximum: 100, example: 4 },
      startDate: str(NOW, { format: 'date-time' }),
      endDate: str(NOW, { format: 'date-time' }),
      hotel: str('3-star'),
      transportation: str('Private car'),
      activities: arrayOf(str('Trekking')),
      requirements: str('Vegetarian meals'),
      itinerary: arrayOf(ref('ItineraryDay')),
      status: { type: 'string', enum: REQUEST_STATUS_ENUM, example: 'NEW' },
      reviewNote: str('', { description: 'The consultant\'s note, for example the quote.' }),
      reviewedBy: str(),
      reviewedAt: str(NOW, { format: 'date-time' }),
      createdAt: str(NOW, { format: 'date-time' }),
      updatedAt: str(NOW, { format: 'date-time' })
    },
    ['_id', 'userId', 'customer', 'destination', 'travelers', 'startDate', 'endDate', 'hotel', 'status']
  ),
  RbacCatalog: obj({
    roles: arrayOf(
      obj({
        code: { type: 'string', enum: ROLES_ENUM },
        label: str('Staff'),
        description: str(),
        selfRegister: bool(false),
        invitable: bool(true),
        bypassPermissions: bool(false),
        assignablePermissions: bool(true)
      })
    ),
    permissions: arrayOf(obj({ code: str('VISA_VIEW'), description: str('See visa applications') }))
  })
};

const errorExample = (message, code, errors) => ({ success: false, message, ...(code ? { code } : {}), ...(errors ? { errors } : {}) });

const errorBody = (description, example) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorResponse'), example } }
});

const rateHeaders = {
  'Retry-After': { description: 'Seconds to wait before trying again.', schema: { type: 'integer', example: 898 } },
  RateLimit: { description: 'Current quota (draft-7): `limit=10, remaining=0, reset=898`.', schema: { type: 'string' } }
};

const responses = {
  BadRequest: errorBody('Malformed request, or a rejected code, token or file.', errorExample('Invalid or expired code.', 'INVALID_CODE')),
  Unauthorized: errorBody('No token, or an invalid or expired token.', errorExample('Authentication required.', 'AUTH_REQUIRED')),
  Forbidden: errorBody('Signed in, but the role, permission or account status does not allow this.', errorExample('Forbidden', 'FORBIDDEN')),
  NotFound: errorBody('Not found. Also returned for a record that belongs to someone else, so existence is never revealed.', errorExample('Not found')),
  Conflict: errorBody('The request conflicts with the current state.', errorExample('An account with this email already exists.', 'EMAIL_TAKEN')),
  PayloadTooLarge: errorBody('A file or the request body is too large (files: 5 MB each, JSON: 100 kB).', errorExample('File too large', undefined)),
  ValidationError: errorBody(
    'The input failed validation. `errors` lists each bad field.',
    errorExample('Password needs a number.', 'VALIDATION_ERROR', [{ field: 'body.password', message: 'Password needs a number.' }])
  ),
  TooManyRequests: {
    ...errorBody('Rate limit reached. Wait for `Retry-After` seconds.', errorExample('Too many requests. Please try again later.', 'RATE_LIMITED')),
    headers: rateHeaders
  },
  ServiceUnavailable: errorBody('A dependency is unavailable (for example Firebase is not configured).', errorExample('Firebase sign-in is not configured on this server.', 'FIREBASE_DISABLED'))
};

const STATUS_TO_COMPONENT = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  413: 'PayloadTooLarge',
  422: 'ValidationError',
  429: 'TooManyRequests',
  503: 'ServiceUnavailable'
};

const STATUS_TEXT = {
  400: 'Bad request',
  401: 'Not signed in',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Too large',
  422: 'Validation failed',
  429: 'Rate limited',
  503: 'Service unavailable'
};

module.exports = {
  ID, NOW, toSchema, parametersFrom, SUCCESS, obj, str, bool, ref, arrayOf, envelope, errorExample, errorBody,
  schemas, responses, STATUS_TO_COMPONENT, STATUS_TEXT, rateHeaders,
  exUser, exDocument, exPartner, exSession, exMeta, exCategory, exTour, exCustomRequest, exItinerary, PASSWORD_RULES,
  ENUMS: { TOUR_STATUS_ENUM, CURRENCY_ENUM, REQUEST_STATUS_ENUM, ROLES_ENUM, STATUS_ENUM, APPROVAL_ENUM, DOC_TYPE_ENUM, DOC_STATUS_ENUM, AUDIT_ENUM }
};
