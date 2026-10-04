// Assembles the OpenAPI 3.0.3 document from scripts/openapi/endpoints.js and the zod schemas.
// Run `npm run openapi` to rewrite documentation/openapi.json. A test fails if that file is stale.
const { version } = require('../../package.json');
const { endpoints, TAGS } = require('./endpoints');
const {
  toSchema, parametersFrom, SUCCESS, envelope, errorBody, errorExample, ref, schemas, responses,
  STATUS_TO_COMPONENT, STATUS_TEXT, exMeta, rateHeaders
} = require('./shared');

// What the API says for each error code. Used for the examples next to each response.
const ERROR_MESSAGES = {
  REGISTRATION_CLOSED: 'Registration is not open for this account type.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  PHONE_TAKEN: 'An account with this phone number already exists.',
  LICENSE_TAKEN: 'A business with this license number is already registered.',
  FILE_TYPE_NOT_ALLOWED: 'Only PDF, JPEG, PNG and WEBP files are allowed.',
  VALIDATION_ERROR: 'Trade license document is required.',
  INVALID_CODE: 'Invalid or expired code.',
  ACCOUNT_NOT_ACTIVE: 'Account not active.',
  EMAIL_NOT_VERIFIED: 'Account not active. Verify your email to continue.',
  INVALID_CREDENTIALS: 'Invalid credentials',
  FIREBASE_TOKEN_INVALID: 'Invalid or expired Firebase token.',
  FIREBASE_PROVIDER_NOT_ALLOWED: 'This sign-in method is not supported. Continue with Google, or register with your email and password.',
  FIREBASE_UNVERIFIED: 'Verify your email or phone with Firebase before signing in.',
  ACCOUNT_TYPE_MISMATCH: 'This email belongs to a different account type. Sign in with your password.',
  FIREBASE_DISABLED: 'Firebase sign-in is not configured on this server.',
  SESSION_EXPIRED: 'Session expired.',
  TOKEN_INVALID: 'Invalid or expired token.',
  INVALID_INVITE: 'This invitation link is invalid or has expired.',
  NO_PASSWORD_SET: 'This account has no password yet. Use "forgot password" to set one.',
  WRONG_PASSWORD: 'Current password is incorrect.',
  PARTNER_NOT_APPROVED: 'Your business account has not been approved yet.',
  FORBIDDEN: 'Forbidden',
  DOCUMENTS_LOCKED: 'Documents cannot be changed after approval. Contact support.',
  SELF_CHANGE: 'You cannot change your own status.',
  LAST_ADMIN: 'This is the last active admin. Create or activate another admin first.',
  NOT_VERIFIED: 'This account has not been verified yet. It becomes active when the user verifies.',
  ROLE_LOCKED: 'The role of B2B and B2C accounts cannot be changed.',
  PERMISSIONS_NOT_ASSIGNABLE: 'This role does not use a permission list.',
  TRADE_LICENSE_MISSING: 'A partner cannot be approved without a trade license document.',
  DB_DOWN: 'Database is not reachable.'
};

const DESCRIPTION = `
Authentication and role-based access for the travel platform. Four roles share one login system: **ADMIN, STAFF, B2B, B2C**.

## Quick start in Postman

1. **Import** this file (File, Import). Postman builds a collection with one folder per area.
2. Open the collection's **Variables**. \`baseUrl\` is already set to \`http://localhost:5000\`; change it for another server. Add a variable named \`bearerToken\` (leave it empty).
3. Run **Auth, Log in**. Copy \`data.accessToken\` from the response into the \`bearerToken\` variable. Every request marked with a lock then works.
4. The access token lasts 15 minutes. Run **Refresh tokens** to get a new one (Postman keeps the refresh cookie for you).

To try a role other than the one you registered, log in as that account and replace \`bearerToken\`.
The first admin is created with \`npm run seed\`; more admins and staff are created by an admin (**Admin: users, Create staff**).

## Roles

| Role | How the account is created | Can reach |
| --- | --- | --- |
| **B2C** | Registers, or continues with Google | Own profile and own records |
| **B2B** | Registers (multipart), then an admin approves | Own profile and documents; operational routes once APPROVED |
| **STAFF** | Invited by an admin | Only what the permissions granted allow |
| **ADMIN** | First one by seed script, later ones invited | Everything under \`/api/admin\` |

The role is **never** accepted from a request body. The endpoint decides it.

## Tokens

- **Access token:** JWT, 15 minutes, sent as \`Authorization: Bearer <token>\`.
- **Refresh token:** 7 days, rotates on every use. Web clients get it as an httpOnly cookie scoped to \`/api/auth\`. Send the header \`X-Client-Type: mobile\` to receive it in the JSON body instead.
- A suspension, role change or password change takes effect on the next request.

## Responses

Success: \`{ "success": true, "message": "...", "data": ..., "meta": { total, page, limit, totalPages } }\` (\`meta\` on lists only).
Error: \`{ "success": false, "message": "...", "code": "SOME_CODE", "errors": [{ "field", "message" }] }\`. Branch on \`code\`, not on \`message\`.

| Status | Meaning |
| --- | --- |
| 400 | Bad request, or a rejected code, token or file |
| 401 | Not signed in, or the token is invalid or expired |
| 403 | Signed in, but role, permission or account status does not allow it |
| 404 | Not found, **or a record that belongs to someone else** |
| 409 | Conflict with the current state |
| 413 | File or body too large |
| 422 | Validation failed (\`errors\` lists each field) |
| 429 | Rate limited (see \`Retry-After\`) |
| 503 | A dependency is unavailable |

## Ids

All ids are MongoDB ObjectIds (24 hex characters). Timestamps are ISO 8601 UTC.

## Rate limits

Each sensitive route has its own limit, stated on the route. All \`/api\` routes are also limited to 300 requests per 15 minutes per IP.
`.trim();

// Left EMPTY in the Postman import on purpose: an empty value means "web" (refresh token in a cookie).
// Type `mobile` to test mobile mode (refresh token in the response body).
const headerParam = {
  name: 'X-Client-Type',
  in: 'header',
  required: false,
  description: 'Leave empty for web clients (refresh token arrives as an httpOnly cookie). Type `mobile` to receive the refresh token in the JSON body instead.',
  schema: { type: 'string' },
  example: ''
};

const errorResponse = (status, codes) => {
  if (codes === true) return { $ref: `#/components/responses/${STATUS_TO_COMPONENT[status]}` };
  const first = codes[0];
  return errorBody(
    `${STATUS_TEXT[status]}. Possible error codes: ${codes.map((c) => `\`${c}\``).join(', ')}.`,
    errorExample(ERROR_MESSAGES[first] || first, first, first === 'VALIDATION_ERROR' ? [{ field: 'tradeLicense', message: 'Trade license document is required.' }] : undefined)
  );
};

const buildOperation = (e) => {
  const op = {
    tags: [e.tag],
    summary: e.summary,
    operationId: e.id,
    description: `${e.description}\n\n**Access:** ${e.access}.${e.notes ? `\n\n${e.notes}` : ''}`,
    security: e.needsAuth ? [{ bearerAuth: [] }] : []
  };

  // ---- parameters
  const parameters = [];
  if (e.params) parameters.push(...parametersFrom(e.params, 'path', e.paramExamples));
  if (e.query) parameters.push(...parametersFrom(e.query, 'query', e.queryExample));
  if (e.mobileHeader) parameters.push(headerParam);
  if (parameters.length) op.parameters = parameters;

  // ---- request body
  if (e.body) {
    op.requestBody = {
      required: e.bodyRequired !== false,
      content: { 'application/json': { schema: toSchema(e.body), example: e.bodyExample } }
    };
  }
  if (e.multipart) {
    const base = e.multipart.zod ? toSchema(e.multipart.zod) : { type: 'object', properties: {} };
    const properties = { ...base.properties };
    Object.entries(e.multipart.example || {}).forEach(([k, v]) => {
      if (properties[k]) properties[k] = { ...properties[k], example: v };
    });
    // Every file is a plain binary field so Postman shows a file picker. A field that accepts several files
    // is sent by repeating the same key (add the row again in Postman), which the description says.
    Object.entries(e.multipart.files).forEach(([name, f]) => {
      properties[name] = {
        type: 'string',
        format: 'binary',
        description: f.multiple ? `${f.description} Repeat this key for each file (up to ${f.maxItems}).` : f.description
      };
    });
    const required = [...(base.required || []), ...e.multipart.required];
    op.requestBody = {
      required: true,
      content: { 'multipart/form-data': { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } }
    };
  }

  // ---- responses
  const res = {};
  const s = e.success;
  if (e.binary) {
    res['200'] = {
      description: 'The file, as an attachment.',
      headers: {
        'Content-Disposition': { description: 'Always `attachment; filename="<original name>"`.', schema: { type: 'string', example: 'attachment; filename="trade-license.pdf"' } },
        'Cache-Control': { description: 'Always `private, no-store`.', schema: { type: 'string', example: 'private, no-store' } }
      },
      content: Object.fromEntries(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].map((t) => [t, { schema: { type: 'string', format: 'binary' } }]))
    };
  } else {
    const headers = s.setsCookie
      ? { 'Set-Cookie': { description: 'Web clients: `refreshToken` cookie (httpOnly, path `/api/auth`, 7 days). Not set when `X-Client-Type: mobile` is sent.', schema: { type: 'string' } } }
      : undefined;
    const content = s.raw
      ? { 'application/json': { schema: s.rawSchema, example: s.raw } }
      : {
          'application/json': {
            schema: envelope(s.schema && s.schema.type === 'object' && !s.schema.properties && !s.schema.$ref ? undefined : s.schema, { paginated: Boolean(s.paginated), message: s.message }),
            example: SUCCESS(s.message, s.example, s.paginated ? { meta: exMeta } : {})
          }
        };
    res[String(s.status)] = { description: s.message, ...(headers ? { headers } : {}), content };
  }
  Object.entries(e.errors || {}).forEach(([status, codes]) => {
    if (e.healthDown && status === '503') {
      res['503'] = {
        description: 'The database is not reachable.',
        content: { 'application/json': { schema: s.rawSchema, example: { success: false, uptime: 1234.56, db: 'down' } } }
      };
    } else {
      res[status] = errorResponse(status, codes);
    }
  });
  op.responses = res;
  return op;
};

const buildSpec = () => {
  const paths = {};
  endpoints.forEach((e) => {
    paths[e.path] = paths[e.path] || {};
    paths[e.path][e.method] = buildOperation(e);
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'Travel Management Platform: Auth and RBAC API',
      version,
      description: DESCRIPTION
    },
    // A plain URL (not a templated one): Postman turns it into the collection variable {{baseUrl}}.
    servers: [{ url: 'http://localhost:5000', description: 'Local development. Change the baseUrl variable for another server.' }],
    // No top-level `security`: each protected route declares bearerAuth itself, so public routes (login,
    // register, ...) carry no Authorization header at all.
    tags: TAGS,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The `accessToken` from a login response. Valid 15 minutes.'
        }
      },
      schemas,
      responses,
      headers: rateHeaders
    }
  };
};

module.exports = { buildSpec, endpoints };
