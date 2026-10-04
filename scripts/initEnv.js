// First-run helper. Usage: npm run setup
//
//   - No .env yet : creates it from .env.example with three fresh random secrets.
//   - .env exists : fills ONLY the secrets that are missing, empty, or still "replace-me".
//                   Real values, and every other line, are left exactly as they are.
// Safe to run again at any time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');
const SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_HASH_SECRET'];

const created = !fs.existsSync(envPath);

if (created && !fs.existsSync(examplePath)) {
  console.error('There is no .env and no .env.example to start from.');
  console.error('Create .env with at least JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and TOKEN_HASH_SECRET, then run this again.');
  process.exit(1);
}

let content = fs.readFileSync(created ? examplePath : envPath, 'utf8');
const filled = [];

SECRETS.forEach((name) => {
  const line = new RegExp(`^${name}=(.*)$`, 'm');
  const match = content.match(line);
  const current = match ? match[1].trim() : '';
  const needsValue = !match || current === '' || current.startsWith('replace-me');
  if (!needsValue) return;

  const secret = crypto.randomBytes(48).toString('hex');
  content = match ? content.replace(line, `${name}=${secret}`) : `${content.replace(/\n?$/, '\n')}${name}=${secret}\n`;
  filled.push(name);
});

if (created || filled.length > 0) fs.writeFileSync(envPath, content, { mode: 0o600 });

if (created) console.log('Created .env from .env.example.');
if (filled.length > 0) console.log(`Generated new random values for: ${filled.join(', ')}.`);
if (!created && filled.length === 0) console.log('.env already has all three secrets. Nothing changed.');
console.log('Next: check MONGODB_URI and the ADMIN_SEED_* values, then run: npm run seed && npm run dev');
