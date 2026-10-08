const fs = require('fs');
const path = require('path');
const SwaggerParser = require('@apidevtools/swagger-parser');

const app = require('../../app');
const { buildSpec, endpoints } = require('../../scripts/openapi/spec');

const FILE = path.join(__dirname, '..', '..', 'documentation', 'openapi.json');
const spec = buildSpec();

// Every route Express has registered, as "METHOD /path/{param}" (Express 4 router stack)
const registeredRoutes = () => {
  const found = new Set();
  const walk = (stack, prefix) =>
    stack.forEach((layer) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((method) => {
          const full = `${prefix}${layer.route.path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
          found.add(`${method.toUpperCase()} ${full.replace(/:([A-Za-z]+)/g, '{$1}')}`);
        });
      } else if (layer.name === 'router' && layer.handle.stack) {
        const match = layer.regexp.source.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)/);
        walk(layer.handle.stack, prefix + (match ? `/${match[1].replace(/\\\//g, '/')}` : ''));
      }
    });
  walk(app._router.stack, '');
  return found;
};

const documentedRoutes = () =>
  new Set(Object.entries(spec.paths).flatMap(([p, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${p}`)));

describe('OpenAPI document (documentation/openapi.json)', () => {
  it('is up to date: regenerate with `npm run openapi` after changing a route or a validation file', () => {
    const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it('is a valid OpenAPI 3 document', async () => {
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)))).resolves.toBeTruthy();
  });

  it('documents every route the app really serves, and nothing that does not exist', () => {
    const real = registeredRoutes();
    const documented = documentedRoutes();

    const undocumented = [...real].filter((r) => !documented.has(r));
    const phantom = [...documented].filter((r) => !real.has(r));

    expect(undocumented).toEqual([]);
    expect(phantom).toEqual([]);
    expect(real.size).toBe(74);
  });

  it('gives every operation a summary, a tag, an id, a success response and explicit access', () => {
    const ids = new Set();
    Object.values(spec.paths).forEach((item) =>
      Object.values(item).forEach((op) => {
        expect(op.summary).toBeTruthy();
        expect(op.description).toMatch(/\*\*Access:\*\*/);
        expect(op.tags).toHaveLength(1);
        expect(Array.isArray(op.security)).toBe(true);
        expect(Object.keys(op.responses).some((code) => /^2/.test(code))).toBe(true);
        expect(ids.has(op.operationId)).toBe(false);
        ids.add(op.operationId);
      })
    );
  });

  it('marks protected routes with bearerAuth and leaves public ones open', () => {
    const publicPaths = ['/api/auth/register', '/api/auth/login', '/api/auth/firebase', '/api/auth/refresh', '/api/auth/forgot-password', '/health', '/'];
    const protectedPaths = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/admin/users', '/api/staff/profile', '/api/b2b/overview', '/api/b2c/profile'];

    publicPaths.forEach((p) => Object.values(spec.paths[p]).forEach((op) => expect(op.security).toEqual([])));
    protectedPaths.forEach((p) => Object.values(spec.paths[p]).forEach((op) => expect(op.security).toEqual([{ bearerAuth: [] }])));
    expect(spec.security).toBeUndefined();
  });

  it('every example request body and query really passes the API validation', () => {
    let checked = 0;
    endpoints.forEach((e) => {
      if (e.body) {
        expect({ route: `${e.method} ${e.path}`, ok: e.body.safeParse(e.bodyExample).success }).toEqual({ route: `${e.method} ${e.path}`, ok: true });
        checked += 1;
      }
      if (e.query && e.queryExample) {
        expect({ route: `${e.method} ${e.path} (query)`, ok: e.query.safeParse(e.queryExample).success }).toEqual({ route: `${e.method} ${e.path} (query)`, ok: true });
        checked += 1;
      }
      if (e.multipart && e.multipart.zod) {
        expect({ route: `${e.method} ${e.path} (form)`, ok: e.multipart.zod.safeParse(e.multipart.example).success }).toEqual({ route: `${e.method} ${e.path} (form)`, ok: true });
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(25);
  });

  it('every path parameter in a URL is documented, with an example id', () => {
    Object.entries(spec.paths).forEach(([p, item]) => {
      const inUrl = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      Object.values(item).forEach((op) => {
        const documented = (op.parameters || []).filter((x) => x.in === 'path');
        expect({ p, names: documented.map((x) => x.name).sort() }).toEqual({ p, names: inUrl });
        documented.forEach((x) => {
          expect(x.required).toBe(true);
          expect(x.example).toMatch(/^[0-9a-f]{24}$/);
        });
      });
    });
  });

  it('describes the form-data of the agency registration, with the trade license required', () => {
    const form = spec.paths['/api/auth/b2b/register'].post.requestBody.content['multipart/form-data'].schema;
    expect(form.required).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'password', 'companyName', 'licenseNo', 'address', 'tradeLicense']));
    expect(form.required).not.toContain('businessCard');
    ['tradeLicense', 'businessCard', 'otherDocuments'].forEach((f) => expect(form.properties[f]).toMatchObject({ type: 'string', format: 'binary' }));
  });

  it('mirrors the real validation rules in the request schemas', () => {
    const body = (p) => spec.paths[p].post.requestBody.content['application/json'].schema;
    const reg = body('/api/auth/register');
    expect(reg.required).toEqual(['name', 'email', 'password']);
    expect(reg.properties.password).toMatchObject({ minLength: 8, maxLength: 64 });
    expect(reg.properties.phone.pattern).toBeTruthy();
    expect(reg.properties.role).toBeUndefined(); // the role can never be sent

    const patch = spec.paths['/api/admin/users/{id}/status'].patch.requestBody.content['application/json'].schema;
    expect(patch.properties.status.enum).toEqual(['ACTIVE', 'SUSPENDED', 'BLOCKED', 'INACTIVE']);

    const decide = spec.paths['/api/admin/b2b/{id}/approval'].patch.requestBody.content['application/json'].schema;
    expect(decide.properties.decision.enum).toEqual(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']);
  });

  it('documents the tour module: public reads accept an optional token, writes need one, and custom requests are B2C', () => {
    const op = (method, p) => spec.paths[p][method];

    [['get', '/api/tours'], ['get', '/api/tours/{id}'], ['get', '/api/tour-categories'], ['get', '/api/tour-categories/{id}']].forEach(([m, p]) =>
      expect({ p, security: op(m, p).security }).toEqual({ p, security: [{}, { bearerAuth: [] }] })
    );
    [['post', '/api/tours'], ['patch', '/api/tours/{id}'], ['delete', '/api/tours/{id}'], ['post', '/api/tour-categories'], ['delete', '/api/tour-categories/{id}']].forEach(([m, p]) => {
      expect({ m, p, security: op(m, p).security }).toEqual({ m, p, security: [{ bearerAuth: [] }] });
      expect(op(m, p).description).toMatch(/TOUR_MANAGE/);
    });
    expect(op('post', '/api/tours/custom-requests').description).toMatch(/\*\*Access:\*\* B2C/);

    const tourList = op('get', '/api/tours').parameters.map((x) => x.name);
    expect(tourList).toEqual(['page', 'limit', 'search', 'category', 'country', 'destination', 'status', 'minPrice', 'maxPrice', 'durationDays', 'sort']);
    const create = op('post', '/api/tours').requestBody.content['application/json'].schema;
    expect(create.properties.priceCurrency.enum).toEqual(['BDT', 'USD', 'EUR']);
    expect(create.properties.status.enum).toEqual(['draft', 'published', 'unpublished', 'archived']);
    expect(create.properties.role).toBeUndefined();
    expect(spec.components.schemas.Tour.properties.b2bPrice.description).toMatch(/Only present/);
  });

  it('documents the membership module in the dashboard\'s shapes: manager-only, { items, total }, id, and 400 for validation', () => {
    const op = (method, p) => spec.paths[p][method];
    const json = (response) => response.content['application/json'];
    const managerRoutes = [
      ['get', '/api/membership-plans'], ['post', '/api/membership-plans'], ['put', '/api/membership-plans/{id}'], ['patch', '/api/membership-plans/{id}/toggle'],
      ['delete', '/api/membership-plans/{id}'], ['get', '/api/memberships'], ['post', '/api/memberships'], ['patch', '/api/memberships/{id}/cancel'],
      ['patch', '/api/memberships/{id}/extend'], ['delete', '/api/memberships/{id}'], ['get', '/api/customers/{customerId}/memberships'],
      ['get', '/api/membership-stats'], ['get', '/api/membership-report/periods']
    ];

    managerRoutes.forEach(([m, p]) => {
      expect({ m, p, security: op(m, p).security }).toEqual({ m, p, security: [{ bearerAuth: [] }] });
      expect(op(m, p).description).toMatch(/MEMBERSHIP_MANAGE/);
    });
    expect(op('get', '/api/b2c/memberships').description).toMatch(/\*\*Access:\*\* B2C/);

    // lists are { items, total } with no envelope, a single answer is the object itself, delete is { success, id }
    const list = json(op('get', '/api/membership-plans').responses['200']);
    expect(Object.keys(list.schema.properties)).toEqual(['items', 'total']);
    expect(Object.keys(list.example)).toEqual(['items', 'total']);
    expect(Object.keys(json(op('get', '/api/customers/{customerId}/memberships').responses['200']).schema.properties)).toEqual(['items']);
    expect(json(op('post', '/api/memberships').responses['201']).schema).toEqual({ $ref: '#/components/schemas/Membership' });
    expect(Object.keys(json(op('delete', '/api/memberships/{id}').responses['200']).example)).toEqual(['success', 'id']);
    expect(spec.components.schemas.Membership.properties).toHaveProperty('id');
    expect(spec.components.schemas.Membership.properties).not.toHaveProperty('_id');

    // validation failures on these routes are 400 (the rest of the API uses 422)
    expect(op('post', '/api/membership-plans').responses).toHaveProperty('400');
    expect(op('post', '/api/membership-plans').responses).not.toHaveProperty('422');

    const create = op('post', '/api/memberships').requestBody.content['application/json'].schema;
    expect(create.required).toEqual(expect.arrayContaining(['customerId', 'planId', 'paymentMethod']));
    expect(create.properties.paymentMethod.enum).toEqual(['bkash', 'nagad', 'bank', 'cash', 'online']);
    expect(create.properties.amount).toBeUndefined(); // the amount always comes from the plan
    expect(op('get', '/api/membership-report/periods').parameters.map((x) => x.name)).toEqual(['mode']);
  });

  it('lists the groups in the intended order, and sorts the operations inside each group', () => {
    const { TAGS, FLOW_TAGS } = require('../../scripts/openapi/endpoints');
    const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
    const byTag = {};
    Object.entries(spec.paths).forEach(([p, item]) =>
      Object.entries(item).forEach(([method, op]) => (byTag[op.tags[0]] = byTag[op.tags[0]] || []).push({ method, path: p, order: 0 }))
    );

    expect(spec.tags.map((x) => x.name)).toEqual(TAGS.map((x) => x.name));
    expect(spec.tags.map((x) => x.name).slice(0, 5)).toEqual(['System', 'Auth: sign up and verify', 'Auth: sign in and session', 'Auth: passwords', 'Customer (B2C)']);
    expect(Object.keys(byTag).every((name) => spec.tags.some((x) => x.name === name))).toBe(true); // no operation in an unlisted group
    expect(spec.tags.every((x) => (byTag[x.name] || []).length > 0)).toBe(true); // no empty group

    // the order the file lists them in is the order Swagger UI and Postman show
    const seenTags = [];
    Object.values(spec.paths).forEach((item) => Object.values(item).forEach((op) => !seenTags.includes(op.tags[0]) && seenTags.push(op.tags[0])));
    expect(seenTags).toEqual(spec.tags.map((x) => x.name));

    // inside a group: by path, then GET, POST, PUT, PATCH, DELETE (the sign-in flows keep their written order;
    // a customer's membership history is moved to the end of its group on purpose)
    Object.entries(byTag).forEach(([name, list]) => {
      if (FLOW_TAGS.has(name)) return;
      const rows = list.filter((r) => r.path !== '/api/customers/{customerId}/memberships');
      const sorted = [...rows].sort((a, b) => (a.path === b.path ? METHODS.indexOf(a.method) - METHODS.indexOf(b.method) : a.path < b.path ? -1 : 1));
      expect({ name, order: rows.map((r) => `${r.method} ${r.path}`) }).toEqual({ name, order: sorted.map((r) => `${r.method} ${r.path}`) });
    });
    expect(byTag.Memberships.at(-1).path).toBe('/api/customers/{customerId}/memberships');
    expect(byTag['Auth: sign in and session'].map((r) => r.path)).toEqual(['/api/auth/login', '/api/auth/firebase', '/api/auth/refresh', '/api/auth/logout', '/api/auth/me']);
  });

  it('gives a 422 example that names a field of its own request, not a password', () => {
    const example = (p, m) => spec.paths[p][m].responses['422'].content['application/json'].example.errors[0].field;

    expect(example('/api/tours', 'get')).toBe('query.page');
    expect(example('/api/tours/{id}', 'get')).toBe('params.id');
    expect(example('/api/auth/login', 'post')).toBe('body.email');
  });

  it('lets web clients stay in web mode: the mobile header is documented but empty by default', () => {
    const header = spec.paths['/api/auth/login'].post.parameters.find((x) => x.in === 'header');
    expect(header.name).toBe('X-Client-Type');
    expect(header.required).toBe(false);
    expect(header.example).toBe('');
  });
});
