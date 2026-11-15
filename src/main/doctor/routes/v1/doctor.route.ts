// src/main/doctor/routes/v1/doctor.route.ts
import express from 'express';
import { HttpError } from '../../../../middlewear/errorHandler';
import {
  checkPlainController,
  createPlainController,
  getAllDoctosPlainController,
  getAllPlainController,
  getByIdPlainController,
  getCurrentDoctorController,
  getDoctorByIdController,
  getDoctorServicesController,
  getDoctorActivityController,
  getDoctorAvailabilityController,
  updateDoctorController,
  updatePlainController,
  deleteServiceController,
  updateServiceByIdController,
  toggleServiceStatusController,
  getSubscriptionsController,
  getSubscriptionsListController,
  getDoctorAvailabilityOnDateController,
  getDoctorAvailabilityInRangeController,
  getFrequentMedicinesController,
  getTopMedicinesController,
  getDoctorPreferencesController,
  upsertDoctorPreferencesController,
  upsertDoctorPrescriptionTemplateController,
  getDoctorPrescriptionTemplateController,
  deleteDoctorPrescriptionTemplateController,
  deleteDoctorLeaveController,
  getDoctorManualTemplateController,
  upsertDoctorManualTemplateController,
  deleteDoctorManualTemplateController,
  medicineFavoriteController,
  updateDoctorPrescriptionTypeController,
  getDoctorPrescriptionTypeController,
  updateDoctorPrescriptionPrintTypeController,
  updateProfileImageController,
  requestDoctorUpdateController,
  listUpdateRequestsController,
  approveDoctorUpdateController,
  myUpdateRequestsController,
  getSpecialtyCatalogController,
  getSpecialtyToolsController,
  getQualificationCatalogController,
  searchCollegesController,
  searchSuggestionsController,
} from '../../controllers/doctor.controller';
import {
  getMyDoctorReviewsController,
  getMyReviewForAppointmentController,
  replyDoctorReviewController,
} from '../../controllers/doctorReview.controller';
import {
  doctorMyReviewsQuerySchema,
  doctorReviewAppointmentParamsSchema,
  doctorReviewParamsSchema,
  doctorReplySchema,
} from '../../schemas/doctorReview.schemas';
import { validate } from '../../../../middlewear/validation.middleware';
import {
  checkPlainsSchemas,
  createClinicAppointmentPlainSchema,
  deleteServiceSchemas,
  getDoctorDoctorIdScheamas,
  getQueryParamsSchema,
  plainIdSchemas,
  updateClinicAppointmentPlainSchema,
  updateDoctorScheamas,
  getSubscriptionsSchema,
  getDoctorAvailabilityOnDateSchema,
  getDoctorAvailabilityRangeSchema,
  getFrequentMedicinesSchema,
  topMedicinesQuerySchema,
  upsertDoctorPreferencesSchema,
  upsertDoctorPrescriptionTemplate,
  getDoctorLeaveScheamas,
  upsertDoctorManualTemplateSchema,
  toggleFavoriteSchema,
  updateServiceByIdSchema,
  serviceIdParamSchema,
  toggleServiceStatusSchema,
  updateDoctorProfileScheamas,
  listUpdateRequestsSchema,
  approveDoctorUpdateSchema,
  doctorProfileImageSchema,
  searchCollegesQuerySchema,
  searchSuggestionsQuerySchema,
} from '../../schemas/doctor.schemas';
import {
  CLINIC_STAFF_ROLES,
  enforceClinicAutoLogout,
  requireAuth,
  requireClinic,
  requireDoctor,
  requireReceptionist,
  requireRole,
  requireSuperAdmin,
} from '../../../../middlewear/auth.middleware';
import {
  uploadProfilePicture,
  uploadDoctorManualTemplate,
} from '../../../../middlewear/upload.middleware';
import { docsRegistry } from '../../../../apiDocs';

const doctorRouter = express.Router();

// Multipart sends every field as text; each JSON field of the doctor update must be listed here.
const MULTIPART_JSON_FIELDS = [
  'qualifications',
  'experiences',
  'doctorProfile',
  'clinicService',
  'aivblity',
  'dateAvailability',
];

export const parseMultipartDoctorData = (
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) => {
  for (const field of MULTIPART_JSON_FIELDS) {
    const value = req.body?.[field];
    if (!value || typeof value !== 'string') continue;
    try {
      req.body[field] = JSON.parse(value);
    } catch {
      throw new HttpError(400, `${field} must be valid JSON.`);
    }
  }
  next();
};

/** @route GET /api/v1/doctor/specialties — speciality catalog for every picker
 *  @access any authenticated user (static reference data) */
doctorRouter.get('/specialties', requireAuth, getSpecialtyCatalogController);

/** @route GET /api/v1/doctor/specialty-tools — every specialty's charts and exam tables
 *  @access Doctor, Admin (static reference data for Prescription Layout) */
doctorRouter.get(
  '/specialty-tools',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  getSpecialtyToolsController
);

/** @route GET /api/v1/doctor/qualifications — qualification catalog for every picker
 *  @access any authenticated user (static reference data) */
doctorRouter.get(
  '/qualifications',
  requireAuth,
  getQualificationCatalogController
);

/** @route GET /api/v1/doctor/colleges?q=&stream= — type-ahead over official college names
 *  @access any authenticated user (static reference data) */
doctorRouter.get(
  '/colleges',
  requireAuth,
  validate(searchCollegesQuerySchema, 'query'),
  searchCollegesController
);

/** @route GET /api/v1/doctor/suggestion-catalog?section=&q=&specialty= — prescription chips, optionally one specialty's
 *  @access Doctor, Admin (static reference data for the prescription) */
doctorRouter.get(
  '/suggestion-catalog',
  requireAuth,
  requireRole(['Doctor', 'Admin']),
  validate(searchSuggestionsQuerySchema, 'query'),
  searchSuggestionsController
);

/**
 * @route PUT /api/v1/doctor/
 * @desc Update doctor profile information
 * @access Private (Admin, Clinic)
 */
doctorRouter.put(
  '/',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  uploadProfilePicture.single('profileImage'),
  parseMultipartDoctorData,
  validate(updateDoctorScheamas, 'body'),
  updateDoctorController
);

doctorRouter.get(
  '/my-profile-update-requests',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  validate(listUpdateRequestsSchema, 'query'),
  myUpdateRequestsController
);

doctorRouter.put(
  '/update-profile-image',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  uploadProfilePicture.single('profileImage'),
  updateProfileImageController
);

doctorRouter.post(
  '/profile-update-request',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  // Super Admin approval retired: profiles save directly via PUT /doctor.
  () => {
    throw new HttpError(
      410,
      'Profile update requests are no longer accepted. Edit your profile directly.'
    );
  },
  validate(updateDoctorProfileScheamas, 'body'),
  requestDoctorUpdateController
);

doctorRouter.get(
  '/profile-update-requests',
  requireAuth,
  requireSuperAdmin,
  validate(listUpdateRequestsSchema, 'query'),
  listUpdateRequestsController
);

doctorRouter.put(
  '/update-profile-request-status/:requestId',
  requireAuth,
  requireSuperAdmin,
  validate(approveDoctorUpdateSchema, 'body'),
  approveDoctorUpdateController
);

/**
 * @route DELETE /api/v1/doctor/delete-service/:serviceId
 * @desc Delete a specific service offered by a doctor
 * @access Private (Admin, Clinic)
 */
doctorRouter.delete(
  '/delete-service/:serviceId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(deleteServiceSchemas, 'params'),
  deleteServiceController
);

/**
 * @route PUT /api/v1/doctor/update-service/:serviceId
 * @desc Update a specific doctor service by service ID
 * @access Private (Admin, Clinic)
 */
doctorRouter.put(
  '/update-service/:serviceId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(serviceIdParamSchema, 'params'),
  validate(updateServiceByIdSchema, 'body'),
  updateServiceByIdController
);

/**
 * @route PATCH /api/v1/doctor/toggle-service/:serviceId
 * @desc Disable or enable a doctor service (soft delete / restore)
 * @access Private (Admin, Clinic)
 */
doctorRouter.patch(
  '/toggle-service/:serviceId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(serviceIdParamSchema, 'params'),
  validate(toggleServiceStatusSchema, 'body'),
  toggleServiceStatusController
);

/**
 * @route GET /api/v1/doctor/user
 * @desc Get current doctor's profile associated with the user
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/user',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  enforceClinicAutoLogout,
  getCurrentDoctorController
);

/**
 * @route GET /api/v1/doctor/single/:doctorId
 * @desc Get detailed profile of a specific doctor by ID
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/single/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorByIdController
);

/**
 * @route GET /api/v1/doctor/single/:doctorId/services
 * @desc Get the clinic services offered by a specific doctor
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/single/:doctorId/services',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorServicesController
);

/**
 * @route GET /api/v1/doctor/single/:doctorId/activity
 * @desc Get a specific doctor's recent appointment activity
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/single/:doctorId/activity',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorActivityController
);

/**
 * @route GET /api/v1/doctor/single/:doctorId/availability
 * @desc Get a specific doctor's weekly clinic availability schedule
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/single/:doctorId/availability',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorAvailabilityController
);

/**
 * @route POST /api/v1/doctor/create/plains
 * @desc Create new appointment plans for the clinic
 * @access Private (Admin, Clinic)
 */
doctorRouter.post(
  '/create/plains',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(createClinicAppointmentPlainSchema, 'body'),
  createPlainController
);

/**
 * @route PUT /api/v1/doctor/update/plains/:plainId
 * @desc Update an existing appointment plan
 * @access Private (Admin, Clinic)
 */
doctorRouter.put(
  '/update/plains/:plainId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(updateClinicAppointmentPlainSchema, 'body'),
  validate(plainIdSchemas, 'params'),
  updatePlainController
);

/**
 * @route GET /api/v1/doctor/get-plains/:plainId
 * @desc Get details of a specific appointment plan
 * @access Private (Admin, Clinic)
 */
doctorRouter.get(
  '/get-plains/:plainId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(plainIdSchemas, 'params'),
  getByIdPlainController
);

doctorRouter.get(
  '/get-all-plains',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getQueryParamsSchema, 'query'),
  getAllPlainController
);

doctorRouter.get(
  '/subscriptions',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getSubscriptionsSchema, 'query'),
  getSubscriptionsController
);

doctorRouter.get(
  '/subscriptions-list',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getSubscriptionsListController
);

doctorRouter.get(
  '/get-all-doctors-plains/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getAllDoctosPlainController
);

doctorRouter.get(
  '/check-plains',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(checkPlainsSchemas, 'query'),
  checkPlainController
);
doctorRouter.get(
  '/frequent-medicines',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getFrequentMedicinesSchema, 'query'),
  getFrequentMedicinesController
);

doctorRouter.get(
  '/top-used-medicines',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  // requireDoctor,
  validate(topMedicinesQuerySchema, 'query'),
  getTopMedicinesController
);

doctorRouter.patch(
  '/favorite-medicine/:medicineId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(toggleFavoriteSchema, 'params'),
  medicineFavoriteController
);

/**
 * @route GET /api/v1/doctor/availability-on-date
 * @desc Get all doctors availability on a specific date
 * @access Private (Auth, Clinic)
 */
doctorRouter.get(
  '/availability-on-date',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorAvailabilityOnDateSchema, 'query'),
  getDoctorAvailabilityOnDateController
);

/**
 * @route GET /api/v1/doctor/availability-range
 * @desc Get specific doctor's availability and breaks over a date range
 * @access Private (Auth, Clinic)
 */
doctorRouter.get(
  '/availability-range',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorAvailabilityRangeSchema, 'query'),
  getDoctorAvailabilityInRangeController
);

doctorRouter.get(
  '/doctor-preferences/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  // requireDoctor,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorPreferencesController
);

// Add/Update doctor preferences
doctorRouter.post(
  '/update-doctor-preferences/:doctorId',
  requireAuth,
  // Clinic admins manage a doctor's preferences too; the service asserts the doctor is in the admin's clinic.
  requireRole(['Doctor', 'Admin']),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  validate(upsertDoctorPreferencesSchema, 'body'),
  upsertDoctorPreferencesController
);

doctorRouter.get(
  '/get-doctor-prescription-template/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorPrescriptionTemplateController
);

doctorRouter.post(
  '/update-doctor-prescription-template/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  validate(upsertDoctorPrescriptionTemplate, 'body'),
  upsertDoctorPrescriptionTemplateController
);

doctorRouter.delete(
  '/delete-doctor-prescription-template/:doctorId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  deleteDoctorPrescriptionTemplateController
);

doctorRouter.get(
  '/get-doctor-manual-template',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getDoctorManualTemplateController
);

doctorRouter.post(
  '/update-doctor-manual-template',
  // Auth first: multer writes to S3 as it runs, so anything before it uploads
  // on behalf of a caller who has not been authenticated yet.
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  uploadDoctorManualTemplate.single('templateImage'),
  validate(upsertDoctorManualTemplateSchema, 'body'),
  upsertDoctorManualTemplateController
);

doctorRouter.delete(
  '/delete-doctor-manual-template',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  deleteDoctorManualTemplateController
);

doctorRouter.delete(
  '/delete-leave/:leaveId',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(getDoctorLeaveScheamas, 'params'),
  deleteDoctorLeaveController
);

doctorRouter.post(
  '/doctor-prescription-type',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  updateDoctorPrescriptionTypeController
);

doctorRouter.get(
  '/doctor-prescription-type',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getDoctorPrescriptionTypeController
);

doctorRouter.post(
  '/doctor-prescription-print-type',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  updateDoctorPrescriptionPrintTypeController
);

/** @route GET /api/v1/doctor/reviews — the signed-in doctor's reviews + rating summary
 *  @access Doctor */
doctorRouter.get(
  '/reviews',
  requireAuth,
  requireDoctor,
  validate(doctorMyReviewsQuerySchema, 'query'),
  getMyDoctorReviewsController
);

/** @route GET /api/v1/doctor/reviews/appointment/:appointmentId — review left for one appointment
 *  @access Doctor (own reviews only; `review` is null when none) */
doctorRouter.get(
  '/reviews/appointment/:appointmentId',
  requireAuth,
  requireDoctor,
  validate(doctorReviewAppointmentParamsSchema, 'params'),
  getMyReviewForAppointmentController
);

/**
 * @route POST /api/v1/doctor/reviews/:reviewId/reply
 * @desc Reply to a patient review
 * @access Private (Doctor only)
 */
doctorRouter.post(
  '/reviews/:reviewId/reply',
  requireAuth,
  requireDoctor,
  validate(doctorReviewParamsSchema, 'params'),
  validate(doctorReplySchema, 'body'),
  replyDoctorReviewController
);

export default doctorRouter;

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/specialties',
  description:
    'Speciality catalog: each main speciality with its sub-specialties, "also practises" fields and booking symptoms',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/specialty-tools',
  description:
    "Each specialty with its Clinical details tabs (charts and exam tables) as { id, title }, for adding another specialty's tab",
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/qualifications',
  description:
    'Qualification catalog: each category (code, label, rank) with its degrees',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/colleges',
  description:
    'Up to 25 official colleges whose name contains q, best match first; stream ranks its colleges higher',
  query: searchCollegesQuerySchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/suggestion-catalog',
  description:
    "Prescription suggestions for one section containing q (2+ letters, up to 25), from every specialty or only `specialty`; with `specialty` and no q, that specialty's whole list A–Z",
  query: searchSuggestionsQuerySchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/availability-on-date',
  description: 'get all doctors availability on a specific date',
  query: getDoctorAvailabilityOnDateSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/availability-range',
  description: 'get specific doctor availability in date range',
  query: getDoctorAvailabilityRangeSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/doctor', // full path as it would appear in the app
  description: 'update doctor profile',
  requestSchema: updateDoctorScheamas,
  contentType: 'multipart/form-data',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/doctor/update-profile-image',
  description: 'update doctor profile image',
  requestSchema: doctorProfileImageSchema,
  contentType: 'multipart/form-data',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/doctor/delete-service/:serviceId', // full path as it would appear in the app
  description: 'delete clinic service',
  params: deleteServiceSchemas,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/doctor/update-service/:serviceId',
  description: 'update doctor service by service id',
  params: serviceIdParamSchema,
  requestSchema: updateServiceByIdSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/doctor/toggle-service/:serviceId',
  description: 'disable or enable a doctor service',
  params: serviceIdParamSchema,
  requestSchema: toggleServiceStatusSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/user', // full path as it would appear in the app
  description: 'get doctor profile',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/doctor/create/plains', // full path as it would appear in the app
  description: 'create plains',
  requestSchema: createClinicAppointmentPlainSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/doctor/update/plains/:plainId', // full path as it would appear in the app
  description: 'update plains',
  requestSchema: updateClinicAppointmentPlainSchema,
  params: plainIdSchemas,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/get-plains/:plainId', // full path as it would appear in the app
  description: 'get plain by id',
  params: plainIdSchemas,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/get-all-plains', // full path as it would appear in the app
  description: 'get all plains',
  query: getQueryParamsSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/get-all-doctors-plains/:doctorId', // full path as it would appear in the app
  description: 'get all doctors plains',
  params: getDoctorDoctorIdScheamas,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/subscriptions',
  description:
    'get subscriptions list with summary statistics (total amount and payment mode totals)',
  query: getSubscriptionsSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/check-plains', // full path as it would appear in the app
  description: 'get all doctors plains',
  query: checkPlainsSchemas,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/subscriptions-list',
  description: 'get subscriptions list for filter',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/get-doctor-manual-template',
  description: 'Get doctor manual template details',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/doctor/update-doctor-manual-template',
  description: 'Update doctor manual template (upload template image)',
  requestSchema: upsertDoctorManualTemplateSchema,
  contentType: 'multipart/form-data',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/doctor/delete-doctor-manual-template',
  description: 'Delete doctor manual template',
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/reviews',
  description: "The signed-in doctor's reviews with rating summary",
  query: doctorMyReviewsQuerySchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/doctor/reviews/appointment/:appointmentId',
  description: "Review left for one of the signed-in doctor's appointments",
  params: doctorReviewAppointmentParamsSchema,
  tags: ['doctor'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/doctor/reviews/:reviewId/reply',
  description: 'Reply to a patient review',
  params: doctorReviewParamsSchema,
  requestSchema: doctorReplySchema,
  tags: ['doctor'],
});
