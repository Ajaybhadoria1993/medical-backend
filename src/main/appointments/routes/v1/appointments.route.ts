import express from 'express';

import {
  CLINIC_STAFF_ROLES,
  enforceClinicAutoLogout,
  requireAdmin,
  requireAuth,
  requireClinic,
  requireDoctor,
  requireReceptionist,
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
  collectAppointmentPaymentController,
  getAppointmentMoneyController,
  refundAppointmentPaymentController,
  getMultipleServicesController,
  getRemainingServicesController,
  convertAppointmentToFreeController,
  getMoveToTodayPreviewController,
  moveToTodayController,
  getLeaveMovePreviewController,
  leaveMoveController,
  leaveCancelController,
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
  moneyMoveSchema,
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
  moveToTodaySchema,
  leaveMovePreviewQuerySchema,
  leaveMoveSchema,
  leaveCancelSchema,
} from '../../schemas/appointment.schemas';
import { docsRegistry } from '../../../../apiDocs';
import {
  shareGalleryImageController,
  getSharedImagesController,
  unshareGalleryImageController,
} from '../../controllers/galleryShare.controller';
import {
  createGalleryShareSchema,
  galleryShareAppointmentParamsSchema,
  galleryShareParamsSchema,
} from '../../schemas/galleryShare.schemas';
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

/** @route POST /api/v1/appointments/add-patient-gallery — upload a patient image
 *  @access Doctor */
appointmentsRouter.post(
  '/add-patient-gallery',
  requireAuth,
  requireDoctor,
  requireClinic,
  uploadPatientGallery.single('imageUrl'),
  validate(createPatientGallerySchema, 'body'),
  createPatientGalleryController
);

/** @route GET /api/v1/appointments/get-patient-gallery — a patient's or appointment's images
 *  @access Admin, Doctor, Receptionist (own clinic, staff scope) */
appointmentsRouter.get(
  '/get-patient-gallery',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(getPatientGallerySchema, 'query'),
  requireAppointmentScope('appointmentId', 'query'),
  getPatientGalleryController
);

/** @route DELETE /api/v1/appointments/delete-patient-gallery/:id — delete one patient image
 *  @access Doctor (service: uploader only) */
appointmentsRouter.delete(
  '/delete-patient-gallery/:id',
  requireAuth,
  requireDoctor,
  deletePatientGalleryController
);

/** @route DELETE /api/v1/appointments/delete-patient-gallery-of-appointment/:appointmentId
 *  @access Doctor (service: the appointment's own doctor) */
appointmentsRouter.delete(
  '/delete-patient-gallery-of-appointment/:appointmentId',
  requireAuth,
  requireDoctor,
  deleteAppointmentGalleryController
);

/** @route POST /api/v1/appointments/add-doctor-gallery — upload a doctor gallery image
 *  @access Doctor */
appointmentsRouter.post(
  '/add-doctor-gallery',
  requireAuth,
  requireDoctor,
  requireClinic,
  uploadDoctorGallery.single('imageUrl'),
  createDoctorGalleryController
);

/** @route GET /api/v1/appointments/get-doctor-gallery — the doctor's own gallery
 *  @access Doctor */
appointmentsRouter.get(
  '/get-doctor-gallery',
  requireAuth,
  requireDoctor,
  validate(getDoctorGallerySchema, 'query'),
  getDoctorGalleryController
);

/** @route GET /api/v1/appointments/get-doctor-gallery-by-specialty — stock images by specialty
 *  @access Any signed-in user */
appointmentsRouter.get(
  '/get-doctor-gallery-by-specialty',
  requireAuth,
  validate(getDoctorGallerySchema, 'query'),
  getDoctorGalleryBySpecialtyController
);

/** @route DELETE /api/v1/appointments/delete-doctor-gallery/:id — delete one gallery image
 *  @access Doctor */
appointmentsRouter.delete(
  '/delete-doctor-gallery/:id',
  requireAuth,
  requireDoctor,
  deleteDoctorGalleryController
);

/** @route POST /api/v1/appointments/:appointmentId/shared-images — share a gallery image with the patient
 *  @access Doctor (service: the appointment's own doctor) */
appointmentsRouter.post(
  '/:appointmentId/shared-images',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(galleryShareAppointmentParamsSchema, 'params'),
  validate(createGalleryShareSchema, 'body'),
  shareGalleryImageController
);

/** @route GET /api/v1/appointments/:appointmentId/shared-images — images shared on this appointment
 *  @access Doctor (service: the appointment's own doctor) */
appointmentsRouter.get(
  '/:appointmentId/shared-images',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(galleryShareAppointmentParamsSchema, 'params'),
  getSharedImagesController
);

/** @route DELETE /api/v1/appointments/:appointmentId/shared-images/:shareId — unshare an image
 *  @access Doctor (service: the appointment's own doctor) */
appointmentsRouter.delete(
  '/:appointmentId/shared-images/:shareId',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(galleryShareParamsSchema, 'params'),
  unshareGalleryImageController
);

/** @route GET /api/v1/appointments/payment-transactions — deprecated: use /clinic-finance/transactions; kept one release for older apps
 *  @access Admin, Receptionist; Doctor (own payments only, filtered in the service) */
appointmentsRouter.get(
  '/payment-transactions',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(getAppointmentPaymentsSchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.PAYMENT_HISTORY_MONTHS),
  getAppointmentPaymentsController
);

/** @route POST /api/v1/appointments — book an appointment
 *  @access Admin, Doctor; Receptionist/Nurse with appointment:create, assigned doctors only */
appointmentsRouter.post(
  '/',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
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

/** @route POST /api/v1/appointments/custom — book outside the doctor's schedule (own route so no body flag can bypass it)
 *  @access Admin, Doctor; Receptionist/Nurse with appointment:custom_slot */
appointmentsRouter.post(
  '/custom',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
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

/** @route PUT /api/v1/appointments/:appointmentId — update an appointment
 *  @access Admin, Doctor, Receptionist (staff scope; confirm/complete: own doctor) */
appointmentsRouter.put(
  '/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(updateAppointmentSchema, 'body'),
  validate(appointmentIdSchema, 'params'),
  enforceClinicAutoLogout,
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  updateAppointmentController
);

/** @route POST /api/v1/appointments/:appointmentId/cancel — staff cancellation under the clinic policy
 *  @access Clinic staff (staff scope) */
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

/** @route POST /api/v1/appointments/update-doctor-manual-prescription/:appointmentId — upload a handwritten prescription
 *  @access Doctor (the appointment's own doctor); scope runs before the upload */
appointmentsRouter.post(
  '/update-doctor-manual-prescription/:appointmentId',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  uploadDoctorManualPrescription.single('doctorManualPrescription'),
  upsertDoctorManualPrescriptionController
);

/** @route POST /api/v1/appointments/:appointmentId/send-manual-prescription-notification
 *  @access Doctor (service: the appointment's own doctor) */
appointmentsRouter.post(
  '/:appointmentId/send-manual-prescription-notification',
  requireAuth,
  requireDoctor,
  validate(appointmentIdSchema, 'params'),
  validate(sendManualPrescriptionNotificationSchema, 'body'),
  sendManualPrescriptionLinkController
);

/** @route PUT /api/v1/appointments/consent/:appointmentId — upload the signed consent form
 *  @access Admin, Doctor, Receptionist (staff scope); scope runs before the upload */
appointmentsRouter.put(
  '/consent/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  uploadConsentFile.single('consentFile'),
  updateConsentFileController
);

/** @route GET /api/v1/appointments/session-override/history — the day's full delay log
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId/history */
appointmentsRouter.get(
  '/session-override/history',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSessionOverrideHistoryQuerySchema, 'query'),
  getSessionOverrideHistoryController
);

/** @route GET /api/v1/appointments/:appointmentId/history — the appointment's activity log
 *  @access Admin, Doctor, Receptionist, Nurse (staff scope) */
appointmentsRouter.get(
  '/:appointmentId/history',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist', 'Nurse']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getAppointmentHistoryController
);

/** @route GET /api/v1/appointments/all/clicnic — the clinic's appointment list
 *  @access Clinic staff; Receptionist with appointment:view */
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

/** @route GET /api/v1/appointments/details/clinic — whole-day status totals for the clinic
 *  @access Clinic staff; Receptionist with appointment:view */
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

/** @route GET /api/v1/appointments/all/user — the signed-in user's own appointments
 *  @access Any signed-in user with a clinic */
appointmentsRouter.get(
  '/all/user',
  requireAuth,
  requireAdmin,
  requireClinic,
  validate(appointmentQuerySchema, 'query'),
  enforceDateLimit(FEATURE_KEYS.STORAGE_MONTHS),
  getAllUserAppointmentController
);

/** @route GET /api/v1/appointments/queue-state — a doctor's live queue (Redis)
 *  @access Clinic members */
appointmentsRouter.get(
  '/queue-state',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getQueueStateController
);

/** @route GET /api/v1/appointments/reception/live-queue — clinic-wide live queue board
 *  @access Receptionist, Admin */
appointmentsRouter.get(
  '/reception/live-queue',
  requireAuth,
  requireRole(['Receptionist', 'Admin']),
  requireClinic,
  enforceClinicAutoLogout,
  getReceptionLiveQueueController
);

/** @route POST /api/v1/appointments/session-override — announce a delay or shift the day (dryRun previews)
 *  @access Admin, Receptionist (any doctor); Doctor (self only) */
appointmentsRouter.post(
  '/session-override',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(announceSessionOverrideSchema, 'body'),
  announceSessionOverrideController
);

/** @route GET /api/v1/appointments/session-override — today's active delays
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/session-override',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSessionOverridesQuerySchema, 'query'),
  getSessionOverridesController
);

/** @route POST /api/v1/appointments/doctor-arrival — record that a doctor started today
 *  @access Admin, Receptionist, Doctor */
appointmentsRouter.post(
  '/doctor-arrival',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(markDoctorArrivalSchema, 'body'),
  markDoctorArrivalController
);

/** @route GET /api/v1/appointments/doctor-arrival — today's arrived doctors
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/doctor-arrival',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getDoctorArrivalQuerySchema, 'query'),
  getDoctorArrivalController
);

/** @route POST /api/v1/appointments/slot-config — customise one shift's slots for a date
 *  @access Admin, Receptionist, Doctor */
appointmentsRouter.post(
  '/slot-config',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(setSlotConfigSchema, 'body'),
  setSlotConfigController
);

/** @route GET /api/v1/appointments/slot-config — a doctor's slot setup for a date
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/slot-config',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getSlotConfigQuerySchema, 'query'),
  getSlotConfigController
);

/** @route GET /api/v1/appointments/missed-slot-options — what can be done with a passed slot
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/missed-slot-options',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getMissedSlotOptionsQuerySchema, 'query'),
  getMissedSlotOptionsController
);

/** @route GET /api/v1/appointments/available-slots — bookable slots for a date
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/available-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getAvailableSlotsQuerySchema, 'query'),
  getAvailableSlotsController
);

/** @route POST /api/v1/appointments/extra-slots — add or clear slots after a session ends
 *  @access Admin, Receptionist, Doctor */
appointmentsRouter.post(
  '/extra-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(setExtraSlotsSchema, 'body'),
  setExtraSlotsController
);

/** @route GET /api/v1/appointments/extra-slots — a doctor's extra-slot setup for a date
 *  @access Admin, Receptionist, Doctor · must stay above /:appointmentId */
appointmentsRouter.get(
  '/extra-slots',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  validate(getExtraSlotsQuerySchema, 'query'),
  getExtraSlotsController
);

/** @route POST /api/v1/appointments/missed-slot/dismiss — mark a passed, unbooked slot as handled
 *  @access Admin, Receptionist, Doctor */
appointmentsRouter.post(
  '/missed-slot/dismiss',
  requireAuth,
  requireRole(['Admin', 'Super_Admin', 'Receptionist', 'Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(dismissMissedSlotSchema, 'body'),
  dismissMissedSlotController
);

/** @route GET /api/v1/appointments/:appointmentId/details — the staff appointment page payload
 *  @access Clinic staff (service: clinic and staff scope) */
appointmentsRouter.get(
  '/:appointmentId/details',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  getAppointmentDetailsController
);

/** @route GET /api/v1/appointments/:appointmentId — one appointment in full
 *  @access Clinic staff (service: clinic and staff scope) */
appointmentsRouter.get(
  '/:appointmentId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  getAppointmentController
);

/** @route GET /api/v1/appointments/patient-last-details/:patientId — the patient's latest clinical summary
 *  @access Doctor (service: patient must belong to the clinic) */
appointmentsRouter.get(
  '/patient-last-details/:patientId',
  requireAuth,
  requireDoctor,
  requireClinic,
  validate(patientIdSchema, 'params'),
  getLastPatientReportCardController
);

/** @route GET /api/v1/appointments/patient/:patientId — a patient with one of their appointments
 *  @access Clinic staff (service: own clinic, staff scope) */
appointmentsRouter.get(
  '/patient/:patientId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(patientIdSchema, 'params'),
  enforceClinicAutoLogout,
  getPatientApppointmentController
);

/** @route GET /api/v1/appointments/doctor/available/slot-date-clinic/:doctorId — a doctor's free slots on a date
 *  @access Clinic staff */
appointmentsRouter.get(
  '/doctor/available/slot-date-clinic/:doctorId',
  requireAuth,
  requireReceptionist,
  requireClinic,
  validate(getAvailableSlotsForParamsSchemas, 'params'),
  validate(getAvailableSlotsForDateSchemas, 'query'),
  getAvailableSlotsForDateController
);

/** @route POST /api/v1/appointments/:appointmentId/no-show — mark the patient as not attended
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.post(
  '/:appointmentId/no-show',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(markNoShowSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  markAsNoShowController
);

/** @route POST /api/v1/appointments/no-show/policy — set the clinic's no-show policy
 *  @access Admin; Receptionist with queue:manage */
appointmentsRouter.post(
  '/no-show/policy',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(createNoShowPolicySchema, 'body'),
  requirePermission(PERMISSION_KEYS.QUEUE_MANAGE, ['Receptionist']),
  setNoShowPolicyController
);

/** @route GET /api/v1/appointments/no-show/policy — the clinic's no-show policy
 *  @access Clinic members */
appointmentsRouter.get(
  '/no-show/policy',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  getNoShowPolicyController
);

/** @route GET /api/v1/appointments/no-show/history/patient/:patientId — a patient's no-show record
 *  @access Admin, Doctor, Receptionist */
appointmentsRouter.get(
  '/no-show/history/patient/:patientId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(patientIdSchema, 'params'),
  getPatientNoShowHistoryController
);

/** @route GET /api/v1/appointments/no-show/analytics/clinic — the clinic's no-show analytics
 *  @access Clinic members */
appointmentsRouter.get(
  '/no-show/analytics/clinic',
  requireAuth,
  requireRole(CLINIC_STAFF_ROLES),
  requireClinic,
  validate(clinicNoShowQuerySchema, 'query'),
  getClinicNoShowAnalyticsController
);

/** @route GET /api/v1/appointments/medical-certificate/:appointmentId — the visit's medical certificate
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.get(
  '/medical-certificate/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getMedicalCertificateController
);

/** @route POST /api/v1/appointments/medical-certificate/:appointmentId — create or update the certificate
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.post(
  '/medical-certificate/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(medicalCertificateSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  upsertMedicalCertificateController
);

/** @route POST /api/v1/appointments/multiple-service/:appointmentId — add services to the visit
 *  @access Admin, Doctor, Receptionist (staff scope; money needs payment:manage) */
appointmentsRouter.post(
  '/multiple-service/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(addMultipleServicesSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  addMultipleServicesController
);

/** @route POST /api/v1/appointments/:appointmentId/payments — record money received at the desk (part or full)
 *  @access Admin; Doctor, Receptionist with payment:manage (staff scope) */
appointmentsRouter.post(
  '/:appointmentId/payments',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(moneyMoveSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePermission(PERMISSION_KEYS.PAYMENT_MANAGE, ['Doctor', 'Receptionist']),
  collectAppointmentPaymentController
);

/** @route GET /api/v1/appointments/:appointmentId/payments — the visit's balance and money entries
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.get(
  '/:appointmentId/payments',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getAppointmentMoneyController
);

/** @route POST /api/v1/appointments/:appointmentId/refunds — give money back (part or full)
 *  @access Admin; Doctor, Receptionist with payment:manage (staff scope) */
appointmentsRouter.post(
  '/:appointmentId/refunds',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  validate(moneyMoveSchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePermission(PERMISSION_KEYS.PAYMENT_MANAGE, ['Doctor', 'Receptionist']),
  refundAppointmentPaymentController
);

/** @route GET /api/v1/appointments/multiple-service/:appointmentId — the visit's extra services
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.get(
  '/multiple-service/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getMultipleServicesController
);

/** @route GET /api/v1/appointments/get-remaining-service/:appointmentId — services not yet added
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.get(
  '/get-remaining-service/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getRemainingServicesController
);

/** @route POST /api/v1/appointments/convert-appointment-to-free/:appointmentId — add a ₹0 consultation (payment must be refunded)
 *  @access Admin, Doctor, Receptionist (staff scope; money needs payment:manage) */
appointmentsRouter.post(
  '/convert-appointment-to-free/:appointmentId',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  requirePaymentPermissionForPayload,
  convertAppointmentToFreeController
);

/** @route GET /api/v1/appointments/:appointmentId/move-to-today/preview — can it move, suggested token/time, today's free slots
 *  @access Admin, Doctor, Receptionist (staff scope) */
appointmentsRouter.get(
  '/:appointmentId/move-to-today/preview',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  validate(appointmentIdSchema, 'params'),
  requireAppointmentScope('appointmentId', 'params'),
  getMoveToTodayPreviewController
);

/** @route POST /api/v1/appointments/:appointmentId/move-to-today — move a past or future visit to today
 *  @access Admin, Doctor, Receptionist (staff scope); off-schedule time needs appointment:custom_slot */
appointmentsRouter.post(
  '/:appointmentId/move-to-today',
  requireAuth,
  requireRole(['Admin', 'Doctor', 'Receptionist']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(appointmentIdSchema, 'params'),
  validate(moveToTodaySchema, 'body'),
  requireAppointmentScope('appointmentId', 'params'),
  moveToTodayController
);

/** @route GET /api/v1/appointments/leave-move/preview?dates= — your visits still booked on leave days
 *  @access Doctor, or Admin with doctor access (own appointments only) */
appointmentsRouter.get(
  '/leave-move/preview',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  validate(leaveMovePreviewQuerySchema, 'query'),
  getLeaveMovePreviewController
);

/** @route POST /api/v1/appointments/leave-move — move those visits to one date, never blocked
 *  @access Doctor, or Admin with doctor access (own appointments only) */
appointmentsRouter.post(
  '/leave-move',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(leaveMoveSchema, 'body'),
  leaveMoveController
);

/** @route POST /api/v1/appointments/leave-cancel — cancel those visits instead; refund per clinic policy
 *  @access Doctor, or Admin with doctor access (own appointments only) */
appointmentsRouter.post(
  '/leave-cancel',
  requireAuth,
  requireRole(['Doctor']),
  requireClinic,
  enforceClinicAutoLogout,
  validate(leaveCancelSchema, 'body'),
  leaveCancelController
);

export default appointmentsRouter;

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments',
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
  path: '/api/v1/appointments/:appointmentId',
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
  path: '/api/v1/appointments/all/clicnic',
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
  path: '/api/v1/appointments/all/user',
  description: 'Get all patient appointments by user',
  query: appointmentQuerySchema,
  tags: ['appointments', 'user'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/:appointmentId',
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
  path: '/api/v1/appointments/patient/:patientId',
  description: 'get  patientId  appointment by id',
  params: patientIdSchema,
  tags: ['appointments', 'Petient'],
});
docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/doctor/:doctorId',
  description: 'get doctorId appointment by id',
  params: doctorIdSchema,
  tags: ['appointments', 'Petient'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/doctor/available/slot-date-clinic/:doctorId',
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

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/appointments/:appointmentId/shared-images',
  description:
    'Share a My Uploads image (galleryImageId) or a Suggested image ' +
    "(suggestedImageUrl) with this appointment's patient. 404 if the " +
    'appointment or image is not theirs, ' +
    '409 if already shared. Access: Doctor.',
  params: galleryShareAppointmentParamsSchema,
  requestSchema: createGalleryShareSchema,
  tags: ['appointments', 'GalleryShare'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/appointments/:appointmentId/shared-images',
  description:
    'Images the doctor has shared on this appointment, newest first. Access: Doctor.',
  params: galleryShareAppointmentParamsSchema,
  tags: ['appointments', 'GalleryShare'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/appointments/:appointmentId/shared-images/:shareId',
  description: 'Unshare an image; the patient stops seeing it. Access: Doctor.',
  params: galleryShareParamsSchema,
  tags: ['appointments', 'GalleryShare'],
});
