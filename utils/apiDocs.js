const swaggerUi = require('swagger-ui-express');
const env = require('../config/env');
const spec = require('../documentation/openapi.json');

// The interactive documentation: Swagger UI at /docs, and the raw OpenAPI file at /docs/openapi.json (for Postman:
// File > Import > Link). It serves the same file the tests keep current, so it can never describe a route that
// is not there.
//
// NEVER in production. Three locks: config/env.js has no setting that enables it there, app.js does not load this file
// unless it is enabled, and mount() refuses to run when NODE_ENV is production. swagger-ui-express is a dev dependency.
//
// It is served by the API itself, so "Try it out" sends the request to the same origin: no CORS setting is needed,
// and the refresh cookie works. The file's own server address (http://localhost:5000, for Postman) is replaced by "/".

// After a request that returns an access token (login, verify, Google sign-in, refresh, change password), put the
// token into the Authorize box, so the next protected request just works. After a logout, take it out again.
// This runs in the browser: it must stay free of anything from this file.
const rememberToken = (response) => {
  try {
    const body = response.obj || JSON.parse(response.text);
    const token = body && body.data && body.data.accessToken;
    if (response.ok && token) window.ui.preauthorizeApiKey('bearerAuth', token);
    if (response.ok && /\/api\/auth\/logout$/.test(response.url)) window.ui.authActions.logout(['bearerAuth']);
  } catch (err) {
    // not a JSON answer: nothing to remember
  }
  return response;
};

// The OpenAPI file opens with a Postman quick start and long reference tables (Postman shows them as the collection
// description). This page replaces them with a short quick start for Swagger UI, so the list of groups is on the first
// screen instead of a page further down.
const PAGE_QUICK_START = `## Quick start on this page

1. Open **Auth: sign in and session**, then **Log in (email and password)**. Replace the example body with real credentials. The first admin is created with \`npm run seed\`.
2. Press **Execute**. A successful login puts the access token into the **Authorize** box by itself and the padlock closes, so every operation with a lock now works.
3. The token lasts 15 minutes and lives only on this page: a reload signs you out. **Refresh tokens** gets a new one (the refresh cookie works here because this page is served by the API), and **Log out** clears it.
4. **Try it out** is already on. Every group starts closed, and the search box finds a group.
5. To try a role other than the one you used, log in again as that account.

## Good to know

- **Roles:** B2C (customer), B2B (agency, needs approval), STAFF (only what an admin granted) and ADMIN. The role is never taken from a request body.
- **Answers:** \`{ success, message, data }\`, and lists add \`meta\` and \`pagination\` (the same object). Membership routes answer \`{ items, total }\` or the object itself. Errors are \`{ success: false, message, code, errors? }\`: branch on \`code\`.
- **Limits:** every \`/api\` route allows 300 requests per 15 minutes per address, and sensitive routes have lower limits, stated on the route. A \`429\` carries \`Retry-After\`.
- **Ids** are 24-character MongoDB ids. Times are ISO 8601 UTC.

`;

const withPageIntro = (document) => ({
  ...document,
  info: { ...document.info, description: document.info.description.replace(/## Quick start in Postman[\s\S]*$/, PAGE_QUICK_START) }
});

const options = {
  customSiteTitle: 'Travel API documentation',
  customCss: '.swagger-ui .topbar { display: none; } .swagger-ui .info { margin: 24px 0; }',
  swaggerOptions: {
    docExpansion: 'none', // every group starts closed, so the list reads as a table of contents
    filter: true, // a search box for groups
    tagsSorter: undefined, // the order of the file: it is already arranged (see scripts/openapi/spec.js)
    operationsSorter: undefined,
    tryItOutEnabled: true,
    displayRequestDuration: true,
    persistAuthorization: false, // the token is NOT kept in localStorage: it lives in the page until it is reloaded
    defaultModelsExpandDepth: 0, // the schema list at the bottom starts closed
    validatorUrl: null, // do not call a third-party validator
    responseInterceptor: rememberToken
  }
};

const mount = (app) => {
  // A second lock behind the one in config/env.js and app.js: whoever calls this in production, nothing is mounted.
  if (env.isProduction) return;

  const live = { ...withPageIntro(spec), servers: [{ url: '/', description: 'This server' }] };

  // The raw file. A middleware (not a route), so it is not counted as an API route.
  app.use('/docs/openapi.json', (req, res, next) => (req.method === 'GET' ? res.json(live) : next()));
  // The page itself answers only at /docs (and its files). Any other path under /docs is an ordinary 404.
  const page = swaggerUi.setup(live, options);
  app.use('/docs', swaggerUi.serve, (req, res, next) => (req.method === 'GET' && (req.path === '/' || req.path === '/index.html') ? page(req, res, next) : next()));
};

module.exports = { mount };
