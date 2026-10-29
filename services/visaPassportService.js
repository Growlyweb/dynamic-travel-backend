const VisaType = require('../models/VisaType');
const { AUDIT_ACTIONS } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const { checkStaff } = require('./visaApplicationService');
const { findApplication, actorOf, addTimeline } = require('./visaShared');

const humanize = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const METHOD_TEXT = {
  pickup: 'Pickup service selected for the original passport.',
  office: 'Applicant will submit the original passport at our office.',
  online: 'Online processing. No physical passport required.'
};

const conflict = (message) => new ApiError(409, message, { code: 'INVALID_PASSPORT_CHANGE' });

// What the visa type allows: online processing, office submission and pickup.
const allowedMethods = async (application) => {
  const type = await VisaType.findById(application.visaType).select('passportRequirement pickupAvailable officeSubmissionAvailable');
  const physical = application.passportRequirement === 'physical_required' || (type && type.passportRequirement === 'physical_required');
  return {
    online: !physical,
    office: physical || Boolean(type && type.officeSubmissionAvailable),
    pickup: Boolean(type && type.pickupAvailable)
  };
};

// One call changes any part of the passport handling. The pieces are applied in this order: submission method,
// pickup request, pickup staff, then the passport status with its details.
const update = async (user, id, body, context = {}) => {
  const application = await findApplication(id);
  if (application.serviceType !== 'visa') throw conflict('Passport handling applies to visa applications only.');
  const actor = await actorOf(user);

  if (body.passportSubmissionMethod) {
    const allowed = await allowedMethods(application);
    if (!allowed[body.passportSubmissionMethod]) throw conflict(`This visa type does not allow "${body.passportSubmissionMethod}" passport handling.`);
    application.passportSubmissionMethod = body.passportSubmissionMethod;
    application.passportStatus = body.passportSubmissionMethod === 'online' ? 'not_required' : 'not_received';
    if (body.passportSubmissionMethod !== 'pickup') application.pickupRequest = null;
    addTimeline(application, { event: 'Passport Submission Method', message: METHOD_TEXT[body.passportSubmissionMethod], visibility: 'both', actor });
  }

  if (body.pickupRequest) {
    if (application.passportSubmissionMethod !== 'pickup') throw conflict('Choose the pickup service first.');
    const previous = application.pickupRequest ? application.pickupRequest.toObject() : {};
    application.pickupRequest = { ...previous, ...body.pickupRequest, status: 'requested' };
    application.passportStatus = 'pickup_requested';
    const { locationType = 'Home', address = '', preferredDate } = application.pickupRequest;
    addTimeline(application, { event: 'Passport Pickup Requested', message: `${locationType} pickup at ${address}${preferredDate ? `, preferred ${preferredDate}` : ''}.`, visibility: 'both', actor });
  }

  if (body.assignedStaff !== undefined) {
    if (!application.pickupRequest) throw conflict('There is no pickup request to assign.');
    if (body.assignedStaff === null) {
      application.pickupRequest.assignedStaff = undefined;
      application.pickupRequest.assignedStaffName = '';
      application.pickupRequest.status = 'requested';
    } else {
      const staff = await checkStaff(body.assignedStaff);
      application.pickupRequest.assignedStaff = staff._id;
      application.pickupRequest.assignedStaffName = staff.name;
      application.pickupRequest.status = 'assigned';
      application.passportStatus = 'assigned';
      addTimeline(application, { event: 'Pickup Staff Assigned', message: `Pickup assigned to ${staff.name}.`, visibility: 'both', actor });
    }
  }

  if (body.passportStatus) {
    if (application.passportSubmissionMethod === 'online' && body.passportStatus !== 'not_required') throw conflict('Online processing needs no physical passport.');
    if (application.passportSubmissionMethod !== 'online' && body.passportStatus === 'not_required') throw conflict('A physical passport is part of this file.');
    const details = body.details || {};
    application.passportStatus = body.passportStatus;

    if (body.passportStatus === 'picked_up') {
      application.passportCollection = details;
      addTimeline(application, { event: 'Passport Collected', message: `Collected from the applicant${details.collectorName ? ` by ${details.collectorName}` : ''}${details.remarks ? `. ${details.remarks}` : ''}.`, visibility: 'both', actor });
    } else if (body.passportStatus === 'received_at_office') {
      application.passportReceived = details;
      addTimeline(application, { event: 'Passport Received at Office', message: `Received by ${details.receivedBy || 'the office'}${details.remarks ? `. ${details.remarks}` : ''}.`, visibility: 'both', actor });
    } else {
      addTimeline(application, { event: `Passport: ${humanize(body.passportStatus)}`, message: body.note || '', visibility: 'both', actor });
    }
  }

  await application.save();
  await auditService.record({ actorUserId: user.id, action: AUDIT_ACTIONS.VISA_PASSPORT_UPDATED, resource: `visa-application:${application._id}`, ip: context.ip, meta: { fields: Object.keys(body) } });
  return application;
};

module.exports = { update };
