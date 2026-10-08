// Comprehensive Seed script to populate MongoDB with initial Admin, Staff, Customers, B2B Partners, and Audit Logs.
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const env = require('../config/env');
const { ROLES, USER_STATUS, APPROVAL_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const User = require('../models/User');
const Partner = require('../models/Partner');
const AuditLog = require('../models/AuditLog');
const TourCategory = require('../models/TourCategory');
const Tour = require('../models/Tour');
const CustomTourRequest = require('../models/CustomTourRequest');
const authService = require('../services/authService');

(async () => {
  console.log('⚡ Connecting to database for seeding...');
  await connectDB();
  await User.syncIndexes();
  await Partner.syncIndexes();
  await AuditLog.syncIndexes();
  await TourCategory.syncIndexes();
  await Tour.syncIndexes();
  await CustomTourRequest.syncIndexes();

  // 1. Seed Admin
  const adminEmail = env.adminSeed?.email || 'admin@example.com';
  const adminPassword = env.adminSeed?.password || 'Admin@12345';
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      name: 'Super Admin',
      email: adminEmail,
      passwordHash: await authService.hashPassword(adminPassword),
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    console.log(`✅ Admin created: ${admin.email} / ${adminPassword}`);
  } else {
    console.log(`ℹ️ Admin exists: ${admin.email}`);
  }

  // 2. Seed Staff
  const staffEmail = 'staff@example.com';
  const staffPassword = 'Staff@12345';
  let staff = await User.findOne({ email: staffEmail });
  if (!staff) {
    staff = await User.create({
      name: 'Operations Manager',
      email: staffEmail,
      passwordHash: await authService.hashPassword(staffPassword),
      role: ROLES.STAFF,
      permissions: ['VISA_VIEW', 'VISA_UPDATE', 'B2B_VIEW', 'B2B_APPROVE', 'DOCUMENT_VIEW', 'DOCUMENT_VERIFY', 'USER_VIEW', 'REPORT_VIEW', 'TOUR_MANAGE'],
      status: USER_STATUS.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    console.log(`✅ Staff created: ${staff.email} / ${staffPassword}`);
  } else {
    console.log(`ℹ️ Staff exists: ${staff.email}`);
  }

  // 3. Seed B2C Customers
  const customerData = [
    { name: 'Rohan Gupta', email: 'rohan.gupta@example.com', phone: '+8801710000001' },
    { name: 'Sara Ali', email: 'sara.ali@example.com', phone: '+8801710000002' },
    { name: 'Tom Becker', email: 'tom.becker@example.com', phone: '+8801710000003' },
    { name: 'Nina Roy', email: 'nina.roy@example.com', phone: '+8801710000004' },
    { name: 'Mei Chen', email: 'mei.chen@example.com', phone: '+8801710000005' },
  ];

  for (const c of customerData) {
    let cust = await User.findOne({ email: c.email });
    if (!cust) {
      await User.create({
        name: c.name,
        email: c.email,
        phone: c.phone,
        passwordHash: await authService.hashPassword('Customer@12345'),
        role: ROLES.B2C,
        status: USER_STATUS.ACTIVE,
        emailVerified: true,
      });
      console.log(`✅ Customer created: ${c.email}`);
    }
  }

  // 4. Seed B2B Partners
  const partnerSeedData = [
    {
      companyName: 'Skyline Travels & Tours',
      licenseNo: 'LIC-2026-8801',
      businessType: 'Travel Agency',
      address: 'Gulshan 2, Dhaka, Bangladesh',
      email: 'contact@skylinetravels.test',
      ownerName: 'Skyline Admin',
      approvalStatus: APPROVAL_STATUS.APPROVED,
    },
    {
      companyName: 'Global Horizon Expeditions',
      licenseNo: 'LIC-2026-8802',
      businessType: 'Tour Operator',
      address: 'Banani C/A, Dhaka, Bangladesh',
      email: 'info@globalhorizon.test',
      ownerName: 'Horizon Manager',
      approvalStatus: APPROVAL_STATUS.PENDING,
    },
    {
      companyName: 'Apex Express Visa Services',
      licenseNo: 'LIC-2026-8803',
      businessType: 'Visa Consultancy',
      address: 'Dhanmondi 27, Dhaka, Bangladesh',
      email: 'support@apexvisa.test',
      ownerName: 'Apex Owner',
      approvalStatus: APPROVAL_STATUS.APPROVED,
    },
  ];

  for (const p of partnerSeedData) {
    let pUser = await User.findOne({ email: p.email });
    if (!pUser) {
      pUser = await User.create({
        name: p.ownerName,
        email: p.email,
        passwordHash: await authService.hashPassword('Partner@12345'),
        role: ROLES.B2B,
        status: USER_STATUS.ACTIVE,
        emailVerified: true,
      });

      const partner = await Partner.create({
        userId: pUser._id,
        companyName: p.companyName,
        licenseNo: p.licenseNo,
        businessType: p.businessType,
        address: p.address,
        approvalStatus: p.approvalStatus,
        reviewedBy: admin._id,
        reviewedAt: new Date(),
      });

      pUser.partnerId = partner._id;
      await pUser.save();
      console.log(`✅ Partner created: ${p.companyName} (${p.approvalStatus})`);
    }
  }

  // 5. Seed Tour Categories
  const categorySeedData = [
    { legacyId: 'cat_beach', name: 'Beach & Resort' },
    { legacyId: 'cat_adventure', name: 'Adventure & Trekking' },
    { legacyId: 'cat_honeymoon', name: 'Honeymoon & Romantic' },
    { legacyId: 'cat_family', name: 'Family Special' },
    { legacyId: 'cat_cultural', name: 'Cultural & Heritage' },
    { legacyId: 'cat_luxury', name: 'Luxury & Wellness' },
    { legacyId: 'cat_city', name: 'City Break' },
    { legacyId: 'cat_custom_group', name: 'Custom Group' },
  ];

  const categoryMap = {};
  for (const cat of categorySeedData) {
    const nameKey = cat.name.trim().replace(/\s+/g, ' ').toLowerCase();
    const slug = nameKey.replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let existingCat = await TourCategory.findOne({ legacyId: cat.legacyId });
    if (!existingCat) {
      existingCat = await TourCategory.findOne({ nameKey });
    }
    if (!existingCat) {
      existingCat = await TourCategory.create({
        legacyId: cat.legacyId,
        name: cat.name,
        nameKey,
        slug,
        isActive: true,
      });
      console.log(`✅ Category created: ${cat.name}`);
    } else {
      console.log(`ℹ️ Category exists: ${cat.name}`);
    }
    categoryMap[cat.legacyId] = existingCat._id;
  }

  // 6. Seed Tour Packages
  const tourSeedData = [
    {
      legacyId: 'tour_205',
      name: "Cox's Bazar Beach Escape",
      country: 'Bangladesh',
      destination: "Cox's Bazar, Bangladesh",
      categoryLegacyId: 'cat_beach',
      durationDays: 3,
      priceCurrency: 'BDT',
      price: 12500,
      b2bPrice: 10000,
      seats: 25,
      status: 'published',
      rating: 4.9,
      coverImage: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80',
      description: 'Experience the world longest natural sea beach with luxury resort stay and fresh seafood.',
      included: ['2 nights hotel stay', 'Breakfast included', 'Beach tour & sunset view'],
      excluded: ['Personal expenses', 'Shopping'],
      hotels: ['Ocean Paradise Hotel & Resort'],
      itinerary: [
        { day: 1, title: 'Arrival & Beach Sunset', description: 'Check-in, relax at Laboni Beach, enjoy sunset.' },
        { day: 2, title: 'Inani Beach & Himchari', description: 'Day trip to Inani rocky beach and Himchari waterfall.' },
        { day: 3, title: 'Departure', description: 'Morning shopping at Burmese market, airport transfer.' },
      ],
      terms: 'Standard cancellation rules apply.',
    },
    {
      legacyId: 'tour_206',
      name: 'Sylhet Tea Garden Experience',
      country: 'Bangladesh',
      destination: 'Sylhet, Bangladesh',
      categoryLegacyId: 'cat_cultural',
      durationDays: 2,
      priceCurrency: 'BDT',
      price: 8500,
      b2bPrice: 6800,
      seats: 20,
      status: 'published',
      rating: 4.8,
      coverImage: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=900&q=80',
      description: 'Lush green tea gardens, Jaflong stone collection and Ratargul swamp forest tour.',
      included: ['1 night resort stay', 'Boat ride at Ratargul & Jaflong', 'All local transfers'],
      excluded: ['Personal shopping'],
      hotels: ['Grand Sultan Tea Resort'],
      itinerary: [
        { day: 1, title: 'Ratargul & Tea Gardens', description: 'Boat safari in Ratargul freshwater swamp forest, evening tea tasting.' },
        { day: 2, title: 'Jaflong & Departure', description: 'Visit Zero Point Jaflong and Khasia village, return transfer.' },
      ],
      terms: 'Standard cancellation rules apply.',
    },
    {
      legacyId: 'tour_201',
      name: 'Bali Escape',
      country: 'Indonesia',
      destination: 'Bali, Indonesia',
      categoryLegacyId: 'cat_beach',
      durationDays: 7,
      priceCurrency: 'USD',
      price: 1450,
      b2bPrice: 1180,
      seats: 18,
      status: 'published',
      rating: 4.8,
      coverImage: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=80',
      gallery: [
        'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=600&q=80',
        'https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=600&q=80',
      ],
      description: 'Seven days across Ubud and Seminyak: rice terraces, temple mornings, a volcano sunrise trek and two lazy beach days to finish.',
      included: [
        '6 nights accommodation with breakfast',
        'All airport and hotel transfers',
        'English-speaking guide throughout',
        'Volcano sunrise trek with breakfast box',
        'Kecak dance tickets at Uluwatu',
      ],
      excluded: ['International flights', 'Travel insurance', 'Bali tourist visa fee', 'Personal expenses and tips'],
      hotels: ['Ubud: Puri Sebali Resort or Similar', 'Seminyak: The Sangrah Villas or Similar'],
      itinerary: [
        { day: 1, title: 'Arrival in Denpasar', description: 'Airport pickup, transfer to Ubud resort and a free evening to settle in.' },
        { day: 2, title: 'Ubud temples & rice terraces', description: 'Tirta Empul water temple, Tegalalang rice terraces and a Balinese cooking class.' },
        { day: 3, title: 'Mount Batur sunrise trek', description: 'Pre-dawn hike up Mount Batur, breakfast at the summit and a hot-spring stop on the way down.' },
        { day: 4, title: 'Transfer to Seminyak', description: 'Scenic drive via Jatiluwih terraces, check-in at the beach hotel, sunset at Tanah Lot.' },
        { day: 5, title: 'Beach & Uluwatu', description: 'Free beach morning, Kecak fire dance at Uluwatu cliff temple and a seafood dinner on Jimbaran bay.' },
        { day: 6, title: 'Free day', description: 'Optional snorkeling trip to Nusa Penida or a spa day — the day is yours.' },
        { day: 7, title: 'Departure', description: 'Transfer to the airport for your flight home.' },
      ],
      terms: 'Free cancellation up to 14 days before departure; 50% charge within 14 days, no refund within 72 hours.',
    },
    {
      legacyId: 'tour_202',
      name: 'Swiss Alps Explorer',
      country: 'Switzerland',
      destination: 'Zurich, Switzerland',
      categoryLegacyId: 'cat_adventure',
      durationDays: 5,
      priceCurrency: 'EUR',
      price: 2210,
      b2bPrice: 1850,
      seats: 12,
      status: 'published',
      rating: 4.6,
      coverImage: 'https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?auto=format&fit=crop&w=900&q=80',
      description: 'Five days of peaks and panoramas: Lucerne, Interlaken and the Jungfraujoch — the top of Europe — with scenic rail between every stop.',
      included: [
        '4 nights in 4-star hotels with breakfast',
        'Swiss Travel Pass (2nd class) for all rail journeys',
        'Jungfraujoch excursion with guide',
        'Lake Lucerne cruise',
      ],
      excluded: ['Flights to/from Zurich', 'Lunches and dinners', 'Optional cable cars not listed'],
      hotels: ['Lucerne: Hotel Astoria or Similar', 'Interlaken: Hotel Interlaken or Similar'],
      itinerary: [
        { day: 1, title: 'Arrive Zurich', description: 'Meet at the airport, transfer to Lucerne and an evening walk across Chapel Bridge.' },
        { day: 2, title: 'Lucerne & lake cruise', description: 'Old-town tour, Lion Monument and a paddle-steamer cruise on Lake Lucerne.' },
        { day: 3, title: 'Interlaken', description: 'Scenic rail to Interlaken, free afternoon for paragliding or lakeside walks.' },
        { day: 4, title: 'Jungfraujoch — Top of Europe', description: 'Cogwheel train to the Sphinx observatory, ice palace and glacier views at 3,454 m.' },
        { day: 5, title: 'Departure', description: 'Return rail to Zurich and airport transfer.' },
      ],
      terms: 'Full payment due at booking; free cancellation up to 21 days before departure.',
    },
    {
      legacyId: 'tour_203',
      name: 'Dubai City Break',
      country: 'UAE',
      destination: 'Dubai, UAE',
      categoryLegacyId: 'cat_city',
      durationDays: 4,
      priceCurrency: 'USD',
      price: 980,
      b2bPrice: 790,
      seats: 24,
      status: 'published',
      rating: 4.4,
      coverImage: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=900&q=80',
      description: 'A long weekend of skylines and desert: Burj Khalifa at sunset, a dhow dinner cruise, a morning desert safari and old-Dubai souks.',
      included: ['3 nights hotel with breakfast', 'Burj Khalifa 124th-floor tickets', 'Desert safari with BBQ dinner', 'Dhow dinner cruise'],
      excluded: ['Flights', 'UAE visa', 'Personal expenses'],
      hotels: ['Dubai: Rove Downtown or Similar'],
      itinerary: [
        { day: 1, title: 'Arrival & marina walk', description: 'Airport pickup, evening stroll around Dubai Marina.' },
        { day: 2, title: 'Old & new Dubai', description: 'Souks, Dubai Frame and Burj Khalifa at sunset with fountain show.' },
        { day: 3, title: 'Desert safari', description: 'Dune bashing, camel ride and BBQ dinner under the stars.' },
        { day: 4, title: 'Departure', description: 'Free morning for shopping, then airport transfer.' },
      ],
      terms: '50% deposit confirms booking, balance due 10 days before arrival.',
    },
    {
      legacyId: 'tour_204',
      name: 'Nepal Himalaya Trek',
      country: 'Nepal',
      destination: 'Kathmandu & Pokhara, Nepal',
      categoryLegacyId: 'cat_adventure',
      durationDays: 10,
      priceCurrency: 'USD',
      price: 890,
      b2bPrice: 720,
      seats: 15,
      status: 'published',
      rating: 4.9,
      coverImage: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=900&q=80',
      description: 'Ten unforgettable days across the roof of the world — Kathmandu temples, the Annapurna foothills and sunrise over Phewa Lake.',
      included: [
        '9 nights accommodation (hotels + teahouses)',
        'All meals during trek',
        'Licensed trekking guide & porter',
        'Domestic Kathmandu–Pokhara flight',
        'All national park entry permits',
      ],
      excluded: ['International flights', 'Nepal visa fee', 'Travel insurance', 'Tips'],
      hotels: ['Kathmandu: Hotel Thamel Eco Resort or Similar', 'Pokhara: Temple Tree Resort or Similar'],
      itinerary: [
        { day: 1, title: 'Arrival in Kathmandu', description: 'Airport pickup and welcome dinner in Thamel.' },
        { day: 2, title: 'Kathmandu Valley sightseeing', description: 'Pashupatinath, Boudhanath stupa and Durbar Square.' },
        { day: 3, title: 'Fly to Pokhara', description: '25-minute mountain flight, lakeside afternoon.' },
        { day: 4, title: 'Trek begins — Nayapul to Tikhedhunga', description: '4–5 hours through terraced rice fields and waterfalls.' },
        { day: 5, title: 'Tikhedhunga to Ghorepani', description: 'Climb through rhododendron forests to 2,874 m.' },
        { day: 6, title: 'Poon Hill sunrise (3,210 m)', description: 'Pre-dawn hike for panoramic Annapurna and Dhaulagiri views.' },
        { day: 7, title: 'Trek to Tadapani', description: 'Beautiful ridge walk through lush forest.' },
        { day: 8, title: 'Descent to Ghandruk', description: 'Gurung cultural village and museum visit.' },
        { day: 9, title: 'Return to Pokhara', description: 'Drive back, free lakeside evening.' },
        { day: 10, title: 'Departure from Kathmandu', description: 'Morning flight to Kathmandu and international departure.' },
      ],
      terms: 'Booking requires 25% deposit; balance due 30 days before departure.',
    },
  ];

  for (const t of tourSeedData) {
    let existingTour = await Tour.findOne({ legacyId: t.legacyId });
    if (!existingTour) {
      existingTour = await Tour.findOne({ name: t.name });
    }
    if (!existingTour) {
      await Tour.create({
        ...t,
        category: categoryMap[t.categoryLegacyId] || null,
      });
      console.log(`✅ Tour created: ${t.name}`);
    } else {
      console.log(`ℹ️ Tour exists: ${t.name}`);
    }
  }

  // 7. Seed Custom Tour Requests
  const customerUser = await User.findOne({ role: ROLES.B2C });
  if (customerUser) {
    const customTourCount = await CustomTourRequest.countDocuments();
    if (customTourCount === 0) {
      await CustomTourRequest.create([
        {
          userId: customerUser._id,
          customer: 'Jane & Mark Doyle',
          phone: '+8801712556340',
          destination: 'Maldives',
          travelers: 2,
          startDate: new Date('2026-11-10'),
          endDate: new Date('2026-11-16'),
          status: 'NEW',
          hotel: 'resort',
          transportation: 'Flight',
          activities: ['Beach day', 'Snorkeling / diving'],
          requirements: 'Overwater villa, anniversary dinner on the beach.',
          itinerary: [
            { day: 1, title: 'Arrival in Malé & speedboat transfer', description: 'Arrival, transfer to the resort and sunset welcome dinner.' },
            { day: 2, title: 'Snorkeling / diving', description: 'House-reef snorkeling trip with a marine guide.' },
            { day: 3, title: 'Rest & local time', description: 'Spa afternoon and sandbank picnic.' },
            { day: 4, title: 'Beach day', description: 'Full day on a private sandbank with beach games.' },
            { day: 5, title: 'Rest & local time', description: 'Free day for the pool, spa or optional add-ons.' },
            { day: 6, title: 'Sunset dolphin cruise', description: 'Evening dolphin cruise with canapés.' },
            { day: 7, title: 'Departure', description: 'Speedboat to Malé and flight home.' },
          ],
        },
        {
          userId: customerUser._id,
          customer: 'Nimbus Labs Team',
          phone: '+8801977402118',
          destination: 'Goa, India',
          travelers: 14,
          startDate: new Date('2026-12-05'),
          endDate: new Date('2026-12-08'),
          status: 'QUOTED',
          hotel: '4-star',
          transportation: 'Minibus',
          activities: ['Beach day', 'Food tour', 'Water sports'],
          requirements: 'Team-building activities on day 2, vegetarian catering.',
          itinerary: [
            { day: 1, title: 'Arrival in Goa', description: 'Minibus transfer to the hotel, welcome dinner.' },
            { day: 2, title: 'Beach day', description: 'Team-building games on the beach followed by a BBQ evening.' },
            { day: 3, title: 'Food tour', description: 'Guided Goan street-food trail in Panjim and Fontainhas.' },
            { day: 4, title: 'Departure', description: 'Check-out and transfer to the airport.' },
          ],
        },
      ]);
      console.log('✅ Custom tour requests seeded.');
    } else {
      console.log(`ℹ️ Custom tour requests exist: ${customTourCount} entries`);
    }
  }

  // 8. Seed Audit Logs
  const logCount = await AuditLog.countDocuments();
  if (logCount === 0) {
    const auditLogsToCreate = [
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Admin Console',
        createdAt: new Date(Date.now() - 3600000 * 1),
      },
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.PARTNER_APPROVE,
        targetUserId: admin._id,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Skyline Travels & Tours',
        createdAt: new Date(Date.now() - 3600000 * 3),
      },
      {
        actorUserId: staff._id,
        action: AUDIT_ACTIONS.USER_UPDATE,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Rohan Gupta Profile',
        createdAt: new Date(Date.now() - 3600000 * 5),
      },
      {
        actorUserId: admin._id,
        action: AUDIT_ACTIONS.DOCUMENT_VERIFY,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Trade License LIC-2026-8801',
        createdAt: new Date(Date.now() - 3600000 * 8),
      },
      {
        actorUserId: staff._id,
        action: AUDIT_ACTIONS.USER_LOGIN,
        result: 'SUCCESS',
        ip: '127.0.0.1',
        resource: 'Staff Workstation',
        createdAt: new Date(Date.now() - 3600000 * 12),
      },
    ];

    await AuditLog.insertMany(auditLogsToCreate);
    console.log('✅ Audit logs seeded.');
  } else {
    console.log(`ℹ️ Audit logs already exist: ${logCount} entries`);
  }
})()
  .then(() => mongoose.disconnect())
  .then(() => {
    console.log('🎉 Seeding complete.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Seeding failed:', err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });

