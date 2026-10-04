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
    expect(real.size).toBe(47);
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

  it('lets web clients stay in web mode: the mobile header is documented but empty by default', () => {
    const header = spec.paths['/api/auth/login'].post.parameters.find((x) => x.in === 'header');
    expect(header.name).toBe('X-Client-Type');
    expect(header.required).toBe(false);
    expect(header.example).toBe('');
  });
});
