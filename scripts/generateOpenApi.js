// Writes documentation/openapi.json (import it into Postman, Insomnia or Swagger UI).
// Usage: npm run openapi
// The request bodies, query strings and path parameters come from the zod schemas in validations/, so
// re-run this after changing a validation file or a route. The test suite fails if the file is stale.
const fs = require('fs');
const path = require('path');
const { buildSpec } = require('./openapi/spec');

const OUT = path.join(__dirname, '..', 'documentation', 'openapi.json');

const spec = buildSpec();
fs.writeFileSync(OUT, `${JSON.stringify(spec, null, 2)}\n`);

const operations = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${operations} operations, ${Object.keys(spec.components.schemas).length} schemas.`);
