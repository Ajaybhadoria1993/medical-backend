import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import {
  sendCreated,
  sendNoContent,
  sendOk,
} from '../../../utils/response.utils';
import { PatientService } from '../services/patient.service';
import { DelayTrackerService } from '../../appointment-engine/services';
import { verifyWebhookSignature } from '../../../utils/razorpay';
import { envConfig } from '../../../utils/envConfig';
import { ClinicService } from '../../clinic/services/clinic.service';

// ─────────────────────────────────────────────────────────────────────────────
// Self Profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/patient/my-profile
 * Fetch the authenticated patient's own profile.
 */
export const getMyProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getMyProfile(req.user.id);
    return sendOk(res, 'Profile fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/account
 * Returns the primary patient's own profile + all linked family members.
 * Single call used to populate the post-login member selection screen.
 */
export const getAccountController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getAccount(req.user.id);
    return sendOk(res, 'Account fetched successfully', result);
  }
);

export const completeProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.completeProfile(
      req.user.id,
      req.validatedBody
    );
    return sendOk(res, 'Profile updated successfully', result);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Family Members
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/patient/family
 * Add a family member (with or without their own mobile number).
 */
export const addFamilyMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.addFamilyMember(
      req.user.id,
      req.validatedBody
    );
    return sendCreated(res, 'Family member added successfully', result);
  }
);

/**
 * GET /api/v1/patient/family
 * List all family members linked to the authenticated patient (paginated).
 */
export const listFamilyMembersController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.listFamilyMembers(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Family members fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/family/:familyMemberId
 * Get a single family member's profile.
 */
export const getFamilyMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    const { familyMemberId } = req.validatedParams;
    const result = await PatientService.getFamilyMember(
      req.user.id,
      familyMemberId
    );
    return sendOk(res, 'Family member fetched successfully', result);
  }
);

/**
 * PATCH /api/v1/patient/family/:familyMemberId
 * Update a family member's profile (only when their status is 'New').
 */
export const updateFamilyMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    const { familyMemberId } = req.validatedParams;
    const result = await PatientService.updateFamilyMember(
      req.user.id,
      familyMemberId,
      req.validatedBody
    );
    return sendOk(res, 'Family member updated successfully', result);
  }
);

/**
 * DELETE /api/v1/patient/family/:familyMemberId
 * Remove the family link (does not delete the linked patient record).
 */
export const removeFamilyMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    const { familyMemberId } = req.validatedParams;
    await PatientService.removeFamilyMember(req.user.id, familyMemberId);
    return sendNoContent(res, 'Family member removed successfully');
  }
);

/**
 * PUT /api/v1/patient/update-profile-image
 * Update the authenticated patient's own profile image.
 */
export const updatePatientProfileImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const profileImage = req.file ? (req.file as any).location : undefined;

    if (!profileImage) {
      return res.status(400).json({
        success: false,
        message: 'No profile image file provided',
      });
    }

    const result = await PatientService.updateProfileImage(
      req.user.id,
      profileImage
    );

    return sendOk(res, 'Profile image updated successfully', result);
  }
);

/**
 * PUT /api/v1/patient/family/:familyMemberId/update-profile-image
 * Update a linked family member's profile image.
 */
export const updateFamilyMemberProfileImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { familyMemberId } = req.validatedParams;
    const profileImage = req.file ? (req.file as any).location : undefined;

    if (!profileImage) {
      return res.status(400).json({
        success: false,
        message: 'No profile image file provided',
      });
    }

    const result = await PatientService.updateFamilyMemberProfileImage(
      req.user.id,
      familyMemberId,
      profileImage
    );

    return sendOk(
      res,
      'Family member profile image updated successfully',
      result
    );
  }
);

/**
 * GET /api/v1/patient/directory/search
 * Search doctors in the directory with filters: search, speciality, and proximity (lat, lng, radius).
 */
export const searchDirectoryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.searchDirectory(req.validatedQuery);
    return sendOk(res, 'Directory search completed successfully', result);
  }
);

/**
 * GET /api/v1/patient/directory/doctors/:doctorId
 * Fetch a doctor's public profile, qualifications, and practicing clinics.
 */
export const getDoctorPublicProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const result = await PatientService.getDoctorPublicProfile(
      doctorId,
      req.user.id
    );
    return sendOk(res, 'Doctor public profile fetched successfully', result);
  }
);

/**
 * POST /api/v1/patient/directory/doctors/:doctorId/toggle-favorite
 * Toggle favorite status for a doctor by the authenticated patient.
 */
export const toggleDoctorFavoriteController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const result = await PatientService.toggleDoctorFavorite(
      req.user.id,
      doctorId
    );
    return sendOk(
      res,
      `Doctor ${result.isFavorite ? 'added to' : 'removed from'} favorites successfully`,
      result
    );
  }
);

/**
 * GET /api/v1/patient/directory/doctors/favorites
 * Fetch list of favorite doctors for the authenticated patient.
 */
export const listFavoriteDoctorsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.listFavoriteDoctors(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Favorite doctors list fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/directory/doctors/:doctorId/slots
 * Fetch availability slots for a doctor on a specific date at a clinic.
 */
export const getDoctorPublicSlotsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const { date, clinicId } = req.validatedQuery;
    const result = await PatientService.getDoctorPublicSlots(doctorId, {
      date,
      clinicId,
    });
    return sendOk(
      res,
      'Doctor availability slots fetched successfully',
      result
    );
  }
);

/**
 * GET /api/v1/patient/appointments/pricing-preview
 * Pre-booking endpoint: calculate and return platform fee, GST, and total payable amount.
 */
export const getPatientAppointmentPricingPreviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getAppointmentPricingPreview(
      req.validatedQuery
    );
    return sendOk(
      res,
      'Appointment pricing preview calculated successfully',
      result
    );
  }
);

/**
 * POST /api/v1/patient/appointments
 * Book an appointment for the patient self or family members.
 */
export const bookPatientAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.bookPatientAppointment(
      req.user.id,
      req.validatedBody
    );
    const message = result.requiresPayment
      ? 'Appointment booking initiated. Payment required.'
      : 'Appointment booked successfully';
    return sendCreated(res, message, result);
  }
);

/**
 * POST /api/v1/patient/appointments/:appointmentId/cancel
 * Cancel a patient's own appointment, enforcing platform & clinic policies.
 */
export const cancelPatientAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const userId = req.user.id as string;
    const userRole = req.user.userType as string;
    const payload = req.validatedBody || req.body;

    const { CancellationPolicyService } =
      await import('../../cancellation-policy/services/cancellationPolicy.service');
    const result = await CancellationPolicyService.processCancellationRequest(
      appointmentId,
      userId,
      userRole,
      payload
    );

    return sendOk(res, result.message, result);
  }
);

/**
 * PUT /api/v1/patient/appointments/:appointmentId
 * Reschedule patient's own appointment following platform & clinic policy checks.
 */
export const reschedulePatientAppointmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const userId = req.user.id as string;
    const payload = req.validatedBody || req.body;

    const result = await PatientService.rescheduleAppointment(
      userId,
      appointmentId,
      payload
    );

    return sendOk(res, 'Appointment rescheduled successfully', result);
  }
);

/**
 * GET /api/v1/patient/appointments/cancellation-policy
 * Get cancellation policy for booking (application-level and clinic-level).
 */
export const getBookingCancellationPolicyController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId, doctorId } = req.validatedQuery;

    const { CancellationPolicyService } =
      await import('../../cancellation-policy/services/cancellationPolicy.service');

    const policy =
      await CancellationPolicyService.getCancellationPolicyForBooking(
        clinicId as string | undefined,
        doctorId as string | undefined
      );

    return sendOk(res, 'Cancellation policy retrieved successfully', policy);
  }
);

/**
 * GET /api/v1/patient/appointments
 * List all past & upcoming appointments for the authenticated patient and family members.
 */
export const listAllPatientAppointmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.listPatientAppointments(
      req.user.id,
      null,
      req.validatedQuery
    );
    return sendOk(res, 'Patient appointments fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/appointments/:patientId
 * List all past & upcoming appointments for a specific family member or self.
 */
export const listPatientAppointmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { patientId } = req.validatedParams;
    const result = await PatientService.listPatientAppointments(
      req.user.id,
      patientId,
      req.validatedQuery
    );
    return sendOk(res, 'Patient appointments fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/appointments/detail/:appointmentId
 * Fetch full details of a specific appointment belonging to the patient or family members.
 * Also returns live queue data for today's appointments.
 */
export const getPatientAppointmentDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.validatedParams;
    const result = await PatientService.getPatientAppointmentDetail(
      req.user.id,
      appointmentId
    );

    // Default queue info
    let estimatedWaitMinutes = 0;
    let nowServingToken: number | null = null;
    let patientsAhead = 0;
    let avgConsultationMinutes: number | null = null;
    let queuePosition:
      'waiting' | 'in-queue' | 'almost-there' | 'consultation' | null = null;
    let totalPatientsInQueue = 0;

    if (result && result.appointment) {
      const appointmentDate = result.appointment.appointmentDate;

      // Check if appointment is today
      const today = new Date();
      const apptDate = new Date(appointmentDate);
      const isToday =
        apptDate.getFullYear() === today.getFullYear() &&
        apptDate.getMonth() === today.getMonth() &&
        apptDate.getDate() === today.getDate();

      if (isToday) {
        const delayTrackerService = new DelayTrackerService();
        const dateStr = today.toISOString().split('T')[0];
        const doctorId = result.appointment.doctorId ?? result.doctor?.id;

        if (doctorId) {
          // Get full queue data — getEstimatedWaitTime looks up clinicId internally
          // But for the full queue we need clinicId, so use the same DB lookup
          const waitTime =
            await delayTrackerService.getEstimatedWaitTime(appointmentId);
          estimatedWaitMinutes = Math.max(0, Math.floor(waitTime));

          // Now get the full queue data for the extra fields
          // We need clinicId — get it from the delay tracker's internal lookup
          const { database: db } =
            await import('../../../configurations/dbConnection');
          const { eq: eqOp } = await import('drizzle-orm');
          const { AppointmentModel: ApptModel } =
            await import('../../appointments/models/appointment.model');

          const [apptRecord] = await db
            .select({ clinicId: ApptModel.clinicId })
            .from(ApptModel)
            .where(eqOp(ApptModel.id, appointmentId))
            .limit(1);

          if (apptRecord?.clinicId) {
            const clinicId = apptRecord.clinicId;

            let queueData = await delayTrackerService.getQueueDelayData(
              clinicId,
              doctorId,
              dateStr
            );

            if (!queueData) {
              queueData = await delayTrackerService.recalculate(
                clinicId,
                doctorId,
                dateStr
              );
            }

            if (queueData && queueData.appointments.length > 0) {
              const appointments = queueData.appointments;

              // Find the currently serving appointment (Confirmed or Patient Arrived)
              const currentlyServing = appointments.find(
                (a) =>
                  a.status === 'Confirmed' || a.status === 'Patient Arrived'
              );

              nowServingToken = currentlyServing?.tokenNo ?? null;

              // Find this patient's appointment in the queue
              const myEntry = appointments.find(
                (a) => a.appointmentId === appointmentId
              );

              if (myEntry) {
                estimatedWaitMinutes = Math.max(
                  0,
                  Math.floor(myEntry.estimatedWaitMinutes)
                );

                // Patients ahead = non-terminal appointments before this one
                const myIndex = appointments.indexOf(myEntry);
                patientsAhead = appointments
                  .slice(0, myIndex)
                  .filter(
                    (a) =>
                      a.status !== 'Completed' &&
                      a.status !== 'Cancelled' &&
                      a.status !== 'NoShow'
                  ).length;

                // Total patients in queue (non-terminal)
                totalPatientsInQueue = appointments.filter(
                  (a) =>
                    a.status !== 'Completed' &&
                    a.status !== 'Cancelled' &&
                    a.status !== 'NoShow'
                ).length;

                // Average consultation duration
                const durations = appointments
                  .filter((a) => a.durationMinutes > 0)
                  .map((a) => a.durationMinutes);
                avgConsultationMinutes =
                  durations.length > 0
                    ? Math.round(
                        durations.reduce((sum, d) => sum + d, 0) /
                          durations.length
                      )
                    : null;

                // Queue position stage
                if (
                  myEntry.status === 'Confirmed' ||
                  myEntry.status === 'Patient Arrived'
                ) {
                  queuePosition = 'consultation';
                } else if (patientsAhead <= 2) {
                  queuePosition = 'almost-there';
                } else if (patientsAhead <= 5) {
                  queuePosition = 'in-queue';
                } else {
                  queuePosition = 'waiting';
                }
              }
            }
          }
        }
      }
    }

    let isCancellable = false;
    let cancellationMessage: string | null = null;
    let isReschedulable = false;
    let rescheduleMessage: string | null = null;

    if (result && result.appointment) {
      try {
        const { PolicyEvaluationService } =
          await import('../../cancellation-policy/services/policyEvaluation.service');

        // Evaluate Cancellation
        try {
          await PolicyEvaluationService.evaluateCancellation(
            result.appointment.id,
            req.user.id,
            'Patient',
            { reasonCode: 'patient_requested' }
          );
          isCancellable = true;
        } catch (err: any) {
          isCancellable = false;
          cancellationMessage =
            err.message || 'Cancellation is not allowed under current policy.';
        }

        // Evaluate Reschedule
        try {
          const blockedRescheduleStatuses = [
            'Completed',
            'Cancelled',
            'NoShow',
          ];
          if (
            blockedRescheduleStatuses.includes(
              result.appointment.appointmentStatus
            )
          ) {
            throw new Error(
              `Appointment in state '${result.appointment.appointmentStatus}' cannot be rescheduled`
            );
          }
          await PolicyEvaluationService.evaluateReschedule(
            result.appointment.id,
            req.user.id
          );
          isReschedulable = true;
        } catch (err: any) {
          isReschedulable = false;
          rescheduleMessage =
            err.message || 'Rescheduling is not allowed under current policy.';
        }
      } catch {
        // Fallback if import or anything fails
      }
    }

    return sendOk(res, 'Appointment details fetched successfully', {
      ...result,
      estimatedWaitMinutes,
      liveQueueStatus: {
        nowServingToken,
        patientsAhead,
        avgConsultationMinutes,
        queuePosition,
        totalPatientsInQueue,
      },
      policyStatus: {
        isCancellable,
        cancellationMessage,
        isReschedulable,
        rescheduleMessage,
      },
    });
  }
);

/**
 * GET /api/v1/patient/appointments/:appointmentId/invoice-data
 * Fetch detailed invoice/billing metadata for a paid appointment.
 */
export const getPatientAppointmentInvoiceDataController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.validatedParams;

    // 1️⃣ Fetch core appointment details to check existence and patient ID
    const { database: db } =
      await import('../../../configurations/dbConnection');
    const { default: redisClient } =
      await import('../../../configurations/redisConfig');
    const { eq, and } = await import('drizzle-orm');
    const { AppointmentModel } =
      await import('../../appointments/models/appointment.model');
    const { PatientFamilyLinksModel } =
      await import('../models/patientFamilyLinks.model');

    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    const resolvedId = mappedApptId || appointmentId;

    const [appointment] = await db
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, resolvedId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found.');
    }

    // 2️⃣ Check ownership (self or linked family member)
    if (appointment.patientId !== req.user.id) {
      const [link] = await db
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, req.user.id),
            eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(
          403,
          'Access denied. You can only view billing details of your own or linked family member appointments.'
        );
      }
    }

    // 3️⃣ Call PatientService to fetch the structured invoice data
    const invoiceData =
      await PatientService.getPatientAppointmentInvoiceData(appointmentId);

    return sendOk(res, 'Invoice data fetched successfully', invoiceData);
  }
);

/**
 * GET /api/v1/patient/associated-doctors
 * Fetch all unique doctors associated with patient & family member appointments.
 */
export const getAssociatedDoctorsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getAssociatedDoctors(req.user.id);
    return sendOk(res, 'Associated doctors fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/appointments/live-queue/:appointmentId
 * Lightweight endpoint for Live Queue Tracking screen.
 * Only available for today's active appointments.
 */
export const getPatientLiveQueueController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.validatedParams;
    const userId = req.user.id;

    const { computeLiveQueuePayload, loadLiveQueueAppointment } =
      await import('../../appointment-engine/services/liveQueueHelper');

    // Same access rule as the socket's join.live-queue; throws the HttpError.
    const appointment = await loadLiveQueueAppointment(appointmentId, userId);

    const payload = await computeLiveQueuePayload(
      appointment.id,
      appointment.clinicId,
      appointment.doctorId
    );

    // Current "Notify me when" preferences so the app can render toggle state.
    const { getPrefs } =
      await import('../../appointment-engine/services/queueNotifyPrefs.service');
    const notifyPrefs = await getPrefs(appointment.id);

    // appointmentTime stays the booked value the app shows; the engine's slot is tentativeStartTime.
    return sendOk(res, 'Live queue status fetched successfully', {
      ...payload,
      appointmentTime: appointment.appointmentTime,
      tokenNo: appointment.tokenNo,
      notifyPrefs,
    });
  }
);

/**
 * POST /api/v1/patient/appointments/live-queue/:appointmentId/notify-prefs
 * Saves the patient's "Notify me when" push preferences for a live-queue
 * appointment (My turn / N patients before / Doctor arrives). Stored in Redis
 * (no DB), read by the appointment engine's broadcast path.
 */
export const upsertLiveQueueNotifyPrefsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId } = req.validatedParams;
    const prefs = req.validatedBody;
    const userId = req.user.id;

    const { database: db } =
      await import('../../../configurations/dbConnection');
    const { default: redisClient } =
      await import('../../../configurations/redisConfig');
    const { eq: eqOp, and: andOp } = await import('drizzle-orm');
    const { AppointmentModel: ApptModel } =
      await import('../../appointments/models/appointment.model');
    const { PatientFamilyLinksModel } =
      await import('../models/patientFamilyLinks.model');

    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    const resolvedId = mappedApptId || appointmentId;

    const [appointment] = await db
      .select({
        id: ApptModel.id,
        patientId: ApptModel.patientId,
        appointmentStatus: ApptModel.appointmentStatus,
      })
      .from(ApptModel)
      .where(eqOp(ApptModel.id, resolvedId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    // Ownership check (self or a linked family member) — same rule as the
    // live-queue GET endpoint.
    if (appointment.patientId !== userId) {
      const [link] = await db
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          andOp(
            eqOp(PatientFamilyLinksModel.primaryPatientId, userId),
            eqOp(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(403, 'Access denied');
      }
    }

    const terminalStatuses = ['Completed', 'Cancelled', 'NoShow'];
    if (terminalStatuses.includes(appointment.appointmentStatus)) {
      throw new HttpError(400, 'Appointment is no longer in queue');
    }

    const { setPrefs } =
      await import('../../appointment-engine/services/queueNotifyPrefs.service');
    // Keyed by the real id: the engine's broadcast reads prefs by it.
    await setPrefs(resolvedId, prefs);

    return sendOk(res, 'Notification preferences saved', prefs);
  }
);

/**
 * GET /api/v1/patient/lab-reports
 * Fetch all lab reports with parameter data and PDF/image download URLs.
 */
export const getPatientLabReportsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getPatientLabReports(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Lab reports fetched successfully', result);
  }
);

/**
 * POST /api/v1/patient/lab-reports/:appointmentTestId/report-upload
 * Upload a report for an existing lab test order from patient side.
 */
export const uploadPatientLabReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentTestId } = req.validatedParams;
    const reportFileUrl = (req.file as { location?: string } | undefined)
      ?.location;
    const result = await PatientService.uploadPatientLabReport(
      req.user.id,
      appointmentTestId,
      reportFileUrl
    );
    return sendOk(res, 'Lab report uploaded successfully', result);
  }
);

/**
 * GET /api/v1/patient/prescriptions
 * Fetch all prescriptions with detailed medicine data and PDF/image download URLs.
 */
export const getPatientPrescriptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getPatientPrescriptions(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Prescriptions fetched successfully', result);
  }
);

/**
 * GET /api/v1/patient/associated-documents
 * Fetch all associated documents (gallery images, manual prescriptions, consent files, etc.) for patient & family members.
 */
export const getPatientAssociatedDocumentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.getPatientAssociatedDocuments(
      req.user.id,
      req.validatedQuery
    );
    return sendOk(res, 'Associated documents fetched successfully', result);
  }
);

/**
 * POST /api/v1/patient/appointments/verify-payment
 * Verify Razorpay payment signature and confirm appointment.
 */
export const verifyAppointmentPaymentController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PatientService.verifyAppointmentPayment(
      req.user.id,
      req.validatedBody
    );
    return sendOk(res, 'Payment verified successfully', result);
  }
);

/**
 * POST /api/v1/patient/appointments/webhook
 * Razorpay webhook handler for capturing patient appointment payments or failures.
 */
export const razorpayAppointmentWebhookController = async (
  req: Request,
  res: Response
) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const stashRawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const rawBody = stashRawBody
    ? stashRawBody.toString('utf8')
    : req.body instanceof Buffer
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);

  if (
    !verifyWebhookSignature(
      rawBody,
      signature,
      envConfig.RAZORPAY_WEBHOOK_APP_SECRET
    )
  ) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let eventData;
  try {
    eventData = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { event, payload } = eventData;

  try {
    if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      const notes = payment.notes || {};
      const appointmentId = notes.appointmentId;
      const patientId = notes.patientId;

      if (appointmentId && patientId) {
        await PatientService.confirmPaymentAndAppoint(
          appointmentId,
          payment.id,
          patientId
        );
      }
    } else if (event === 'payment.failed') {
      const payment = payload.payment.entity;
      const notes = payment.notes || {};
      const appointmentId = notes.appointmentId;
      const patientId = notes.patientId;

      if (appointmentId && patientId) {
        await PatientService.handlePaymentFailure(
          appointmentId,
          payment.id,
          patientId
        );
      }
    } else if (
      event === 'account.activated' ||
      event === 'account.updated' ||
      event === 'product.activated'
    ) {
      await ClinicService.handleRazorpayAccountWebhook(event, payload);
    }

    return res.json({ received: true });
  } catch (error: any) {
    return res
      .status(500)
      .json({ error: error.message || 'Internal server error' });
  }
};
