// src/main/patient/routes/v1/patient.route.ts
import express, { Router } from 'express';
import {
  createCreatePetientController,
  getAllPetientController,
  getPetientController,
  searchPatientController,
  checkPatientByMobileController,
  updatePetientController,
} from '../../../users/controllers/user.controller';
import {
  createPetientSchemas,
  getAllPetientsSchema,
  getPetientSchema,
  searchPatientSchema,
  checkPatientByMobileSchema,
  updatePetientSchemas,
  getPetientQuerySchema,
} from '../../../users/schemas/auth.schemas';
import { validate } from '../../../../middlewear/validation.middleware';
import { requirePermission } from '../../../../middlewear/permission.middleware';
import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import {
  requireAuth,
  requireClinic,
  requireReceptionist,
  requirePatient,
} from '../../../../middlewear/auth.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  completeProfileController,
  getMyProfileController,
  getAccountController,
  addFamilyMemberController,
  listFamilyMembersController,
  getFamilyMemberController,
  updateFamilyMemberController,
  removeFamilyMemberController,
  updatePatientProfileImageController,
  updateFamilyMemberProfileImageController,
  searchDirectoryController,
  getDoctorPublicProfileController,
  toggleDoctorFavoriteController,
  listFavoriteDoctorsController,
  getDoctorPublicSlotsController,
  bookPatientAppointmentController,
  getPatientAppointmentPricingPreviewController,
  listPatientAppointmentsController,
  listAllPatientAppointmentsController,
  getPatientAppointmentDetailController,
  getPatientAppointmentInvoiceDataController,
  getPatientLiveQueueController,
  upsertLiveQueueNotifyPrefsController,
  getAssociatedDoctorsController,
  getPatientLabReportsController,
  uploadPatientLabReportController,
  getPatientPrescriptionsController,
  getPatientAssociatedDocumentsController,
  verifyAppointmentPaymentController,
  razorpayAppointmentWebhookController,
  cancelPatientAppointmentController,
  getBookingCancellationPolicyController,
  reschedulePatientAppointmentController,
} from '../../controllers/patient.controller';
import { requestCancellationSchema } from '../../../cancellation-policy/schemas/cancellationPolicy.schemas';
import {
  completePatientProfileSchema,
  addFamilyMemberSchema,
  updateFamilyMemberSchema,
  familyMemberParamsSchema,
  listFamilyMembersQuerySchema,
  updateProfileImageSchema,
  patientDirectorySearchSchema,
  patientDoctorProfileSchema,
  patientDoctorSlotsQuerySchema,
  listFavoriteDoctorsQuerySchema,
  patientBookingSchema,
  patientAppointmentsParamsSchema,
  patientAppointmentDetailParamsSchema,
  liveQueueNotifyPrefsSchema,
  patientAppointmentsQuerySchema,
  patientLabReportsQuerySchema,
  patientAppointmentTestParamsSchema,
  patientPrescriptionsQuerySchema,
  patientAssociatedDocumentsQuerySchema,
  verifyAppointmentPaymentSchema,
  getBookingCancellationPolicySchema,
  patientPricingPreviewQuerySchema,
  patientRescheduleSchema,
  patientRecentActivityQuerySchema,
} from '../../schemas/patient.schemas';
import { getPatientRecentActivityController } from '../../controllers/recentActivity.controller';
import { uploadProfilePicture } from '../../../../configurations/s3';
import { uploadPatientTest } from '../../../../middlewear/upload.middleware';
import {
  createDoctorReviewController,
  updateDoctorReviewController,
  deleteDoctorReviewController,
  getDoctorReviewsController,
} from '../../../doctor/controllers/doctorReview.controller';
import {
  createDoctorReviewSchema,
  updateDoctorReviewSchema,
  doctorReviewParamsSchema,
  doctorReviewDoctorParamsSchema,
  doctorReviewQuerySchema,
} from '../../../doctor/schemas/doctorReview.schemas';

const patientRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Clinic / Receptionist routes (existing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/patient
 * @desc   Create a new patient record (receptionist)
 * @access Private — Receptionist + Clinic
 */
patientRouter.post(
  '/',
  requireAuth,
  requireReceptionist,
  requireClinic,
  requirePermission(PERMISSION_KEYS.PATIENT_MANAGE, ['Receptionist', 'Nurse']),
  validate(createPetientSchemas, 'body'),
  createCreatePetientController
);

/**
 * @route  PUT /api/v1/patient
 * @desc   Update an existing patient record (receptionist)
 * @access Private — Receptionist
 */
patientRouter.put(
  '/',
  requireAuth,
  requireReceptionist,
  requireClinic,
  requirePermission(PERMISSION_KEYS.PATIENT_MANAGE, ['Receptionist', 'Nurse']),
  validate(updatePetientSchemas, 'body'),
  updatePetientController
);

/**
 * @route  GET /api/v1/patient/all
 * @desc   Get all patients for the clinic
 * @access Private — Receptionist + Clinic
 */
patientRouter.get(
  '/all',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAllPetientsSchema, 'query'),
  getAllPetientController
);

/**
 * @route  GET /api/v1/patient/search
 * @desc   Search patients by name or mobile
 * @access Private — Receptionist + Clinic
 */
patientRouter.get(
  '/search',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(searchPatientSchema, 'query'),
  searchPatientController
);

/**
 * @route  GET /api/v1/patient/check-mobile
 * @desc   Check if a patient exists by 10-digit mobile number
 * @access Private — Receptionist + Clinic
 */
patientRouter.get(
  '/check-mobile',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(checkPatientByMobileSchema, 'query'),
  checkPatientByMobileController
);

// ─────────────────────────────────────────────────────────────────────────────
// Patient self-service routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/patient/account
 * @desc   Fetch primary profile + all linked family members (post-login call)
 * @access Private — Patient only
 */
patientRouter.get(
  '/account',
  requireAuth,
  requirePatient,
  getAccountController
);

/**
 * @route  GET /api/v1/patient/my-profile
 * @desc   Fetch the authenticated patient's own profile
 * @access Private — Patient only
 */
patientRouter.get(
  '/my-profile',
  requireAuth,
  requirePatient,
  getMyProfileController
);

/**
 * @route  PATCH /api/v1/patient/complete-profile
 * @desc   Save / update patient profile details after OTP login
 * @access Private — Patient only
 */
patientRouter.patch(
  '/complete-profile',
  requireAuth,
  requirePatient,
  validate(completePatientProfileSchema, 'body'),
  completeProfileController
);

/**
 * @route  PUT /api/v1/patient/update-profile-image
 * @desc   Update the authenticated patient's own profile image
 * @access Private — Patient only
 */
patientRouter.put(
  '/update-profile-image',
  requireAuth,
  requirePatient,
  uploadProfilePicture.single('profileImage'),
  updatePatientProfileImageController
);

// ─────────────────────────────────────────────────────────────────────────────
// Family member routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  POST /api/v1/patient/family
 * @desc   Add a family member (with or without their own mobile)
 * @access Private — Patient only
 */
patientRouter.post(
  '/family',
  requireAuth,
  requirePatient,
  validate(addFamilyMemberSchema, 'body'),
  addFamilyMemberController
);

/**
 * @route  GET /api/v1/patient/family
 * @desc   List all family members linked to the authenticated patient (paginated)
 * @access Private — Patient only
 */
patientRouter.get(
  '/family',
  requireAuth,
  requirePatient,
  validate(listFamilyMembersQuerySchema, 'query'),
  listFamilyMembersController
);

/**
 * @route  GET /api/v1/patient/family/:familyMemberId
 * @desc   Get a single family member's profile
 * @access Private — Patient only
 */
patientRouter.get(
  '/family/:familyMemberId',
  requireAuth,
  requirePatient,
  validate(familyMemberParamsSchema, 'params'),
  getFamilyMemberController
);

/**
 * @route  PATCH /api/v1/patient/family/:familyMemberId
 * @desc   Update a family member (only when their status is 'New')
 * @access Private — Patient only
 */
patientRouter.patch(
  '/family/:familyMemberId',
  requireAuth,
  requirePatient,
  validate(familyMemberParamsSchema, 'params'),
  validate(updateFamilyMemberSchema, 'body'),
  updateFamilyMemberController
);

/**
 * @route  PUT /api/v1/patient/family/:familyMemberId/update-profile-image
 * @desc   Update a linked family member's profile image
 * @access Private — Patient only
 */
patientRouter.put(
  '/family/:familyMemberId/update-profile-image',
  requireAuth,
  requirePatient,
  validate(familyMemberParamsSchema, 'params'),
  uploadProfilePicture.single('profileImage'),
  updateFamilyMemberProfileImageController
);

/**
 * @route  DELETE /api/v1/patient/family/:familyMemberId
 * @desc   Remove a family member link (does not delete the patient record)
 * @access Private — Patient only
 */
patientRouter.delete(
  '/family/:familyMemberId',
  requireAuth,
  requirePatient,
  validate(familyMemberParamsSchema, 'params'),
  removeFamilyMemberController
);

// ─────────────────────────────────────────────────────────────────────────────
// Patient Search & Booking routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/patient/directory/search
 * @desc   Search doctors/clinics by name, specialty, or proximity
 * @access Private — Patient only
 */
patientRouter.get(
  '/directory/search',
  requireAuth,
  requirePatient,
  validate(patientDirectorySearchSchema, 'query'),
  searchDirectoryController
);

/**
 * @route  GET /api/v1/patient/directory/doctors/favorites
 * @desc   Fetch list of favorite doctors for the authenticated patient
 * @access Private — Patient only
 */
patientRouter.get(
  '/directory/doctors/favorites',
  requireAuth,
  requirePatient,
  validate(listFavoriteDoctorsQuerySchema, 'query'),
  listFavoriteDoctorsController
);

/**
 * @route  GET /api/v1/patient/directory/doctors/:doctorId
 * @desc   Fetch doctor's public profile, credentials, and practicing clinics
 * @access Private — Patient only
 */
patientRouter.get(
  '/directory/doctors/:doctorId',
  requireAuth,
  requirePatient,
  validate(patientDoctorProfileSchema, 'params'),
  getDoctorPublicProfileController
);

/**
 * @route  POST /api/v1/patient/directory/doctors/:doctorId/toggle-favorite
 * @desc   Toggle doctor favorite status for the patient
 * @access Private — Patient only
 */
patientRouter.post(
  '/directory/doctors/:doctorId/toggle-favorite',
  requireAuth,
  requirePatient,
  validate(patientDoctorProfileSchema, 'params'),
  toggleDoctorFavoriteController
);

/**
 * @route  GET /api/v1/patient/directory/doctors/:doctorId/slots
 * @desc   Fetch slot availability for a doctor on a given date at a clinic
 * @access Private — Patient only
 */
patientRouter.get(
  '/directory/doctors/:doctorId/slots',
  requireAuth,
  requirePatient,
  validate(patientDoctorProfileSchema, 'params'),
  validate(patientDoctorSlotsQuerySchema, 'query'),
  getDoctorPublicSlotsController
);

/**
 * @route  GET /api/v1/patient/appointments/cancellation-policy
 * @desc   Get cancellation policy for booking (application-level and clinic-level)
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/cancellation-policy',
  requireAuth,
  requirePatient,
  validate(getBookingCancellationPolicySchema, 'query'),
  getBookingCancellationPolicyController
);

/**
 * @route  GET /api/v1/patient/appointments/pricing-preview
 * @desc   Get calculated platform fee, GST, and total payable breakdown before booking
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/pricing-preview',
  requireAuth,
  requirePatient,
  validate(patientPricingPreviewQuerySchema, 'query'),
  getPatientAppointmentPricingPreviewController
);

/**
 * @route  POST /api/v1/patient/appointments
 * @desc   Book an appointment for patient or family member
 * @access Private — Patient only
 */
patientRouter.post(
  '/appointments',
  requireAuth,
  requirePatient,
  validate(patientBookingSchema, 'body'),
  bookPatientAppointmentController
);

patientRouter.post(
  '/appointments/verify-payment',
  requireAuth,
  requirePatient,
  validate(verifyAppointmentPaymentSchema, 'body'),
  verifyAppointmentPaymentController
);

patientRouter.post(
  '/appointments/webhook',
  express.raw({ type: 'application/json' }),
  razorpayAppointmentWebhookController
);

/**
 * @route  GET /api/v1/patient/associated-doctors
 * @desc   Fetch all unique doctors associated with patient & family member appointments
 * @access Private — Patient only
 */
patientRouter.get(
  '/associated-doctors',
  requireAuth,
  requirePatient,
  getAssociatedDoctorsController
);

/**
 * @route  GET /api/v1/patient/lab-reports
 * @desc   Fetch all lab reports for patient & family members (with parameter values and PDFs)
 * @access Private — Patient only
 */
patientRouter.get(
  '/lab-reports',
  requireAuth,
  requirePatient,
  validate(patientLabReportsQuerySchema, 'query'),
  getPatientLabReportsController
);

/**
 * @route  POST /api/v1/patient/lab-reports/:appointmentTestId/report-upload
 * @desc   Upload a report for an existing lab test order from patient side
 * @access Private — Patient only
 */
patientRouter.post(
  '/lab-reports/:appointmentTestId/report-upload',
  requireAuth,
  requirePatient,
  validate(patientAppointmentTestParamsSchema, 'params'),
  uploadPatientTest.single('reportPdf'),
  uploadPatientLabReportController
);

/**
 * @route  GET /api/v1/patient/prescriptions
 * @desc   Fetch all prescriptions for patient & family members (with detailed medicine data and PDFs)
 * @access Private — Patient only
 */
patientRouter.get(
  '/prescriptions',
  requireAuth,
  requirePatient,
  validate(patientPrescriptionsQuerySchema, 'query'),
  getPatientPrescriptionsController
);

/**
 * @route  GET /api/v1/patient/associated-documents
 * @desc   Fetch all associated documents for patient & family members (gallery, manual/digital prescriptions, consent files, lab reports)
 * @access Private — Patient only
 */
patientRouter.get(
  '/associated-documents',
  requireAuth,
  requirePatient,
  validate(patientAssociatedDocumentsQuerySchema, 'query'),
  getPatientAssociatedDocumentsController
);

/**
 * @route  GET /api/v1/patient/recent-activity
 * @desc   Unified recent-activity feed (appointments, lab tests, prescriptions)
 *         for patient & family members, shaped for the activity card UI
 * @access Private — Patient only
 */
patientRouter.get(
  '/recent-activity',
  requireAuth,
  requirePatient,
  validate(patientRecentActivityQuerySchema, 'query'),
  getPatientRecentActivityController
);

/**
 * @route  GET /api/v1/patient/appointments
 * @desc   List past and upcoming appointments for patient & family members
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments',
  requireAuth,
  requirePatient,
  validate(patientAppointmentsQuerySchema, 'query'),
  listAllPatientAppointmentsController
);

/**
 * @route  GET /api/v1/patient/appointments/detail/:appointmentId
 * @desc   Fetch detailed information for a specific appointment
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/detail/:appointmentId',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  getPatientAppointmentDetailController
);

/**
 * @route  GET /api/v1/patient/appointments/:appointmentId/invoice-data
 * @desc   Fetch detailed invoice/billing metadata for an appointment
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/:appointmentId/invoice-data',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  getPatientAppointmentInvoiceDataController
);

/**
 * @route  POST /api/v1/patient/appointments/:appointmentId/cancel
 * @desc   Cancel patient\'s own appointment following platform & clinic policy checks
 * @access Private — Patient only
 */
patientRouter.post(
  '/appointments/:appointmentId/cancel',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  validate(requestCancellationSchema, 'body'),
  cancelPatientAppointmentController
);

/**
 * @route  PUT /api/v1/patient/appointments/:appointmentId
 * @desc   Reschedule patient\'s own appointment following platform & clinic policy checks
 * @access Private — Patient only
 */
patientRouter.put(
  '/appointments/:appointmentId',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  validate(patientRescheduleSchema, 'body'),
  reschedulePatientAppointmentController
);

/**
 * @route  GET /api/v1/patient/appointments/live-queue/:appointmentId
 * @desc   Lightweight endpoint for Live Queue Tracking screen (queue data only)
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/live-queue/:appointmentId',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  getPatientLiveQueueController
);

/**
 * @route  POST /api/v1/patient/appointments/live-queue/:appointmentId/notify-prefs
 * @desc   Save "Notify me when" push preferences (My turn / N patients before / Doctor arrives)
 * @access Private — Patient only
 */
patientRouter.post(
  '/appointments/live-queue/:appointmentId/notify-prefs',
  requireAuth,
  requirePatient,
  validate(patientAppointmentDetailParamsSchema, 'params'),
  validate(liveQueueNotifyPrefsSchema, 'body'),
  upsertLiveQueueNotifyPrefsController
);

/**
 * @route  GET /api/v1/patient/appointments/:patientId
 * @desc   List past and upcoming appointments for a specific family member or self
 * @access Private — Patient only
 */
patientRouter.get(
  '/appointments/:patientId',
  requireAuth,
  requirePatient,
  validate(patientAppointmentsParamsSchema, 'params'),
  validate(patientAppointmentsQuerySchema, 'query'),
  listPatientAppointmentsController
);

// ─────────────────────────────────────────────────────────────────────────────
// Receptionist: get patient by ID  (keep at the bottom — wildcard route)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route  GET /api/v1/patient/:peteintId
 * @desc   Get detailed information for a specific patient by ID
 * @access Private — Receptionist
 */
patientRouter.get(
  '/:peteintId',
  requireAuth,
  requireReceptionist,
  validate(getPetientSchema, 'params'),
  validate(getPetientQuerySchema, 'query'),
  getPetientController
);

/**
 * @route  POST /api/v1/patient/reviews
 * @desc   Submit a rating and review for a completed or cancelled appointment
 * @access Private — Patient only
 */
patientRouter.post(
  '/reviews',
  requireAuth,
  requirePatient,
  validate(createDoctorReviewSchema, 'body'),
  createDoctorReviewController
);

/**
 * @route  PUT /api/v1/patient/reviews/:reviewId
 * @desc   Update an existing rating and review
 * @access Private — Patient only (author)
 */
patientRouter.put(
  '/reviews/:reviewId',
  requireAuth,
  requirePatient,
  validate(doctorReviewParamsSchema, 'params'),
  validate(updateDoctorReviewSchema, 'body'),
  updateDoctorReviewController
);

/**
 * @route  DELETE /api/v1/patient/reviews/:reviewId
 * @desc   Delete an existing review
 * @access Private — Patient only (author)
 */
patientRouter.delete(
  '/reviews/:reviewId',
  requireAuth,
  requirePatient,
  validate(doctorReviewParamsSchema, 'params'),
  deleteDoctorReviewController
);

/**
 * @route  GET /api/v1/patient/directory/doctors/:doctorId/reviews
 * @desc   Fetch paginated public reviews for a specific doctor
 * @access Private — Patient only
 */
patientRouter.get(
  '/directory/doctors/:doctorId/reviews',
  requireAuth,
  requirePatient,
  validate(doctorReviewDoctorParamsSchema, 'params'),
  validate(doctorReviewQuerySchema, 'query'),
  getDoctorReviewsController
);

export default patientRouter;

// ─── API Docs ─────────────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient',
  description: 'Create patient record (receptionist)',
  requestSchema: createPetientSchemas,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/patient',
  description: 'Update patient record (receptionist)',
  requestSchema: updatePetientSchemas,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/all',
  description: 'Get all patients for a clinic',
  query: getAllPetientsSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/search',
  description: 'Search patients by name or mobile',
  query: searchPatientSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/check-mobile',
  description:
    'Check if a patient exists by 10-digit mobile. Returns exists:true + basic info, or exists:false.',
  query: checkPatientByMobileSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/account',
  description: 'Get primary profile + all linked family members (post-login)',
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/my-profile',
  description: 'Get authenticated patient own profile',
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/patient/complete-profile',
  description: 'Complete / update patient profile after OTP login',
  requestSchema: completePatientProfileSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/family',
  description: 'Add a family member to the patient account',
  requestSchema: addFamilyMemberSchema,
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/family',
  description:
    'List all family members for the authenticated patient (paginated)',
  query: listFamilyMembersQuerySchema,
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/family/:familyMemberId',
  description: 'Get a single family member profile',
  params: familyMemberParamsSchema,
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'patch',
  path: '/api/v1/patient/family/:familyMemberId',
  description: 'Update a family member profile (only when status is New)',
  params: familyMemberParamsSchema,
  requestSchema: updateFamilyMemberSchema,
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/patient/family/:familyMemberId',
  description: 'Remove a family member link',
  params: familyMemberParamsSchema,
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/patient/update-profile-image',
  description: 'Update authenticated patient own profile image',
  requestSchema: updateProfileImageSchema,
  contentType: 'multipart/form-data',
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/patient/family/:familyMemberId/update-profile-image',
  description: 'Update a linked family member profile image',
  params: familyMemberParamsSchema,
  requestSchema: updateProfileImageSchema,
  contentType: 'multipart/form-data',
  tags: ['patient-family'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/:peteintId',
  description: 'Get patient by ID (receptionist)',
  params: getPetientSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/directory/search',
  description:
    'Search doctors/clinics by name, specialty, or proximity location in kilometers',
  query: patientDirectorySearchSchema,
  tags: ['patient-search'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/directory/doctors/favorites',
  description: 'Fetch list of favorite doctors for the authenticated patient',
  query: listFavoriteDoctorsQuerySchema,
  tags: ['patient-search'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/directory/doctors/:doctorId',
  description: 'Get doctor public profile, credentials, and practicing clinics',
  params: patientDoctorProfileSchema,
  tags: ['patient-search'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/directory/doctors/:doctorId/toggle-favorite',
  description: 'Toggle doctor favorite status for the patient',
  params: patientDoctorProfileSchema,
  tags: ['patient-search'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/directory/doctors/:doctorId/slots',
  description: 'Get slot availability for a doctor on a given date at a clinic',
  params: patientDoctorProfileSchema,
  query: patientDoctorSlotsQuerySchema,
  tags: ['patient-search'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/appointments/cancellation-policy',
  description:
    'Get cancellation policy for booking (application-level and clinic-level)',
  query: getBookingCancellationPolicySchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/appointments/pricing-preview',
  description:
    'Get calculated platform fee, GST, and total payable breakdown before booking',
  query: patientPricingPreviewQuerySchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/appointments',
  description: 'Book an appointment for patient or family member',
  requestSchema: patientBookingSchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/appointments/verify-payment',
  description: 'Verify Razorpay payment signature and confirm appointment',
  requestSchema: verifyAppointmentPaymentSchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/appointments',
  description:
    'List combined past and upcoming appointments for patient & family members',
  query: patientAppointmentsQuerySchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/recent-activity',
  description:
    'Unified recent-activity feed (appointments, lab tests, prescriptions) for the patient and linked family members, returned as card-ready items with a primary status chip',
  query: patientRecentActivityQuerySchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/appointments/:patientId',
  description:
    'List past and upcoming appointments for a specific family member or self',
  params: patientAppointmentsParamsSchema,
  query: patientAppointmentsQuerySchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/appointments/detail/:appointmentId',
  description:
    'Get details of a specific appointment belonging to patient or family members',
  params: patientAppointmentDetailParamsSchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/appointments/:appointmentId/cancel',
  description:
    'Cancel patient appointment, performing validation and processing refunds',
  params: patientAppointmentDetailParamsSchema,
  requestSchema: requestCancellationSchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/patient/appointments/:appointmentId',
  description:
    'Reschedule patient appointment, performing validation checks and updating slot/time details',
  params: patientAppointmentDetailParamsSchema,
  requestSchema: patientRescheduleSchema,
  tags: ['patient-booking'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/associated-doctors',
  description:
    'Get distinct list of doctors that have appointments with the patient or family members across all statuses',
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/lab-reports',
  description:
    'Get list of lab reports for the primary patient and linked family members with results data and PDF/image download details',
  query: patientLabReportsQuerySchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/lab-reports/:appointmentTestId/report-upload',
  description:
    'Upload a report for an existing lab test order from patient side',
  params: patientAppointmentTestParamsSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/prescriptions',
  description:
    'Get list of prescriptions for the primary patient and linked family members with detailed medicine data and PDF/image download details',
  query: patientPrescriptionsQuerySchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/associated-documents',
  description:
    'Get consolidated list of associated documents (gallery, manual/digital prescriptions, consent files, lab reports) for the primary patient and linked family members',
  query: patientAssociatedDocumentsQuerySchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/patient/reviews',
  description: 'Submit a rating and review for a completed appointment',
  requestSchema: createDoctorReviewSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/patient/reviews/:reviewId',
  description: 'Update an existing rating and review',
  params: doctorReviewParamsSchema,
  requestSchema: updateDoctorReviewSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/patient/reviews/:reviewId',
  description: 'Delete an existing review',
  params: doctorReviewParamsSchema,
  tags: ['patient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/patient/directory/doctors/:doctorId/reviews',
  description: 'Fetch paginated public reviews for a specific doctor',
  params: doctorReviewDoctorParamsSchema,
  query: doctorReviewQuerySchema,
  tags: ['patient'],
});
