const mongoose = require('mongoose');
const VisaApplication = require('../models/VisaApplication');
const VisaCountry = require('../models/VisaCountry');
const VisaType = require('../models/VisaType');
const TourBooking = require('../models/TourBooking');
const CustomTourRequest = require('../models/CustomTourRequest');
const SavedItem = require('../models/SavedItem');
const counterService = require('./counterService');
const auditService = require('./auditService');
const events = require('../utils/events');
const ApiError = require('../utils/ApiError');
const { AUDIT_ACTIONS } = require('../config/constants');

const passportKey = (val) => String(val || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const mapStatusToCustomerTone = (status) => {
  const s = String(status || '').toLowerCase();
  if (['approved', 'completed', 'issued'].includes(s)) return 'Approved';
  if (['rejected', 'cancelled'].includes(s)) return 'Rejected';
  if (['draft'].includes(s)) return 'Draft';
  return 'In Process';
};

exports.getOverview = async (user) => {
  const [
    visaCount,
    tourCount,
    customCount,
    savedCount,
    recentVisas,
    recentTours,
    recentCustoms
  ] = await Promise.all([
    VisaApplication.countDocuments({ createdBy: user._id, serviceType: 'visa' }),
    TourBooking.countDocuments({ userId: user._id }),
    CustomTourRequest.countDocuments({ userId: user._id }),
    SavedItem.countDocuments({ userId: user._id }),
    VisaApplication.find({ createdBy: user._id, serviceType: 'visa' }).sort({ createdAt: -1 }).limit(5).lean(),
    TourBooking.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    CustomTourRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean()
  ]);

  const recentUpdates = [];
  recentVisas.slice(0, 3).forEach((v) => {
    recentUpdates.push({
      id: `up-${v._id}`,
      text: `Your visa application for ${v.countryName} is ${v.status}`,
      date: new Date(v.createdAt).toISOString().slice(0, 10),
      tone: v.status === 'approved' ? 'green' : v.status === 'rejected' ? 'red' : 'blue'
    });
  });

  return {
    counts: {
      visaApplications: visaCount,
      tourBookings: tourCount,
      customTours: customCount,
      savedItems: savedCount
    },
    recentVisas: recentVisas.map((v) => ({
      id: v.number,
      country: v.countryName,
      visaType: v.visaTypeName,
      appliedDate: new Date(v.createdAt).toISOString().slice(0, 10),
      travelDate: v.applicant?.dob || new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
      status: mapStatusToCustomerTone(v.status)
    })),
    recentTours: recentTours.map((t) => ({
      id: t.bookingRef,
      name: t.tourName,
      destination: t.destination,
      startDate: new Date(t.startDate).toISOString().slice(0, 10),
      endDate: new Date(t.endDate).toISOString().slice(0, 10),
      travelers: t.travelers,
      status: t.status,
      image: t.image
    })),
    recentCustoms: recentCustoms.map((c) => ({
      id: `CT-${c._id.toString().slice(-6).toUpperCase()}`,
      name: `${c.destination} Custom Tour`,
      destinations: c.destination,
      startDate: new Date(c.startDate).toISOString().slice(0, 10),
      endDate: new Date(c.endDate).toISOString().slice(0, 10),
      travelers: `${c.travelers} Travelers`,
      status: c.status === 'quoted' ? 'Quotation Sent' : c.status === 'confirmed' ? 'Confirmed' : 'Pending',
      summary: c.requirements || 'Custom itinerary'
    })),
    recentUpdates
  };
};

exports.listVisaApplications = async (user, query = {}) => {
  const filter = { createdBy: user._id, serviceType: 'visa' };
  const items = await VisaApplication.find(filter).sort({ createdAt: -1 }).lean();

  return items.map((app) => ({
    id: app.number,
    _id: app._id,
    countryCode: (app.countryName === 'China' ? 'cn' : app.countryName === 'Thailand' ? 'th' : app.countryName === 'Malaysia' ? 'my' : app.countryName === 'Singapore' ? 'sg' : 'ae'),
    country: app.countryName,
    visaType: app.visaTypeName,
    appliedDate: new Date(app.createdAt).toISOString().slice(0, 10),
    travelDate: app.applicant?.dob || new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
    status: mapStatusToCustomerTone(app.status),
    timeline: app.timeline || [],
    documents: app.documents || []
  }));
};

exports.createVisaApplication = async (user, body, files = {}) => {
  // Find country
  let country = null;
  if (body.countryId && mongoose.isValidObjectId(body.countryId)) {
    country = await VisaCountry.findById(body.countryId);
  } else if (body.countryCode) {
    country = await VisaCountry.findOne({ code: body.countryCode.toUpperCase() });
  } else if (body.country) {
    country = await VisaCountry.findOne({ name: new RegExp(`^${body.country.trim()}$`, 'i') });
  }

  // Find visa type
  let type = null;
  if (body.visaTypeId && mongoose.isValidObjectId(body.visaTypeId)) {
    type = await VisaType.findById(body.visaTypeId);
  } else if (body.applicationType || body.visaType) {
    const typeName = body.applicationType || body.visaType;
    type = await VisaType.findOne({ name: new RegExp(`^${typeName.trim()}$`, 'i') });
  }

  const appNumber = await counterService.nextNumber('ABL', { width: 6 });
  const fee = Number(body.fee) || 12500;

  // Documents mapping if files provided
  const documents = [];
  if (files && typeof files === 'object') {
    Object.entries(files).forEach(([field, fileList]) => {
      const arr = Array.isArray(fileList) ? fileList : [fileList];
      arr.filter(Boolean).forEach((f) => {
        documents.push({
          type: field,
          originalName: f.originalname || f.name || 'document',
          mimeType: f.mimetype || 'application/octet-stream',
          size: f.size || 0,
          storagePath: f.path || f.filename || `uploads/${field}`,
          status: 'pending',
          uploadedBy: user._id,
          uploadedByName: user.name || 'Customer'
        });
      });
    });
  }

  const application = await VisaApplication.create({
    number: appNumber,
    serviceType: 'visa',
    channel: 'b2c',
    country: country ? country._id : new mongoose.Types.ObjectId(),
    countryName: country ? country.name : (body.country || 'China'),
    visaType: type ? type._id : new mongoose.Types.ObjectId(),
    visaTypeName: type ? type.name : (body.applicationType || body.visaType || 'Tourist Visa'),
    applicant: {
      fullName: body.givenName && body.surname ? `${body.givenName} ${body.surname}` : (body.applicantName || user.name),
      mobile: body.contactNumber || body.contactPhone || user.phone || '+8801700000000',
      email: body.email || user.email,
      address: body.pickupAddress || '',
      applicantType: 'individual'
    },
    passport: {
      number: body.passportNumber || body.passportNo,
      numberKey: passportKey(body.passportNumber || body.passportNo),
      expiry: body.passportExpiry || ''
    },
    documents,
    status: 'submitted',
    statusHistory: [{ status: 'submitted', at: new Date() }],
    timeline: [
      {
        event: 'Application Submitted',
        message: 'Application submitted via Customer Portal',
        visibility: 'both',
        by: 'Customer',
        byUserId: user._id
      }
    ],
    price: {
      currency: 'BDT',
      rateToBase: 1,
      b2c: fee,
      b2b: fee,
      fees: { service: 2500, embassy: fee - 2500, vat: 0 }
    },
    account: {
      totalAmount: fee,
      netAmount: fee,
      advancePaid: 0,
      dueAmount: fee,
      paymentStatus: 'Unpaid'
    },
    createdBy: user._id
  });

  events.emit(events.EVENTS.VISA_APPLICATION_CREATED, {
    applicationId: String(application._id),
    number: application.number
  });

  await auditService.record({
    actorUserId: user._id,
    action: AUDIT_ACTIONS.VISA_APPLICATION_CREATED || 'VISA_APPLICATION_CREATED',
    resource: 'VisaApplication',
    resourceId: application._id,
    details: { number: application.number, channel: 'b2c' }
  });

  return {
    id: application.number,
    _id: application._id,
    refNumber: application.number,
    number: application.number,
    country: application.countryName,
    visaType: application.visaTypeName,
    status: 'In Process',
    createdAt: application.createdAt
  };
};

exports.listTourBookings = async (user) => {
  const items = await TourBooking.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
  return items.map((t) => ({
    id: t.bookingRef,
    _id: t._id,
    name: t.tourName,
    duration: t.duration || '5 Days 4 Nights',
    destination: t.destination,
    startDate: new Date(t.startDate).toISOString().slice(0, 10),
    endDate: new Date(t.endDate).toISOString().slice(0, 10),
    travelers: t.travelers,
    status: t.status,
    image: t.image
  }));
};

exports.createTourBooking = async (user, body) => {
  const ref = `TP-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
  const booking = await TourBooking.create({
    userId: user._id,
    bookingRef: body.bookingRef || ref,
    tourId: body.tourId || '',
    tourName: body.tourName || 'Tour Package',
    destination: body.destination || 'International Destination',
    duration: body.duration || '5 Days 4 Nights',
    startDate: body.startDate ? new Date(body.startDate) : new Date(Date.now() + 86400000 * 15),
    endDate: body.endDate ? new Date(body.endDate) : new Date(Date.now() + 86400000 * 20),
    travelers: body.travelers || '2 Adults',
    totalPrice: Number(body.totalPrice) || 0,
    currency: body.currency || 'USD',
    status: 'Upcoming',
    image: body.image || '',
    contact: {
      name: body.contact?.name || user.name,
      email: body.contact?.email || user.email,
      phone: body.contact?.phone || user.phone || ''
    },
    notes: body.notes || ''
  });

  return booking;
};

exports.listSavedItems = async (user) => {
  return SavedItem.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
};

exports.addSavedItem = async (user, body) => {
  const item = await SavedItem.findOneAndUpdate(
    { userId: user._id, kind: body.kind, title: body.title },
    {
      userId: user._id,
      kind: body.kind,
      title: body.title,
      place: body.place || '',
      countryCode: body.countryCode || '',
      image: body.image || '',
      href: body.href || '',
      meta: body.meta || []
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return item;
};

exports.removeSavedItem = async (user, id) => {
  const deleted = await SavedItem.findOneAndDelete({ _id: id, userId: user._id });
  return Boolean(deleted);
};
