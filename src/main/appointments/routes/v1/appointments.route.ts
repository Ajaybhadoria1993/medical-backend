// src/main/appointments/routes/v1/appointments.route.ts
import express from 'express';

import {
  requireAuth,
  requireAdmin,
  requireClinic,
  requireReceptionist,
  enforceClinicAutoLogout,
  requireDoctor,
  requireRole,
} from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { getAppointmentDetailsController } from '../../controllers/appointmentDetails.controller';

import {
  createAppointmentController,
  createCustomAppointmentController,
  getAllClinicAppointmentController,
  getClinicAppointmentDetailsController,
  getAllUserAppointmentController,
  getAppointmentController,
  getAppointmentHistoryController,
  getAvailableSlotsForDateController,
  getDcotorApppointmentController,
  getPatientApppointmentController,
  updateAppointmentController,
  markAsNoShowController,
  setNoShowPolicyController,
  getNoShowPolicyController,
  getPatientNoShowHistoryController,
  getClinicNoShowAnalyticsController,
  getAppointmentPaymentsController,
  getLastPatientReportCardController,
  createPatientGalleryController,
  getPatientGalleryController,
  deletePatientGalleryController,
  deleteAppointmentGalleryController,
  createDoctorGalleryController,
  getDoctorGalleryController,
  deleteDoctorGalleryController,
  getDoctorGalleryBySpecialtyController,
  updateConsentFileController,
  upsertDoctorManualPrescriptionController,
  sendManualPrescriptionLinkController,
  getMedicalCertificateController,
  upsertMedicalCertificateController,
  addMultipleServicesController,
  getMultipleServicesController,
  getRemainingServicesController,
  convertAppointmentToFreeController,
} from '../../controllers/appointment.controller';
import { requirePermission } from '../../../../middlewear/permission.middleware';
import { PERMISSION_KEYS } from '../../../permissions/utils/permission.constants';
import {
  requireAppointmentScope,
  requireDoctorScope,
} from '../../../permissions/middlewares/staffScope.middleware';
import {
  requirePaymentPermissionForPayload,
  requireWalkInPermissionForPayload,
} from '../../middlewares/appointmentPermission.middleware';
import { cancelAppointmentController } from '../../../cancellation-policy/controllers/cancellationPolicy.controller';
import { requestCancellationSchema } from '../../../cancellation-policy/schemas/cancellationPolicy.schemas';
import {
  appointmentIdSchema,
  appointmentQuerySchema,
  clinicAppointmentDetailsQuerySchema,
  createAppointmentSchemas,
  createCustomAppointmentSchema,
  doctorIdSchema,
  getAvailableSlotsForDateSchemas,
  getAvailableSlotsForParamsSchemas,
  patientIdSchema,
  updateAppointmentSchema,
  createNoShowPolicySchema,
  markNoShowSchema,
  clinicNoShowQuerySchema,
  getAppointmentPaymentsSchema,
  createPatientGallerySchema,
  getPatientGallerySchema,
  getDoctorGallerySchema,
  medicalCertificateSchema,
  addMultipleServicesSchema,
  sendManualPrescriptionNotificationSchema,
} from '../../schemas/appointment.schemas';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  uploadConsentFile,
  uploadDoctorGallery,
  uploadDoctorManualPrescription,
  uploadPatientGallery,
} from '../../../../middlewear/upload.middleware';
import {
  enforceDateLimit,
  FEATURE_KEYS,
} from '../../../../middlewear/limitation.middleware';
import { getQueueStateController } from '../../../appointment-engine/controllers/queueState.controller';
import { getReceptionLiveQueueController } from '../../../appointment-engine/controllers/receptionLiveQueue.controller';
import {
  announceSessionOverrideController,
  getSessionOverridesController,
  getSessionOverrideHistoryController,
} from '../../../appointment-engine/controllers/sessionOverride.controller';
import {
  announceSessionOverrideSchema,
  getSessionOverridesQuerySchema,
  getSessionOverrideHistoryQuerySchema,
  announceSessionOverrideResponseSchema,
  getSessionOverridesResponseSchema,
  getSessionOverrideHistoryResponseSchema,
} from '../../../appointment-engine/schemas/sessionOverride.schemas';
import {
  markDoctorArrivalController,
  getDoctorArrivalController,
} from '../../../appointment-engine/controllers/doctorArrival.controller';
import {
  markDoctorArrivalSchema,
  getDoctorArrivalQuerySchema,
  markDoctorArrivalResponseSchema,
  getDoctorArrivalResponseSchema,
} from '../../../appointment-engine/schemas/doctorArrival.schemas';
import {
  getSlotConfigController,
  getMissedSlotOptionsController,
  setSlotConfigController,
  getAvailableSlotsController,
} from '../../../appointment-engine/controllers/slotConfig.controller';
import {
  getSlotConfigQuerySchema,
  getMissedSlotOptionsQuerySchema,
  getMissedSlotOptionsResponseSchema,
} from '../../../appointment-engine/schemas/slotConfig.schemas';
import {
  queueStateResponseSchema,
  receptionLiveQueueResponseSchema,
} from '../../../appointment-engine/schemas/queue.schemas';
import {
  setSlotConfigSchema,
  getSlotConfigResponseSchema,
  setSlotConfigResponseSchema,
  getAvailableSlotsQuerySchema,
} from '../../../appointment-engine/schemas/slotConfig.schemas';
import {
  getExtraSlotsController,
  setExtraSlotsController,
} from '../../../appointment-engine/controllers/extraSlots.controller';
import {
  getExtraSlotsQuerySchema,
  setExtraSlotsSchema,
  getExtraSlotsResponseSchema,
  setExtraSlotsResponseSchema,
} from '../../../appointment-engine/schemas/extraSlots.schemas';
import { dismissMissedSlotController } from '../../../appointment-engine/controllers/missedSlotDismissal.controller';
import {
  dismissMissedSlotSchema,
  dismissMissedSlotResponseSchema,
} from '../../../appointment-engine/schemas/missedSlotDismissal.schemas';

const appointmentsRouter = express.Router();

/**
 * @route POST /api/v1/appointments/
 * @desc Create a new appointment for a patient
 * @access Private (Admin, Clinic)
 */

appointmentsRouter.post(
  '/add-patient-gallery',
  requireAuth,
  requireDoctor,
  requireClinic,
  uploadPatientGallery.single('imageUrl'),
  validate(createPatientGallerySchema, 'body'),
  createPatientGalleryController
);

appointmentsRouter.get(
  '/get-patient-gallery',
  requireAuth,
  validate(getPatientGallerySchema, 'query'),
  getPatientGalleryController
);

appointmentsRouter.delete(
  '/delete-patient-gallery/:id',
  requireAuth,
  requireDoctor,
  deletePatientGalleryController
);

appointmentsRouter.delete(
  '/delete-patient-gallery-of-appointment/:appointmentId',
  requireAuth,
  requireDoctor,
  deleteAppointmentGalleryController
);

appointmentsRouter.post(
  '/add-doctor-gallery',
  requireAuth,
  requireDoctor,
  requireClinic,
  uploadDoctorGallery.single('imageUrl'),
  createDoctorGalleryController
);

appointmentsRouter.get(
  '/get-doctor-gallery',
  requireAuth,
  requireDoctor,
  validate(getDoctorGallerySchema, 'query'),
  getDoctorGalleryController
);

appointmentsRouter.get(
  '/get-doctor-gallery-by-specialty',
  requireAuth,
  validate(getDoctorGallerySchema, 'query'),
  getDoctorGalleryBySpecialtyController
);

appointmentsRouter.delete(
  '/delete-doctor-gallery/:id',
  requireAuth,
  requireDoctor,
  deleteDoctorGalleryController
);

appointmentsRouter.get(
  '/payment-transactions',
  requireAuth,
  requireClinic,
  validate(getAppointmentPaymentsSchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.PAYMENT_HISTORY_MONTHS),
  getAppointmentPaymentsController
);

appointmentsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  requireClinic,
  enforceClinicAutoLogout,
  validate(createAppointmentSchemas, 'body'),
  requirePermission(PERMISSION_KEYS.APPOINTMENT_CREATE, [
    'Receptionist',
    'Nurse',
  ]),
  requireWalkInPermissionForPayload,
  requirePaymentPermissionForPayload,
  requireDoctorScope('doctorId', 'body'),
  createAppointmentController
);

/**
 * @route POST /api/v1/appointments/custom
 * @desc Create a custom / override appointment — a booking deliberately made
 *       outside the doctor's configured availability: after clinic hours,
 *       during a break, on a day the clinic is closed, or at any future time
 *       the schedule does not offer.
 *
 *       A separate route rather than a flag on POST `/`, on purpose. The
 *       override marker is set here by the server, so a request body can never
 *       pick the validation path and turn the normal endpoint into an
 *       availability bypass. It also gives the extra permission somewhere to
 *       hang: booking is not the same right as booking outside the schedule.
 *
 *       Availability is not validated. Authorization and past-time still are.
 * @access Private (Admin, Doctor; Receptionist/Nurse with appointment:custom_slot)
 */
appointmentsRouter.post(
  '/custom',
  requireAuth,
  requireAdmin,
  requireClinic,
  enforceClinicAutoLogout,
  validate(createCustomAppointmentSchema, 'body'),
  requirePermission(PERMISSION_KEYS.APPOINTMENT_CUSTOM_SLOT, [
    'Receptionist',
    'Nurse',
  ]),
  requirePaymentPermissionForPayload,
  requireDoctorScope('doctorId', 'body'),
  createCustomAppointmentController
);

/**
 * @route PUT /api/v1/appointments/:appointmentId
 * @desc Update an existing appointment details
 * @access Private (Admin, Clinic)
 */
appointmentsRouter.put(
  '/:appointmentId',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(updateAppointmentSchema, 'body'),
  validate(appointmentIdSchema, 'params'),
  enforceClinicAutoLogout,
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  updateAppointmentController
);

/**
 * @route POST /api/v1/appointments/:appointmentId/cancel
 * @desc Cancel appointment (Staff-initiated policy cancellation)
 * @access Private (Clinic)
 */
appointmentsRouter.post(
  '/:appointmentId/cancel',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(requestCancellationSchema, 'body'),
  validate(appointmentIdSchema, 'params'),
  enforceClinicAutoLogout,
  requireAppointmentScope('appointmentId', 'params'),
  cancelAppointmentController
);

appointmentsRouter.post(
  '/update-doctor-manual-prescription/:appointmentId',
  requireAuth,
  requireClinic,
  uploadDoctorManualPrescription.single('doctorManualPrescription'),
  validate(appointmentIdSchema, 'params'),
  upsertDoctorManualPrescriptionController
);

appointmentsRouter.post(
  '/:appointmentId/send-manual-prescription-notification',
  requireAuth,
  requireDoctor,
  validate(appointmentIdSchema, 'params'),
  validate(sendManualPrescriptionNotificationSchema, 'body'),
  sendManualPrescriptionLinkController
);

appointmentsRouter.put(
  '/consent/:appointmentId',
  requireAuth,
  requireClinic,
  uploadConsentFile.single('consentFile'),
  updateConsentFileController
);

/**
 * @route GET /api/v1/appointments/session-override/history
 * @desc The day's full override log — cleared rows included, newest first,
 *       with the row currently in effect flagged. Backs the delay settings
 *       page, where staff need to see what was changed and by whom rather
 *       than only what is live.
 * @access Private (Admin, Receptionist, Doctor)
 *
 * **Must stay above `GET /:appointmentId/history` below.** Express matches in
 * order, and that route's pattern fits this path perfectly — with
 * `appointmentId` bound to the literal "session-override", which then fails
 * UUID validation and returns 400. The one-segment `/session-override` routes
 * further down are safe from it; this two-segment one is not.
 */
appointmentsRouter.get(
  '/session-override/history',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSessionOverrideHistoryQuerySchema, 'query'),
  getSessionOverrideHistoryController
);

/**
 * @route GET /api/v1/appointments/:appointmentId/history
 * @desc Get activity history for a specific appointment
 * @access Private (Auth)
 */
appointmentsRouter.get(
  '/:appointmentId/history',
  requireAuth,
  validate(appointmentIdSchema, 'params'),
  getAppointmentHistoryController
);

/**
 * @route GET /api/v1/appointments/all/clicnic
 * @desc Get all appointments associated with a specific clinic
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/all/clicnic',
  requireAuth,
  requireReceptionist,
  requireClinic,
  requirePermission(PERMISSION_KEYS.APPOINTMENT_VIEW, ['Receptionist']),
  validate(appointmentQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  enforceClinicAutoLogout,
  getAllClinicAppointmentController
);

/**
 * @route GET /api/v1/appointments/details/clinic
 * @desc Get whole-day appointment status totals for a clinic
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/details/clinic',
  requireAuth,
  requireReceptionist,
  requireClinic,
  requirePermission(PERMISSION_KEYS.APPOINTMENT_VIEW, ['Receptionist']),
  validate(clinicAppointmentDetailsQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  enforceClinicAutoLogout,
  getClinicAppointmentDetailsController
);

/**
 * @route GET /api/v1/appointments/all/user
 * @desc Get all appointments for the current user across clinics
 * @access Private (Admin, Clinic)
 */
appointmentsRouter.get(
  '/all/user',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(appointmentQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  getAllUserAppointmentController
);

/**
 * @route GET /api/v1/appointments/queue-state
 * @desc Get real-time queue state (from Redis cache) for a doctor's daily queue
 * @query clinicId, doctorId, date (optional, defaults to today)
 * @access Private (Auth)
 */
appointmentsRouter.get(
  '/queue-state',
  requireAuth,
  requireClinic,
  getQueueStateController
);

/**
 * @route GET /api/v1/appointments/reception/live-queue
 * @desc Clinic-wide live doctor queue board (status, waiting, next-in-queue,
 *       current running patient per doctor/admin). Real-time updates pushed
 *       via Socket.io "reception.liveQueue.updated" to the clinic room.
 * @access Private (Receptionist, Admin)
 */
appointmentsRouter.get(
  '/reception/live-queue',
  requireAuth,
  requireRole(['Receptionist', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  getReceptionLiveQueueController
);

/**
 * @route POST /api/v1/appointments/session-override
 * @desc Declare a delay on one or more doctors' day today. `running_late`
 *       announces it — the engine's projection moves and waiting patients are
 *       re-notified via the existing "running_late" push/socket event, but
 *       nothing is rewritten. `schedule_shift` moves the day instead: the
 *       remaining appointments and the bookable window slide forward, so the
 *       capacity behind the delay is not lost. `dryRun: true` previews a shift
 *       without writing. Either form clears with valueMinutes: 0.
 * @access Private (Admin, Receptionist — any clinic doctor; Doctor — self only)
 */
appointmentsRouter.post(
  '/session-override',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(announceSessionOverrideSchema, 'body'),
  announceSessionOverrideController
);

/**
 * @route GET /api/v1/appointments/session-override
 * @desc Today's active session overrides for the clinic, optionally narrowed
 *       to specific doctorIds.
 * @access Private (Admin, Receptionist, Doctor)
 *
 * Registered before "/:appointmentId" — Express matches in order, so the
 * parameterised route would otherwise swallow this path.
 */
appointmentsRouter.get(
  '/session-override',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSessionOverridesQuerySchema, 'query'),
  getSessionOverridesController
);

/**
 * @route POST /api/v1/appointments/doctor-arrival
 * @desc Record that a doctor has started their day, today.
 */
appointmentsRouter.post(
  '/doctor-arrival',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(markDoctorArrivalSchema, 'body'),
  markDoctorArrivalController
);

/**
 * @route GET /api/v1/appointments/doctor-arrival
 * @desc Today's arrived doctors for the clinic. Must stay above "/:appointmentId".
 */
appointmentsRouter.get(
  '/doctor-arrival',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getDoctorArrivalQuerySchema, 'query'),
  getDoctorArrivalController
);

/**
 * @route POST /api/v1/appointments/slot-config
 * @desc Customize one shift's slot count/duration (or token count) for a current/future date.
 */
appointmentsRouter.post(
  '/slot-config',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(setSlotConfigSchema, 'body'),
  setSlotConfigController
);

/**
 * @route GET /api/v1/appointments/slot-config
 * @desc Current slot setup for a doctor's session(s) on a date. Must stay above "/:appointmentId".
 */
appointmentsRouter.get(
  '/slot-config',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSlotConfigQuerySchema, 'query'),
  getSlotConfigController
);

/**
 * @route GET /api/v1/appointments/missed-slot-options
 * @desc What can be done with a slot whose time has passed — shift it (and where to), or record it at its original time. Must stay above "/:appointmentId".
 */
appointmentsRouter.get(
  '/missed-slot-options',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getMissedSlotOptionsQuerySchema, 'query'),
  getMissedSlotOptionsController
);

/**
 * @route GET /api/v1/appointments/available-slots
 * @desc Custom-slot-aware bookable slots for a date. Must stay above "/:appointmentId".
 */
appointmentsRouter.get(
  '/available-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getAvailableSlotsQuerySchema, 'query'),
  getAvailableSlotsController
);

/**
 * @route POST /api/v1/appointments/extra-slots
 * @desc Add (or clear) extra bookable slots after one session's real end time, for a walk-in surge.
 */
appointmentsRouter.post(
  '/extra-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(setExtraSlotsSchema, 'body'),
  setExtraSlotsController
);

/**
 * @route GET /api/v1/appointments/extra-slots
 * @desc Current extra-slot setup for a doctor's session(s) on a date. Must stay above "/:appointmentId".
 */
appointmentsRouter.get(
  '/extra-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getExtraSlotsQuerySchema, 'query'),
  getExtraSlotsController
);

/**
 * @route POST /api/v1/appointments/missed-slot/dismiss
 * @desc Marks a past, never-booked grid slot as handled (shifted elsewhere or acknowledged) so `available-slots` stops offering it. Must stay above "/:appointmentId".
 */
appointmentsRouter.post(
  '/missed-slot/dismiss',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(dismissMissedSlotSchema, 'body'),
  dismissMissedSlotController
);

/**
 * @route GET /api/v1/appointments/:appointmentId/details
 * @desc Staff appointment page payload — only the fields that screen reads
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/:appointmentId/details',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  getAppointmentDetailsController
);

/**
 * @route GET /api/v1/appointments/:appointmentId
 * @desc Get detailed information about a specific appointment by ID
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/:appointmentId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  getAppointmentController
);

appointmentsRouter.get(
  '/patient-last-details/:patientId',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(patientIdSchema, 'params'),
  getLastPatientReportCardController
);

/**
 * @route GET /api/v1/appointments/patient/:patientId
 * @desc Get all appointments for a specific patient
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/patient/:patientId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(patientIdSchema, 'params'),
  enforceClinicAutoLogout,
  getPatientApppointmentController
);

/**
 * @route GET /api/v1/appointments/doctor/:doctorId
 * @desc Get all appointments for a specific doctor
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/doctor/:doctorId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(doctorIdSchema, 'params'),
  getDcotorApppointmentController
);

/**
 * @route GET /api/v1/appointments/doctor/available/slot-date-clinic/:doctorId
 * @desc Get available time slots for a doctor on a specific date at a clinic
 * @access Private (Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/doctor/available/slot-date-clinic/:doctorId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAvailableSlotsForParamsSchemas, 'params'),
  validate(getAvailableSlotsForDateSchemas, 'query'),
  getAvailableSlotsForDateController
);

/**
 * @route POST /api/v1/appointments/:appointmentId/no-show
 * @desc Mark an appointment as No Show
 * @access Private (Doctor, Receptionist, Clinic)
 */
appointmentsRouter.post(
  '/:appointmentId/no-show',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(markNoShowSchema, 'body'),
  markAsNoShowController
);

/**
 * @route POST /api/v1/appointments/no-show/policy
 * @desc Set or update No Show policy for a clinic
 * @access Private (Admin; Receptionist with queue:manage)
 */
appointmentsRouter.post(
  '/no-show/policy',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(createNoShowPolicySchema, 'body'),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist']),
  setNoShowPolicyController
);

/**
 * @route GET /api/v1/appointments/no-show/policy
 * @desc Get No Show policy for a clinic
 * @access Private (Admin, Clinic, Receptionist)
 */
appointmentsRouter.get(
  '/no-show/policy',
  requireAuth,
  requireClinic,
  getNoShowPolicyController
);

/**
 * @route GET /api/v1/appointments/no-show/history/patient/:patientId
 * @desc Get No Show history for a patient
 * @access Private (Doctor, Receptionist, Clinic)
 */
appointmentsRouter.get(
  '/no-show/history/patient/:patientId',
  requireAuth,
  requireClinic,
  validate(patientIdSchema, 'params'),
  getPatientNoShowHistoryController
);

/**
 * @route GET /api/v1/appointments/no-show/analytics/clinic
 * @desc Get No Show analytics for a clinic
 * @access Private (Admin, Clinic)
 */
appointmentsRouter.get(
  '/no-show/analytics/clinic',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(clinicNoShowQuerySchema, 'query'),
  getClinicNoShowAnalyticsController
);

appointmentsRouter.get(
  '/medical-certificate/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  getMedicalCertificateController
);

appointmentsRouter.post(
  '/medical-certificate/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(medicalCertificateSchema, 'body'),
  upsertMedicalCertificateController
);

appointmentsRouter.post(
  '/multiple-service/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(addMultipleServicesSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  addMultipleServicesController
);

appointmentsRouter.get(
  '/multiple-service/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getMultipleServicesController
);

appointmentsRouter.get(
  '/get-remaining-service/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getRemainingServicesController
);

/**
 * @route POST /api/v1/appointments/convert-appointment-to-free/:appointmentId
 * @desc Add a "Free Consultation" service (price 0, INR, 1-day duration) as
 *       an additional service on the appointment, reusing an existing
 *       "Free Consultation" service for the appointment's doctor/clinic if
 *       one already exists (no-op if it's already attached to this
 *       appointment). Requires the appointment's payment to already be
 *       Refunded, and is not allowed once the appointment is
 *       Cancelled/Completed.
 * @access Private (Clinic)
 */
appointmentsRouter.post(
  '/convert-appointment-to-free/:appointmentId',
  requireAuth,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  convertAppointmentToFreeController
);

export default appointmentsRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments', // full path as it would appear in the app
  description: 'Create a appointments for a patient',
  requestSchema: createAppointmentSchemas,
  tags: ['appointments', 'Petient'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/custom',
  description:
    'Create a custom / override appointment. Bypasses clinic availability, ' +
    'working hours, breaks and end-of-shift entirely, so an authorized user ' +
    'can book an urgent patient at any future time. Still enforces the ' +
    'appointment:custom_slot permission and rejects times in the past.',
  requestSchema: createCustomAppointmentSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/appointments/:appointmentId', // full path as it would appear in the app
  description: 'update a appointments for a patient',
  requestSchema: updateAppointmentSchema,
  params: appointmentIdSchema,
  tags: ['appointments', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/:appointmentId/add-multiple-services',
  description: 'Add multiple services to an appointment',
  requestSchema: addMultipleServicesSchema,
  params: appointmentIdSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/:appointmentId/multiple-services',
  description: 'Get multiple services for an appointment',
  params: appointmentIdSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/all/clicnic', // full path as it would appear in the app
  description: 'Get all patient appointments by clinic',
  query: appointmentQuerySchema,
  tags: ['appointments', 'Clinic'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/details/clinic',
  description: 'Get clinic appointment totals by selected date',
  query: clinicAppointmentDetailsQuerySchema,
  tags: ['appointments', 'Clinic'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/all/user', // full path as it would appear in the app
  description: 'Get all patient appointments by user',
  query: appointmentQuerySchema,
  tags: ['appointments', 'user'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/:appointmentId', // full path as it would appear in the app
  description: 'get appointment by id',
  params: appointmentIdSchema,
  tags: ['appointments', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/:appointmentId/details',
  description: 'appointment details for the staff appointment page',
  params: appointmentIdSchema,
  tags: ['appointments'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/patient/:patientId', // full path as it would appear in the app
  description: 'get  patientId  appointment by id',
  params: patientIdSchema,
  tags: ['appointments', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/doctor/:doctorId', // full path as it would appear in the app
  description: 'get doctorId appointment by id',
  params: doctorIdSchema,
  tags: ['appointments', 'Petient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/doctor/available/slot-date-clinic/:doctorId', // full path as it would appear in the app
  description: 'get avlble slot for a date',
  params: getAvailableSlotsForParamsSchemas,
  query: getAvailableSlotsForDateSchemas,
  tags: ['appointments', 'Petient'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/:appointmentId/no-show',
  description: 'Mark an appointment as No Show',
  params: appointmentIdSchema,
  requestSchema: markNoShowSchema,
  tags: ['appointments', 'NoShow'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/no-show/policy',
  description: 'Set or update No Show policy for a clinic',
  requestSchema: createNoShowPolicySchema,
  tags: ['appointments', 'NoShow'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/no-show/policy',
  description: 'Get No Show policy for a clinic',
  tags: ['appointments', 'NoShow'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/no-show/history/patient/:patientId',
  description: 'Get No Show history for a patient',
  params: patientIdSchema,
  tags: ['appointments', 'NoShow'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/no-show/analytics/clinic',
  description: 'Get No Show analytics for a clinic',
  tags: ['appointments', 'NoShow'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/:appointmentId/send-manual-prescription-notification',
  description:
    'Send manual prescription upload link/notification to doctor mobile device',
  params: appointmentIdSchema,
  requestSchema: sendManualPrescriptionNotificationSchema,
  tags: ['appointments', 'Notification'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/convert-appointment-to-free/:appointmentId',
  description:
    'Add a Free Consultation service (price 0, INR, 1-day duration) as an ' +
    'additional service on the appointment, reusing an existing Free ' +
    'Consultation service for the doctor/clinic if present. Requires the ' +
    "appointment's payment to already be Refunded; rejected for " +
    'Cancelled/Completed appointments.',
  params: appointmentIdSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/doctor-arrival',
  description:
    'Record that a doctor has started a shift, today. Doctor may only mark ' +
    'their own arrival; Admin/Receptionist may mark any doctor in their clinic.',
  requestSchema: markDoctorArrivalSchema,
  responseSchema: markDoctorArrivalResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/session-override',
  description:
    'Declare a delay on one or more doctors for a day (defaults to today). ' +
    '`running_late` announces it — the engine projection moves and waiting ' +
    'patients are re-notified, but nothing is rewritten. `schedule_shift` ' +
    'moves the day instead: the remaining appointments and the bookable ' +
    'window slide forward by `valueMinutes`. `dryRun: true` previews a shift ' +
    'without writing. Either form clears with `valueMinutes: 0`. Access: ' +
    'Admin / Super_Admin / Receptionist may target any doctor in their ' +
    'clinic; a Doctor may only target their own id.',
  requestSchema: announceSessionOverrideSchema,
  responseSchema: announceSessionOverrideResponseSchema,
  tags: ['appointments', 'SessionOverride'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/doctor-arrival',
  description:
    "Today's arrived doctors for the clinic, optionally narrowed by doctorIds.",
  query: getDoctorArrivalQuerySchema,
  responseSchema: getDoctorArrivalResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/session-override',
  description:
    "A day's active session overrides for the clinic (defaults to today). " +
    'Optional `doctorIds` (repeated or comma-separated) narrows it; with ' +
    'none, every doctor currently carrying a non-zero value is returned so ' +
    'the reception board can badge every card in one call. Pass ' +
    '`type=schedule_shift` with `doctorIds` to also get each doctor’s ' +
    'post-shift sessions. Access: Admin / Super_Admin / Receptionist / Doctor.',
  query: getSessionOverridesQuerySchema,
  responseSchema: getSessionOverridesResponseSchema,
  tags: ['appointments', 'SessionOverride'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/slot-config',
  description:
    "Customize one shift's slot count/duration (time-based) or token count " +
    "(token-based) for a current/future date. Validated against the shift's " +
    'real time window; rejected if the config does not fit.',
  requestSchema: setSlotConfigSchema,
  responseSchema: setSlotConfigResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/slot-config',
  description:
    "Current slot setup for a doctor's session(s) on a date, including " +
    'whether each session has been customized.',
  query: getSlotConfigQuerySchema,
  responseSchema: getSlotConfigResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/queue-state',
  description:
    "Per-appointment timing for one doctor's day: estimated wait, projected " +
    'start, when the current patient went in, and when each patient checked ' +
    'in. Complements /queue/board, which carries positions and ordering but ' +
    'none of these fields.',
  responseSchema: queueStateResponseSchema,
  tags: ['appointments', 'Queue'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/reception/live-queue',
  description:
    'The composed clinic-wide board: every doctor on the roster with their ' +
    'queue, plus the derived affordances (actionTarget, checkInTarget, ' +
    'canAnnounceLate) so no client decides which patient a control acts on.',
  responseSchema: receptionLiveQueueResponseSchema,
  tags: ['appointments', 'Queue'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/missed-slot-options',
  description:
    'What can be done with a slot whose time has already passed: shift it to ' +
    'a newly created slot after that session ends (landing in the break ' +
    'before the next sitting, or after the last one), or record it at its ' +
    'original past time. Never offers an already-open slot earlier in the ' +
    'day — those stay held for ordinary bookings.',
  query: getMissedSlotOptionsQuerySchema,
  responseSchema: getMissedSlotOptionsResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/available-slots',
  description:
    'Custom-slot-aware bookable slots for a date — same underlying logic as ' +
    'the legacy booking-slots endpoint, with any live slot_config override ' +
    'applied on top, session by session.',
  query: getAvailableSlotsQuerySchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/extra-slots',
  description:
    'Add (or clear, with numberOfSlots: 0) extra bookable slots after one ' +
    "session's real end time, for a walk-in surge. Validated against the " +
    'free room before the next session that day, or midnight.',
  requestSchema: setExtraSlotsSchema,
  responseSchema: setExtraSlotsResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/extra-slots',
  description: "Current extra-slot setup for a doctor's session(s) on a date.",
  query: getExtraSlotsQuerySchema,
  responseSchema: getExtraSlotsResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/missed-slot/dismiss',
  description:
    'Marks a past, never-booked grid slot as handled (shifted elsewhere or ' +
    'acknowledged) so `available-slots` stops offering it — persists past a ' +
    'page refresh, unlike hiding it client-side alone. Rejected for a future date.',
  requestSchema: dismissMissedSlotSchema,
  responseSchema: dismissMissedSlotResponseSchema,
  tags: ['appointments'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/session-override/history',
  description:
    'Every override written for a day, cleared rows included, newest first. ' +
    'The audit view: which doctor, what value, who set it, and which row is ' +
    'currently in effect (`isActive`). Paginated by `limit` + `cursor` ' +
    '(ISO `createdAt` of the last row seen). Access: Admin / Super_Admin / ' +
    'Receptionist / Doctor.',
  query: getSessionOverrideHistoryQuerySchema,
  responseSchema: getSessionOverrideHistoryResponseSchema,
  tags: ['appointments', 'SessionOverride'],
});
