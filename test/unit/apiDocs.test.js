const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../../app');
const env = require('../../config/env');

const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'documentation', 'openapi.json'), 'utf8'));
const SECRETS = { JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), TOKEN_HASH_SECRET: 'c'.repeat(40) };
const EMAILJS = { EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't', EMAILJS_PUBLIC_KEY: 'p', EMAILJS_PRIVATE_KEY: 'k' };

// Loads a fresh copy of config/env.js as if the server had started with exactly these variables.
const loadEnv = (vars) => {
  const saved = { ...process.env };
  ['API_DOCS_ENABLED', 'NODE_ENV', 'MONGODB_URI'].forEach((key) => delete process.env[key]);
  Object.assign(process.env, { SKIP_DOTENV: 'true', ...SECRETS, ...vars });
  try {
    let loaded;
    jest.isolateModules(() => {
      loaded = require('../../config/env');
    });
    return loaded;
  } finally {
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, saved);
  }
};

const operationsIn = (spec) => Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);

describe('interactive documentation (Swagger UI at /docs)', () => {
  it('is on in development and test, and serves the page with its scripts and styles', async () => {
    expect(env.apiDocsEnabled).toBe(true);

    const page = await request(app).get('/docs/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('Travel API documentation');
    for (const asset of ['swagger-ui-init.js', 'swagger-ui-bundle.js', 'swagger-ui.css']) {
      expect({ asset, status: (await request(app).get(`/docs/${asset}`)).status }).toEqual({ asset, status: 200 });
    }
    expect((await request(app).get('/docs').redirects(0)).status).toBe(301); // /docs becomes /docs/
  });

  it('serves the OpenAPI file with this server as the address, so "Try it out" hits the same origin', async () => {
    const res = await request(app).get('/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual([{ url: '/', description: 'This server' }]);
    expect(operationsIn(res.body)).toBe(operationsIn(FILE));
    expect(Object.keys(res.body.paths)).toEqual(Object.keys(FILE.paths)); // same routes, same order
    expect(FILE.servers[0].url).toBe('http://localhost:5000'); // the file itself still serves Postman
  });

  it('opens with a quick start for this page, not the Postman one, while the file keeps the Postman one', async () => {
    const live = (await request(app).get('/docs/openapi.json')).body.info.description;

    expect(live).toContain('Quick start on this page');
    expect(live).toContain('Authorize');
    expect(live).not.toContain('Quick start in Postman');
    expect(live).toContain('Good to know'); // a short reference instead of the long tables
    expect(live).not.toContain('## Rate limits'); // the long tables stay in the file
    expect(live.length).toBeLessThan(FILE.info.description.length / 2); // so the groups are on the first screen
    expect(live.startsWith(FILE.info.description.split('\n')[0])).toBe(true); // the first line is the same
    expect(FILE.info.description).toContain('Quick start in Postman');
    expect(FILE.info.description).toContain('## Rate limits');
  });

  it('answers 404 for anything else under /docs, and only reads: nothing can be changed there', async () => {
    expect((await request(app).get('/docs/nope')).status).toBe(404);
    expect((await request(app).get('/docs/../package.json')).status).toBe(404);
    expect((await request(app).post('/docs/openapi.json').send({})).status).toBe(404);
    expect((await request(app).put('/docs/')).status).toBe(404);
  });

  it('needs no token (it is documentation), and is not one of the API routes', async () => {
    expect((await request(app).get('/docs/openapi.json')).status).toBe(200);
    expect(Object.keys(FILE.paths).some((p) => p.startsWith('/docs'))).toBe(false);
  });

  it('is on in development and test, can be switched off, and can NEVER be switched on in production', () => {
    const production = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1/x', ...EMAILJS };

    expect(loadEnv({ NODE_ENV: 'development' }).apiDocsEnabled).toBe(true);
    expect(loadEnv({ NODE_ENV: 'development', API_DOCS_ENABLED: 'false' }).apiDocsEnabled).toBe(false);
    expect(loadEnv(production).apiDocsEnabled).toBe(false);
    expect(loadEnv({ ...production, API_DOCS_ENABLED: 'false' }).apiDocsEnabled).toBe(false);
    // there is no setting that turns it on in production
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      expect({ value, enabled: loadEnv({ ...production, API_DOCS_ENABLED: value }).apiDocsEnabled }).toEqual({ value, enabled: false });
    }
    // the attempt is noticed, so the app can say it was ignored
    expect(loadEnv({ ...production, API_DOCS_ENABLED: 'true' }).apiDocsOverrideIgnored).toBe(true);
    expect(loadEnv(production).apiDocsOverrideIgnored).toBe(false);
    expect(loadEnv({ NODE_ENV: 'development', API_DOCS_ENABLED: 'true' }).apiDocsOverrideIgnored).toBe(false);
  });

  describe('in production', () => {
    // A whole server started as production, with the documentation explicitly asked for.
    const startProduction = (extra = {}) => {
      const saved = { ...process.env };
      Object.keys(process.env).filter((key) => /^(API_DOCS|NODE_ENV|MONGODB_URI|EMAIL|SKIP_DOTENV)/.test(key)).forEach((key) => delete process.env[key]);
      Object.assign(process.env, { SKIP_DOTENV: 'true', NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1/x', ...SECRETS, ...EMAILJS, API_DOCS_ENABLED: 'true', LOG_LEVEL: 'silent', ...extra });
      const swaggerLoaded = jest.fn();
      try {
        let server;
        jest.isolateModules(() => {
          jest.doMock('swagger-ui-express', () => {
            swaggerLoaded();
            return jest.requireActual('swagger-ui-express');
          });
          server = require('../../app');
        });
        return { server, swaggerLoaded };
      } finally {
        Object.keys(process.env).forEach((key) => delete process.env[key]);
        Object.assign(process.env, saved);
      }
    };

    it('every path under /docs answers 404, even with API_DOCS_ENABLED=true', async () => {
      const { server } = startProduction();

      for (const asset of ['', 'index.html', 'openapi.json', 'swagger-ui-init.js', 'swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png']) {
        const res = await request(server).get(`/docs/${asset}`);
        expect({ asset, status: res.status, json: res.headers['content-type'] }).toEqual({ asset, status: 404, json: expect.stringMatching(/application\/json/) });
      }
      expect((await request(server).get('/docs').redirects(0)).status).toBe(404);
      expect((await request(server).get('/api-docs')).status).toBe(404);
      expect((await request(server).get('/documentation/openapi.json')).status).toBe(404); // the file is not served from anywhere
      expect((await request(server).get('/openapi.json')).status).toBe(404);
      expect((await request(server).get('/swagger.json')).status).toBe(404);
    });

    it('the rest of the app still works, and an unknown URL looks the same as /docs', async () => {
      const { server } = startProduction();

      expect((await request(server).get('/')).status).toBe(200);
      expect((await request(server).get('/api/auth/me')).status).toBe(401);
      const docs = await request(server).get('/docs/');
      const unknown = await request(server).get('/something-else/');
      expect([docs.status, docs.body.message.replace('/docs/', 'X')]).toEqual([unknown.status, unknown.body.message.replace('/something-else/', 'X')]);
    });

    it('does not even load the documentation code', () => {
      const { swaggerLoaded } = startProduction();

      expect(swaggerLoaded).not.toHaveBeenCalled();
    });

    it('apiDocs.mount does nothing in production, even if something calls it', () => {
      const saved = { ...process.env };
      Object.keys(process.env).filter((key) => /^(NODE_ENV|MONGODB_URI|EMAIL)/.test(key)).forEach((key) => delete process.env[key]);
      Object.assign(process.env, { SKIP_DOTENV: 'true', NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1/x', ...SECRETS, ...EMAILJS });
      try {
        const fakeApp = { use: jest.fn() };
        jest.isolateModules(() => {
          require('../../utils/apiDocs').mount(fakeApp);
        });

        expect(fakeApp.use).not.toHaveBeenCalled();
      } finally {
        Object.keys(process.env).forEach((key) => delete process.env[key]);
        Object.assign(process.env, saved);
      }
    });

    it('outside production the same server does serve it (so the test above proves something)', async () => {
      const dev = (() => {
        const saved = { ...process.env };
        process.env.API_DOCS_ENABLED = 'true';
        try {
          let server;
          jest.isolateModules(() => {
            server = require('../../app');
          });
          return server;
        } finally {
          Object.keys(process.env).forEach((key) => delete process.env[key]);
          Object.assign(process.env, saved);
        }
      })();

      expect((await request(dev).get('/docs/')).status).toBe(200);
    });
  });

  it('a server installed without dev dependencies has no /docs and still starts', async () => {
    let server;
    jest.isolateModules(() => {
      jest.doMock('swagger-ui-express', () => {
        const error = new Error("Cannot find module 'swagger-ui-express'");
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      });
      server = require('../../app');
    });

    expect((await request(server).get('/docs/')).status).toBe(404);
    expect((await request(server).get('/')).status).toBe(200);
  });

  it('a server started with the docs switched off answers 404 at /docs', async () => {
    const saved = process.env.API_DOCS_ENABLED;
    process.env.API_DOCS_ENABLED = 'false';
    try {
      let off;
      jest.isolateModules(() => {
        off = require('../../app');
      });

      expect((await request(off).get('/docs/')).status).toBe(404);
      expect((await request(off).get('/docs/openapi.json')).status).toBe(404);
      expect((await request(off).get('/health')).status).toBeLessThan(600); // the rest of the app is untouched
    } finally {
      if (saved === undefined) delete process.env.API_DOCS_ENABLED;
      else process.env.API_DOCS_ENABLED = saved;
    }
  });
});
