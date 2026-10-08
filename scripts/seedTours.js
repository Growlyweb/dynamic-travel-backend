// Creates the 8 starting tour categories and the Cox's Bazar sample tour from the handoff.
// Safe to run again: anything that already exists is left exactly as it is. Usage: npm run seed:tours
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const TourCategory = require('../models/TourCategory');
const Tour = require('../models/Tour');
const { keyOf, slugOf } = require('../services/tourCategoryService');

// The ids on the left are the ones the frontend already uses. They are kept in `legacyId`.
const CATEGORIES = [
  ['cat_beach', 'Beach & Resort'],
  ['cat_adventure', 'Adventure & Trekking'],
  ['cat_honeymoon', 'Honeymoon & Romantic'],
  ['cat_family', 'Family Special'],
  ['cat_cultural', 'Cultural & Heritage'],
  ['cat_luxury', 'Luxury & Wellness'],
  ['cat_city', 'City Break'],
  ['cat_custom_group', 'Custom Group']
];

const SAMPLE_TOUR = {
  legacyId: 'tour_205',
  categoryLegacyId: 'cat_beach',
  name: "Cox's Bazar Beach Escape",
  country: 'Bangladesh',
  destination: "Cox's Bazar, Bangladesh",
  durationDays: 3,
  priceCurrency: 'BDT',
  price: 12500,
  b2bPrice: 10000,
  seats: 25,
  status: 'published',
  rating: 4.9,
  coverImage: 'https://picsum.photos/seed/coxs-bazar/900/560',
  description: 'Experience the world longest natural sea beach with luxury resort stay and fresh seafood.',
  included: ['2 nights hotel stay', 'Breakfast included', 'Beach tour & sunset view'],
  excluded: ['Personal expenses', 'Shopping'],
  hotels: ['Ocean Paradise Hotel & Resort'],
  itinerary: [
    { day: 1, title: 'Arrival & Beach Sunset', description: 'Check-in, relax at Laboni Beach, enjoy sunset.' },
    { day: 2, title: 'Inani Beach & Himchari', description: 'Day trip to Inani rocky beach and Himchari waterfall.' },
    { day: 3, title: 'Departure', description: 'Morning shopping at Burmese market, airport transfer.' }
  ],
  terms: 'Standard cancellation rules apply.'
};

// Returns what it created, so a test (or a person) can see whether anything changed.
const seedTours = async () => {
  const created = { categories: [], tours: [] };

  for (const [legacyId, name] of CATEGORIES) {
    const nameKey = keyOf(name);
    const exists = await TourCategory.exists({ $or: [{ legacyId }, { nameKey }] });
    if (exists) continue;
    await TourCategory.create({ name, nameKey, slug: slugOf(name), legacyId });
    created.categories.push(name);
  }

  if (!(await Tour.exists({ legacyId: SAMPLE_TOUR.legacyId }))) {
    const { categoryLegacyId, ...tour } = SAMPLE_TOUR;
    const category = await TourCategory.findOne({ legacyId: categoryLegacyId });
    await Tour.create({ ...tour, category: category && category._id });
    created.tours.push(tour.name);
  }
  return created;
};

module.exports = { seedTours, CATEGORIES, SAMPLE_TOUR };

if (require.main === module) {
  (async () => {
    await connectDB();
    await TourCategory.syncIndexes();
    await Tour.syncIndexes();

    const { categories, tours } = await seedTours();
    console.log(categories.length ? `Categories created: ${categories.join(', ')}` : 'All 8 categories already exist.');
    console.log(tours.length ? `Sample tour created: ${tours.join(', ')}` : 'The sample tour already exists.');
  })()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err.message || err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
