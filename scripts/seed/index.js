// Fills the database with starting data, or empties it again, one module at a time.
//
//   npm run seed:all                 every module
//   npm run seed:visa                only the visa module
//   npm run seed:clear [module...]   deletes the data the seeders created (and what the app added to those collections)
//   npm run seed:reset [module...]   clear, then seed
//
// Every module file exports { name, seed(), clear() }. Seeding is safe to run again: what exists is left alone.
// `clear` and `reset` refuse to run in production. Pass --allow-production only if you really mean it.
// Demo records (sample applications, staff accounts with known passwords) are never created in production.
const connectDB = require('../../config/db');
const env = require('../../config/env');

const MODULES = [require('./visa')];

const byName = Object.fromEntries(MODULES.map((module) => [module.name, module]));

const pick = (names) => {
  if (!names.length) return MODULES;
  return names.map((name) => {
    if (!byName[name]) throw new Error(`Unknown seed module "${name}". Available: ${MODULES.map((m) => m.name).join(', ')}.`);
    return byName[name];
  });
};

// Exported so a test can run it against its own connection.
const run = async (command, names = [], { allowProduction = false, log = console.log } = {}) => {
  if (!['seed', 'clear', 'reset'].includes(command)) throw new Error('Usage: seed | clear | reset [module...] [--allow-production]');
  if (command !== 'seed' && env.isProduction && !allowProduction) {
    throw new Error(`"${command}" deletes data and will not run in production. Add --allow-production if you really mean it.`);
  }

  const modules = pick(names);
  const summary = {};
  if (command === 'clear' || command === 'reset') {
    // Clear in reverse order, so a module that depends on another is emptied first.
    for (const module of [...modules].reverse()) {
      summary[`${module.name}.cleared`] = await module.clear();
      log(`cleared ${module.name}`);
    }
  }
  if (command === 'seed' || command === 'reset') {
    for (const module of modules) {
      summary[`${module.name}.seeded`] = await module.seed({ demo: !env.isProduction });
      log(`seeded ${module.name}`);
    }
  }
  return summary;
};

module.exports = { run, MODULES };

if (require.main === module) {
  (async () => {
    const [command, ...rest] = process.argv.slice(2);
    const allowProduction = rest.includes('--allow-production');
    const names = rest.filter((arg) => !arg.startsWith('--'));

    await connectDB();
    const summary = await run(command, names, { allowProduction });
    console.log(JSON.stringify(summary, null, 2));
  })()
    .then(() => require('mongoose').disconnect())
    .catch(async (err) => {
      console.error(err.message);
      await require('mongoose').disconnect().catch(() => {});
      process.exit(1);
    });
}
