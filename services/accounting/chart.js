const Account = require('../../models/Account');
const SaleCategory = require('../../models/SaleCategory');
const { ACCOUNTS, DEFAULT_CATEGORIES } = require('../../config/accounting');

// Creates the accounts and the five built-in sale categories that are missing. Nothing already there is touched, so a
// change made by an admin survives a restart. Called at server start and by the seed.
const ensureChart = async () => {
  await Account.bulkWrite(
    ACCOUNTS.map((account) => ({
      updateOne: { filter: { code: account.code }, update: { $setOnInsert: { ...account, control: account.control || null } }, upsert: true }
    }))
  );
  await SaleCategory.bulkWrite(
    DEFAULT_CATEGORIES.map((category) => ({
      updateOne: {
        filter: { labelKey: category.label.toLowerCase() },
        update: { $setOnInsert: { ...category, labelKey: category.label.toLowerCase(), builtin: true } },
        upsert: true
      }
    }))
  );
};

// Tests and a fresh database may have no chart yet. This makes sure it is there without touching an existing one.
const ensureChartIfEmpty = async () => {
  if ((await Account.estimatedDocumentCount()) === 0) await ensureChart();
};

module.exports = { ensureChart, ensureChartIfEmpty };
