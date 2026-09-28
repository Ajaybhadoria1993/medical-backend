import { and, eq, gte, sql, desc } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  ApplicationCancellationPolicyModel,
  ClinicCancellationPolicyModel,
  CancellationRequestModel,
} from '../models/cancellationPolicy.model';
import { CANCELLATION_REASONS } from '../constants/reasons';
import {
  ICancellationEvaluationResult,
  IRefundEvaluationResult,
  ICancellationRequestPayload,
} from '../interfaces';
import { CancellationCacheService } from './cancellationCache.service';

function formatRemainingTime(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  if (roundedSeconds < 60) {
    return `${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(roundedSeconds / 60);
  if (minutes < 60) {
    const remainingSeconds = roundedSeconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `${minutes} minute${minutes === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
}

export class PolicyEvaluationService {
  /**
   * Evaluates if a cancellation is allowed based on application and clinic rules.
   * Throws HttpError if validation fails, or returns success object.
   */
  static async evaluateCancellation(
    appointmentId: string,
    userId: string,
    userRole: string,
    payload: ICancellationRequestPayload
  ): Promise<ICancellationEvaluationResult> {
    // 1. Fetch application settings (Governance)
    const appPolicy = await CancellationCacheService.getGlobalPolicy(
      async () => {
        const [result] = await database
          .select()
          .from(ApplicationCancellationPolicyModel)
          .limit(1);
        return result || null;
      }
    );

    if (!appPolicy) {
      throw new HttpError(
        500,
        'Application cancellation policy settings are not seeded. Please run the database seed command.',
        'POLICY_NOT_SEEDED'
      );
    }

    if (!appPolicy.cancellationFeatureEnabled) {
      throw new HttpError(
        400,
        'Cancellation feature is temporarily disabled by the platform',
        'CANCELLATION_DISABLED'
      );
    }

    // 2. Fetch appointment details
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(
        404,
        'Appointment not found',
        'APPOINTMENT_NOT_FOUND'
      );
    }

    // 3. Validate appointment status state rules
    const blockedStatuses = [
      'Completed',
      // 'Patient Arrived',
      'Cancelled',
      'NoShow',
      'Rescheduled',
      'Missed',
    ];
    if (blockedStatuses.includes(appointment.appointmentStatus)) {
      throw new HttpError(
        400,
        `Appointment in state '${appointment.appointmentStatus}' cannot be cancelled`,
        'INVALID_APPOINTMENT_STATE'
      );
    }

    // System role bypasses all clinic settings
    if (userRole === 'System' || userRole === 'Super_Admin') {
      return { allowed: true };
    }

    // 4. Fetch the clinic cancellation policy (either locked version or current active)
    let policy: typeof ClinicCancellationPolicyModel.$inferSelect | null = null;

    if (appointment.clinicCancellationPolicyId) {
      const policyId = appointment.clinicCancellationPolicyId;
      policy = await CancellationCacheService.getClinicPolicyVersion(
        policyId,
        async () => {
          const [result] = await database
            .select()
            .from(ClinicCancellationPolicyModel)
            .where(eq(ClinicCancellationPolicyModel.id, policyId))
            .limit(1);
          return result || null;
        }
      );
    } else {
      // Fallback/Legacy lookup of currently active policy
      policy = await CancellationCacheService.getClinicActivePolicy(
        appointment.clinicId,
        async () => {
          const [result] = await database
            .select()
            .from(ClinicCancellationPolicyModel)
            .where(
              and(
                eq(
                  ClinicCancellationPolicyModel.clinicId,
                  appointment.clinicId
                ),
                eq(ClinicCancellationPolicyModel.isActive, true)
              )
            )
            .limit(1);
          return result || null;
        }
      );
    }

    // If no policy is configured, allow cancellation by default
    if (!policy || !policy.isActive) {
      return { allowed: true };
    }

    // 5. Check Cancellation Rights (Roles Allowed)
    const normalizedRole = userRole.toLowerCase();
    if (normalizedRole === 'patient' && !policy.allowPatientCancel) {
      throw new HttpError(
        403,
        'Patients are not permitted to cancel appointments under clinic policy',
        'INSUFFICIENT_USER_RIGHTS'
      );
    }
    if (normalizedRole === 'doctor' && !policy.allowDoctorCancel) {
      throw new HttpError(
        403,
        'Doctors are not permitted to cancel appointments under clinic policy',
        'INSUFFICIENT_USER_RIGHTS'
      );
    }
    if (normalizedRole === 'receptionist' && !policy.allowReceptionistCancel) {
      throw new HttpError(
        403,
        'Receptionists are not permitted to cancel appointments under clinic policy',
        'INSUFFICIENT_USER_RIGHTS'
      );
    }
    if (normalizedRole === 'clinic_admin' && !policy.allowClinicAdminCancel) {
      throw new HttpError(
        403,
        'Clinic Admins are not permitted to cancel appointments under clinic policy',
        'INSUFFICIENT_USER_RIGHTS'
      );
    }

    // 6. Check Reason and Comment length
    const reason = CANCELLATION_REASONS.find(
      (r) => r.code === payload.reasonCode
    );
    if (policy.reasonMandatory) {
      if (!payload.reasonCode || !reason || !reason.isActive) {
        throw new HttpError(
          400,
          'A valid active cancellation reason code is required',
          'INVALID_REASON_CODE'
        );
      }
    }

    if (payload.comments) {
      if (!policy.allowAdditionalComments) {
        throw new HttpError(
          400,
          'Additional comments are not allowed by the clinic policy',
          'COMMENTS_NOT_ALLOWED'
        );
      }
      if (payload.comments.length < policy.minCommentLength) {
        throw new HttpError(
          400,
          `Comment must be at least ${policy.minCommentLength} characters long`,
          'COMMENT_LENGTH_VIOLATION'
        );
      }
      if (payload.comments.length > policy.maxCommentLength) {
        throw new HttpError(
          400,
          `Comment cannot exceed ${policy.maxCommentLength} characters`,
          'COMMENT_LENGTH_VIOLATION'
        );
      }
    }

    // Bypass windows, limits, and cooldowns for Clinic Admins or Doctors (Staff Roles)
    const isStaff =
      normalizedRole === 'clinic_admin' ||
      normalizedRole === 'doctor' ||
      normalizedRole === 'receptionist';
    if (isStaff) {
      return { allowed: true };
    }

    // 7. Check Cancellation Window (Patient only)
    const now = new Date();
    const apptDate = new Date(appointment.appointmentDate);
    const diffHours = (apptDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    const isOnline = appointment.appointmentType?.toLowerCase() === 'online';
    const requiredHours = isOnline
      ? policy.windowOnlineHours
      : policy.windowOfflineHours;

    if (diffHours < requiredHours) {
      throw new HttpError(
        400,
        `Cancellation window has passed. Minimum buffer required is ${requiredHours} hours.`,
        'CANCELLATION_WINDOW_VIOLATION'
      );
    }

    // 8. Check Cooldown Period (Patient only)
    const cooldownSeconds = policy.cooldownSecondsBetweenCancellations;
    if (cooldownSeconds > 0) {
      const [lastRequest] = await database
        .select()
        .from(CancellationRequestModel)
        .where(
          and(
            eq(CancellationRequestModel.userId, userId),
            eq(CancellationRequestModel.userRole, 'Patient')
          )
        )
        .orderBy(desc(CancellationRequestModel.createdAt))
        .limit(1);

      if (lastRequest) {
        const secondsSinceLast =
          (now.getTime() - new Date(lastRequest.createdAt).getTime()) / 1000;
        if (secondsSinceLast < cooldownSeconds) {
          const remainingSeconds = cooldownSeconds - secondsSinceLast;
          const formattedRemaining = formatRemainingTime(remainingSeconds);
          throw new HttpError(
            429,
            `Please wait before initiating another cancellation request. Next cancellation window will open after ${formattedRemaining}.`,
            'COOLDOWN_VIOLATION'
          );
        }
      }
    }

    // 9. Check Cancellation Limits (Patient only)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Count in last 24h
    const [dailyCountRes] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(CancellationRequestModel)
      .where(
        and(
          eq(CancellationRequestModel.userId, userId),
          eq(CancellationRequestModel.userRole, 'Patient'),
          gte(CancellationRequestModel.createdAt, oneDayAgo)
        )
      );
    if ((dailyCountRes?.count || 0) >= policy.dailyLimitPerPatient) {
      throw new HttpError(
        400,
        'Daily cancellation limit exceeded for patient',
        'DAILY_LIMIT_EXCEEDED'
      );
    }

    // Count in last 7 days
    const [weeklyCountRes] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(CancellationRequestModel)
      .where(
        and(
          eq(CancellationRequestModel.userId, userId),
          eq(CancellationRequestModel.userRole, 'Patient'),
          gte(CancellationRequestModel.createdAt, oneWeekAgo)
        )
      );
    if ((weeklyCountRes?.count || 0) >= policy.weeklyLimitPerPatient) {
      throw new HttpError(
        400,
        'Weekly cancellation limit exceeded for patient',
        'WEEKLY_LIMIT_EXCEEDED'
      );
    }

    // Count in last 30 days
    const [monthlyCountRes] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(CancellationRequestModel)
      .where(
        and(
          eq(CancellationRequestModel.userId, userId),
          eq(CancellationRequestModel.userRole, 'Patient'),
          gte(CancellationRequestModel.createdAt, oneMonthAgo)
        )
      );
    if ((monthlyCountRes?.count || 0) >= policy.monthlyLimitPerPatient) {
      throw new HttpError(
        400,
        'Monthly cancellation limit exceeded for patient',
        'MONTHLY_LIMIT_EXCEEDED'
      );
    }

    return { allowed: true };
  }

  /**
   * Calculates the refund eligibility and amount.
   */
  static async calculateRefund(
    appointmentId: string
  ): Promise<IRefundEvaluationResult> {
    // 1. Fetch payment details
    const [payment] = await database
      .select()
      .from(AppointmentPaymentModel)
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId))
      .limit(1);

    // If no payment was recorded, or payment was not successful/paid
    if (!payment || payment.paymentStatus !== 'Paid') {
      return { eligible: false, refundType: 'None', refundAmount: 0 };
    }

    // 2. Fetch app-level settings
    const appPolicy = await CancellationCacheService.getGlobalPolicy(
      async () => {
        const [result] = await database
          .select()
          .from(ApplicationCancellationPolicyModel)
          .limit(1);
        return result || null;
      }
    );

    if (!appPolicy) {
      throw new HttpError(
        500,
        'Application cancellation policy settings are not seeded. Please run the database seed command.',
        'POLICY_NOT_SEEDED'
      );
    }

    if (!appPolicy.refundFeatureEnabled) {
      return { eligible: false, refundType: 'None', refundAmount: 0 };
    }

    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      return { eligible: false, refundType: 'None', refundAmount: 0 };
    }

    // Compute hours until appointment
    const now = new Date();
    const apptDate = new Date(appointment.appointmentDate);
    const diffHours = (apptDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    const price = parseFloat(payment.price || '0');
    if (price <= 0) {
      return { eligible: false, refundType: 'None', refundAmount: 0 };
    }

    if (diffHours >= appPolicy.defaultRefundCooldownHours) {
      // Full Refund
      const amount = (price * appPolicy.defaultRefundPercentage) / 100;
      return { eligible: true, refundType: 'Full', refundAmount: amount };
    } else if (diffHours >= appPolicy.partialRefundCooldownHours) {
      // Partial Refund
      const amount = (price * appPolicy.partialRefundPercentage) / 100;
      return { eligible: true, refundType: 'Partial', refundAmount: amount };
    } else {
      // No Refund
      return { eligible: false, refundType: 'None', refundAmount: 0 };
    }
  }

  /**
   * Validates rescheduling rules.
   */
  static async evaluateReschedule(
    appointmentId: string,
    _patientId: string
  ): Promise<ICancellationEvaluationResult> {
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    let policy: typeof ClinicCancellationPolicyModel.$inferSelect | null = null;

    if (appointment.clinicCancellationPolicyId) {
      const policyId = appointment.clinicCancellationPolicyId;
      policy = await CancellationCacheService.getClinicPolicyVersion(
        policyId,
        async () => {
          const [result] = await database
            .select()
            .from(ClinicCancellationPolicyModel)
            .where(eq(ClinicCancellationPolicyModel.id, policyId))
            .limit(1);
          return result || null;
        }
      );
    } else {
      policy = await CancellationCacheService.getClinicActivePolicy(
        appointment.clinicId,
        async () => {
          const [result] = await database
            .select()
            .from(ClinicCancellationPolicyModel)
            .where(
              and(
                eq(
                  ClinicCancellationPolicyModel.clinicId,
                  appointment.clinicId
                ),
                eq(ClinicCancellationPolicyModel.isActive, true)
              )
            )
            .limit(1);
          return result || null;
        }
      );
    }

    if (!policy || !policy.isActive) {
      return { allowed: true };
    }

    if (!policy.allowReschedule) {
      throw new HttpError(
        400,
        'Rescheduling is not allowed for this clinic',
        'RESCHEDULE_NOT_ALLOWED'
      );
    }

    // Count reschedules
    const [rescheduleCountRes] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(CancellationRequestModel)
      .where(
        and(
          eq(CancellationRequestModel.appointmentId, appointmentId),
          eq(CancellationRequestModel.isRescheduleRequest, true)
        )
      );

    if ((rescheduleCountRes?.count || 0) >= policy.maxReschedules) {
      throw new HttpError(
        400,
        'Maximum rescheduling limit reached for this appointment',
        'RESCHEDULE_LIMIT_EXCEEDED'
      );
    }

    // Check reschedule window
    const now = new Date();
    const apptDate = new Date(appointment.appointmentDate);
    const diffHours = (apptDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diffHours < policy.rescheduleWindowHours) {
      throw new HttpError(
        400,
        `Rescheduling window has passed. Minimum buffer required is ${policy.rescheduleWindowHours} hours.`,
        'RESCHEDULE_WINDOW_VIOLATION'
      );
    }

    return { allowed: true };
  }
}
