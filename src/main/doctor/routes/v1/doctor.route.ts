// src/main/doctor/routes/v1/doctor.route.ts
import express from 'express';
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
} from '../../controllers/doctor.controller';
import { replyDoctorReviewController } from '../../controllers/doctorReview.controller';
import {
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
} from '../../schemas/doctor.schemas';
import {
  enforceClinicAutoLogout,
  requireAdmin,
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
import { docsRegistry } from '../../../../utils/docsRegistry';

const doctorRouter = express.Router();

export const parseMultipartDoctorData = (
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) => {
  if (req.body.qualifications && typeof req.body.qualifications === 'string') {
    req.body.qualifications = JSON.parse(req.body.qualifications);
  }
  if (req.body.doctorProfile && typeof req.body.doctorProfile === 'string') {
    req.body.doctorProfile = JSON.parse(req.body.doctorProfile);
  }
  if (req.body.clinicService && typeof req.body.clinicService === 'string') {
    req.body.clinicService = JSON.parse(req.body.clinicService);
  }
  if (req.body.aivblity && typeof req.body.aivblity === 'string') {
    req.body.aivblity = JSON.parse(req.body.aivblity);
  }
  if (
    req.body.dateAvailability &&
    typeof req.body.dateAvailability === 'string'
  ) {
    req.body.dateAvailability = JSON.parse(req.body.dateAvailability);
  }
  next();
};

/**
 * @route PUT /api/v1/doctor/
 * @desc Update doctor profile information
 * @access Private (Admin, Clinic)
 */
doctorRouter.put(
  '/',
  requireAuth,
  requireAdmin,
  requireClinic,
  uploadProfilePicture.single('profileImage'),
  parseMultipartDoctorData,
  validate(updateDoctorScheamas, 'body'),
  updateDoctorController
);

doctorRouter.get(
  '/my-profile-update-requests',
  requireAuth,
  validate(listUpdateRequestsSchema, 'query'),
  myUpdateRequestsController
);

doctorRouter.put(
  '/update-profile-image',
  requireAuth,
  requireClinic,
  uploadProfilePicture.single('profileImage'),
  updateProfileImageController
);

doctorRouter.post(
  '/profile-update-request',
  requireAuth,
  requireClinic,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
  requireClinic,
  validate(plainIdSchemas, 'params'),
  getByIdPlainController
);

doctorRouter.get(
  '/get-all-plains',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(getQueryParamsSchema, 'query'),
  getAllPlainController
);

doctorRouter.get(
  '/subscriptions',
  requireAuth,
  requireClinic,
  validate(getSubscriptionsSchema, 'query'),
  getSubscriptionsController
);

doctorRouter.get(
  '/subscriptions-list',
  requireAuth,
  requireClinic,
  getSubscriptionsListController
);

doctorRouter.get(
  '/get-all-doctors-plains/:doctorId',
  requireAuth,
  requireAdmin,
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
  requireAdmin,
  requireClinic,
  validate(getFrequentMedicinesSchema, 'query'),
  getFrequentMedicinesController
);

doctorRouter.get(
  '/top-used-medicines',
  requireAuth,
  requireClinic,
  // requireDoctor,
  validate(topMedicinesQuerySchema, 'query'),
  getTopMedicinesController
);

doctorRouter.patch(
  '/favorite-medicine/:medicineId',
  requireAuth,
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
  requireClinic,
  validate(getDoctorAvailabilityRangeSchema, 'query'),
  getDoctorAvailabilityInRangeController
);

doctorRouter.get(
  '/doctor-preferences/:doctorId',
  requireAuth,
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
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  getDoctorPrescriptionTemplateController
);

doctorRouter.post(
  '/update-doctor-prescription-template/:doctorId',
  requireAuth,
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  validate(upsertDoctorPrescriptionTemplate, 'body'),
  upsertDoctorPrescriptionTemplateController
);

doctorRouter.delete(
  '/delete-doctor-prescription-template/:doctorId',
  requireAuth,
  requireClinic,
  validate(getDoctorDoctorIdScheamas, 'params'),
  deleteDoctorPrescriptionTemplateController
);

doctorRouter.get(
  '/get-doctor-manual-template',
  requireAuth,
  requireClinic,
  getDoctorManualTemplateController
);

doctorRouter.post(
  '/update-doctor-manual-template',
  // Auth first: multer writes to S3 as it runs, so anything before it uploads
  // on behalf of a caller who has not been authenticated yet.
  requireAuth,
  requireClinic,
  uploadDoctorManualTemplate.single('templateImage'),
  validate(upsertDoctorManualTemplateSchema, 'body'),
  upsertDoctorManualTemplateController
);

doctorRouter.delete(
  '/delete-doctor-manual-template',
  requireAuth,
  requireClinic,
  deleteDoctorManualTemplateController
);

doctorRouter.delete(
  '/delete-leave/:leaveId',
  requireAuth,
  requireClinic,
  validate(getDoctorLeaveScheamas, 'params'),
  deleteDoctorLeaveController
);

doctorRouter.post(
  '/doctor-prescription-type',
  requireAuth,
  requireClinic,
  updateDoctorPrescriptionTypeController
);

doctorRouter.get(
  '/doctor-prescription-type',
  requireAuth,
  requireClinic,
  getDoctorPrescriptionTypeController
);

doctorRouter.post(
  '/doctor-prescription-print-type',
  requireAuth,
  requireClinic,
  updateDoctorPrescriptionPrintTypeController
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
  method: 'post',
  path: '/api/v1/doctor/reviews/:reviewId/reply',
  description: 'Reply to a patient review',
  params: doctorReviewParamsSchema,
  requestSchema: doctorReplySchema,
  tags: ['doctor'],
});
