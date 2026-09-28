/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  // not,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { TokenCapacityService } from '../../appointment-engine/services/tokenCapacity.service';
import {
  ScheduleShiftService,
  toHHMM,
} from '../../appointment-engine/services/scheduleShift.service';
import path from 'path';
import z from 'zod';
import { database } from '../../../configurations/dbConnection';
import { deleteFromS3 } from '../../../configurations/s3';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { envConfig, notificationsEnabled } from '../../../utils/envConfig';
// Rule 9: outside main/notifications, notify() is the only import.
import { notify } from '../../notifications/queues/notification.queue';
import { CacheKeys, invalidateCacheByPattern } from '../../../utils/cache.util';
import logger from '../../../utils/logger';
import {
  getUserById,
  notifyAppointmentCanceled,
  notifyAppointmentConfirmed,
  notifyAppointmentCreated,
  notifyAppointmentRescheduled,
} from '../../../utils/notificationHelpers';
import { sendNotificationToUser } from '../../../utils/notification.utils';
import { broadcastAppointmentChange } from '../../../utils/appointmentRealtime';
import { pagination } from '../../../utils/utils';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { doctorScopeFilter } from '../../permissions/utils/staffScope.utils';
import { ClinicCancellationPolicyModel } from '../../cancellation-policy/models/cancellationPolicy.model';
import { ClinicSymptomCountModel } from '../../clinic/models/clinic-symptom-count.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import {
  ClinicAppointmentPlainModel,
  ClinicAssignModel,
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
  ClinicModel,
  ClinicServiceModel,
} from '../../clinic/models/clinic.model';
import { DoctorQualificationModel } from '../../doctor/models/doctor.model';
import { AppointmentNotificationService } from '../../notifications/services/appointmentNotification.service';
import { whatsAppReminderQueue } from '../../notifications/services/appointmentWhatsappReminder.service';
import {
  ReportCardModel,
  PrescriptionModel,
} from '../../reports/models/reports.model';
import { UserModel } from '../../users/models/user.model';
import {
  APPOINTMENT_TYPE_CONSULTATION,
  APPOINTMENT_TYPE_CUSTOM,
  isOverrideAppointmentType,
} from '../utils/appointmentType.constants';
import { UserDevicesModel } from '../../users/models/userDevices.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { AppointmentClinicalModel } from '../models/appointmentClinical.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import {
  PaymentMode,
  normalizePaymentMode,
  isPayLaterMode,
} from '../utils/paymentMode.constants';
import { AppointmentModel } from '../models/appointment.model';
import { VisitingRequestModel } from '../models/visitingRequest.model';
import { DoctorReviewsModel } from '../../doctor/models/doctorReview.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';
import { isAppointmentInClinic } from '../../../utils/clinicOwnership';
import {
  appointmentInstantIST,
  getISTDateString,
} from '../../../utils/istDateTime';
import { signalAppointmentChange } from '../../realtime';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { resolveByCollapseKey } from '../../notifications/services/notifications.service';
import {
  endConsultationIfOccupant,
  getCurrentAppointmentId,
  holdAppointment,
  resumeAppointment,
  setConsultationEndedAt,
  setConsultationStartedAt,
  setCurrentAppointment,
} from '../../appointment-engine/services/queueHoldStore.service';
import { doctorGallery } from '../models/doctorGallery.model';
import { doctorManualPrescriptionModel } from '../models/doctorManualPrescription.model';
import { PrescriptionQueueService } from '../../pharmacy/services/prescriptionQueue.service';
import { medicalCertificateModel } from '../models/medicalCertificate.model';
import { patientGallery } from '../models/patientGallery.model';
import { PaymentReservationService } from './paymentReservation.service';
import {
  appointmentQueryDto,
  ClinicAppointmentDetailsQueryDto,
  createAppointmentDto,
  createCustomAppointmentDto,
  CreatePatientGalleryDto,
  GetAppointmentPaymentsDto,
  getAvailableSlotsForDateDto,
  getAvailableSlotsForParamsDto,
  UpdateAppointmentDto,
  updateAppointmentSchema,
} from '../schemas/appointment.schemas';
import { AppointmentActivityHistoryModel } from '../models/appointmentActivityHistory.model';
import { AppointmentActivityHistoryService } from './appointmentActivityHistory.service';
import { AppointmentRegistrationService } from './appointmentRegistration.service';
import { autoNoShowQueue } from './autoNoShow.service';
import { AppointmentEngineOrchestrator } from '../../appointment-engine/services/orchestrator.service';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import {
  AppointmentRecord,
  AppointmentStatus,
} from '../../appointment-engine/types/engine.types';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

export const buildActiveAppointmentFilter =
  PaymentReservationService.buildActiveAppointmentFilter;
export const filterExpiredPendingAppointments =
  PaymentReservationService.filterExpiredPendingAppointments;

type Slot = {
  start: string; // ISO-like: YYYY-MM-DDTHH:mm:00
  end: string;
  clinicAvailabilityId: string;
  source: 'availability' | 'break' | 'appointment';
  status?: 'available' | 'break' | 'Confirmed' | 'booked' | 'reserved';
  breakId?: string;
  breakType?: string;
  appointmentId?: string;
  appointmentStatus?: string;
  patientId?: string;
  // Token-mode response (when ClinicAvailability.noOfPatients is set)
  totalTokens?: number;
  availableTokens?: number;

  sessionIndex?: number;
  /** This shift's window, IST 'HH:mm', for labelling the choice. */
  sessionStart?: string;
  sessionEnd?: string;
  /** How many shifts the day has; 1 means there is nothing to choose. */
  totalSessions?: number;
  tokens?: Array<{
    tokenNo: number;
    status: 'available' | 'booked' | 'reserved';
    appointmentId?: string;
    appointmentStatus?: string;
    patientId?: string;
    /** Custom / Emergency / Follow-up when an override booked or added it. */
    appointmentType?: string;
    /** Added beyond the session's configured capacity. */
    isExtra?: boolean;
    /** Free again after a cancellation/no-show — the number is already issued. */
    isReopened?: boolean;
  }>;
};

/**
 * Parse time strings into minutes since midnight.
 * Accepts: "09:00", "9:00", "09:00 AM", "9:00AM", "5:30 PM", "17:30"
 */
export function parseTimeToMinutes(time?: string | null): number | null {
  if (!time) return null;
  const t = time.trim();

  // 12-hour with AM/PM or 24-hour with colon
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  // plain numeric string — last 3 digits (optional) OR single hour like "9"
  const plainNumMatch = t.match(/^(\d{1,2})$/);
  if (plainNumMatch) {
    const hour = Number(plainNumMatch[1]);
    return hour * 60;
  }

  // try parse with Date (fallback) — extracts hour/minute from current date
  const parsed = new Date(`1970-01-01T${t}`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
  }

  return null;
}

function getDayNameFromDate(d: Date): string {
  // returns English weekday name matching your stored values (e.g., "Monday")
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

interface PaymentTransaction {
  patientName: string;
  patientMobile: string;
  doctorName: string;
  doctorSpeciality: string;
  serviceName: string;
  appointmentDate: Date;
  transactionTimestamp: Date;
  price: number;
  entryType: 'Credit' | 'Debit';
  // Normalized per-row status so the UI can distinguish actually-collected
  // money ('Paid') from uncollected dues ('Pending'/Pay Later) and refunds.
  paymentStatus: 'Paid' | 'Pending' | 'Already Paid' | 'Refunded';
  paymentMode?: string;
  refundMode?: string;
  refundNotes?: string;
  transactionId: string;
  originalAppointmentId: string;
  gatewayTransactionId?: string;
}

type ClinicAppointmentDetailsMetricKey =
  | 'totalAppointments'
  | 'completed'
  | 'upcoming'
  | 'cancelled'
  | 'noShow'
  | 'confirmed'
  | 'patientArrived';

type ClinicAppointmentDetailsCounts = Record<
  ClinicAppointmentDetailsMetricKey,
  number
>;

function formatDateOnlyLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOnlyLocal(dateLike?: string) {
  if (!dateLike) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const raw = String(dateLike).trim();
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new HttpError(400, 'Invalid date');
    }

    return parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'Invalid date');
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getSingleDayRange(dateLike?: string) {
  const start = parseDateOnlyLocal(dateLike);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function buildMetricComparison(current: number, previous: number) {
  const changeCount = current - previous;
  const percentageChange =
    previous === 0
      ? current === 0
        ? 0
        : 100
      : Number(((changeCount / previous) * 100).toFixed(2));
  const percentageLabel = `${percentageChange > 0 ? '+' : ''}${percentageChange}%`;
  const trend =
    changeCount > 0 ? 'increase' : changeCount < 0 ? 'decrease' : 'no_change';

  return {
    count: current,
    previousCount: previous,
    changeCount,
    percentageChange,
    percentageLabel,
    trend,
  };
}

function convertTo24Hour(time12h: string) {
  const [time, modifier] = time12h.split(' ');
  const [hours, minutes] = time.split(':');

  let hour = parseInt(hours, 10);

  if (modifier === 'PM' && hour !== 12) {
    hour += 12;
  }

  if (modifier === 'AM' && hour === 12) {
    hour = 0;
  }

  return `${hour.toString().padStart(2, '0')}:${minutes}`;
}

function hashStringToInt32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// Appointment Service
export class AppointmentService {
  /**
   * Verify `appointmentId` belongs to `clinicId` before any consent-file or
   * medical-certificate access — otherwise the route param is trusted as-is
   * and any authenticated user could read another clinic's data. Redis-cached.
   */
  private static async assertAppointmentInClinic(
    appointmentId: string,
    clinicId: string
  ) {
    const belongsToClinic = await isAppointmentInClinic(
      appointmentId,
      clinicId
    );
    if (!belongsToClinic) {
      throw new HttpError(
        403,
        'Access denied. Appointment does not belong to this clinic.'
      );
    }
  }
  /**
   * Blocks a duplicate booking for a patient+doctor+service that already has
   * an active appointment. Lifts once that slot has passed: time-based at its
   * appointmentTime, token-based at end of day.
   */
  private static async checkDuplicateServiceBooking(
    tx: any,
    params: {
      clinicId: string;
      doctorId: string;
      patientId: string;
      clinicServiceId: string;
      excludeAppointmentId?: string;
    }
  ) {
    const activeStatuses = [
      'Upcoming',
      'Confirmed',
      'Patient Arrived',
      'Pending',
      'Rescheduled',
    ] as const;

    const conditions = [
      eq(AppointmentModel.clinicId, params.clinicId),
      eq(AppointmentModel.doctorId, params.doctorId),
      eq(AppointmentModel.patientId, params.patientId),
      eq(AppointmentModel.clinicServiceId, params.clinicServiceId),
      inArray(AppointmentModel.appointmentStatus, activeStatuses),
    ];
    if (params.excludeAppointmentId) {
      conditions.push(ne(AppointmentModel.id, params.excludeAppointmentId));
    }

    const rows = await tx
      .select({
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentStatus: AppointmentModel.appointmentStatus,
      })
      .from(AppointmentModel)
      .where(and(...conditions));

    const now = new Date();

    for (const row of rows as any[]) {
      const isTokenBased = row.tokenNo !== null && row.tokenNo !== undefined;
      const restrictUntil = new Date(row.appointmentDate);

      if (isTokenBased) {
        restrictUntil.setHours(23, 59, 59, 999);
      } else {
        const mins = parseTimeToMinutes(row.appointmentTime);
        if (mins !== null) {
          restrictUntil.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        } else {
          restrictUntil.setHours(23, 59, 59, 999);
        }
      }

      if (now.getTime() < restrictUntil.getTime()) {
        throw new HttpError(
          409,
          `Patient already has a ${row.appointmentStatus} appointment with this doctor for this service on ${formatDateOnlyLocal(new Date(row.appointmentDate))}. Booking for this doctor and service is restricted until ${restrictUntil.toLocaleString()}.`
        );
      }
    }
  }

  static async validateAppointmentBooking(
    userId: string,
    clinicId: string,
    payload: createAppointmentDto,
    performerUserId?: string,
    tx: any = database
  ) {
    // Shape is validated at the route (createAppointmentSchemas /
    // createCustomAppointmentSchema / patientBookingSchema). patientId is
    // optional there, so only that pair is re-checked here.
    if (!payload.doctorId || !payload.patientId) {
      throw new HttpError(400, 'DoctorId and PatientId required');
    }

    const queryUserIds = [payload.doctorId, payload.patientId];
    if (performerUserId) {
      queryUserIds.push(performerUserId);
    }

    const users = await tx
      .select({
        id: UserModel.id,
        status: UserModel.userStatus,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(inArray(UserModel.id, queryUserIds));

    const doctor = users.find((u: any) => u.id === payload.doctorId);
    const patient = users.find((u: any) => u.id === payload.patientId);
    const bookingPerformer = performerUserId
      ? users.find((u: any) => u.id === performerUserId)
      : null;

    // Deduce booking source based on who created the appointment
    let deducedBookingSource:
      'mobile_app' | 'web_portal' | 'phone_call' | 'walk_in' | 'system' =
      'walk_in';
    if (payload.bookingSource) {
      deducedBookingSource = payload.bookingSource as any;
    } else if (bookingPerformer) {
      const userType = bookingPerformer.userType;
      if (userType === 'Patient') {
        deducedBookingSource = 'mobile_app';
      } else if (
        ['Receptionist', 'Admin', 'Super_Admin', 'Doctor'].includes(userType)
      ) {
        deducedBookingSource = 'walk_in';
      } else {
        deducedBookingSource = 'system';
      }
    } else {
      deducedBookingSource = 'system';
    }

    // Validate both users exist and are in a valid state
    const validateUser = (
      user: (typeof users)[0] | undefined,
      role: string
    ) => {
      if (!user) throw new HttpError(404, `${role} not found`);
      if (user.status === 'Inactive')
        throw new HttpError(400, `${role} account is inactive`);
      if (user.status === 'Blocked')
        throw new HttpError(403, `${role} account is blocked`);
    };

    validateUser(doctor, 'Doctor');
    validateUser(patient, 'Patient');

    const isCancelled = (payload as any).appointmentStatus === 'Cancelled';
    if (isCancelled) {
      const apptDateObj = new Date(payload.appointmentDate);
      return {
        finalTokenNo: payload.tokenNo ?? null,
        finalAppointmentTime: payload.appointmentTime ?? null,
        apptDateObj,
        coreRest: {
          patientId: payload.patientId ?? userId,
          doctorId: payload.doctorId,
          clinicServiceId: payload.clinicServiceId,
          appointmentNotes:
            (payload as any).notes || payload.appointmentNotes || null,
          appointmentDurationMinutes:
            payload.appointmentDurationMinutes ?? '30',
        },
        rest: {
          paymentMode: payload.paymentMode,
          paymentStatus: payload.paymentStatus,
          price: payload.price,
          paymentNotes: payload.paymentNotes,
        },
        derivedPaymentStatus: payload.paymentStatus ?? null,
        activePolicy: null,
        deducedBookingSource: 'system',
        duration: Number(payload.appointmentDurationMinutes) || 30,
      };
    }

    const {
      patientId,
      appointmentDate,
      appointmentTime,
      tokenNo,
      commonSymptoms: _commonSymptoms,
      clinicSymptomIds: _clinicSymptomIds,
      bookingSource: _bookingSource,
      ...rest
    } = payload;

    const now = new Date();
    const apptDateObj = new Date(appointmentDate);

    if (Number.isNaN(apptDateObj.getTime())) {
      throw new HttpError(400, 'Invalid appointmentDate');
    }

    const dateOnlyStr = apptDateObj.toISOString().split('T')[0];
    const todayAtMidnight = new Date(now);
    todayAtMidnight.setHours(0, 0, 0, 0);

    // Compare dates (not times)
    if (apptDateObj.getTime() < todayAtMidnight.getTime()) {
      throw new HttpError(400, 'Appointment date cannot be in the past');
    }

    const dayName = getDayNameFromDate(apptDateObj);

    // Date-only bounds; every day-scoped read below shares them.
    const dateOnly = new Date(apptDateObj);
    dateOnly.setHours(0, 0, 0, 0);
    const nextDay = new Date(dateOnly);
    nextDay.setDate(nextDay.getDate() + 1);

    // None of these five reads feeds another, so they go out together instead
    // of as five sequential round trips. The checks below still run in order.
    // Not cached on purpose: the appointments read and the Redis holds ARE the
    // double-booking guard, and the config reads share the batch's wall clock.
    const [
      [availability],
      service,
      dayAppointments,
      redisLocks,
      [activePolicy],
    ] = await Promise.all([
      tx
        .select()
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.clinicId, clinicId),
            eq(ClinicAvailability.doctorId, payload.doctorId),
            sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
          )
        ),
      payload.clinicServiceId
        ? tx
            .select()
            .from(ClinicServiceModel)
            .where(eq(ClinicServiceModel.id, payload.clinicServiceId))
            .then((rows: any[]) => rows[0] ?? null)
        : Promise.resolve(null),
      // The day's live appointments, read once and reused by the token scan,
      // the slot overlap guard and the same-patient duplicate check.
      tx
        .select({
          id: AppointmentModel.id,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
          appointmentStatus: AppointmentModel.appointmentStatus,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          doctorId: AppointmentModel.doctorId,
          patientId: AppointmentModel.patientId,
          appointmentDate: AppointmentModel.appointmentDate,
          tokenNo: AppointmentModel.tokenNo,
          sessionIndex: AppointmentModel.sessionIndex,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, payload.doctorId),
            gte(AppointmentModel.appointmentDate, dateOnly),
            lt(AppointmentModel.appointmentDate, nextDay),
            inArray(AppointmentModel.appointmentStatus, [
              'Upcoming',
              'Confirmed',
              'Patient Arrived',
              'Pending',
              'Rescheduled',
              'Completed',
            ])
          )
        ),
      PaymentReservationService.getActiveLocksForDate(
        payload.doctorId,
        dateOnlyStr
      ),
      tx
        .select({ id: ClinicCancellationPolicyModel.id })
        .from(ClinicCancellationPolicyModel)
        .where(
          and(
            eq(ClinicCancellationPolicyModel.clinicId, clinicId),
            eq(ClinicCancellationPolicyModel.isActive, true)
          )
        )
        .limit(1),
    ]);

    if (!availability || availability.isAvailable === false) {
      throw new HttpError(400, `Clinic is not available on ${dayName}`);
    }

    // Validate clinicServiceId exists before proceeding
    if (payload.clinicServiceId) {
      if (!service) {
        throw new HttpError(400, 'Clinic service not found');
      }
      if (
        bookingPerformer &&
        bookingPerformer.userType === 'Patient' &&
        !service.canBeBookedByPatient
      ) {
        throw new HttpError(
          400,
          'This service cannot be booked by the patient online'
        );
      }
    }

    // Token-based booking mode (max patients per shift)
    const isTokenMode =
      typeof (availability as any).noOfPatients === 'number' &&
      Number((availability as any).noOfPatients) > 0;

    // Which shift this token belongs to and its capacity, resolved per session:
    // the day-wide `1..noOfPatients` scan this replaced handed evening patients
    // morning numbers, or called the day full once the morning had filled.
    const session = isTokenMode
      ? await TokenSessionService.resolve(
          tx,
          clinicId,
          payload.doctorId,
          dateOnlyStr,
          payload.sessionIndex
        )
      : null;

    const maxTokens = session?.capacity ?? null;

    const istDateParts = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/'); // [dd, mm, yyyy]
    const istTodayYMD = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

    if (dateOnlyStr === istTodayYMD) {
      if (!isTokenMode && !appointmentTime) {
        throw new HttpError(400, 'appointmentTime is required');
      }
    }

    const finalAppointmentTime: string | null | undefined = appointmentTime;
    let finalTokenNo: number | null | undefined = tokenNo ?? undefined;
    /** Token mode: the resolved shift. Slot mode: the segment holding the time. */
    let finalSessionIndex: number | null = null;
    // 0 means "no slot grid" (a token day), not a zero-length consultation —
    // saving that would store an appointment with no duration at all.
    const availSlotMinutes = Number((availability as any).slotMinutes);
    let requestedDuration =
      Number.isFinite(availSlotMinutes) && availSlotMinutes > 0
        ? availSlotMinutes
        : 30;

    // What actually gets stored. Decided from the payload once, because token
    // days and date-specific slots skip the slot-mode branch that used to set it.
    const payloadDuration = Number(payload.appointmentDurationMinutes);
    const persistedDuration =
      Number.isFinite(payloadDuration) && payloadDuration > 0
        ? String(payloadDuration)
        : null;

    if (!payload.paymentMode) {
      rest.paymentStatus = 'Already Paid';
    }

    if (isPayLaterMode(payload.paymentMode)) {
      rest.paymentStatus = 'Pending';
    }

    if (
      payload.paymentMode &&
      normalizePaymentMode(payload.paymentMode) === PaymentMode.NOT_REQUIRED
    ) {
      rest.paymentStatus = 'Free Consultation';
    }

    if (isTokenMode) {
      // Only this shift's tokens compete for this shift's numbers. Rows booked
      // before shift-wise numbering carry a null session and read as session 1,
      // which is where their numbers were issued.
      const booked = dayAppointments.filter((a: any) =>
        session!.sessionIndex === 1
          ? a.sessionIndex === 1 || a.sessionIndex == null
          : a.sessionIndex === session!.sessionIndex
      );

      const bookedSet = new Set(
        booked
          .map((b: any) => Number(b.tokenNo))
          .filter((n: any) => Number.isFinite(n))
      );

      // Merge active Redis locks (only those that don't belong to the current patient)
      const patientIdToCheck = payload.patientId ?? userId;
      for (const lock of redisLocks) {
        // A hold in another shift says nothing about this one's numbering.
        if (lock.sessionIndex !== session!.sessionIndex) continue;
        if (typeof lock.slotOrToken === 'number') {
          let lockPatientId: string | undefined;
          try {
            const parsed = JSON.parse(lock.value);
            if (parsed && typeof parsed === 'object') {
              lockPatientId = parsed.patientId;
            }
          } catch {
            /* ignore */
          }

          if (lockPatientId !== patientIdToCheck) {
            bookedSet.add(lock.slotOrToken);
          }
        }
      }

      // Auto-assign the first free token in THIS session. Numbering restarts at
      // 1 per shift, so the evening starts at 1 rather than continuing the
      // morning's run.
      if (!finalTokenNo) {
        for (let t = 1; t <= maxTokens!; t++) {
          if (!bookedSet.has(t)) {
            finalTokenNo = t;
            break;
          }
        }
      }

      if (!finalTokenNo) {
        throw new HttpError(
          400,
          session!.totalSessions > 1
            ? `No tokens available in this session (${session!.sessionStart})`
            : 'No tokens available for this date'
        );
      }
      if (bookedSet.has(finalTokenNo)) {
        throw new HttpError(400, `Token ${finalTokenNo} is already booked`);
      }

      finalSessionIndex = session!.sessionIndex;
    } else {
      // Time-slot based booking (existing behavior)
      if (!appointmentTime) {
        throw new HttpError(400, 'appointmentTime is required');
      }

      // parse times into minutes
      const apptMin = parseTimeToMinutes(appointmentTime);
      if (apptMin === null)
        throw new HttpError(400, 'Invalid appointmentTime format');

      // Session comes from the time itself; left null, a 17:15 row read as session 1.
      const day = await ScheduleShiftService.resolveDaySegments(
        tx,
        clinicId,
        payload.doctorId,
        dateOnlyStr
      );
      const segmentIdx =
        day?.segments.findIndex((s) => apptMin >= s.start && apptMin < s.end) ??
        -1;
      if (segmentIdx !== -1) finalSessionIndex = segmentIdx + 1;

      // const startMin = parseTimeToMinutes(availability.startTime) ?? null;
      // const endMin = parseTimeToMinutes(availability.endTime) ?? null;

      // Check for date-specific availability
      const dateOnlyForCheck = new Date(apptDateObj);
      dateOnlyForCheck.setHours(0, 0, 0, 0);
      const nextDayForCheck = new Date(dateOnlyForCheck);
      nextDayForCheck.setDate(nextDayForCheck.getDate() + 1);

      // Fetch date-specific availability and breaks in parallel
      const [dateAvailabilityResult, breaks] = await Promise.all([
        tx
          .select()
          .from(ClinicDateAvailability)
          .where(
            and(
              eq(ClinicDateAvailability.clinicId, clinicId),
              eq(ClinicDateAvailability.doctorId, payload.doctorId),
              gte(ClinicDateAvailability.date, dateOnlyForCheck),
              lt(ClinicDateAvailability.date, nextDayForCheck)
            )
          ),
        tx
          .select()
          .from(ClinicAvailabilityBreak)
          .where(
            and(
              eq(ClinicAvailabilityBreak.status, false),
              eq(ClinicAvailabilityBreak.clinicAvailabilityId, availability.id)
            )
          ),
      ]);

      const [dateAvailability] = dateAvailabilityResult;

      // let isValidTime = false;
      let useDateSpecificSlots = false;

      if (dateAvailability && dateAvailability.isAvailable) {
        // Check date-specific time slots
        const dateTimeSlots = await tx
          .select()
          .from(ClinicDateAvailabilityTimeSlots)
          .where(
            and(
              eq(
                ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
                dateAvailability.id
              ),
              eq(ClinicDateAvailabilityTimeSlots.isAvailable, true)
            )
          );

        if (dateTimeSlots.length > 0) {
          useDateSpecificSlots = true;
        }

        for (const slot of dateTimeSlots) {
          const slotStartMin = parseTimeToMinutes(slot.startTime);
          const slotEndMin = parseTimeToMinutes(slot.endTime);
          if (
            slotStartMin !== null &&
            slotEndMin !== null &&
            apptMin >= slotStartMin &&
            apptMin < slotEndMin
          ) {
            // isValidTime = true;
            break;
          }
        }
      }

      // Only validate breaks, duration, and overlaps for weekly schedule (not for date-specific slots)
      if (!useDateSpecificSlots) {
        for (const b of breaks) {
          const bStart = parseTimeToMinutes(b.startTime);
          const bEnd = parseTimeToMinutes(b.endTime);
          if (bStart !== null && bEnd !== null) {
            // if appointment falls inside a break -> reject
            if (apptMin >= bStart && apptMin < bEnd) {
              throw new HttpError(
                400,
                `Appointment time ${appointmentTime} falls during break (${b.breakType}: ${b.startTime} - ${b.endTime})`
              );
            }
          }
        }

        // ── Custom duration validation ──────────────────────────────────────
        const defaultDuration = Number((availability as any).slotMinutes) || 30;
        // A parsed 0 means "not stated", not "zero minutes" — the string "0" is
        // truthy, so a caller with no duration failed instead of falling back.
        const parsedDuration = Number(payload.appointmentDurationMinutes);
        // Persisted only when a caller actually chose a length. Stamping the
        // grid's slot size made every row outrank the clinic's own setting.
        const hasChosenDuration =
          Number.isFinite(parsedDuration) && parsedDuration > 0;
        requestedDuration = hasChosenDuration
          ? parsedDuration
          : defaultDuration;

        if (!Number.isFinite(requestedDuration) || requestedDuration < 1) {
          throw new HttpError(
            400,
            'appointmentDurationMinutes must be a positive number'
          );
        }

        const apptEndMin = apptMin + requestedDuration;

        // Guard: must not extend into any break
        for (const b of breaks) {
          const bStart = parseTimeToMinutes(b.startTime);
          const bEnd = parseTimeToMinutes(b.endTime);
          if (bStart !== null && bEnd !== null) {
            if (apptMin < bEnd && apptEndMin > bStart) {
              throw new HttpError(
                400,
                `Appointment duration causes overlap with break (${b.breakType}: ${b.startTime} - ${b.endTime})`
              );
            }
          }
        }

        // Guard: must not overlap another existing time-based appointment on same doctor/clinic/date
        {
          const activeExistingAppts =
            await filterExpiredPendingAppointments(dayAppointments);

          // Parse and merge Redis locks (only those that don't belong to the current patient)
          const patientIdToCheck = payload.patientId ?? userId;
          const redisAppts = [];
          for (const lock of redisLocks) {
            if (typeof lock.slotOrToken === 'string') {
              let duration = 30;
              let lockPatientId: string | undefined;
              let id = lock.value;
              try {
                const parsed = JSON.parse(lock.value);
                if (parsed && typeof parsed === 'object') {
                  id = parsed.bookingRefId || lock.value;
                  duration = Number(parsed.duration) || 30;
                  lockPatientId = parsed.patientId;
                }
              } catch {
                /* ignore */
              }

              if (lockPatientId !== patientIdToCheck) {
                redisAppts.push({
                  id,
                  appointmentTime: lock.slotOrToken,
                  appointmentDurationMinutes: String(duration),
                  appointmentStatus: 'Pending',
                  paymentMode: 'Online',
                  paymentStatus: 'Pending',
                  doctorId: payload.doctorId,
                  appointmentDate: apptDateObj,
                  patientId: lockPatientId,
                });
              }
            }
          }

          const allActiveAppts = [...activeExistingAppts, ...redisAppts];

          for (const ea of allActiveAppts) {
            const eaStart = parseTimeToMinutes(ea.appointmentTime ?? '');
            // Token rows carry no time and cannot overlap a slot.
            if (eaStart == null) continue;
            // A same-patient clash gets the clearer 409 from the duplicate
            // guard below; only other patients compete for the doctor here.
            if (ea.patientId === patientIdToCheck) continue;

            const eaMinutes = Number(ea.appointmentDurationMinutes);
            const eaEnd =
              eaStart +
              (Number.isFinite(eaMinutes) && eaMinutes > 0
                ? eaMinutes
                : defaultDuration);

            if (apptMin < eaEnd && apptEndMin > eaStart) {
              throw new HttpError(
                400,
                `Appointment time ${appointmentTime} overlaps an existing appointment (${toHHMM(eaStart)} - ${toHHMM(eaEnd)})`
              );
            }
          }
        }
      }
    }

    // ── COMMON: Check for existing appointment for same patient on same date ──
    const existingPatientAppts = dayAppointments.filter(
      (a: any) => a.patientId === (patientId ?? userId)
    );

    const activePatientAppts =
      await filterExpiredPendingAppointments(existingPatientAppts);
    const existingPatientAppt = activePatientAppts[0];

    const patientIdToCheck = patientId ?? userId;
    const patientHasRedisLock = redisLocks.some((lock) => {
      try {
        const parsed = JSON.parse(lock.value);
        if (parsed && parsed.patientId === patientIdToCheck) {
          // If the patient has a lock, check if it's for a DIFFERENT slot/token.
          // If it's for the same slot/token, it's a retry of the same checkout, so we don't treat it as a conflict.
          const isSameSlot =
            String(lock.slotOrToken) ===
            String(finalTokenNo || finalAppointmentTime);
          return !isSameSlot;
        }
        return false;
      } catch {
        return false;
      }
    });

    if (existingPatientAppt || patientHasRedisLock) {
      throw new HttpError(
        409,
        'Patient already has an appointment or a pending checkout on this date.'
      );
    }

    return {
      finalTokenNo,
      finalSessionIndex,
      finalAppointmentTime,
      apptDateObj,
      coreRest: {
        patientId: (patientId ?? userId) as string,
        doctorId: payload.doctorId as string,
        clinicServiceId: payload.clinicServiceId,
        appointmentDurationMinutes: persistedDuration,
      },
      derivedPaymentStatus: rest.paymentStatus ?? null,
      appointmentNotes:
        payload.appointmentNotes || (payload as any).notes || null,
      activePolicy,
      deducedBookingSource,
      duration: requestedDuration,
    };
  }

  /**
   * Override booking validation, the counterpart to
   * `validateAppointmentBooking`: it asks whether the schedule allows this,
   * this one only whether the slot is in the future and the data is sound.
   * Separate rather than a flag, because a custom slot may have no schedule to
   * check at all — a closed day or a break is the intended outcome here.
   *
   * Enforced: doctor/patient exist and are active, the service exists, the
   * slot is in the future in IST, and the token isn't already taken.
   * Not enforced: day availability, working hours, breaks, date-specific slot
   * windows, or the one-appointment-per-patient-per-day rule.
   *
   * Authorization lives in the route's `requirePermission` guard.
   */
  static async validateCustomOverrideBooking(
    userId: string,
    clinicId: string,
    payload: createCustomAppointmentDto,
    performerUserId?: string,
    tx: any = database
  ) {
    if (!payload.doctorId || !payload.patientId) {
      throw new HttpError(400, 'DoctorId and PatientId required');
    }

    const queryUserIds = [payload.doctorId, payload.patientId];
    if (performerUserId) queryUserIds.push(performerUserId);

    const users = await tx
      .select({
        id: UserModel.id,
        status: UserModel.userStatus,
        userType: UserModel.userType,
      })
      .from(UserModel)
      .where(inArray(UserModel.id, queryUserIds));

    const validateUser = (user: any, role: string) => {
      if (!user) throw new HttpError(404, `${role} not found`);
      if (user.status === 'Inactive')
        throw new HttpError(400, `${role} account is inactive`);
      if (user.status === 'Blocked')
        throw new HttpError(403, `${role} account is blocked`);
    };

    validateUser(
      users.find((u: any) => u.id === payload.doctorId),
      'Doctor'
    );
    validateUser(
      users.find((u: any) => u.id === payload.patientId),
      'Patient'
    );

    const apptDateObj = new Date(payload.appointmentDate);
    if (Number.isNaN(apptDateObj.getTime())) {
      throw new HttpError(400, 'Invalid appointmentDate');
    }
    const dateOnlyStr = apptDateObj.toISOString().split('T')[0];

    const isTokenOverride =
      typeof payload.tokenNo === 'number' && payload.tokenNo > 0;

    const apptMin = parseTimeToMinutes(payload.appointmentTime);
    if (apptMin === null) {
      throw new HttpError(400, 'Invalid appointmentTime format');
    }

    // Date guard. The time of day is deliberately unchecked: staff routinely
    // record a walk-in that already happened (seen at 3am, entered at 9am),
    // and refusing that only forces them to falsify the time. The date itself
    // still cannot be in the past.
    const now = new Date();
    const [d, m, y] = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/');
    const istTodayYMD = `${y}-${m}-${d}`;

    // ISO dates compare correctly as strings.
    if (dateOnlyStr < istTodayYMD) {
      throw new HttpError(400, 'Appointment date cannot be in the past');
    }

    // ── Clinic service ──────────────────────────────────────────────────────
    if (payload.clinicServiceId) {
      const [service] = await tx
        .select()
        .from(ClinicServiceModel)
        .where(eq(ClinicServiceModel.id, payload.clinicServiceId));
      if (!service) throw new HttpError(400, 'Clinic service not found');
    }

    // ── Duration ────────────────────────────────────────────────────────────
    // Availability is read for its slot length only, and is allowed to be
    // missing entirely: an override on a day the doctor does not work has no
    // row to read, which is the normal case here rather than a failure.
    const dayName = getDayNameFromDate(apptDateObj);
    const [availability] = await tx
      .select()
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, payload.doctorId),
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      );

    /*
     * A zero or absent `slotMinutes` means "this day has no slot grid" — the
     * normal state of a token day — not a zero-length consultation. Treated as
     * unset so it falls through to the 30-minute default, rather than
     * producing a 0 that then fails the check below.
     */
    const availabilitySlotMinutes = Number((availability as any)?.slotMinutes);
    const defaultDuration =
      Number.isFinite(availabilitySlotMinutes) && availabilitySlotMinutes > 0
        ? availabilitySlotMinutes
        : 30;

    // Likewise a requested 0 means "not stated": the string "0" is truthy, so a
    // caller with no duration to send was failing rather than falling back.
    const parsedDuration = Number(payload.appointmentDurationMinutes);
    const requestedDuration =
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? parsedDuration
        : defaultDuration;

    if (!Number.isFinite(requestedDuration) || requestedDuration < 1) {
      throw new HttpError(
        400,
        'appointmentDurationMinutes must be a positive number'
      );
    }

    // ── Token collision ─────────────────────────────────────────────────────
    // Not a schedule rule: two patients holding the same token break queue
    // ordering regardless of who authorized the booking. The token is NOT
    // range-checked against the day's configured maximum — exceeding it is the
    // point of an override.
    let finalTokenNo: number | null = null;
    if (isTokenOverride) {
      finalTokenNo = payload.tokenNo as number;

      const dateOnly = new Date(apptDateObj);
      dateOnly.setHours(0, 0, 0, 0);
      const nextDay = new Date(dateOnly);
      nextDay.setDate(nextDay.getDate() + 1);

      const booked = await tx
        .select({ tokenNo: AppointmentModel.tokenNo })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            eq(AppointmentModel.doctorId, payload.doctorId),
            gte(AppointmentModel.appointmentDate, dateOnly),
            lt(AppointmentModel.appointmentDate, nextDay),
            inArray(AppointmentModel.appointmentStatus, [
              'Upcoming',
              'Confirmed',
              'Patient Arrived',
              'Pending',
              'Rescheduled',
              'Completed',
            ])
          )
        );

      if (booked.some((b: any) => Number(b.tokenNo) === finalTokenNo)) {
        throw new HttpError(400, `Token ${finalTokenNo} is already booked`);
      }
    }

    // ── Payment mode → status, mirroring the normal path ─────────────────────
    let derivedPaymentStatus: string | null = payload.paymentStatus ?? null;
    if (!payload.paymentMode) {
      derivedPaymentStatus = 'Already Paid';
    } else if (
      ['pay later', 'paylater'].includes(payload.paymentMode.toLowerCase())
    ) {
      derivedPaymentStatus = 'Pending';
    } else if (payload.paymentMode === 'Not Required') {
      derivedPaymentStatus = 'Free Consultation';
    }

    const { ClinicCancellationPolicyModel } =
      await import('../../cancellation-policy/models/cancellationPolicy.model');
    const [activePolicy] = await tx
      .select({ id: ClinicCancellationPolicyModel.id })
      .from(ClinicCancellationPolicyModel)
      .where(
        and(
          eq(ClinicCancellationPolicyModel.clinicId, clinicId),
          eq(ClinicCancellationPolicyModel.isActive, true)
        )
      )
      .limit(1);

    return {
      finalTokenNo,
      // A custom override is a time-based slot outside the normal grid, so it
      // belongs to no token session.
      finalSessionIndex: null as number | null,
      finalAppointmentTime: payload.appointmentTime,
      apptDateObj,
      coreRest: {
        patientId: (payload.patientId ?? userId) as string,
        doctorId: payload.doctorId as string,
        clinicServiceId: payload.clinicServiceId,
        appointmentDurationMinutes: String(requestedDuration),
      },
      derivedPaymentStatus,
      appointmentNotes:
        payload.appointmentNotes || (payload as any).notes || null,
      activePolicy,
      // An override is always somebody at the clinic acting deliberately, so it
      // is a walk-in unless the caller says otherwise.
      deducedBookingSource: (payload.bookingSource ?? 'walk_in') as
        'mobile_app' | 'web_portal' | 'phone_call' | 'walk_in' | 'system',
      duration: requestedDuration,
    };
  }

  /**
   * `options.customSlot` switches to the override flow: a different validator
   * and appointmentType. Everything after the insert is identical, which is why
   * both flows share this function rather than keeping a copy that drifts.
   *
   * Set by the `/appointments/custom` route, never from a request body — a
   * client-supplied flag would turn the normal endpoint into a bypass.
   */
  static async createAppointment(
    userId: string,
    clinicId: string,
    payload: createAppointmentDto,
    performerUserId?: string,
    options?: { customSlot?: { reason?: string | null } }
  ) {
    const isCustomSlot = !!options?.customSlot;

    const created = await database.transaction(async (trx) => {
      // Serialize the whole read-decide-write for this doctor + date. Held
      // before validation: after it, two concurrent bookings both read the same
      // token or slot as free and only the unique index caught the token case.
      const lockDate = new Date(payload.appointmentDate);
      if (payload.doctorId && !Number.isNaN(lockDate.getTime())) {
        const key1 = hashStringToInt32(payload.doctorId);
        const key2 = hashStringToInt32(lockDate.toISOString().split('T')[0]);
        await trx.execute(sql`SELECT pg_advisory_xact_lock(${key1}, ${key2})`);
      }

      const validationResult = isCustomSlot
        ? await AppointmentService.validateCustomOverrideBooking(
            userId,
            clinicId,
            payload as createCustomAppointmentDto,
            performerUserId,
            trx
          )
        : await AppointmentService.validateAppointmentBooking(
            userId,
            clinicId,
            payload,
            performerUserId,
            trx
          );

      const {
        finalTokenNo,
        finalSessionIndex,
        finalAppointmentTime,
        apptDateObj,
        coreRest,
        derivedPaymentStatus,
        appointmentNotes,
        activePolicy,
        deducedBookingSource,
      } = validationResult;

      // Auto-link patient to clinic if not already linked
      await trx
        .insert(ClinicAssignModel)
        .values({ userId: coreRest.patientId, clinicId })
        .onConflictDoUpdate({
          target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
          set: { updatedAt: new Date() },
        });

      // Issued inside the transaction, so a booking that fails hands its number back.
      const registrationNo = coreRest.doctorId
        ? await AppointmentRegistrationService.next(
            trx,
            clinicId,
            coreRest.doctorId
          )
        : null;

      const _paymentMode = payload.paymentMode ?? null;
      // Mode-derived status from validation (Pay Later → Pending, Not Required
      // → Free Consultation, no mode → Already Paid) — the client rarely sends
      // an explicit paymentStatus, so without this every booking lands as Paid.
      const _paymentStatus =
        payload.paymentStatus ?? derivedPaymentStatus ?? 'Paid';
      const _price = payload.price ?? null;
      const _primarySvcPrice = payload.primaryServicePrice ?? null;
      const _paymentNotes = payload.paymentNotes ?? null;

      const [appointment] = await trx
        .insert(AppointmentModel)
        .values({
          // The override marker. `appointment_type` is free text the UI and
          // reports group by, so this distinguishes override rows without a
          // schema change. Re-checked rather than trusted, so no future caller
          // can land a non-override type on a booking that skipped validation.
          appointmentType: isCustomSlot
            ? isOverrideAppointmentType(payload.appointmentType)
              ? (payload.appointmentType as string)
              : APPOINTMENT_TYPE_CUSTOM
            : APPOINTMENT_TYPE_CONSULTATION,
          appointmentDate: apptDateObj,
          appointmentTime: finalAppointmentTime ?? null,
          tokenNo: finalTokenNo ?? null,
          registrationNo,
          sessionIndex: finalSessionIndex,
          clinicCancellationPolicyId: activePolicy?.id || null,
          bookingSource: (payload.bookingSource ?? deducedBookingSource) as any,
          clinicId,
          ...coreRest,
          appointmentStatus: ((payload as any).appointmentStatus ||
            'Pending') as any,
        })
        .returning();

      if (!appointment) {
        throw new HttpError(
          500,
          'Failed to create appointment. Please try again.'
        );
      }

      // ── Override audit trail ────────────────────────────────────────────
      // Who authorized a booking that no schedule explains, and why. Written
      // inside the transaction and awaited (unlike the fire-and-forget logs
      // further down) because an override with no record of who approved it is
      // the thing this feature must never produce.
      if (isCustomSlot) {
        await AppointmentActivityHistoryService.logActivity({
          appointmentId: appointment.id,
          action: 'CREATED',
          performedBy: performerUserId || userId,
          newState: {
            isCustomSlot: true,
            appointmentType: appointment.appointmentType,
            appointmentDate: appointment.appointmentDate,
            appointmentTime: appointment.appointmentTime,
            tokenNo: appointment.tokenNo,
            doctorId: appointment.doctorId,
            patientId: appointment.patientId,
            authorizedBy: performerUserId || userId,
            reason: options?.customSlot?.reason ?? null,
          },
          remarks: options?.customSlot?.reason
            ? `${appointment.appointmentType} slot override — ${options.customSlot.reason}`
            : `${appointment.appointmentType} slot override — booked outside configured availability`,
          tx: trx,
        });
      }

      // If this appointment is being booked off a doctor-suggested visiting
      // request, link the two: the request moves Pending -> Scheduled and
      // records the appointment it produced.
      if (payload.visitingRequestId) {
        const [visitingRequest] = await trx
          .select()
          .from(VisitingRequestModel)
          .where(eq(VisitingRequestModel.id, payload.visitingRequestId))
          .limit(1);

        if (!visitingRequest || visitingRequest.clinicId !== clinicId) {
          throw new HttpError(404, 'Visiting request not found');
        }
        if (
          visitingRequest.doctorId !== coreRest.doctorId ||
          visitingRequest.patientId !== coreRest.patientId
        ) {
          throw new HttpError(
            400,
            'Visiting request does not match the doctor/patient for this appointment'
          );
        }
        if (visitingRequest.status !== 'Pending') {
          throw new HttpError(
            400,
            `Only pending visiting requests can be scheduled (current status: ${visitingRequest.status})`
          );
        }

        await trx
          .update(VisitingRequestModel)
          .set({
            status: 'Scheduled',
            generatedAppointmentId: appointment.id,
            updatedAt: new Date(),
          })
          .where(eq(VisitingRequestModel.id, payload.visitingRequestId));
      }

      // Insert payment data into separate table
      await trx.insert(AppointmentPaymentModel).values({
        appointmentId: appointment.id,
        paymentMode: _paymentMode ? normalizePaymentMode(_paymentMode) : null,
        paymentStatus: _paymentStatus ?? 'Paid',
        price: _price ?? null,
        primaryServicePrice: _primarySvcPrice ?? _price ?? null,
        paymentNotes: _paymentNotes ?? null,
      });

      // Insert clinical data into separate table
      const { commonSymptoms, clinicSymptomIds } = payload;
      await trx.insert(AppointmentClinicalModel).values({
        appointmentId: appointment.id,
        commonSymptoms: commonSymptoms ?? [],
        clinicSymptomIds: clinicSymptomIds ?? [],
        appointmentNotes: appointmentNotes ?? null,
      });
      // ===============================
      // 🔥 SUBSCRIPTION HANDLING START
      // ===============================

      if (payload.clinicServiceId) {
        const patientFinalId = coreRest.patientId ?? userId;

        // 1️⃣ Check existing active subscription
        const [existingSubscription] = await trx
          .select()
          .from(ClinicAppointmentPlainModel)
          .where(
            and(
              eq(ClinicAppointmentPlainModel.patientId, patientFinalId),
              eq(ClinicAppointmentPlainModel.doctorId, payload.doctorId),
              eq(
                ClinicAppointmentPlainModel.doctorSubscriptionId,
                payload.clinicServiceId
              ),
              eq(ClinicAppointmentPlainModel.status, 'active'),
              gte(ClinicAppointmentPlainModel.expireAt, apptDateObj)
            )
          );

        // 2️⃣ If no active subscription → create one
        if (!existingSubscription) {
          const [service] = await trx
            .select()
            .from(ClinicServiceModel)
            .where(eq(ClinicServiceModel.id, payload.clinicServiceId));

          if (!service) {
            throw new HttpError(400, 'Clinic service not found');
          }

          const expireDate = new Date(apptDateObj);
          const durationDays = Number(service.durationDays ?? 0);
          if (Number.isFinite(durationDays) && durationDays > 0) {
            expireDate.setDate(expireDate.getDate() + durationDays);
          }
          const rawPaymentMode = payload.paymentMode?.toLowerCase();
          const paymentMode =
            rawPaymentMode === 'cash' ||
            rawPaymentMode === 'upi' ||
            rawPaymentMode === 'card' ||
            rawPaymentMode === 'insurance'
              ? rawPaymentMode
              : 'cash';

          await trx.insert(ClinicAppointmentPlainModel).values({
            doctorId: payload.doctorId,
            patientId: patientFinalId,
            clinicId,
            doctorSubscriptionId: payload.clinicServiceId,
            expireAt: expireDate,
            amount: String(service.price ?? 0),
            paymentStatus: 'paid',
            paymentMode,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      // ===============================
      // 🔥 SUBSCRIPTION HANDLING END
      // ===============================

      if (notificationsEnabled()) {
        // Fire-and-forget: schedule reminders without blocking the transaction
        const patientMobile = (
          await trx
            .select({ mobile: UserModel.mobile })
            .from(UserModel)
            .where(eq(UserModel.id, appointment.patientId))
        )?.[0]?.mobile;

        const clinicName = (
          await trx
            .select({ clinicName: ClinicModel.clinicName })
            .from(ClinicModel)
            .where(eq(ClinicModel.id, clinicId))
        )?.[0]?.clinicName;

        // The no-show timer is not a reminder: a token booking stores no real
        // time and a patient may have no mobile, and neither excuses skipping it.
        autoNoShowQueue.scheduleAutoNoShow(appointment).catch((err) => {
          logger.error('Failed to schedule auto no-show', err);
        });

        if (patientMobile && appointment.appointmentTime && clinicName) {
          const appointmentDateTime = appointmentInstantIST(
            appointment.appointmentDate,
            appointment.appointmentTime
          );

          // Non-blocking: don't await queue operations
          whatsAppReminderQueue
            .scheduleWhatsAppReminders(
              appointment.id,
              patientMobile,
              clinicId,
              clinicName,
              appointmentDateTime,
              finalTokenNo ?? null
            )
            .catch((err) => {
              logger.error('Failed to schedule notification reminders', err);
            });
        }
      }

      // Update symptom counts
      if (clinicSymptomIds && clinicSymptomIds.length > 0) {
        const dateStr = apptDateObj.toISOString().split('T')[0];
        for (const symptomId of clinicSymptomIds) {
          await trx
            .insert(ClinicSymptomCountModel)
            .values({
              symptomId,
              date: dateStr,
              count: 1,
            })
            .onConflictDoUpdate({
              target: [
                ClinicSymptomCountModel.symptomId,
                ClinicSymptomCountModel.date,
              ],
              set: {
                count: sql`${ClinicSymptomCountModel.count} + 1`,
              },
            });
        }
      }

      broadcastAppointmentChange({
        appointmentId: appointment.id,
        clinicId,
        doctorId: coreRest.doctorId,
        patientId: appointment.patientId,
        action: 'created',
        performerUserId: performerUserId || userId,
      });

      // Logged in `trx`: a separate connection can't see the uncommitted
      // appointment row, so the FK on appointment_id fails.
      const paymentRemarks =
        payload.paymentMode === 'Pay Later'
          ? 'Payment is pending for this appointment'
          : payload.paymentMode === 'Not Required'
            ? 'Payment not required for this appointment as it is free consultation'
            : payload.paymentMode
              ? 'Payment received for this appointment by ' +
                payload.paymentMode
              : 'Payment not required for this appointment as it is under follow-up period';
      await AppointmentActivityHistoryService.logActivity({
        appointmentId: appointment.id,
        action: 'PAYMENT_STATUS',
        performedBy: performerUserId || userId,
        newState: appointment,
        remarks: paymentRemarks,
        tx: trx,
      });

      // Log activity
      await AppointmentActivityHistoryService.logActivity({
        appointmentId: appointment.id,
        action: 'CREATED',
        performedBy: performerUserId || userId,
        newState: appointment,
        remarks: `Appointment created`,
        tx: trx,
      });

      // The booking SMS/WhatsApp is dispatched after this transaction commits —
      // see below. It resolves the recipient from the appointment row, which is
      // not visible on another connection until commit.

      // Every dashboard cache, the doctor's included, is versioned per clinic;
      // `signalAppointmentChange` below retires them after commit.

      // Schedule running-late delayed job (fire-and-forget)
      if (coreRest.doctorId && appointment.appointmentTime) {
        // Schedule BullMQ job that fires at (appointmentTime + threshold)
        import('../../appointment-engine/services/runningLateQueue.service')
          .then(({ runningLateQueue }) =>
            runningLateQueue.scheduleCheck(
              appointment.id,
              clinicId,
              coreRest.doctorId!,
              appointment.appointmentDate,
              appointment.appointmentTime!
            )
          )
          .catch(() => {});
      }

      // Reception overview caches today's counts (incl. new-patient count) for
      // 60s — drop them so the dashboard reflects this booking immediately.
      // Pattern-based because each receptionist's doctor scope produces its own
      // key, and the booking changes what several of them would read.
      await invalidateCacheByPattern(
        CacheKeys.receptionOverviewPattern(clinicId)
      );

      return appointment;
    });

    // Post-commit: the notification writes on a different connection than
    // `trx`, so inside the transaction a rollback could leave a notification
    // for an appointment that never existed.
    const createdDoctorId = created?.doctorId;
    if (created && createdDoctorId && payload.paymentMode !== 'razorpay') {
      void (async () => {
        const performer = await getUserById(performerUserId || userId);
        const patientInfo = await getUserById(created.patientId);
        if (!performer || !patientInfo) return;

        await notifyAppointmentCreated(
          clinicId,
          created.id,
          performer.id,
          patientInfo.name,
          performer.name,
          performer.userType,
          createdDoctorId, // assigned doctor only
          created.patientId
        );
      })().catch((err) => {
        logger.error('Failed to send appointment created notification', err);
      });
    }

    // Post-commit, fire-and-forget: the notification service reads the
    // appointment (recipient, clinic, settings, doctor) in a single query, so
    // it must run once the row is actually visible to other connections.
    if (
      notificationsEnabled() &&
      payload.paymentMode !== 'razorpay' &&
      created?.appointmentTime
    ) {
      AppointmentNotificationService.sendImmediateNotification(
        created.id,
        created.appointmentDate,
        created.appointmentTime,
        created.tokenNo ?? null
      ).catch((err) => {
        logger.error('Failed to send immediate notification', err);
      });
    }

    // ─── Realtime: a new booking changes the queue for that doctor/day ──────
    // Recalculate post-commit, then signal: in the transaction the recompute
    // could not see the row, and `/queue-state` serves that cached snapshot.
    if (created) {
      // Retire dashboard caches now: this request's own client refetches on the
      // response, well before the queue recalculation below lets the signal go.
      void invalidateClinicDashboardCaches(clinicId);
      const createdDate = new Date(created.appointmentDate);
      const now = new Date();
      const isTodayQueue =
        Boolean(createdDoctorId && created.appointmentTime) &&
        createdDate.getUTCFullYear() === now.getUTCFullYear() &&
        createdDate.getUTCMonth() === now.getUTCMonth() &&
        createdDate.getUTCDate() === now.getUTCDate();

      const refreshQueue = isTodayQueue
        ? import('../../appointment-engine/services/delayTracker.service').then(
            async ({ DelayTrackerService }) => {
              const queueData = await new DelayTrackerService().recalculate(
                clinicId,
                createdDoctorId!,
                createdDate.toISOString().split('T')[0]
              );
              const { QueueBroadcastService } =
                await import('../../appointment-engine/services/queueBroadcast.service');
              const broadcaster = new QueueBroadcastService();
              broadcaster.emitQueueUpdated(clinicId, queueData);
              await broadcaster.emitPatientUpdated(queueData);
            }
          )
        : Promise.resolve();

      void refreshQueue
        .catch(() => {})
        .finally(() => signalAppointmentChange(created, 'appointment.created'));
    }

    return created;
  }

  /**
   * Patient/staff notifications for an appointment update. Called after the
   * update transaction commits: these reach SMS and WhatsApp providers over the
   * network, and must not run while a transaction holds row locks.
   */
  private static async dispatchUpdateNotifications(
    updated: typeof AppointmentModel.$inferSelect,
    payload: UpdateAppointmentDto,
    performerUserId?: string
  ): Promise<void> {
    const performer = await getUserById(performerUserId || 'system');
    if (!performer) return;

    // A date/time change is a reschedule whatever the appointment's current
    // status is. This must be tested before the status branches below, which
    // read `updated.appointmentStatus` — rescheduling an already Confirmed
    // appointment would otherwise match the Confirmed branch and never notify
    // the patient.
    const isReschedule = Boolean(
      payload.appointmentDate || payload.appointmentTime
    );

    if (updated.appointmentStatus === 'Cancelled') {
      await notifyAppointmentCanceled(
        updated.clinicId,
        updated.id,
        performer.id,
        performer.name,
        performer.userType,
        updated.doctorId || undefined,
        updated.patientId
      );
    } else if (updated.appointmentStatus === 'Confirmed' && !isReschedule) {
      // In-app only: the patient already got an SMS/WhatsApp when the
      // appointment was booked, and one message per appointment is the agreed
      // behaviour regardless of later status changes.
      await notifyAppointmentConfirmed(
        updated.id,
        performer.id,
        performer.name,
        performer.userType,
        updated.doctorId || undefined,
        updated.patientId,
        updated.clinicId
      );
    } else if (isReschedule) {
      await notifyAppointmentRescheduled(
        updated.id,
        performer.id,
        performer.name,
        performer.userType,
        updated.doctorId || undefined,
        updated.patientId,
        updated.clinicId,
        updated.appointmentTime
          ? {
              date: new Date(updated.appointmentDate),
              time: updated.appointmentTime,
              tokenNo: updated.tokenNo ?? null,
            }
          : undefined
      );
    }
  }

  static async updateAppointment(
    appointmentId: string,
    payload: UpdateAppointmentDto,
    performerUserId?: string,
    performerUserType?: string
  ) {
    // Validate payload shape
    try {
      updateAppointmentSchema.parse(payload);
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      throw err;
    }

    // Capture previous status for appointment engine hook
    let previousAppointmentStatus: string | null = null;
    // Captured for the realtime signal: a reschedule across days changes two
    // queues, and the day being left has no other way of finding out.
    let previousAppointmentDate: Date | string | null = null;
    // Captured for the realtime signal: a vitals/notes-only edit changes
    // neither status nor date, so without this it would never signal at all
    // and a doctor's open encounter screen would stay silently stale.
    let clinicalChanged = false;
    // Same reasoning for a payment-only edit (e.g. marking Paid without also
    // touching status) — see Phase 2 of docs/REALTIME_ROLLOUT_PLAN.md.
    let paymentChanged = false;

    const updated = await database.transaction(async (trx) => {
      // 1) Fetch existing appointment
      const [existing] = await trx
        .select()
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, appointmentId));
      if (!existing || !existing.doctorId) {
        throw new HttpError(400, 'Appointment not found');
      }

      // If appointment status is updating to Cancelled, run policy checks
      if (payload.appointmentStatus === 'Cancelled') {
        const { PolicyEvaluationService } =
          await import('../../cancellation-policy/services/policyEvaluation.service');
        await PolicyEvaluationService.evaluateCancellation(
          appointmentId,
          performerUserId || 'system',
          performerUserType || 'System',
          {
            reasonCode: payload.reReasonForCancellation || 'other',
            comments:
              payload.reason || payload.reReasonForCancellation || undefined,
          }
        );
      }

      // Capture previous status for appointment engine orchestrator
      previousAppointmentStatus = existing.appointmentStatus;
      previousAppointmentDate = existing.appointmentDate;

      // Fetch existing payment record for comparison
      const [existingPaymentRecord] = await trx
        .select()
        .from(AppointmentPaymentModel)
        .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));

      // Create a combined existing object for backward-compatible comparisons
      const existingWithPayment = {
        ...existing,
        paymentStatus: existingPaymentRecord?.paymentStatus ?? null,
        paymentMode: existingPaymentRecord?.paymentMode ?? null,
      };

      // Optional: check permission (patient or clinic admin etc.)
      // if (existing.patientId !== userId) throw new HttpError(400,"Not allowed to update this appointment");

      // 2) Determine new date/time values (fall back to existing if not provided)
      const newDate = payload.appointmentDate
        ? new Date(payload.appointmentDate)
        : new Date(existing.appointmentDate);
      if (Number.isNaN(newDate.getTime())) {
        throw new HttpError(400, 'Invalid appointmentDate');
      }
      const now = new Date();

      const newTime =
        typeof payload.appointmentTime !== 'undefined'
          ? payload.appointmentTime
          : existing.appointmentTime;

      const isTokenBasedAppointment =
        existing.tokenNo !== null || payload.tokenNo;

      // Recomputed rather than carried over: a session and a token number only
      // mean something together, so a move that lands in a different shift
      // would otherwise keep a morning number in the evening queue and collide
      // with that shift's own token. Only when the move could change it.
      const tokenPlacementChanged = Boolean(
        payload.appointmentDate || typeof payload.tokenNo !== 'undefined'
      );

      let resolvedSessionIndex: number | null | undefined;

      if (isTokenBasedAppointment && tokenPlacementChanged) {
        const targetDate = newDate.toISOString().split('T')[0];

        const session = await TokenSessionService.resolve(
          trx,
          existing.clinicId,
          existing.doctorId,
          targetDate,
          // An explicit session wins; otherwise the day is re-read and, on a
          // single-session day or today, inferred exactly as booking does.
          payload.sessionIndex ?? null
        );

        resolvedSessionIndex = session.sessionIndex;

        const targetToken = payload.tokenNo ?? existing.tokenNo;

        // A number already taken in the shift being moved into. Caught here so
        // it reads as a conflict rather than surfacing as a raw unique
        // violation from `ux_appt_token_per_session`.
        if (targetToken != null) {
          const [clash] = await trx
            .select({ id: AppointmentModel.id })
            .from(AppointmentModel)
            .where(
              and(
                eq(AppointmentModel.clinicId, existing.clinicId),
                eq(AppointmentModel.doctorId, existing.doctorId),
                eq(AppointmentModel.appointmentDate, newDate),
                eq(AppointmentModel.tokenNo, targetToken),
                ne(AppointmentModel.id, appointmentId),
                session.sessionIndex === 1
                  ? or(
                      eq(AppointmentModel.sessionIndex, 1),
                      isNull(AppointmentModel.sessionIndex)
                    )
                  : eq(AppointmentModel.sessionIndex, session.sessionIndex),
                inArray(AppointmentModel.appointmentStatus, [
                  'Upcoming',
                  'Confirmed',
                  'Patient Arrived',
                  'Pending',
                  'Rescheduled',
                  'Completed',
                ])
              )
            );

          if (clash) {
            throw new HttpError(
              400,
              session.totalSessions > 1
                ? `Token ${targetToken} is already booked in the session starting ${session.sessionStart}`
                : `Token ${targetToken} is already booked`
            );
          }
        }
      }

      if (
        payload.paymentStatus &&
        payload.paymentStatus.toLowerCase() === 'refunded' &&
        existing.clinicServiceId
      ) {
        await trx
          .update(ClinicAppointmentPlainModel)
          .set({
            paymentStatus: 'refunded',
            status: 'inactive', // optional but recommended
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicAppointmentPlainModel.patientId, existing.patientId),
              eq(ClinicAppointmentPlainModel.doctorId, existing.doctorId),
              eq(
                ClinicAppointmentPlainModel.doctorSubscriptionId,
                existing.clinicServiceId
              ),
              eq(ClinicAppointmentPlainModel.status, 'active')
            )
          );
      }
      // / / 7) Build update payload (only provided fields)
      const setObj: Record<string, any> = {};
      const paymentSetObj: Record<string, any> = {};
      const clinicalSetObj: Record<string, any> = {};

      if (payload.appointmentDate) setObj.appointmentDate = newDate;
      if (typeof payload.appointmentTime !== 'undefined')
        setObj.appointmentTime = newTime;
      if (payload.appointmentType)
        setObj.appointmentType = payload.appointmentType;

      if (typeof payload.appointmentStatus !== 'undefined')
        setObj.appointmentStatus = payload.appointmentStatus;

      // ── Late patient handling ────────────────────────────────────────────
      // The first time an appointment reaches "Patient Arrived", record when,
      // and apply the clinic's late policy. Guarded on `existing.arrivedAt`
      // being unset so re-saving the row later (a payment update, a note)
      // cannot re-stamp the arrival or re-apply the penalty.
      if (
        payload.appointmentStatus === 'Patient Arrived' &&
        !existing.arrivedAt
      ) {
        const arrivedAt = new Date();
        setObj.arrivedAt = arrivedAt;

        // Reception can waive the penalty — an emergency, a frail patient, or
        // a delay the clinic itself caused. The waiver is deliberate and shows
        // up in the activity history alongside the arrival.
        if (payload.keepQueuePosition === true) {
          setObj.lateQueueDemotion = 0;
        } else {
          const { LatePatientService } = await import('./latePatient.service');
          const assessment = await LatePatientService.assess(
            existing.clinicId,
            existing.appointmentTime,
            arrivedAt
          );

          if (assessment.isLate && assessment.demotion > 0) {
            setObj.lateQueueDemotion = assessment.demotion;
            logger.info(
              `[LatePatient] appointment=${appointmentId} arrived ${assessment.lateByMinutes}m late; ` +
                `policy=${assessment.policy} → moved back ${assessment.demotion} place(s)`
            );
          }
        }

        // A patient standing at the desk is not a no-show. Cancelling the
        // pending job here is what makes late handling possible at all —
        // otherwise the grace timer would still fire and mark them absent
        // while they sat in the waiting room.
        await autoNoShowQueue.removeAutoNoShow(appointmentId);
      }

      if (payload.appointmentDurationMinutes)
        setObj.appointmentDurationMinutes = payload.appointmentDurationMinutes;

      // Payment fields → AppointmentPaymentModel
      if (payload.paymentMode) {
        paymentSetObj.paymentMode =
          payload.paymentMode === 'razorpay' ? 'Online' : payload.paymentMode;
      }
      if (payload.paymentStatus)
        paymentSetObj.paymentStatus = payload.paymentStatus;
      if (payload.price) paymentSetObj.price = payload.price;
      if (payload.paymentNotes)
        paymentSetObj.paymentNotes = payload.paymentNotes;
      if (payload.refundMode) paymentSetObj.refundMode = payload.refundMode;
      if (payload.refundedAmount)
        paymentSetObj.refundedAmount = payload.refundedAmount;
      if (payload.refundNotes) paymentSetObj.refundNotes = payload.refundNotes;

      // Clinical fields → AppointmentClinicalModel
      if (typeof payload.appointmentNotes !== 'undefined')
        clinicalSetObj.appointmentNotes = payload.appointmentNotes;
      if (payload.consentNotes)
        clinicalSetObj.consentNotes = payload.consentNotes;
      if (payload.clinicSymptomIds)
        clinicalSetObj.clinicSymptomIds = payload.clinicSymptomIds;
      if (payload.vitals) clinicalSetObj.vitals = payload.vitals;
      if (payload.referrals) clinicalSetObj.referrals = payload.referrals;

      // Core appointment fields
      if (payload.bookingSource) setObj.bookingSource = payload.bookingSource;

      if (payload.reReasonForCancellation)
        setObj.reReasonForCancellation = payload.reReasonForCancellation;

      if (payload.reasionForReSchedule)
        setObj.reasionForReSchedule = payload.reasionForReSchedule;

      if (typeof payload.tokenNo !== 'undefined')
        setObj.tokenNo = payload.tokenNo;

      // Written alongside the token, never apart from it: a number moved into a
      // different shift without its session would collide with that shift's own
      // numbering. Prefers the value recomputed above over the caller's, so a
      // staff edit that moves the date without naming a session still lands in
      // the right one.
      if (typeof resolvedSessionIndex !== 'undefined')
        setObj.sessionIndex = resolvedSessionIndex;
      else if (typeof payload.sessionIndex !== 'undefined')
        setObj.sessionIndex = payload.sessionIndex;

      // Update core appointment
      setObj.updatedAt = new Date();

      const [updated] = await trx
        .update(AppointmentModel)
        .set(setObj)
        .where(eq(AppointmentModel.id, appointmentId))
        .returning();

      if (!updated) throw new HttpError(400, 'Failed to update appointment');

      // Update payment table if there are payment changes
      if (Object.keys(paymentSetObj).length > 0) {
        paymentSetObj.updatedAt = new Date();
        const [existingPayment] = await trx
          .select()
          .from(AppointmentPaymentModel)
          .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));

        if (existingPayment) {
          const alreadyPaid =
            existingPayment.paymentStatus?.toLowerCase() === 'paid';
          const requestedStatus = payload.paymentStatus?.toLowerCase();

          // Two receptionists can hold the same appointment open. Whoever
          // saves second must not be able to undo a collection they cannot
          // see, nor collect it twice.
          if (alreadyPaid && requestedStatus === 'pending') {
            const collectedBy = await AppointmentService.findPaymentCollector(
              trx,
              appointmentId
            );
            throw new HttpError(
              409,
              collectedBy
                ? `This appointment was already paid — ${collectedBy} collected it. Refresh to see the current payment status.`
                : 'This appointment has already been paid. Refresh to see the current payment status.'
            );
          }

          // Re-asserting Paid is the same collection arriving twice, so the
          // payment row is left exactly as it is rather than written again.
          if (alreadyPaid && requestedStatus === 'paid') {
            delete paymentSetObj.paymentStatus;
            delete paymentSetObj.price;
            delete paymentSetObj.paymentMode;
          }

          if (Object.keys(paymentSetObj).length > 1) {
            paymentChanged = true;
            await trx
              .update(AppointmentPaymentModel)
              .set(paymentSetObj)
              .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
          }
        } else {
          paymentChanged = true;
          await trx.insert(AppointmentPaymentModel).values({
            appointmentId,
            ...paymentSetObj,
          });
        }
      }

      // Update clinical table if there are clinical changes
      if (Object.keys(clinicalSetObj).length > 0) {
        clinicalChanged = true;
        clinicalSetObj.updatedAt = new Date();
        const [existingClinical] = await trx
          .select()
          .from(AppointmentClinicalModel)
          .where(eq(AppointmentClinicalModel.appointmentId, appointmentId));

        if (existingClinical) {
          await trx
            .update(AppointmentClinicalModel)
            .set(clinicalSetObj)
            .where(eq(AppointmentClinicalModel.appointmentId, appointmentId));
        } else {
          await trx.insert(AppointmentClinicalModel).values({
            appointmentId,
            ...clinicalSetObj,
          });
        }
      }

      // NEW: Reschedule reminders if appointment date/time changed
      const dateChanged =
        payload.appointmentDate &&
        new Date(payload.appointmentDate).toDateString() !==
          new Date(existing.appointmentDate).toDateString();

      const timeChanged =
        payload.appointmentTime &&
        payload.appointmentTime !== existing.appointmentTime;

      // Any move landing today — date, time, or a token placed in another shift —
      // recalculates the queue, whether or not notifications are enabled.
      const tokenMoved =
        typeof payload.tokenNo !== 'undefined' ||
        typeof payload.sessionIndex !== 'undefined';

      if (
        (((dateChanged || timeChanged) && updated.appointmentTime) ||
          tokenMoved) &&
        updated.doctorId
      ) {
        const rescheduledDateForCache = new Date(updated.appointmentDate);
        const todayForRescheduleCache = new Date();
        if (
          rescheduledDateForCache.getUTCFullYear() ===
            todayForRescheduleCache.getUTCFullYear() &&
          rescheduledDateForCache.getUTCMonth() ===
            todayForRescheduleCache.getUTCMonth() &&
          rescheduledDateForCache.getUTCDate() ===
            todayForRescheduleCache.getUTCDate()
        ) {
          const dateStr = rescheduledDateForCache.toISOString().split('T')[0];
          new AppointmentEngineOrchestrator()
            .onReschedule(existing.clinicId, updated.doctorId, dateStr)
            .catch(() => {});
        }
      }

      if (notificationsEnabled()) {
        if ((dateChanged || timeChanged) && updated.appointmentTime) {
          const appointmentDateTime = appointmentInstantIST(
            updated.appointmentDate,
            updated.appointmentTime
          );

          const [clinic_name] = await trx
            .select({ clinicName: ClinicModel.clinicName })
            .from(ClinicModel)
            .where(eq(ClinicModel.id, existing.clinicId));

          const [patient] = await trx
            .select({ mobile: UserModel.mobile })
            .from(UserModel)
            .where(eq(UserModel.id, updated.patientId));

          // Re-armed on the moved schedule, not on the patient having a mobile.
          // scheduleAutoNoShow drops a deadline already in the past itself.
          await autoNoShowQueue.removeAutoNoShow(appointmentId);
          await autoNoShowQueue.scheduleAutoNoShow(updated);

          if (appointmentDateTime > now && patient?.mobile) {
            await whatsAppReminderQueue.removeWhatsAppReminders(
              appointmentId,
              existing.clinicId
            );

            // Schedule WhatsApp reminders if enabled
            await whatsAppReminderQueue.scheduleWhatsAppReminders(
              updated.id,
              patient.mobile,
              existing.clinicId,
              clinic_name.clinicName,
              appointmentDateTime,
              null
            );

            // Reschedule running-late check
            if (updated.doctorId && updated.appointmentTime) {
              import('../../appointment-engine/services/runningLateQueue.service')
                .then(({ runningLateQueue }) => {
                  runningLateQueue.cancelCheck(appointmentId);
                  return runningLateQueue.scheduleCheck(
                    updated.id,
                    existing.clinicId,
                    updated.doctorId!,
                    updated.appointmentDate,
                    updated.appointmentTime!
                  );
                })
                .catch(() => {});
              // Queue recalculation for this reschedule now happens
              // unconditionally above, outside notificationsEnabled()/mobile
              // gating — see the comment there for why it was moved.
            }
          }
        } else if (
          payload.appointmentStatus === 'Cancelled' ||
          payload.appointmentStatus === 'Completed' ||
          payload.appointmentStatus === 'NoShow'
        ) {
          // Remove auto no show if appointment is finished or cancelled
          await autoNoShowQueue.removeAutoNoShow(appointmentId);

          // Cancel running-late check for this appointment
          import('../../appointment-engine/services/runningLateQueue.service')
            .then(({ runningLateQueue }) =>
              runningLateQueue.cancelCheck(appointmentId)
            )
            .catch(() => {});
        }
      }

      // Log activity
      const actions: Array<
        | 'UPDATED'
        | 'CONFIRMED'
        | 'STATUS_CHANGED'
        | 'RESCHEDULED'
        | 'PATIENT_ARRIVED'
        | 'CANCELLED'
        | 'COMPLETED'
        | 'PAYMENT_STATUS'
        | 'VITALS_UPDATED'
      > = [];
      let remarks = 'Appointment updated';
      if (
        payload.appointmentStatus &&
        payload.appointmentStatus !== existing.appointmentStatus
      ) {
        if (payload.appointmentStatus === 'Cancelled') {
          actions.push('CANCELLED');
          remarks = `Appointment cancelled: ${payload.reReasonForCancellation || 'No reason provided'}`;
        } else if (payload.appointmentStatus === 'Confirmed') {
          actions.push('CONFIRMED');
          remarks = `Appointment confirmed ${payload.reason ? '(Reason: ' + payload.reason + ')' : ''}`;
        } else if (payload.appointmentStatus === 'Completed') {
          actions.push('COMPLETED');
          remarks = `Appointment completed`;
        } else {
          actions.push('STATUS_CHANGED');
          remarks = `Status changed from ${existing.appointmentStatus} to ${payload.appointmentStatus}`;
        }
      }

      const isReceptionist =
        performerUserType?.toLowerCase() === 'receptionist';

      if (payload.vitals && isReceptionist) {
        actions.push('VITALS_UPDATED');
        remarks = `Vitals updated`;
      }

      if (
        payload.paymentStatus &&
        payload.paymentStatus !== existingWithPayment.paymentStatus
      ) {
        if (payload.paymentStatus == 'Refunded') {
          actions.push('PAYMENT_STATUS');
          remarks = `₹${payload.refundedAmount} has been refunded by ${payload.refundMode} ${payload.refundNotes ? ` (${payload.refundNotes})` : ''}`;
        } else if (payload.paymentStatus == 'Paid') {
          actions.push('PAYMENT_STATUS');
          remarks =
            'Payment received for this appointment by ' + payload.paymentMode;
        }
      }

      if (payload.appointmentDate || payload.appointmentTime) {
        const dateChanged =
          payload.appointmentDate &&
          new Date(payload.appointmentDate).toDateString() !==
            new Date(existing.appointmentDate).toDateString();
        const timeChanged =
          payload.appointmentTime &&
          payload.appointmentTime !== existing.appointmentTime;

        if (dateChanged || timeChanged) {
          actions.push('RESCHEDULED');
          remarks = `Appointment rescheduled to ${updated.appointmentDate.toDateString()} at ${updated.appointmentTime}`;
        }
      }

      if (actions.length === 0) {
        actions.push('UPDATED');
      }

      // Log each detected action (or just the primary one)
      // For simplicity, let's log the most important one or a generic UPDATED
      const primaryAction =
        actions.find((a) => a === 'CANCELLED') ||
        actions.find((a) => a === 'CONFIRMED') ||
        actions.find((a) => a === 'COMPLETED') ||
        actions.find((a) => a === 'RESCHEDULED') ||
        actions.find((a) => a === 'PATIENT_ARRIVED') ||
        actions.find((a) => a === 'STATUS_CHANGED') ||
        actions.find((a) => a === 'PAYMENT_STATUS') ||
        actions.find((a) => a === 'VITALS_UPDATED') ||
        'UPDATED';

      await AppointmentActivityHistoryService.logActivity({
        appointmentId: updated.id,
        action: primaryAction,
        performedBy: performerUserId || 'system',
        previousState: existing,
        newState: updated,
        remarks: remarks,
        tx: trx,
      });

      // Patient-facing notifications are dispatched after this transaction
      // commits — see below. They make external SMS/WhatsApp calls, which must
      // not hold the transaction open.

      // 🔴 Real-time broadcast to clinic room (auto-update on doctor/reception screens)
      {
        let action: import('../../../utils/appointmentRealtime').AppointmentRealtimeAction =
          'updated';
        if (payload.appointmentStatus === 'Cancelled') action = 'cancelled';
        else if (payload.appointmentStatus === 'Confirmed')
          action = 'confirmed';
        else if (payload.appointmentStatus === 'Completed')
          action = 'completed';
        else if (payload.appointmentStatus === 'NoShow') action = 'noshow';
        else if (payload.appointmentDate || payload.appointmentTime)
          action = 'rescheduled';
        else if (payload.paymentStatus) action = 'payment_updated';
        else if (payload.vitals) action = 'vitals_updated';

        broadcastAppointmentChange({
          appointmentId: updated.id,
          clinicId: updated.clinicId,
          doctorId: updated.doctorId || undefined,
          patientId: updated.patientId,
          action,
          performerUserId: performerUserId || 'system',
          data: {
            appointmentStatus: updated.appointmentStatus,
            appointmentDate: updated.appointmentDate,
            appointmentTime: updated.appointmentTime,
          },
        });
      }

      // Every dashboard cache is versioned per clinic and retired after commit:
      // by `signalAppointmentChange`, or below when an edit sends no signal.

      // No SMS/WhatsApp on a plain edit: the patient is messaged once when the
      // appointment is booked, and again only if it is rescheduled. Editing
      // unrelated fields must not re-notify them.

      return updated;
    });

    // ─── Patient notifications: post-commit, fire-and-forget ────────────────
    // These reach out to SMS/WhatsApp providers, so they run once the row is
    // committed rather than holding the transaction open for a network call.
    if (updated && notificationsEnabled()) {
      void AppointmentService.dispatchUpdateNotifications(
        updated,
        payload,
        performerUserId
      ).catch((err: Error) => {
        logger.error(
          `Failed to dispatch update notifications for appointment ${updated.id}: ${err.message}`
        );
      });
    }

    // ─── Appointment Engine: fire-and-forget post-commit hook ───────────────
    // The orchestrator handles all errors internally and never throws.
    if (
      updated &&
      previousAppointmentStatus &&
      payload.appointmentStatus &&
      payload.appointmentStatus !== previousAppointmentStatus
    ) {
      const engineRecord: AppointmentRecord = {
        id: updated.id,
        appointmentDate: updated.appointmentDate,
        appointmentTime: updated.appointmentTime,
        tokenNo: updated.tokenNo,
        appointmentStatus: updated.appointmentStatus as AppointmentStatus,
        clinicId: updated.clinicId,
        patientId: updated.patientId,
        doctorId: updated.doctorId!,
        appointmentDurationMinutes: updated.appointmentDurationMinutes ?? null,
        userId: updated.patientId, // patientId references UserModel.id
      };

      const orchestrator = new AppointmentEngineOrchestrator();
      orchestrator
        .onStatusChange(
          engineRecord,
          previousAppointmentStatus as AppointmentStatus
        )
        .catch((err) => {
          logger.error(
            `[AppointmentEngine] Post-commit orchestrator hook failed for appointment=${updated.id}`,
            { error: err }
          );
        });
    }

    // ─── Arriving clears any hold ───────────────────────────────────────────
    // "On hold" means not available right now; walking in contradicts it, and
    // a hold written before arrival would otherwise fire on check-in and drop
    // the patient straight into Paused. `sendIn` clears it for the same reason.
    if (
      updated?.doctorId &&
      payload.appointmentStatus === 'Patient Arrived' &&
      previousAppointmentStatus !== 'Patient Arrived'
    ) {
      const arrivalDate = getISTDateString(
        updated.appointmentDate instanceof Date
          ? updated.appointmentDate
          : new Date(updated.appointmentDate)
      );
      // Awaited: the signal goes out below and every screen refetches on it,
      // so losing this race would show the patient as held everywhere.
      try {
        await resumeAppointment(
          updated.clinicId,
          updated.doctorId,
          arrivalDate,
          updated.id
        );
      } catch (err) {
        logger.warn(
          `[Queue] Failed to clear hold on check-in for appointment=${updated.id}`,
          err
        );
      }
    }

    // ─── A doctor confirming an appointment takes the room ──────────────────
    // The room is a pointer, not a status, so confirming from the appointment
    // page would otherwise leave the board showing the previous patient.
    // Whoever they were with is parked. Doctors and admins only: reception
    // confirming a booking says nothing about who is in the room.
    if (
      updated?.doctorId &&
      payload.appointmentStatus === 'Confirmed' &&
      previousAppointmentStatus !== 'Confirmed' &&
      (performerUserType === 'Doctor' || performerUserType === 'Admin')
    ) {
      const roomDate = getISTDateString(
        updated.appointmentDate instanceof Date
          ? updated.appointmentDate
          : new Date(updated.appointmentDate)
      );
      try {
        const displaced = await getCurrentAppointmentId(
          updated.clinicId,
          updated.doctorId,
          roomDate
        );
        if (displaced && displaced !== updated.id) {
          await holdAppointment(
            updated.clinicId,
            updated.doctorId,
            roomDate,
            displaced,
            'held'
          );
          // The room changing hands ends whatever was running, so record when.
          // Same reason as QueueService.putInRoom: without a real end instant
          // the projection falls back to the planned length, and a doctor who
          // finishes early frees time no waiting patient is ever told about.
          await setConsultationEndedAt(
            updated.clinicId,
            updated.doctorId,
            roomDate,
            new Date().toISOString()
          );
        }
        // Confirming supersedes any hold on the patient being taken in.
        await resumeAppointment(
          updated.clinicId,
          updated.doctorId,
          roomDate,
          updated.id
        );
        await setCurrentAppointment(
          updated.clinicId,
          updated.doctorId,
          roomDate,
          updated.id
        );
        // The instant the consultation began — the same stamp
        // `QueueService.putInRoom` writes, since this is that event by another
        // route. Without it the card showed "In the room" with no elapsed time.
        await setConsultationStartedAt(
          updated.clinicId,
          updated.doctorId,
          roomDate,
          new Date().toISOString()
        );
      } catch (err) {
        logger.warn(
          `[Queue] Failed to move the room on confirm for appointment=${updated.id}`,
          err
        );
      }

      // Fallback: confirming implies the doctor is in. No-ops if already recorded.
      void DoctorArrivalService.autoMarkOnConfirm(
        updated.clinicId,
        updated.doctorId,
        updated.doctorId,
        updated
      ).catch((err) => {
        logger.warn(
          `[DoctorArrival] auto-mark-on-confirm failed for appointment=${updated.id}`,
          err
        );
      });
    }

    // ─── A terminal status empties the room ─────────────────────────────────
    // Awaited before the signal below: a detached clear can land after screens
    // have already refetched a queue still naming this row as the occupant.
    if (
      updated?.doctorId &&
      payload.appointmentStatus &&
      payload.appointmentStatus !== previousAppointmentStatus &&
      ['Completed', 'Cancelled', 'NoShow'].includes(payload.appointmentStatus)
    ) {
      await endConsultationIfOccupant(
        updated.clinicId,
        updated.doctorId,
        getISTDateString(
          updated.appointmentDate instanceof Date
            ? updated.appointmentDate
            : new Date(updated.appointmentDate)
        ),
        updated.id
      );
    }

    // Realtime: fires on a status change, reschedule, clinical-only edit, or
    // payment-only edit. A reschedule keeps the status but moves queue
    // position, and clinical/payment-only edits change neither status nor date
    // — without those flags they never signalled, so an open screen went stale.
    if (updated) {
      const statusChanged = Boolean(
        payload.appointmentStatus &&
        previousAppointmentStatus &&
        payload.appointmentStatus !== previousAppointmentStatus
      );
      // A token moved into another shift is a reschedule too, even on the same
      // day: without this the move saved but no open screen was told.
      const rescheduled = Boolean(
        payload.appointmentDate ||
        payload.appointmentTime ||
        typeof payload.tokenNo !== 'undefined' ||
        typeof payload.sessionIndex !== 'undefined'
      );

      if (statusChanged || rescheduled || clinicalChanged || paymentChanged) {
        const reason = statusChanged
          ? `appointment.${String(updated.appointmentStatus)
              .toLowerCase()
              .replace(/\s+/g, '_')}`
          : rescheduled
            ? 'appointment.rescheduled'
            : paymentChanged
              ? 'billing.payment_updated'
              : 'encounter.vitals_updated';

        signalAppointmentChange(
          updated,
          reason,
          rescheduled ? previousAppointmentDate : null
        );
      } else {
        // A quiet edit (type, notes) still changes what dashboards list.
        void invalidateClinicDashboardCaches(updated.clinicId);
      }

      // Payment recorded, so clear the action-required notification for the
      // whole desk at once by collapse key rather than per receptionist.
      // Fire-and-forget: a notification that fails to clear must never fail
      // the payment that already committed.
      if (paymentChanged) {
        void resolveByCollapseKey(
          `appointment:${updated.id}`,
          performerUserId ?? null
        ).catch((err) => {
          logger.warn(
            `[Notifications] Failed to auto-resolve for appointment=${updated.id}`,
            { error: err }
          );
        });
      }

      // Consultation finished — tell the desk, which otherwise only finds out
      // by watching the board. Hung off statusChanged so re-saving an already
      // Completed appointment doesn't re-announce it; the performer is excluded
      // by the event's own recipient rule. Gated on the registry flag.
      if (
        envConfig.NOTIFICATIONS_REGISTRY_ENABLED &&
        statusChanged &&
        updated.appointmentStatus === 'Completed'
      ) {
        await notify('consultation.completed', {
          appointmentId: updated.id,
          clinicId: updated.clinicId,
          doctorId: updated.doctorId,
          patientId: updated.patientId,
          performerUserId: performerUserId ?? null,
        });
      }
    }

    return updated;
  }

  static async upsertDoctorManualPrescription(
    doctorId: string,
    appointmentId: string,
    doctorManualPrescription?: string | null
  ) {
    try {
      const [appointment] = await database
        .select({
          id: AppointmentModel.id,
          doctorId: AppointmentModel.doctorId,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          tokenNo: AppointmentModel.tokenNo,
          appointmentStatus: AppointmentModel.appointmentStatus,
          clinicId: AppointmentModel.clinicId,
          patientId: AppointmentModel.patientId,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
        })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.id, appointmentId),
            eq(AppointmentModel.doctorId, doctorId)
          )
        )
        .limit(1);

      if (!appointment) {
        throw new HttpError(
          403,
          'You can only add prescriptions to your own appointments'
        );
      }

      const existingdoctorManualPrescription = await database
        .select()
        .from(doctorManualPrescriptionModel)
        .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
        .limit(1);

      const now = new Date();
      const isFirstUpload = existingdoctorManualPrescription.length === 0;

      if (
        existingdoctorManualPrescription.length > 0 &&
        doctorManualPrescription
      ) {
        const oldFilePath =
          existingdoctorManualPrescription[0].doctorManualPrescription;
        if (oldFilePath) {
          try {
            await deleteFromS3(oldFilePath);
          } catch {
            logger.warn('Failed to delete old prescription');
          }
        }
      }

      if (existingdoctorManualPrescription.length > 0) {
        const updateData: any = {
          updatedAt: now,
        };

        if (doctorManualPrescription !== undefined) {
          updateData.doctorManualPrescription = doctorManualPrescription;
        }

        const [updatedPrescription] = await database
          .update(doctorManualPrescriptionModel)
          .set(updateData)
          .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
          .returning();

        // Replacing a prescription changes what the consultation screen shows,
        // so it signals like any clinical edit. Only the first-upload branch
        // did, so re-uploading left an open encounter on the old prescription.
        signalAppointmentChange(appointment, 'encounter.vitals_updated');

        return updatedPrescription;
      } else {
        const [newTemplate] = await database
          .insert(doctorManualPrescriptionModel)
          .values({
            appointmentId,
            doctorManualPrescription: doctorManualPrescription || null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (isFirstUpload) {
          try {
            await PrescriptionQueueService.createEntry({
              appointmentId,
              doctorId,
              clinicId: appointment.clinicId,
            });
          } catch (err) {
            logger.warn(
              `Failed to seed prescription_queue entry for manual prescription upload, appointment=${appointmentId}`,
              { error: err }
            );
          }

          await database
            .update(AppointmentModel)
            .set({
              appointmentStatus: 'Completed',
              updatedAt: now,
            })
            .where(eq(AppointmentModel.id, appointmentId));

          // This path completes without going through `updateAppointment`,
          // where other status changes get their activity row. Without it a
          // prescription-upload finish left no COMPLETED entry, so
          // ConsultationDurationService never saw the consultation.
          await AppointmentActivityHistoryService.logActivity({
            appointmentId,
            action: 'COMPLETED',
            performedBy: doctorId,
            remarks: 'Appointment completed on prescription upload',
          });

          // ─── Appointment Engine: fire-and-forget post-commit hook ───────────────
          if (appointment.doctorId) {
            // Awaited before the signal below, same reason as in
            // `updateAppointment`: the engine's hook is detached.
            await endConsultationIfOccupant(
              appointment.clinicId,
              appointment.doctorId,
              getISTDateString(
                appointment.appointmentDate instanceof Date
                  ? appointment.appointmentDate
                  : new Date(appointment.appointmentDate)
              ),
              appointment.id
            );

            const engineRecord: AppointmentRecord = {
              id: appointment.id,
              appointmentDate: appointment.appointmentDate,
              appointmentTime: appointment.appointmentTime,
              tokenNo: appointment.tokenNo,
              appointmentStatus: 'Completed' as AppointmentStatus,
              clinicId: appointment.clinicId,
              patientId: appointment.patientId,
              doctorId: appointment.doctorId,
              appointmentDurationMinutes:
                appointment.appointmentDurationMinutes ?? null,
              userId: appointment.patientId,
            };

            const orchestrator = new AppointmentEngineOrchestrator();
            orchestrator
              .onStatusChange(
                engineRecord,
                appointment.appointmentStatus as AppointmentStatus
              )
              .catch((err) => {
                logger.error(
                  `[AppointmentEngine] Post-commit orchestrator hook failed for auto-completed appointment=${appointmentId}`,
                  { error: err }
                );
              });

            // The doctor finishing a prescription is the single most important
            // moment for the reception board — it is what promotes the next
            // patient — so it signals exactly like an explicit status change.
            signalAppointmentChange(appointment, 'appointment.completed');
          }
        }

        return newTemplate;
      }
    } catch {
      throw new HttpError(500, 'An unexpected error occurred');
    }
  }

  static async sendManualPrescriptionNotification(
    doctorId: string,
    appointmentId: string,
    otp: string
  ) {
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, appointmentId),
          eq(AppointmentModel.doctorId, doctorId)
        )
      )
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found or not assigned to you');
    }

    const doctorDevices = await database
      .select()
      .from(UserDevicesModel)
      .where(eq(UserDevicesModel.userId, doctorId));

    if (doctorDevices.length === 0) {
      throw new HttpError(
        400,
        'No registered mobile devices found. Please log in to the Medisetu app on your phone to receive notifications.'
      );
    }

    const [patient] = await database
      .select({ name: UserModel.name })
      .from(UserModel)
      .where(eq(UserModel.id, appointment.patientId))
      .limit(1);

    const patientName = patient?.name || 'Patient';
    const uploadUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/doctor/upload-manual-prescription?appointmentId=${appointmentId}`;

    await sendNotificationToUser({
      userId: doctorId,
      title: 'Upload Manual Prescription',
      body: `Tap here to upload the manual prescription for ${patientName}`,
      type: 'prescription_upload',
      allowToStoreInDB: false,
      metadata: {
        action: 'upload_manual_prescription',
        otp: otp,
        appointmentId: appointmentId,
        url: uploadUrl,
      },
    });
  }

  static async updateConsentFile(
    id: string,
    consentFile: string,
    clinicId: string
  ) {
    await AppointmentService.assertAppointmentInClinic(id, clinicId);

    const result = await database.transaction(async (trx) => {
      // Upsert into clinical table
      const [existingClinical] = await trx
        .select()
        .from(AppointmentClinicalModel)
        .where(eq(AppointmentClinicalModel.appointmentId, id));

      if (existingClinical) {
        await trx
          .update(AppointmentClinicalModel)
          .set({
            consentFile: consentFile,
            updatedAt: new Date(),
          })
          .where(eq(AppointmentClinicalModel.appointmentId, id));
      } else {
        await trx.insert(AppointmentClinicalModel).values({
          appointmentId: id,
          consentFile: consentFile,
        });
      }

      // Also update the main appointment's updatedAt
      const [updatedAppointment] = await trx
        .update(AppointmentModel)
        .set({
          updatedAt: new Date(),
        })
        .where(eq(AppointmentModel.id, id))
        .returning();

      return {
        appointment: updatedAppointment,
      };
    });

    // Another clinical-fields write that previously never signalled — same
    // gap as the vitals path in updateAppointment above.
    if (result.appointment) {
      signalAppointmentChange(result.appointment, 'encounter.vitals_updated');
    }

    return result;
  }

  static async getAppointmentPaymentTransactions(
    query: GetAppointmentPaymentsDto,
    user: any,
    clinicId: string
  ) {
    return await database.transaction(async (tx) => {
      // Check authorization
      if (
        !['Admin', 'Doctor', 'Receptionist', 'Super_Admin'].includes(
          user.userType
        )
      ) {
        throw new HttpError(
          403,
          'Access denied. Only Admin, Doctor, and Receptionist can access this resource.'
        );
      }

      const conditions = [];

      // Exclude unpaid pending online checkouts
      conditions.push(buildActiveAppointmentFilter());

      // Clinic filter
      conditions.push(eq(AppointmentModel.clinicId, clinicId));

      // Role-based filtering
      if (user.userType === 'Doctor') {
        conditions.push(eq(AppointmentModel.doctorId, user.id));
      }

      // Payment status filter - include all relevant statuses
      if (query.paymentStatus) {
        const inputStatuses = Array.isArray(query.paymentStatus)
          ? query.paymentStatus
          : [query.paymentStatus];
        const paymentStatuses: string[] = [];
        for (const s of inputStatuses) {
          paymentStatuses.push(s);
          paymentStatuses.push(s.toLowerCase());
          paymentStatuses.push(s.toUpperCase());
          const camel = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
          if (!paymentStatuses.includes(camel)) {
            paymentStatuses.push(camel);
          }
        }
        conditions.push(
          inArray(AppointmentPaymentModel.paymentStatus, paymentStatuses)
        );
      } else {
        // Default: money the clinic actually took — Paid and Refunded only,
        // the same set `DashboardService.getRevenueOverview` uses so the two
        // cannot disagree. "Pending" is a due, "Already Paid" was collected
        // elsewhere; both stay reachable via an explicit paymentStatus filter.
        conditions.push(
          inArray(AppointmentPaymentModel.paymentStatus, [
            'Paid',
            'paid',
            'PAID',
            'Refunded',
            'refunded',
            'REFUNDED',
          ])
        );
      }

      // Doctor filter
      if (query.doctorId) {
        const doctorIds = Array.isArray(query.doctorId)
          ? query.doctorId
          : [query.doctorId];
        conditions.push(inArray(AppointmentModel.doctorId, doctorIds));
      }

      // Patient filter
      if (query.patientId) {
        const patientIds = Array.isArray(query.patientId)
          ? query.patientId
          : [query.patientId];
        conditions.push(inArray(AppointmentModel.patientId, patientIds));
      }

      // Date filtering
      let start: Date, end: Date;

      if (query.startDate) {
        start = new Date(query.startDate);
        start.setHours(0, 0, 0, 0);
      } else {
        start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
      }

      if (query.endDate) {
        end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        end = new Date();
        end.setHours(23, 59, 59, 999);
      }

      conditions.push(gte(AppointmentModel.appointmentDate, start));
      conditions.push(lte(AppointmentModel.appointmentDate, end));

      // Aliases for joins
      const patientUser = alias(UserModel, 'patientUser');
      const doctorUser = alias(UserModel, 'doctorUser');

      // Search condition
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        const isGenericKeyword = [
          'credit',
          'debit',
          'primary',
          'additional',
        ].some((kw) => searchLower.includes(kw) || kw.includes(searchLower));

        if (!isGenericKeyword) {
          const searchPattern = `%${searchLower}%`;
          conditions.push(
            sql`(
              lower(${patientUser.name}) LIKE ${searchPattern} OR 
              lower(${doctorUser.name}) LIKE ${searchPattern} OR 
              lower(${ClinicServiceModel.serviceName}) LIKE ${searchPattern} OR
              ${patientUser.mobile} LIKE ${searchPattern} OR
              lower(${AppointmentPaymentModel.transactionId}) LIKE ${searchPattern} OR
              lower(cast(${AppointmentModel.id} as text)) LIKE ${searchPattern}
            )`
          );
        }
      }

      // Fetch all appointments that match the criteria
      const appointments = await tx
        .select({
          id: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,
          createdAt: AppointmentModel.createdAt,
          paymentUpdatedAt: AppointmentPaymentModel.updatedAt,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          paymentMode: AppointmentPaymentModel.paymentMode,
          refundMode: AppointmentPaymentModel.refundMode,
          refundedAmount: AppointmentPaymentModel.refundedAmount,
          refundNotes: AppointmentPaymentModel.refundNotes,
          primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
          price: AppointmentPaymentModel.price,
          transactionId: AppointmentPaymentModel.transactionId,
          gatewayOrderId: AppointmentPaymentModel.gatewayOrderId,
          gatewayResponse: AppointmentPaymentModel.gatewayResponse,
          serviceId: ClinicServiceModel.id,
          serviceName: ClinicServiceModel.serviceName,
          doctorId: doctorUser.id,
          doctorName: doctorUser.name,
          doctorSpeciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          patientId: patientUser.id,
          patientName: patientUser.name,
          patientMobile: patientUser.mobile,
        })
        .from(AppointmentModel)
        .innerJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .leftJoin(patientUser, eq(AppointmentModel.patientId, patientUser.id))
        .leftJoin(doctorUser, eq(AppointmentModel.doctorId, doctorUser.id))
        .leftJoin(
          ClinicServiceModel,
          eq(AppointmentModel.clinicServiceId, ClinicServiceModel.id)
        )
        .where(and(...conditions))
        .orderBy(desc(AppointmentModel.createdAt));

      // Fetch additional services for ALL appointments that might need them
      const allAppointmentIds = appointments.map((apt) => apt.id);
      const additionalServicesMap = new Map<string, any[]>();

      if (allAppointmentIds.length > 0) {
        const additionalServices = await tx
          .select({
            appointmentId: appointmentMultipleService.appointmentId,
            serviceId: appointmentMultipleService.serviceId,
            serviceName: ClinicServiceModel.serviceName,
            price: appointmentMultipleService.price,
            paymentMode: appointmentMultipleService.paymentMode,
            payment_notes: appointmentMultipleService.payment_notes,
            createdAt: appointmentMultipleService.createdAt,
          })
          .from(appointmentMultipleService)
          .leftJoin(
            ClinicServiceModel,
            eq(appointmentMultipleService.serviceId, ClinicServiceModel.id)
          )
          .where(
            inArray(appointmentMultipleService.appointmentId, allAppointmentIds)
          );

        additionalServices.forEach((service) => {
          if (!additionalServicesMap.has(service.appointmentId)) {
            additionalServicesMap.set(service.appointmentId, []);
          }
          additionalServicesMap.get(service.appointmentId)!.push(service);
        });
      }

      // Transform appointments into payment transactions
      let transactions: PaymentTransaction[] = [];

      appointments.forEach((appointment) => {
        const additionalServices =
          additionalServicesMap.get(appointment.id) || [];
        const statusLower = appointment.paymentStatus?.toLowerCase();

        if (statusLower === 'paid' || statusLower === 'pending') {
          // Credit entry for primary service (using primaryServicePrice, NOT price)
          const primaryPrice =
            Number(appointment.primaryServicePrice) ||
            Number(appointment.price) ||
            0;

          if (primaryPrice > 0) {
            transactions.push({
              patientName: appointment.patientName || 'Unknown',
              patientMobile: appointment.patientMobile || 'N/A',
              doctorName: appointment.doctorName || 'Unknown',
              doctorSpeciality: appointment.doctorSpeciality || 'General',
              serviceName: appointment.serviceName || 'Consultation',
              appointmentDate:
                appointment.appointmentDate || appointment.createdAt,
              transactionTimestamp: appointment.createdAt,
              price: primaryPrice,
              entryType: 'Credit',
              paymentStatus: statusLower === 'pending' ? 'Pending' : 'Paid',
              paymentMode: appointment.paymentMode || 'Unknown',
              transactionId: `CREDIT-PRIMARY-${appointment.id}`,
              originalAppointmentId: appointment.id,
              gatewayTransactionId: appointment.transactionId || undefined,
            });
          }

          // Credit entries for additional services
          additionalServices.forEach((service, index) => {
            const servicePrice = Number(service.price) || 0;
            if (servicePrice > 0) {
              transactions.push({
                patientName: appointment.patientName || 'Unknown',
                patientMobile: appointment.patientMobile || 'N/A',
                doctorName: appointment.doctorName || 'Unknown',
                doctorSpeciality: appointment.doctorSpeciality || 'General',
                serviceName: service.serviceName || `Additional Service`,
                appointmentDate:
                  appointment.appointmentDate || appointment.createdAt,
                transactionTimestamp: appointment.createdAt,
                price: servicePrice,
                entryType: 'Credit',
                paymentStatus: statusLower === 'pending' ? 'Pending' : 'Paid',
                paymentMode:
                  service.paymentMode || appointment.paymentMode || 'Unknown',
                transactionId: `CREDIT-ADDITIONAL-${appointment.id}-${index}`,
                originalAppointmentId: appointment.id,
                gatewayTransactionId: appointment.transactionId || undefined,
              });
            }
          });
        } else if (statusLower === 'refunded') {
          // Credit entry for primary service (original payment)
          const primaryPrice = Number(appointment.primaryServicePrice) || 0;

          if (primaryPrice > 0) {
            transactions.push({
              patientName: appointment.patientName || 'Unknown',
              patientMobile: appointment.patientMobile || 'N/A',
              doctorName: appointment.doctorName || 'Unknown',
              doctorSpeciality: appointment.doctorSpeciality || 'General',
              serviceName: appointment.serviceName || 'Consultation',
              appointmentDate:
                appointment.appointmentDate || appointment.createdAt,
              transactionTimestamp: appointment.createdAt,
              price: primaryPrice,
              entryType: 'Credit',
              paymentStatus: 'Paid',
              paymentMode: appointment.paymentMode || 'Unknown',
              transactionId: `CREDIT-PRIMARY-${appointment.id}`,
              originalAppointmentId: appointment.id,
              gatewayTransactionId: appointment.transactionId || undefined,
            });
          }

          // Credit entries for additional services (original payments)
          additionalServices.forEach((service, index) => {
            const servicePrice = Number(service.price) || 0;
            if (servicePrice > 0) {
              transactions.push({
                patientName: appointment.patientName || 'Unknown',
                patientMobile: appointment.patientMobile || 'N/A',
                doctorName: appointment.doctorName || 'Unknown',
                doctorSpeciality: appointment.doctorSpeciality || 'General',
                serviceName: service.serviceName || `Additional Service`,
                appointmentDate:
                  appointment.appointmentDate || appointment.createdAt,
                transactionTimestamp: appointment.createdAt,
                price: servicePrice,
                entryType: 'Credit',
                paymentStatus: 'Paid',
                paymentMode:
                  service.paymentMode || appointment.paymentMode || 'Unknown',
                transactionId: `CREDIT-ADDITIONAL-${appointment.id}-${index}`,
                originalAppointmentId: appointment.id,
                gatewayTransactionId: appointment.transactionId || undefined,
              });
            }
          });

          // Debit entry for refund (using refundedAmount)
          const refundAmount = appointment.refundedAmount
            ? parseFloat(appointment.refundedAmount)
            : primaryPrice +
              additionalServices.reduce(
                (sum, s) => sum + (Number(s.price) || 0),
                0
              );

          if (refundAmount > 0) {
            transactions.push({
              patientName: appointment.patientName || 'Unknown',
              patientMobile: appointment.patientMobile || 'N/A',
              doctorName: appointment.doctorName || 'Unknown',
              doctorSpeciality: appointment.doctorSpeciality || 'General',
              serviceName: 'Refund',
              appointmentDate:
                appointment.appointmentDate || appointment.createdAt,
              transactionTimestamp:
                appointment.paymentUpdatedAt || appointment.createdAt,
              price: refundAmount,
              entryType: 'Debit',
              paymentStatus: 'Refunded',
              refundMode:
                appointment.refundMode || appointment.paymentMode || 'Unknown',
              refundNotes: appointment.refundNotes || 'Refund processed',
              transactionId: `DEBIT-${appointment.id}`,
              originalAppointmentId: appointment.id,
              gatewayTransactionId: appointment.transactionId || undefined,
            });
          }
        } else if (statusLower === 'already paid') {
          // For "Already Paid" appointments: ONLY capture additional service entries
          // Primary service is NOT included since it was paid elsewhere

          additionalServices.forEach((service, index) => {
            const servicePrice = Number(service.price) || 0;
            if (servicePrice > 0) {
              transactions.push({
                patientName: appointment.patientName || 'Unknown',
                patientMobile: appointment.patientMobile || 'N/A',
                doctorName: appointment.doctorName || 'Unknown',
                doctorSpeciality: appointment.doctorSpeciality || 'General',
                serviceName: service.serviceName || `Additional Service`,
                appointmentDate:
                  appointment.appointmentDate || appointment.createdAt,
                transactionTimestamp: appointment.createdAt,
                price: servicePrice,
                entryType: 'Credit',
                paymentStatus: 'Already Paid',
                paymentMode: service.paymentMode || 'Unknown',
                transactionId: `ADDITIONAL-CREDIT-${appointment.id}-${index}`,
                originalAppointmentId: appointment.id,
                gatewayTransactionId: appointment.transactionId || undefined,
              });
            }
          });
        }
      });

      // Filter out transactions with invalid payment modes
      transactions = transactions.filter((t) => {
        const mode = t.entryType === 'Credit' ? t.paymentMode : t.refundMode;
        return mode && mode !== 'Not Required';
      });

      // Filter by search query on transactions
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        transactions = transactions.filter((t) => {
          return (
            t.patientName.toLowerCase().includes(searchLower) ||
            t.patientMobile.toLowerCase().includes(searchLower) ||
            t.doctorName.toLowerCase().includes(searchLower) ||
            t.doctorSpeciality.toLowerCase().includes(searchLower) ||
            t.serviceName.toLowerCase().includes(searchLower) ||
            (t.transactionId &&
              t.transactionId.toLowerCase().includes(searchLower)) ||
            (t.gatewayTransactionId &&
              t.gatewayTransactionId.toLowerCase().includes(searchLower)) ||
            (t.paymentMode &&
              t.paymentMode.toLowerCase().includes(searchLower)) ||
            (t.refundMode && t.refundMode.toLowerCase().includes(searchLower))
          );
        });
      }

      // Filter by payment mode.
      // Stored mode strings are historically inconsistent (e.g. "PayLater",
      // "Pay Later", "pay later"), so match on a normalized key (lowercased,
      // whitespace removed) rather than an exact string — otherwise a valid
      // selection silently returns zero rows.
      if (query.paymentMode) {
        const normalizeMode = (m?: string | null) =>
          (m || '').toLowerCase().replace(/\s+/g, '');

        const requestedModes = (
          Array.isArray(query.paymentMode)
            ? query.paymentMode
            : [query.paymentMode]
        ).map(normalizeMode);

        transactions = transactions.filter((t) => {
          if (t.entryType === 'Credit') {
            return requestedModes.includes(normalizeMode(t.paymentMode));
          } else if (t.entryType === 'Debit') {
            return requestedModes.includes(normalizeMode(t.refundMode));
          }
          return true;
        });
      }

      // Filter by entry type
      if (query.entryType) {
        transactions = transactions.filter(
          (t) => t.entryType === query.entryType
        );
      }

      // Calculate summary statistics.
      // Money amounts count only *collected* credit — a Pending (Pay Later)
      // entry is a due, not a receipt, so it never contributes to credit or
      // net. It is reported separately as `totalPendingAmount`.
      const isCollectedCredit = (t: PaymentTransaction) =>
        t.entryType === 'Credit' && t.paymentStatus !== 'Pending';

      const summary = {
        totalCreditAmount: transactions
          .filter(isCollectedCredit)
          .reduce((sum, t) => sum + t.price, 0),
        totalDebitAmount: transactions
          .filter((t) => t.entryType === 'Debit')
          .reduce((sum, t) => sum + t.price, 0),
        // Credit that is booked but not yet actually collected (Pay Later /
        // Pending). Surfaced separately so the UI doesn't present uncollected
        // dues as money already received.
        totalPendingAmount: transactions
          .filter(
            (t) => t.entryType === 'Credit' && t.paymentStatus === 'Pending'
          )
          .reduce((sum, t) => sum + t.price, 0),
        netAmount: transactions.reduce((sum, t) => {
          if (isCollectedCredit(t)) return sum + t.price;
          if (t.entryType === 'Debit') return sum - t.price;
          return sum;
        }, 0),
        totalTransactions: transactions.length,
        creditTransactions: transactions.filter((t) => t.entryType === 'Credit')
          .length,
        debitTransactions: transactions.filter((t) => t.entryType === 'Debit')
          .length,
        paymentModeSummary: {
          credit: transactions.filter(isCollectedCredit).reduce(
            (acc, t) => {
              const mode = t.paymentMode || 'Unknown';
              acc[mode] = (acc[mode] || 0) + t.price;
              return acc;
            },
            {} as Record<string, number>
          ),
          debit: transactions
            .filter((t) => t.entryType === 'Debit')
            .reduce(
              (acc, t) => {
                const mode = t.refundMode || 'Unknown';
                acc[mode] = (acc[mode] || 0) + t.price;
                return acc;
              },
              {} as Record<string, number>
            ),
        },
      };

      transactions.sort(
        (a, b) =>
          new Date(b.transactionTimestamp).getTime() -
          new Date(a.transactionTimestamp).getTime()
      );

      // Apply pagination
      const pageSize = Math.max(Number(query.pageSize) || 100, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      const paginatedTransactions = transactions.slice(offset, offset + limit);
      const totalRecords = transactions.length;
      const totalPages = Math.ceil(totalRecords / pageSize);

      return {
        data: paginatedTransactions,
        summary,
        metadata: {
          totalRecords,
          totalPages,
          currentPage: pageNumber,
          pageSize,
          dateRange: {
            start,
            end,
          },
        },
      };
    });
  }

  static escapeLike(s: string) {
    return s.replace(/[%_\\]/g, (m) => `\\${m}`);
  }

  // get all clinic appointments
  private static async findPaymentCollector(
    trx: DbTransaction,
    appointmentId: string
  ): Promise<string | null> {
    const [row] = await trx
      .select({ name: UserModel.name })
      .from(AppointmentActivityHistoryModel)
      .leftJoin(
        UserModel,
        eq(UserModel.id, AppointmentActivityHistoryModel.performedBy)
      )
      .where(
        and(
          eq(AppointmentActivityHistoryModel.appointmentId, appointmentId),
          eq(AppointmentActivityHistoryModel.action, 'PAYMENT_STATUS')
        )
      )
      .orderBy(desc(AppointmentActivityHistoryModel.createdAt))
      .limit(1);

    return row?.name ?? null;
  }

  static async getAllClinicAppointments(
    clinicId: string,
    query: appointmentQueryDto,
    user: AuthUser
  ) {
    // An out-of-scope doctorId is a 403 rather than a silently empty list, so
    // a receptionist is told why they cannot see another doctor's schedule.
    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      user,
      clinicId
    );
    if (query.doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        user,
        clinicId,
        query.doctorId
      );
    }

    return await database.transaction(async (trx) => {
      const pageSize = Math.max(Number(query?.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query?.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      // Build where clause safely
      const whereClauses: any[] = [];

      if (user.userType === 'Patient')
        whereClauses.push(eq(AppointmentModel.patientId, user.id));
      if (user.userType === 'Doctor')
        whereClauses.push(eq(AppointmentModel.doctorId, user.id));
      if (user.userType === 'Admin' || user.userType === 'Receptionist')
        whereClauses.push(eq(AppointmentModel.clinicId, clinicId));

      // Allow Admin and Receptionist to filter by doctorId
      if (
        (user.userType === 'Admin' || user.userType === 'Receptionist') &&
        query.doctorId
      ) {
        whereClauses.push(eq(AppointmentModel.doctorId, query.doctorId));
      }

      const scopeFilter = doctorScopeFilter(
        AppointmentModel.doctorId,
        allowedDoctorIds
      );
      if (scopeFilter) whereClauses.push(scopeFilter);

      {
        const now = new Date();
        let start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0
        );
        let end = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999
        );
        if (query.startDate) {
          const [sy, sm, sd] = query.startDate.split('-').map(Number);
          start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
          if (!query.endDate) {
            end = new Date(sy, sm - 1, sd, 23, 59, 59, 999);
          }
        }
        if (query.endDate) {
          const [ey, em, ed] = query.endDate.split('-').map(Number);
          end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
        }
        whereClauses.push(gte(AppointmentModel.appointmentDate, start));
        whereClauses.push(lte(AppointmentModel.appointmentDate, end));
      }

      whereClauses.push(buildActiveAppointmentFilter());

      const patientUser = alias(UserModel, 'patientUser');
      const doctorUser = alias(UserModel, 'doctorUser');

      if (query?.search) {
        const raw = String(query.search).trim();
        if (raw.length > 0) {
          const terms = raw.split(/\s+/).slice(0, 5);
          const termConditions = terms.map((term) => {
            const escaped = this.escapeLike(term);
            const pattern = `%${escaped}%`.toLowerCase();
            const byName = sql`lower(${patientUser.name}) LIKE ${pattern}`;
            const byEmail = sql`lower(${patientUser.email}) LIKE ${pattern}`;
            const byMobile = sql`lower(${patientUser.mobile}) LIKE ${pattern}`;
            const byAltMobile = sql`lower((SELECT alternate_mobile FROM user_profiles WHERE user_id = ${patientUser.id})) LIKE ${pattern}`;
            const byAppointmentType = sql`lower(${AppointmentModel.appointmentType}) LIKE ${pattern}`;
            const byAppointmentStatus = sql`lower(CAST(${AppointmentModel.appointmentStatus} AS text)) LIKE ${pattern}`;
            return or(
              byName,
              byEmail,
              byMobile,
              byAltMobile,
              byAppointmentType,
              byAppointmentStatus
            );
          });
          if (termConditions.length === 1) {
            whereClauses.push(termConditions[0]);
          } else if (termConditions.length > 1) {
            whereClauses.push(and(...termConditions));
          }
        }
      }

      // Removed standalone patient name search in favor of above multi-field search

      // Kept separate from `whereClauses` so the status-breakdown query below
      // can reuse every other filter (clinic/doctor/date/search) without the
      // status filter itself — otherwise the "All"/tab counts would always
      // just reflect whichever single status is currently selected, which is
      // what made the dropdown counts look broken/inconsistent on the FE.
      const baseWhereClauses = [...whereClauses];

      if (query?.appointmentStatus) {
        const raw = Array.isArray(query.appointmentStatus)
          ? query.appointmentStatus
          : [query.appointmentStatus];
        const normalized = raw
          .flatMap((s) => (typeof s === 'string' ? s.split(',') : s))
          .map((s) => String(s).trim())
          .filter((s) =>
            [
              'Upcoming',
              'Completed',
              'Cancelled',
              'Rescheduled',
              'Patient Arrived',
              'Pending',
              'Missed',
              'Confirmed',
              'NoShow',
            ].includes(s)
          );
        if (normalized.length > 0) {
          whereClauses.push(
            inArray(AppointmentModel.appointmentStatus, normalized as any)
          );
        }
      }

      // total count of appointments matching the criteria
      const totalRecords = await trx
        .select({ count: sql`COUNT(${AppointmentModel.id})` })
        .from(AppointmentModel)
        .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(and(...whereClauses));

      const totalCount = Number(totalRecords?.[0]?.count ?? 0) || 0;
      const totalPages =
        totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

      // Per-status breakdown for the "Status - All (N)" tab dropdown —
      // computed against baseWhereClauses (no status filter) so the counts
      // stay stable regardless of which tab is currently selected.
      const statusBreakdownRows = await trx
        .select({
          status: AppointmentModel.appointmentStatus,
          count: sql<number>`COUNT(${AppointmentModel.id})::int`,
        })
        .from(AppointmentModel)
        .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(and(...baseWhereClauses))
        .groupBy(AppointmentModel.appointmentStatus);

      const statusCounts: Record<string, number> = {};
      let allStatusCount = 0;
      for (const row of statusBreakdownRows) {
        const count = Number(row.count ?? 0);
        statusCounts[row.status as string] = count;
        allStatusCount += count;
      }
      statusCounts.all = allStatusCount;

      const latestQualification = trx
        .select({
          qualificationTitle: DoctorQualificationModel.qualificationTitle,
        })
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, doctorUser.id))
        .orderBy(desc(DoctorQualificationModel.yearOfCompletion))
        .limit(1);

      const patients = await trx
        .select({
          id: patientUser.id,
          name: patientUser.name,
          // Dependent family members are stored with mobile = NULL (they're
          // reachable only through the primary patient), so fall back to the
          // primary patient's number instead of showing a blank contact.
          mobile: sql<string | null>`COALESCE(${patientUser.mobile}, (
            SELECT pu.mobile
            FROM patient_family_links pfl
            JOIN users pu ON pu.id = pfl.primary_patient_id
            WHERE pfl.linked_patient_id = ${patientUser.id}
              AND pu.mobile IS NOT NULL
            LIMIT 1
          ))`,
          profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${patientUser.id} LIMIT 1)`,
          appointment: {
            id: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentDurationMinutes:
              AppointmentModel.appointmentDurationMinutes,
            appointmentType: AppointmentModel.appointmentType,
            appointmentStatus: AppointmentModel.appointmentStatus,
            paymentMethod: AppointmentPaymentModel.paymentMode,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            refundMode: AppointmentPaymentModel.refundMode,
            refundedAmount: AppointmentPaymentModel.refundedAmount,
            refundNotes: AppointmentPaymentModel.refundNotes,
            tokenNo: AppointmentModel.tokenNo,
            // Which shift the token belongs to. Numbering restarts at 1 in
            // every shift, so without this the list can't tell a doctor's
            // morning Token 1 apart from their evening Token 1 — both render
            // identically. Missing here entirely predates shift-wise tokens.
            sessionIndex: AppointmentModel.sessionIndex,
            bookingSource: AppointmentModel.bookingSource,
          },
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            email: doctorUser.email,
            mobile: doctorUser.mobile,
            gender: sql<string>`(SELECT gender FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            qualification: sql`(${latestQualification})`,
            // The timeline header names the doctor's speciality alongside the
            // qualification; without this the list was the only source it had
            // and it always came back undefined.
            speciality: sql<
              string | null
            >`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          },
          service: {
            id: ClinicServiceModel.id,
            serviceName: ClinicServiceModel.serviceName,
            servicePrice: ClinicServiceModel.price,
          },
        })
        .from(AppointmentModel)
        .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .leftJoin(
          ClinicServiceModel,
          eq(ClinicServiceModel.id, AppointmentModel.clinicServiceId)
        )
        .where(and(...whereClauses))
        .orderBy(
          sql`CASE ${AppointmentModel.appointmentStatus}
            WHEN 'Confirmed' THEN 0
            WHEN 'Patient Arrived' THEN 1
            WHEN 'Upcoming' THEN 2
            WHEN 'Pending' THEN 2
            ELSE 3
          END`,
          asc(AppointmentModel.appointmentDate),
          asc(AppointmentModel.appointmentTime),
          asc(AppointmentModel.tokenNo)
        )
        .limit(limit)
        .offset(offset);

      const tokenRows = patients.filter(
        (p): p is typeof p & { doctor: { id: string } } =>
          p.appointment.tokenNo != null &&
          (p.appointment as any).sessionIndex != null &&
          p.doctor?.id != null
      );

      if (tokenRows.length > 0) {
        const dayKey = (doctorId: string, date: Date) =>
          `${doctorId}:${formatDateOnlyLocal(new Date(date))}`;

        const uniqueDays = new Map<string, { doctorId: string; date: Date }>();
        for (const p of tokenRows) {
          const key = dayKey(
            p.doctor.id,
            p.appointment.appointmentDate as Date
          );
          if (!uniqueDays.has(key)) {
            uniqueDays.set(key, {
              doctorId: p.doctor.id,
              date: p.appointment.appointmentDate as Date,
            });
          }
        }

        const sessionWindowsByDay = new Map<
          string,
          Map<number, { sessionStart: string; sessionEnd: string }>
        >();

        await Promise.all(
          [...uniqueDays.entries()].map(async ([key, { doctorId, date }]) => {
            const dateStr = formatDateOnlyLocal(date);
            const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
              trx,
              clinicId,
              doctorId,
              dateStr
            );
            const windows = new Map<
              number,
              { sessionStart: string; sessionEnd: string }
            >();
            (day?.segments ?? []).forEach((segment, index) => {
              windows.set(index + 1, {
                sessionStart: toHHMM(segment.start),
                sessionEnd: toHHMM(segment.end),
              });
            });
            sessionWindowsByDay.set(key, windows);
          })
        );

        for (const p of tokenRows) {
          const key = dayKey(
            p.doctor.id,
            p.appointment.appointmentDate as Date
          );
          const window = sessionWindowsByDay
            .get(key)
            ?.get((p.appointment as any).sessionIndex);
          if (window) {
            (p.appointment as any).sessionStart = window.sessionStart;
            (p.appointment as any).sessionEnd = window.sessionEnd;
          }
        }
      }

      return {
        patients,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
        statusCounts,
      };
    });
  }

  static async getClinicAppointmentDetails(
    clinicId: string,
    query: ClinicAppointmentDetailsQueryDto,
    user: AuthUser
  ) {
    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      user,
      clinicId
    );
    if (query.doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        user,
        clinicId,
        query.doctorId
      );
    }

    const selectedDate = query.date || query.startDate;
    const currentRange = getSingleDayRange(selectedDate);
    const previousRange = {
      start: new Date(currentRange.start),
      end: new Date(currentRange.start),
    };
    previousRange.start.setDate(previousRange.start.getDate() - 1);

    const getCountsForRange = async (
      start: Date,
      end: Date
    ): Promise<ClinicAppointmentDetailsCounts> => {
      return await database.transaction(async (trx) => {
        const whereClauses: any[] = [
          eq(AppointmentModel.clinicId, clinicId),
          gte(AppointmentModel.appointmentDate, start),
          lt(AppointmentModel.appointmentDate, end),
        ];

        if (user.userType === 'Patient') {
          whereClauses.push(eq(AppointmentModel.patientId, user.id));
        }

        if (user.userType === 'Doctor') {
          whereClauses.push(eq(AppointmentModel.doctorId, user.id));
        }

        if (
          query.doctorId &&
          ['Admin', 'Receptionist', 'Super_Admin'].includes(user.userType)
        ) {
          whereClauses.push(eq(AppointmentModel.doctorId, query.doctorId));
        }

        const scopeFilter = doctorScopeFilter(
          AppointmentModel.doctorId,
          allowedDoctorIds
        );
        if (scopeFilter) whereClauses.push(scopeFilter);

        const [counts] = await trx
          .select({
            totalAppointments: sql<number>`COUNT(*)::int`,
            completed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Completed' THEN 1 END)::int`,
            upcoming: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Pending' THEN 1 END)::int`,
            cancelled: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Cancelled' THEN 1 END)::int`,
            noShow: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'NoShow' THEN 1 END)::int`,
            confirmed: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Confirmed' THEN 1 END)::int`,
            patientArrived: sql<number>`COUNT(CASE WHEN ${AppointmentModel.appointmentStatus} = 'Patient Arrived' THEN 1 END)::int`,
          })
          .from(AppointmentModel)
          .leftJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(and(...whereClauses, buildActiveAppointmentFilter()));

        return {
          totalAppointments: Number(counts?.totalAppointments ?? 0),
          completed: Number(counts?.completed ?? 0),
          upcoming: Number(counts?.upcoming ?? 0),
          cancelled: Number(counts?.cancelled ?? 0),
          noShow: Number(counts?.noShow ?? 0),
          confirmed: Number(counts?.confirmed ?? 0),
          patientArrived: Number(counts?.patientArrived ?? 0),
        };
      });
    };

    const [currentCounts, previousCounts] = await Promise.all([
      getCountsForRange(currentRange.start, currentRange.end),
      getCountsForRange(previousRange.start, previousRange.end),
    ]);

    return {
      date: formatDateOnlyLocal(currentRange.start),
      previousDate: formatDateOnlyLocal(previousRange.start),
      totalAppointments: buildMetricComparison(
        currentCounts.totalAppointments,
        previousCounts.totalAppointments
      ),
      completed: buildMetricComparison(
        currentCounts.completed,
        previousCounts.completed
      ),
      upcoming: buildMetricComparison(
        currentCounts.upcoming,
        previousCounts.upcoming
      ),
      cancelled: buildMetricComparison(
        currentCounts.cancelled,
        previousCounts.cancelled
      ),
      noShow: buildMetricComparison(
        currentCounts.noShow,
        previousCounts.noShow
      ),
      confirmed: buildMetricComparison(
        currentCounts.confirmed,
        previousCounts.confirmed
      ),
      patientArrived: buildMetricComparison(
        currentCounts.patientArrived,
        previousCounts.patientArrived
      ),
    };
  }

  // get all user appointments
  static async getALlUserAppountment(
    userId: string,
    query: appointmentQueryDto
  ) {
    return await database.transaction(async (trx) => {
      const pageSize = Math.max(Number(query?.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query?.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      // Build where clause safely
      const whereClauses: any[] = [eq(AppointmentModel.patientId, userId)];

      if (query?.search) {
        const raw = String(query.search).trim();
        if (raw.length > 0) {
          const terms = raw.split(/\s+/).slice(0, 5);

          const termConditions = terms.map((term) => {
            const escaped = this.escapeLike(term);
            const pattern = `%${escaped}%`.toLowerCase();

            const byName = sql`lower(${UserModel.name}) LIKE ${pattern}`;
            const byEmail = sql`lower(${UserModel.email}) LIKE ${pattern}`;
            const byMobile = sql`lower(${UserModel.mobile}) LIKE ${pattern}`;
            const byAltMobile = sql`lower(${UserProfileModel.alternateMobile}) LIKE ${pattern}`;
            const byAppointmentType = sql`lower(${AppointmentModel.appointmentType}) LIKE ${pattern}`;
            const byAppointmentStatus = sql`lower(CAST(${AppointmentModel.appointmentStatus} AS text)) LIKE ${pattern}`;

            // For a single term, any of these fields may match => OR
            return or(
              byName,
              byEmail,
              byMobile,
              byAltMobile,
              byAppointmentType,
              byAppointmentStatus
            );
          });

          // Combine multiple term conditions with AND (each term must appear somewhere)
          if (termConditions.length === 1) {
            whereClauses.push(termConditions[0]);
          } else if (termConditions.length > 1) {
            whereClauses.push(and(...termConditions));
          }
        }
      }

      // total count of appointments matching the criteria
      const totalRecords = await trx
        .select({ count: sql`COUNT(${AppointmentModel.id})` })
        .from(AppointmentModel)
        .where(and(...whereClauses));

      const totalCount = Number(totalRecords?.[0]?.count ?? 0) || 0;
      const totalPages =
        totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
      const doctor = alias(UserModel, 'doctor');

      // fetch patients with their appointment (this will return one row per appointment)
      // If you want only latest appointment per patient, see note below.
      const patients = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          alternateMobile: UserProfileModel.alternateMobile,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          status: UserModel.userStatus,
          updatedAt: UserModel.updatedAt,
          createdAt: UserModel.createdAt,
          doctor: {
            id: doctor.id,
            name: doctor.name,
            email: doctor.email,
            mobile: doctor.mobile,
            status: doctor.userStatus,
            updatedAt: doctor.updatedAt,
            createdAt: doctor.createdAt,
          },
          appointment: {
            id: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            appointmentStatus: AppointmentModel.appointmentStatus,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            bookingSource: AppointmentModel.bookingSource,
          },
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          AppointmentModel,
          eq(UserModel.id, AppointmentModel.patientId)
        )
        .leftJoin(doctor, eq(doctor.id, AppointmentModel.doctorId))
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(and(...whereClauses))
        // stable ordering so paging is deterministic:
        .orderBy(
          desc(UserModel.createdAt),
          desc(AppointmentModel.appointmentDate),
          desc(AppointmentModel.appointmentTime)
        )
        .limit(limit)
        .offset(offset);

      return {
        patients,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }

  static async getAppointment(
    appointmentId: string,
    requestingUser: { id: string; userType: string; clinicId?: string }
  ) {
    const DoctorUser = alias(UserModel, 'doctor');
    return await database.transaction(async (trx) => {
      const appointment = await trx
        .select({
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
          doctorId: AppointmentModel.doctorId,
          clinicId: AppointmentModel.clinicId,
          appointmentStatus: AppointmentModel.appointmentStatus,
        })
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, appointmentId))
        .limit(1);

      if (!appointment.length) {
        throw new HttpError(404, 'Appointment not found');
      }

      const appointmentData = appointment[0];

      let hasAccess = false;

      switch (requestingUser.userType) {
        case 'Admin':
        case 'Receptionist':
          if (
            requestingUser.clinicId &&
            appointmentData.clinicId === requestingUser.clinicId
          ) {
            hasAccess = true;
          }
          break;

        case 'Doctor':
          if (appointmentData.doctorId === requestingUser.id) {
            hasAccess = true;
          }
          break;

        default:
          hasAccess = false;
      }

      if (!hasAccess) {
        throw new HttpError(
          403,
          'You do not have permission to access this appointment'
        );
      }

      if (requestingUser.clinicId) {
        await StaffScopeService.assertDoctorAllowed(
          requestingUser,
          requestingUser.clinicId,
          appointmentData.doctorId as string
        );
      }

      // Get main appointment with user details
      const result = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          alternateMobile: UserProfileModel.alternateMobile,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          status: UserModel.userStatus,
          updatedAt: UserModel.updatedAt,
          createdAt: UserModel.createdAt,
          appointment: {
            id: AppointmentModel.id,
            doctorId: AppointmentModel.doctorId,
            clinicId: AppointmentModel.clinicId,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            appointmentStatus: AppointmentModel.appointmentStatus,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            tokenNo: AppointmentModel.tokenNo,
            // See the note at getAllClinicAppointments — needed wherever a
            // token is shown, or the detail page can't say which shift it's in.
            sessionIndex: AppointmentModel.sessionIndex,
            clinicServiceId: AppointmentModel.clinicServiceId,
            vitals: AppointmentClinicalModel.vitals,
            referrals: AppointmentClinicalModel.referrals,
            paymentMode: AppointmentPaymentModel.paymentMode,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            price: AppointmentPaymentModel.price,
            primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
            convenienceFee: AppointmentPaymentModel.convenienceFee,
            gstAmount: AppointmentPaymentModel.gstAmount,
            platformFee: AppointmentPaymentModel.convenienceFee,
            platformFeeGst: AppointmentPaymentModel.gstAmount,
            paymentNotes: AppointmentPaymentModel.paymentNotes,
            refundMode: AppointmentPaymentModel.refundMode,
            refundedAmount: AppointmentPaymentModel.refundedAmount,
            refundNotes: AppointmentPaymentModel.refundNotes,
            transactionId: AppointmentPaymentModel.transactionId,
            gatewayOrderId: AppointmentPaymentModel.gatewayOrderId,
            gatewayResponse: AppointmentPaymentModel.gatewayResponse,
            consentNotes: AppointmentClinicalModel.consentNotes,
            consentFile: AppointmentClinicalModel.consentFile,
            commonSymptoms: AppointmentClinicalModel.commonSymptoms,
            clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
            bookingSource: AppointmentModel.bookingSource,
            dayStartTime: ClinicAvailability.startTime,
            dayEndTime: ClinicAvailability.endTime,
          },
          doctor: {
            id: DoctorUser.id,
            name: DoctorUser.name,
            email: DoctorUser.email,
            mobile: DoctorUser.mobile,
            speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
            profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
            averageRating: sql<string>`(SELECT COALESCE(average_rating, '0.00') FROM user_professionals WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
            reviewCount: sql<number>`(SELECT COALESCE(review_count, 0) FROM user_professionals WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
          },
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .innerJoin(
          AppointmentModel,
          eq(UserModel.id, AppointmentModel.patientId)
        )
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
        )
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .innerJoin(DoctorUser, eq(AppointmentModel.doctorId, DoctorUser.id))
        .leftJoin(
          ClinicAvailability,
          and(
            eq(ClinicAvailability.clinicId, AppointmentModel.clinicId),
            eq(ClinicAvailability.doctorId, AppointmentModel.doctorId),
            sql`trim(both from lower(${ClinicAvailability.dayOfWeek})) = trim(both from lower(to_char(${AppointmentModel.appointmentDate}, 'Day')))`
          )
        )

        .where(eq(AppointmentModel.id, appointmentId))
        .limit(1);

      if (!result.length) return null;

      const baseData = result[0];

      const manualPrescription = await trx
        .select({
          id: doctorManualPrescriptionModel.id,
          doctorManualPrescription:
            doctorManualPrescriptionModel.doctorManualPrescription,
          createdAt: doctorManualPrescriptionModel.createdAt,
          updatedAt: doctorManualPrescriptionModel.updatedAt,
        })
        .from(doctorManualPrescriptionModel)
        .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
        .limit(1);

      // Get clinic service details
      let clinicService = null;
      if (baseData.appointment.clinicServiceId) {
        const serviceResult = await trx
          .select({
            id: ClinicServiceModel.id,
            serviceName: ClinicServiceModel.serviceName,
            price: ClinicServiceModel.price,
            currency: ClinicServiceModel.currency,
            durationDays: ClinicServiceModel.durationDays,
            additionalServices: ClinicServiceModel.additionalServices,
          })
          .from(ClinicServiceModel)
          .where(
            eq(ClinicServiceModel.id, baseData.appointment.clinicServiceId)
          )
          .limit(1);

        if (serviceResult.length > 0) {
          clinicService = serviceResult[0];
        }
      }

      // A covered visit stores no payment of its own: find the paid visit it falls under, using the
      // same rule as the booking screen's "Expiring on" (UserService), scoped to this clinic.
      let coveredBy: Record<string, unknown> | null = null;
      const appt = baseData.appointment;
      if (
        !appt.paymentMode &&
        appt.paymentStatus === 'Already Paid' &&
        appt.clinicServiceId &&
        appt.appointmentDate &&
        appointmentData.clinicId &&
        appointmentData.patientId &&
        appointmentData.doctorId
      ) {
        const [payingVisit] = await trx
          .select({
            appointmentId: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            paymentMode: AppointmentPaymentModel.paymentMode,
            amount: sql<
              string | null
            >`COALESCE(${AppointmentPaymentModel.primaryServicePrice}, ${AppointmentPaymentModel.price})`,
          })
          .from(AppointmentModel)
          .innerJoin(
            AppointmentPaymentModel,
            eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
          )
          .where(
            and(
              eq(AppointmentModel.clinicId, appointmentData.clinicId),
              eq(AppointmentModel.patientId, appointmentData.patientId),
              eq(AppointmentModel.doctorId, appointmentData.doctorId),
              eq(AppointmentModel.clinicServiceId, appt.clinicServiceId),
              ne(AppointmentModel.id, appointmentId),
              lte(AppointmentModel.appointmentDate, appt.appointmentDate),
              inArray(AppointmentModel.appointmentStatus, [
                'Completed',
                'Confirmed',
                'Pending',
              ]),
              isNotNull(AppointmentPaymentModel.paymentMode),
              sql`${AppointmentPaymentModel.paymentStatus} IS DISTINCT FROM 'Refunded'`
            )
          )
          .orderBy(
            desc(AppointmentModel.appointmentDate),
            desc(AppointmentPaymentModel.createdAt)
          )
          .limit(1);

        if (payingVisit) {
          // Same date arithmetic as UserService's "Expiring on", so the two never disagree.
          const durationDays = Number(clinicService?.durationDays ?? 0);
          let validTill: string | null = null;
          if (durationDays > 0) {
            const expiry = new Date(payingVisit.appointmentDate as any);
            expiry.setDate(expiry.getDate() + durationDays);
            validTill = expiry.toISOString().split('T')[0];
          }
          coveredBy = { ...payingVisit, validTill };
        }
      }

      // Get symptom details - FIXED with proper type checking
      let symptoms: any[] = [];
      const clinicSymptomIds = baseData.appointment.clinicSymptomIds;

      // Check if clinicSymptomIds exists and is an array with items
      if (
        clinicSymptomIds &&
        Array.isArray(clinicSymptomIds) &&
        clinicSymptomIds.length > 0
      ) {
        symptoms = await trx
          .select({
            id: ClinicSymptomModel.id,
            name: ClinicSymptomModel.name,
            description: ClinicSymptomModel.description,
            status: ClinicSymptomModel.status,
          })
          .from(ClinicSymptomModel)
          .where(inArray(ClinicSymptomModel.id, clinicSymptomIds));
      }

      // Get digital prescription details (Report Card)
      const reportCards = await trx
        .select()
        .from(ReportCardModel)
        .where(eq(ReportCardModel.appointmentId, appointmentId))
        .limit(1);

      // Get prescribed medicines
      let digitalPrescriptions: any[] = [];
      if (reportCards.length > 0) {
        digitalPrescriptions = await trx
          .select({
            id: PrescriptionModel.id,
            medicineId: PrescriptionModel.medicineId,
            medicineName: PrescriptionModel.medicineName,
            composition: PrescriptionModel.composition,
            strength: PrescriptionModel.strength,
            dosage: PrescriptionModel.dosage,
            frequency: PrescriptionModel.frequency,
            duration: PrescriptionModel.duration,
            notes: PrescriptionModel.notes,
            manufacturer: PrescriptionModel.manufacturer,
            medicineCount: PrescriptionModel.medicineCount,
            marketer: PrescriptionModel.marketer,
            imageUrl: PrescriptionModel.imageUrl,
            uses: PrescriptionModel.uses,
          })
          .from(PrescriptionModel)
          .where(eq(PrescriptionModel.reportCardId, reportCards[0].id));
      }

      // Get review details if any
      const reviews = await trx
        .select({
          id: DoctorReviewsModel.id,
          rating: DoctorReviewsModel.rating,
          reviewText: DoctorReviewsModel.reviewText,
          replyText: DoctorReviewsModel.replyText,
          createdAt: DoctorReviewsModel.createdAt,
        })
        .from(DoctorReviewsModel)
        .where(eq(DoctorReviewsModel.appointmentId, appointmentId))
        .limit(1);

      // Construct final response
      return {
        ...baseData,
        appointment: { ...baseData.appointment, coveredBy },
        clinicService: clinicService,
        symptoms: symptoms,
        manualPrescription:
          manualPrescription.length > 0 ? manualPrescription[0] : null,
        reportCard: reportCards.length > 0 ? reportCards[0] : null,
        prescriptions: digitalPrescriptions,
        review: reviews.length > 0 ? reviews[0] : null,
      };
    });
  }

  // get appointment by patient id
  static async getAppointmentByPatient(patientId: string) {
    return await database.transaction(async (trx) => {
      const result = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          alternateMobile: UserProfileModel.alternateMobile,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          status: UserModel.userStatus,
          updatedAt: UserModel.updatedAt,
          createdAt: UserModel.createdAt,
          appointment: {
            id: AppointmentModel.id,
            clinicId: AppointmentModel.clinicId,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            appointmentStatus: AppointmentModel.appointmentStatus,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            bookingSource: AppointmentModel.bookingSource,
          },
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .innerJoin(
          AppointmentModel,
          eq(UserModel.id, AppointmentModel.patientId)
        )
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(eq(UserModel.id, patientId))
        .limit(1); // Just in case, even though patientId should be unique

      return result.length > 0 ? result[0] : null;
    });
  }

  static async getLastPatientReportCard(patientId: string, clinicId: string) {
    return await database.transaction(async (trx) => {
      // Validate that the patient belongs to the clinic
      const isAssigned = await trx
        .select({ id: ClinicAssignModel.id })
        .from(ClinicAssignModel)
        .where(
          and(
            eq(ClinicAssignModel.userId, patientId),
            eq(ClinicAssignModel.clinicId, clinicId)
          )
        )
        .limit(1);

      if (!isAssigned.length) {
        throw new HttpError(
          403,
          'Access denied. Patient is not assigned to this clinic.'
        );
      }

      const reportCards = await trx
        .select({
          id: ReportCardModel.id,
          habits: ReportCardModel.habits,
          provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
          allergies: ReportCardModel.allergies,
          createdAt: ReportCardModel.createdAt,
          appointmentId: ReportCardModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
        })
        .from(ReportCardModel)
        .leftJoin(
          AppointmentModel,
          eq(ReportCardModel.appointmentId, AppointmentModel.id)
        )
        .leftJoin(
          alias(UserModel, 'doctor'),
          eq(AppointmentModel.doctorId, alias(UserModel, 'doctor').id)
        )
        .where(
          and(
            eq(ReportCardModel.petientId, patientId),
            eq(AppointmentModel.clinicId, clinicId)
          )
        )
        .orderBy(desc(ReportCardModel.createdAt))
        .limit(1);

      if (!reportCards.length) {
        return null;
      }

      const reportCard = reportCards[0];

      return {
        id: reportCard.id,
        appointmentId: reportCard.appointmentId,
        appointmentDate: reportCard.appointmentDate,
        habits: reportCard.habits,
        provisionalDiagnosis: reportCard.provisionalDiagnosis,
        allergies: reportCard.allergies,
        createdAt: reportCard.createdAt,
      };
    });
  }

  // get appointment by doctor id
  static async getAppointmentByDoctor(doctorId: string) {
    return await database.transaction(async (trx) => {
      const result = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          alternateMobile: UserProfileModel.alternateMobile,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          status: UserModel.userStatus,
          updatedAt: UserModel.updatedAt,
          createdAt: UserModel.createdAt,
          appointment: {
            id: AppointmentModel.id,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
            appointmentType: AppointmentModel.appointmentType,
            appointmentNotes: AppointmentClinicalModel.appointmentNotes,
            appointmentStatus: AppointmentModel.appointmentStatus,
            reReasonForCancellation: AppointmentModel.reReasonForCancellation,
            reasionForReSchedule: AppointmentModel.reasionForReSchedule,
            bookingSource: AppointmentModel.bookingSource,
          },
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .innerJoin(
          AppointmentModel,
          eq(UserModel.id, AppointmentModel.doctorId)
        )
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(eq(UserModel.id, doctorId))
        .limit(1); // Just in case, even though doctorId should be unique

      return result.length > 0 ? result[0] : null;
    });
  }

  // normalize date to yyyy-mm-dd
  static normalizeToDateOnly(dateLike: string) {
    // Accept either "YYYY-MM-DD" or a full ISO and return "YYYY-MM-DD"
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) {
      // fallback: try to extract yyyy-mm-dd
      const m = String(dateLike).match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    }
    // Use UTC date to avoid local timezone shifts when storing/comparing day
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // convert hh:mm to minutes since midnight
  static hhmmToMinutes(hhmm: string | null | undefined) {
    if (!hhmm) return null;
    const s = String(hhmm).trim();

    // handle "hh:mm" (24-hour)
    const plainMatch = s.match(/^(\d{1,2}):(\d{2})$/);
    if (plainMatch) {
      const h = Number(plainMatch[1]);
      const m = Number(plainMatch[2]);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    }

    // handle "hh:mm AM/PM"
    const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampmMatch) {
      let h = Number(ampmMatch[1]);
      const m = Number(ampmMatch[2]);
      const meridiem = ampmMatch[3].toUpperCase();
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      if (meridiem === 'AM') {
        if (h === 12) h = 0;
      } else {
        if (h !== 12) h += 12;
      }
      return h * 60 + m;
    }

    // fallback: extract digits
    const fallback = s.match(/(\d{1,2}):(\d{2})/);
    if (fallback) {
      const h = Number(fallback[1]);
      const m = Number(fallback[2]);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    }

    return null;
  }

  // convert minutes since midnight to hh:mm
  static minutesToIso(dateOnlyYMD: string, minutesSinceMidnight: number) {
    const hh = Math.floor(minutesSinceMidnight / 60)
      .toString()
      .padStart(2, '0');
    const mm = (minutesSinceMidnight % 60).toString().padStart(2, '0');
    // dateOnlyYMD must be "YYYY-MM-DD"
    return `${dateOnlyYMD}T${hh}:${mm}:00`;
  }

  // check if two time ranges overlap
  static rangesOverlap(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
  ) {
    // use <= to treat touching boundaries as overlap
    return aStart < bEnd && bStart <= aEnd;
  }

  // Add small helpers (inside same class, near other helpers)
  static appointmentFullyContainsSlot(
    apptStart: number,
    apptEnd: number,
    slotStart: number,
    slotEnd: number
  ) {
    return apptStart <= slotStart && apptEnd >= slotEnd;
  }

  // check if appointment starts at slot time
  static appointmentStartsAtSlot(apptStart: number, slotStart: number) {
    return apptStart === slotStart;
  }

  static async getAvailableSlotsForDate(
    clinicId: string,
    query: getAvailableSlotsForDateDto & {
      onlyOccupied?: boolean;
      occupyMode?: 'partial' | 'full' | 'start';
    } = {
      onlyOccupied: false,
      occupyMode: 'partial',
      date: new Date().toISOString().split('T')[0],
    },
    params: getAvailableSlotsForParamsDto
  ): Promise<{ slots: Slot[]; shifts?: string[] }> {
    return await database.transaction(async (tx) => {
      const rawDate = typeof query === 'string' ? query : (query as any)?.date;
      const dateStr = this.normalizeToDateOnly(rawDate);
      if (!dateStr) return { slots: [] };

      const startOfDay = new Date(`${dateStr}T00:00:00Z`);
      const nextDay = new Date(startOfDay);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      let finalSlots: Slot[] = [];
      let shifts: string[] = [];
      let isTokenBooking = false; // Add flag to track if we've already processed token booking

      // Helper function to format time for display (12-hour format with AM/PM)
      const formatTimeForDisplay = (timeStr: string): string => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
      };

      // Helper function to convert minutes to time string (HH:MM)
      const minutesToTimeStr = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      };

      // Helper function to calculate shifts from availability and breaks
      const calculateShifts = (
        availStart: string | null,
        availEnd: string | null,
        breaks: { startTime: string | null; endTime: string | null }[]
      ): string[] => {
        // Return empty array if start or end is null
        if (!availStart || !availEnd) return [];

        const shiftsArray: string[] = [];

        // Convert times to minutes for comparison
        const availStartMin = this.hhmmToMinutes(availStart);
        const availEndMin = this.hhmmToMinutes(availEnd);

        if (availStartMin === null || availEndMin === null) return [];

        // Filter breaks that have valid start and end times
        const validBreaks = breaks
          .filter((b) => b.startTime && b.endTime)
          .map((b) => ({
            start: this.hhmmToMinutes(b.startTime as string),
            end: this.hhmmToMinutes(b.endTime as string),
            startTime: b.startTime as string,
            endTime: b.endTime as string,
          }))
          .filter((b) => b.start !== null && b.end !== null) as {
          start: number;
          end: number;
          startTime: string;
          endTime: string;
        }[];

        // Sort breaks by start time
        validBreaks.sort((a, b) => a.start - b.start);

        let currentStart = availStartMin;

        for (const breakItem of validBreaks) {
          const breakStart = breakItem.start;
          const breakEnd = breakItem.end;

          // If there's a gap before this break, add as a shift
          if (currentStart < breakStart) {
            shiftsArray.push(
              `${formatTimeForDisplay(minutesToTimeStr(currentStart))} - ${formatTimeForDisplay(minutesToTimeStr(breakStart))}`
            );
          }

          // Move current start to after the break
          currentStart = Math.max(currentStart, breakEnd);
        }

        // Add final shift after all breaks
        if (currentStart < availEndMin) {
          shiftsArray.push(
            `${formatTimeForDisplay(minutesToTimeStr(currentStart))} - ${formatTimeForDisplay(minutesToTimeStr(availEndMin))}`
          );
        }

        return shiftsArray;
      };

      // 1️⃣ Check if this doctor/clinic/day uses token-based booking (noOfPatients)
      const weekdayForToken = new Date(
        `${dateStr}T00:00:00Z`
      ).toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
      });

      const tokenAvailRows = await tx
        .select()
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.clinicId, clinicId),
            eq(ClinicAvailability.doctorId, params.doctorId),
            eq(ClinicAvailability.dayOfWeek, weekdayForToken),
            eq(ClinicAvailability.isAvailable, true)
          )
        );

      let tokenCapacity = 0;
      let tokenClinicAvailabilityId: string | null = null;
      for (const row of tokenAvailRows) {
        const n = (row as any).noOfPatients as number | null | undefined;
        if (typeof n === 'number' && n > tokenCapacity) {
          tokenCapacity = n;
          tokenClinicAvailabilityId = (row as any).id as string;
        }
      }

      const dateUnavailable = await tx
        .select()
        .from(ClinicDateAvailability)
        .where(
          and(
            eq(ClinicDateAvailability.clinicId, clinicId),
            eq(ClinicDateAvailability.doctorId, params.doctorId),
            eq(ClinicDateAvailability.date, startOfDay)
          )
        );

      // If date availability record exists and is NOT true (either false or null), skip token booking
      const shouldSkipToken =
        dateUnavailable.length > 0 &&
        (dateUnavailable[0].isAvailable === false ||
          dateUnavailable[0].isAvailable === null);

      if (tokenCapacity > 0 && tokenClinicAvailabilityId && !shouldSkipToken) {
        isTokenBooking = true; // Set flag that this is a token booking

        const apptStatuses = [
          'Confirmed',
          'Patient Arrived',
          'Pending',
          'Rescheduled',
          'Upcoming',
          'Completed',
          // Fetched alongside the active rows, then split out below: a
          // cancelled token is free again but its number is already issued.
          'Cancelled',
          'NoShow',
        ] as const;
        const booked = await tx
          .select({
            id: AppointmentModel.id,
            tokenNo: AppointmentModel.tokenNo,
            // Read below as `(b as any).sessionIndex` to key `bookedMap` —
            // omitted here, that cast silently resolved to `undefined` on
            // every row, so every booked token collapsed into session 1's
            // bucket regardless of which shift it was actually booked into.
            sessionIndex: AppointmentModel.sessionIndex,
            appointmentStatus: AppointmentModel.appointmentStatus,
            // Lets the token card name the override that booked it rather than
            // showing a generic "Booked" beside an ordinary consultation.
            appointmentType: AppointmentModel.appointmentType,
            patientId: AppointmentModel.patientId,
            paymentMode: AppointmentPaymentModel.paymentMode,
            paymentStatus: AppointmentPaymentModel.paymentStatus,
            doctorId: AppointmentModel.doctorId,
            appointmentDate: AppointmentModel.appointmentDate,
            appointmentTime: AppointmentModel.appointmentTime,
          })
          .from(AppointmentModel)
          .leftJoin(
            AppointmentPaymentModel,
            eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
          )
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              eq(AppointmentModel.doctorId, params.doctorId),
              gte(AppointmentModel.appointmentDate, startOfDay),
              lt(AppointmentModel.appointmentDate, nextDay),
              inArray(AppointmentModel.appointmentStatus, apptStatuses)
            )
          );

        // Terminal rows ride along in the query above but must not occupy a
        // token — that is what keeps capacity from shrinking on a cancellation.
        const isReleasedStatus = (status: string) =>
          status === 'Cancelled' || status === 'NoShow';
        const releasedBooked = booked.filter((b) =>
          isReleasedStatus(b.appointmentStatus as string)
        );
        const activeBooked = await filterExpiredPendingAppointments(
          booked.filter((b) => !isReleasedStatus(b.appointmentStatus as string))
        );

        const redisLocks =
          await PaymentReservationService.getActiveLocksForDate(
            params.doctorId,
            dateStr
          );

        // Keyed "session:token", not by token alone: a day-wide map let the
        // morning's token 3 mark the evening's as taken. Null sessions (booked
        // before shift-wise numbering) read as session 1, where they were issued.
        const bookedKey = (session: number | null, token: number) =>
          `${session ?? 1}:${token}`;

        /*
         * Tokens whose appointment was cancelled or no-showed. The number is
         * genuinely free again — capacity must not shrink on a cancellation —
         * but it was already handed to a patient, who may still turn up with
         * it. Flagged so the desk can see the number is in circulation rather
         * than reading identically to one never issued.
         *
         * Split out of the rows already fetched rather than queried
         * separately: an extra read here would both cost a round trip and
         * shift every later query in the sequence.
         */
        const releasedKeys = new Set<string>();
        for (const b of releasedBooked) {
          const t = b.tokenNo == null ? null : Number(b.tokenNo);
          if (t && Number.isFinite(t)) {
            releasedKeys.add(`${(b as any).sessionIndex ?? 1}:${t}`);
          }
        }

        const bookedMap = new Map<string, any>();
        const bookedTokens: number[] = [];
        for (const b of activeBooked) {
          const t =
            b.tokenNo == null ? null : Number(b.tokenNo as unknown as number);
          if (t && Number.isFinite(t)) {
            bookedMap.set(bookedKey((b as any).sessionIndex ?? null, t), {
              id: b.id,
              appointmentStatus: b.appointmentStatus,
              appointmentType: b.appointmentType,
              patientId: b.patientId,
            });
            bookedTokens.push(t);
          }
        }

        for (const lock of redisLocks) {
          if (typeof lock.slotOrToken === 'number') {
            const t = lock.slotOrToken;
            const lockKey = bookedKey(lock.sessionIndex, t);
            if (!bookedMap.has(lockKey)) {
              let patientId: string | undefined;
              let id = lock.value;
              try {
                const parsed = JSON.parse(lock.value);
                if (parsed && typeof parsed === 'object') {
                  id = parsed.bookingRefId || lock.value;
                  patientId = parsed.patientId;
                }
              } catch {
                /* ignore */
              }
              bookedMap.set(lockKey, {
                id,
                appointmentStatus: 'Pending',
                patientId,
              });
              bookedTokens.push(t);
            }
          }
        }

        const availRow = tokenAvailRows.find(
          (r: any) => r.id === tokenClinicAvailabilityId
        );

        if (!availRow?.startTime || !availRow?.endTime) {
          throw new Error('Start time or End time missing');
        }

        // Calculate shifts for token-based booking
        const breaks = await tx
          .select()
          .from(ClinicAvailabilityBreak)
          .where(
            and(
              eq(
                ClinicAvailabilityBreak.clinicAvailabilityId,
                tokenClinicAvailabilityId
              ),
              eq(ClinicAvailabilityBreak.status, true)
            )
          );

        const calculatedShifts = calculateShifts(
          availRow.startTime,
          availRow.endTime,
          breaks
        );

        if (calculatedShifts.length > 0) {
          shifts = calculatedShifts;
        }

        // One entry per shift. Blocks come from the same resolver booking uses,
        // so the picker and the booking cannot drift apart. A 10:00 clinic of 20
        // and a 17:00 of 30 are two runs of 1..N, not one run of 1..50.
        const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
          tx,
          clinicId,
          params.doctorId,
          dateStr
        );

        const segments = day?.segments?.length
          ? day.segments
          : // No derivable blocks: treat the availability window as the single
            // session, so a plain token day behaves exactly as it always has.
            [
              {
                start: this.hhmmToMinutes(availRow.startTime) ?? 0,
                end: this.hhmmToMinutes(availRow.endTime) ?? 0,
                slotId: undefined as string | undefined,
              },
            ];

        const sessionSlots = await Promise.all(
          segments.map(async (segment, index) => {
            const sessionIndex = index + 1;
            const sessionStart = minutesToTimeStr(segment.start);
            const sessionEnd = minutesToTimeStr(segment.end);

            const {
              capacity,
              source: capacitySource,
              appointmentType: overrideType,
            } = await TokenCapacityService.resolveForSession(
              clinicId,
              params.doctorId,
              dateStr,
              sessionStart,
              (segment as { slotId?: string }).slotId,
              tx,
              sessionIndex
            );

            // Numbers past the standing capacity exist only because an
            // override raised it, so the card can say so rather than "extra".
            const baseCapacity =
              capacitySource === 'session_override'
                ? await TokenCapacityService.resolveStandingCapacity(
                    clinicId,
                    params.doctorId,
                    dateStr,
                    sessionIndex,
                    tx
                  )
                : capacity;

            const sessionTokens: Slot['tokens'] = Array.from(
              { length: capacity },
              (_, i) => {
                const tokenNo = i + 1;
                const b = bookedMap.get(bookedKey(sessionIndex, tokenNo));
                return b
                  ? {
                      tokenNo,
                      status:
                        b.appointmentStatus === 'Confirmed' ||
                        b.appointmentStatus === 'Patient Arrived'
                          ? ('booked' as const)
                          : ('reserved' as const),
                      appointmentId: b.id,
                      appointmentStatus: b.appointmentStatus,
                      // Booking an override-created token through the ordinary
                      // grid stores 'Consultation'; the slot's own reason wins.
                      appointmentType: isOverrideAppointmentType(
                        b.appointmentType
                      )
                        ? b.appointmentType
                        : tokenNo > baseCapacity && overrideType
                          ? overrideType
                          : b.appointmentType,
                      patientId: b.patientId,
                    }
                  : {
                      tokenNo,
                      status: 'available' as const,
                      // Free again, but this number is already in a patient's
                      // hands — see releasedKeys.
                      ...(releasedKeys.has(bookedKey(sessionIndex, tokenNo))
                        ? { isReopened: true }
                        : {}),
                      // Added by an override, so it carries that override's
                      // reason until someone books it.
                      ...(tokenNo > baseCapacity
                        ? {
                            isExtra: true,
                            ...(overrideType
                              ? { appointmentType: overrideType }
                              : {}),
                          }
                        : {}),
                    };
              }
            );

            // Override bookings above capacity sit outside 1..capacity; list them,
            // or the grid shows the number free and the modal re-offers it.
            for (const [key, b] of bookedMap) {
              const [session, tokenNo] = key.split(':').map(Number);
              if (session !== sessionIndex || tokenNo <= capacity) continue;
              sessionTokens.push({
                tokenNo,
                status:
                  b.appointmentStatus === 'Confirmed' ||
                  b.appointmentStatus === 'Patient Arrived'
                    ? 'booked'
                    : 'reserved',
                appointmentId: b.id,
                appointmentStatus: b.appointmentStatus,
                appointmentType: b.appointmentType,
                patientId: b.patientId,
                isExtra: true,
              });
            }
            sessionTokens.sort((x, y) => x.tokenNo - y.tokenNo);

            // The first free number in THIS shift. Scanning from 1 rather than
            // from the highest booked, because a cancellation reopens a number
            // and the next patient should be given it.
            const firstFree = sessionTokens.find(
              (t) => t.status === 'available'
            );

            return {
              start: `${dateStr}T${convertTo24Hour(sessionStart)}:00`,
              end: `${dateStr}T${convertTo24Hour(sessionEnd)}:00`,
              clinicAvailabilityId: tokenClinicAvailabilityId,
              source: 'availability' as const,
              status: 'available' as const,
              tokens: sessionTokens,
              totalTokens: capacity,
              availableTokens: sessionTokens.filter(
                (t) => t.status === 'available'
              ).length,
              autoToken: firstFree ? firstFree.tokenNo : ('-' as const),
              sessionIndex,
              sessionStart,
              sessionEnd,
              totalSessions: segments.length,
            };
          })
        );

        // Finished sessions drop out, judged per session rather than against
        // the day's end: at 14:00 the whole day used to disappear because the
        // morning was over, leaving the evening clinic unbookable.
        const thresholdMinutes = query.time
          ? this.hhmmToMinutes(query.time)
          : null;

        const istTodayYMD = new Date()
          .toLocaleDateString('en-GB', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
          .split('/')
          .reverse()
          .join('-');

        const isToday = dateStr === istTodayYMD;

        for (const sessionSlot of sessionSlots) {
          const endMinutes = this.hhmmToMinutes(sessionSlot.sessionEnd);

          const ended =
            isToday &&
            thresholdMinutes !== null &&
            endMinutes !== null &&
            endMinutes <= thresholdMinutes;

          // A finished session keeps its issued tokens — the day's queue still
          // has to be readable. Only its free numbers go.
          if (!ended) {
            finalSlots.push(sessionSlot);
          } else {
            const issued = sessionSlot.tokens.filter(
              (t: any) => t.status !== 'available'
            );
            if (issued.length > 0) {
              finalSlots.push({
                ...sessionSlot,
                tokens: issued,
                availableTokens: 0,
              });
            }
          }
        }
      }

      /*
       * A token day the doctor has taken off: no capacity is offered, but the
       * overrides already booked into it still have to be listed. Emitted as a
       * tokens array so the client keeps rendering the day as token-based —
       * with only the real bookings in it, and nothing free to pick.
       */
      if (tokenCapacity > 0 && tokenClinicAvailabilityId && shouldSkipToken) {
        const leaveDayBooked = await tx
          .select({
            id: AppointmentModel.id,
            tokenNo: AppointmentModel.tokenNo,
            sessionIndex: AppointmentModel.sessionIndex,
            appointmentStatus: AppointmentModel.appointmentStatus,
            appointmentType: AppointmentModel.appointmentType,
            patientId: AppointmentModel.patientId,
          })
          .from(AppointmentModel)
          .where(
            and(
              eq(AppointmentModel.clinicId, clinicId),
              eq(AppointmentModel.doctorId, params.doctorId),
              gte(AppointmentModel.appointmentDate, startOfDay),
              lt(AppointmentModel.appointmentDate, nextDay),
              isNotNull(AppointmentModel.tokenNo)
            )
          );

        isTokenBooking = true;

        // The weekday's real sittings, so the override picker can still name
        // one. Off duty removes the capacity, not the shape of the day.
        const leaveAvailRow = tokenAvailRows.find(
          (r: any) => r.id === tokenClinicAvailabilityId
        );
        const leaveBreaks = await tx
          .select()
          .from(ClinicAvailabilityBreak)
          .where(
            and(
              eq(
                ClinicAvailabilityBreak.clinicAvailabilityId,
                tokenClinicAvailabilityId
              ),
              eq(ClinicAvailabilityBreak.status, true)
            )
          );

        const leaveShifts =
          leaveAvailRow?.startTime && leaveAvailRow?.endTime
            ? calculateShifts(
                leaveAvailRow.startTime,
                leaveAvailRow.endTime,
                leaveBreaks
              )
            : [];
        if (leaveShifts.length > 0) shifts = leaveShifts;

        const leaveSegments = leaveShifts.length
          ? leaveShifts.map((s: any) => ({
              start: this.hhmmToMinutes(s.startTime ?? s.start) ?? 0,
              end: this.hhmmToMinutes(s.endTime ?? s.end) ?? 0,
            }))
          : [{ start: 0, end: 24 * 60 - 1 }];

        leaveSegments.forEach((segment, index) => {
          const sessionIndex = index + 1;
          // A booking made before shift-wise numbering carries no session and
          // belongs to the first, where its number was issued.
          const sessionTokens = leaveDayBooked
            .filter((b) => (b.sessionIndex ?? 1) === sessionIndex)
            .map((b) => ({
              tokenNo: Number(b.tokenNo),
              status:
                b.appointmentStatus === 'Confirmed' ||
                b.appointmentStatus === 'Patient Arrived'
                  ? ('booked' as const)
                  : ('reserved' as const),
              appointmentId: b.id,
              appointmentStatus: b.appointmentStatus,
              appointmentType: b.appointmentType,
              patientId: b.patientId,
            }))
            .sort((a, b) => a.tokenNo - b.tokenNo);

          finalSlots.push({
            start: this.minutesToIso(dateStr, segment.start),
            end: this.minutesToIso(dateStr, segment.end),
            clinicAvailabilityId: tokenClinicAvailabilityId,
            source: 'availability' as const,
            status: 'available' as const,
            tokens: sessionTokens,
            // Zero capacity is the point: the day offers nothing new, so the
            // grid shows these bookings and no free numbers beside them.
            totalTokens: 0,
            availableTokens: 0,
            autoToken: '-' as const,
            sessionIndex,
            sessionStart: minutesToTimeStr(segment.start),
            sessionEnd: minutesToTimeStr(segment.end),
            totalSessions: leaveSegments.length,
          } as any);
        });
      }

      // Only process non-token bookings if we haven't already processed a token booking
      if (!isTokenBooking) {
        const dateAvail = await tx
          .select()
          .from(ClinicDateAvailability)
          .where(
            and(
              eq(ClinicDateAvailability.clinicId, clinicId),
              eq(ClinicDateAvailability.doctorId, params.doctorId),
              eq(ClinicDateAvailability.date, startOfDay)
            )
          );

        if (dateAvail.length > 0) {
          const da = dateAvail[0];
          if (da.isAvailable) {
            const dateAvailTimeSlots = await tx
              .select()
              .from(ClinicDateAvailabilityTimeSlots)
              .where(
                and(
                  eq(
                    ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
                    da.id
                  ),
                  eq(ClinicDateAvailabilityTimeSlots.isAvailable, true)
                )
              );

            if (dateAvailTimeSlots.length > 0) {
              const slotDuration = Number(da.slotMinutes) || 30;
              const bufferMinutes = Number(da.stepMinutes) || 0;
              const stepDuration = slotDuration + bufferMinutes;

              // Added //
              const apptStatuses = [
                'Confirmed',
                'Patient Arrived',
                'Pending',
                'Rescheduled',
                'Upcoming',
                'Completed',
              ] as const;
              const appointments = await tx
                .select({
                  id: AppointmentModel.id,
                  appointmentTime: AppointmentModel.appointmentTime,
                  appointmentDurationMinutes:
                    AppointmentModel.appointmentDurationMinutes,
                  appointmentStatus: AppointmentModel.appointmentStatus,
                  patientId: AppointmentModel.patientId,
                  paymentMode: AppointmentPaymentModel.paymentMode,
                  paymentStatus: AppointmentPaymentModel.paymentStatus,
                  doctorId: AppointmentModel.doctorId,
                  appointmentDate: AppointmentModel.appointmentDate,
                  tokenNo: AppointmentModel.tokenNo,
                })
                .from(AppointmentModel)
                .leftJoin(
                  AppointmentPaymentModel,
                  eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
                )
                .where(
                  and(
                    eq(AppointmentModel.clinicId, clinicId),
                    eq(AppointmentModel.doctorId, params.doctorId),
                    gte(AppointmentModel.appointmentDate, startOfDay),
                    lt(AppointmentModel.appointmentDate, nextDay),
                    inArray(AppointmentModel.appointmentStatus, apptStatuses)
                  )
                );

              const activeAppointments =
                await filterExpiredPendingAppointments(appointments);

              const redisLocks =
                await PaymentReservationService.getActiveLocksForDate(
                  params.doctorId,
                  dateStr
                );
              const redisRanges: any[] = [];
              for (const lock of redisLocks) {
                if (typeof lock.slotOrToken === 'string') {
                  const startMin = this.hhmmToMinutes(lock.slotOrToken);
                  if (startMin !== null) {
                    let duration = slotDuration;
                    let patientId: string | undefined;
                    let id = lock.value;
                    try {
                      const parsed = JSON.parse(lock.value);
                      if (parsed && typeof parsed === 'object') {
                        id = parsed.bookingRefId || lock.value;
                        duration = Number(parsed.duration) || slotDuration;
                        patientId = parsed.patientId;
                      }
                    } catch {
                      /* ignore */
                    }
                    redisRanges.push({
                      start: startMin,
                      end: startMin + duration,
                      id,
                      status: 'Pending',
                      patientId,
                    });
                  }
                }
              }

              const appointmentRanges = [
                ...(activeAppointments || [])
                  .map((a: any) => {
                    const startMin = this.hhmmToMinutes(a.appointmentTime);
                    if (startMin == null) return null;
                    const duration = Math.max(
                      1,
                      Number(a.appointmentDurationMinutes) || 30
                    );
                    return {
                      start: startMin,
                      end: startMin + duration,
                      id: a.id,
                      status: a.appointmentStatus,
                      patientId: a.patientId,
                    };
                  })
                  .filter(Boolean),
                ...redisRanges,
              ];
              // Added //

              for (const ts of dateAvailTimeSlots) {
                const startTimeMinutes = this.hhmmToMinutes(ts.startTime);
                const endTimeMinutes = this.hhmmToMinutes(ts.endTime);

                if (startTimeMinutes === null || endTimeMinutes === null) {
                  continue;
                }

                for (
                  let s = startTimeMinutes;
                  s < endTimeMinutes;
                  s += stepDuration
                ) {
                  const e = s + slotDuration;
                  if (e > endTimeMinutes) continue;

                  // Added //
                  const overlappingAppt = appointmentRanges.find(
                    (ar) => ar && ar.start < e && ar.end > s
                  );

                  if (overlappingAppt) {
                    finalSlots.push({
                      start: this.minutesToIso(dateStr, s),
                      end: this.minutesToIso(dateStr, e),
                      clinicAvailabilityId: da.id,
                      source: 'appointment',
                      status:
                        overlappingAppt.status === 'Confirmed' ||
                        overlappingAppt.status === 'Patient Arrived'
                          ? 'booked'
                          : 'reserved',
                      appointmentId: overlappingAppt.id,
                      appointmentStatus: overlappingAppt.status,
                      patientId: overlappingAppt.patientId,
                    });
                  } else {
                    finalSlots.push({
                      start: this.minutesToIso(dateStr, s),
                      end: this.minutesToIso(dateStr, e),
                      clinicAvailabilityId: da.id,
                      source: 'availability',
                      status: 'available',
                    });
                  }
                  // Added //
                }
              }
            }
          }
        } else {
          const weekday = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(
            'en-US',
            {
              weekday: 'long',
              timeZone: 'UTC',
            }
          );

          const availRows = await tx
            .select()
            .from(ClinicAvailability)
            .where(
              and(
                eq(ClinicAvailability.clinicId, clinicId),
                eq(ClinicAvailability.doctorId, params.doctorId),
                eq(ClinicAvailability.dayOfWeek, weekday),
                eq(ClinicAvailability.isAvailable, true)
              )
            );

          if (availRows && availRows.length > 0) {
            // If day availability is token-based, return token availability instead of time slots
            const tokenCapacity = Number((availRows[0] as any).noOfPatients);
            if (Number.isFinite(tokenCapacity) && tokenCapacity > 0) {
              // This is the duplicate token booking - we should skip it since we already handled token bookings above
              // Instead of creating a slot here, we'll just set the shifts

              // Calculate shifts for this availability
              const breaks = await tx
                .select()
                .from(ClinicAvailabilityBreak)
                .where(
                  and(
                    eq(
                      ClinicAvailabilityBreak.clinicAvailabilityId,
                      availRows[0].id
                    ),
                    eq(ClinicAvailabilityBreak.status, true)
                  )
                );

              const calculatedShifts = calculateShifts(
                availRows[0].startTime,
                availRows[0].endTime,
                breaks
              );

              // Only set shifts if not already set
              if (calculatedShifts.length > 0 && shifts.length === 0) {
                shifts = calculatedShifts;
              }

              // Skip creating the duplicate slot
              return {
                slots: finalSlots,
                shifts: shifts.length > 0 ? shifts : undefined,
              };
            } else {
              // Non-token based availability
              const availIds = availRows.map((r: any) => r.id);

              const breaks = await tx
                .select()
                .from(ClinicAvailabilityBreak)
                .where(
                  and(
                    inArray(
                      ClinicAvailabilityBreak.clinicAvailabilityId,
                      availIds
                    ),
                    eq(ClinicAvailabilityBreak.status, true)
                  )
                );

              // Calculate shifts for the main availability
              if (availRows.length > 0 && shifts.length === 0) {
                const calculatedShifts = calculateShifts(
                  availRows[0].startTime,
                  availRows[0].endTime,
                  breaks
                );
                if (calculatedShifts.length > 0) {
                  shifts = calculatedShifts;
                }
              }

              const apptStatuses = [
                'Confirmed',
                'Patient Arrived',
                'Pending',
                'Rescheduled',
                'Upcoming',
                'Completed',
              ] as const;

              const appointments = await tx
                .select({
                  id: AppointmentModel.id,
                  appointmentTime: AppointmentModel.appointmentTime,
                  appointmentDurationMinutes:
                    AppointmentModel.appointmentDurationMinutes,
                  appointmentStatus: AppointmentModel.appointmentStatus,
                  patientId: AppointmentModel.patientId,
                  paymentMode: AppointmentPaymentModel.paymentMode,
                  paymentStatus: AppointmentPaymentModel.paymentStatus,
                  doctorId: AppointmentModel.doctorId,
                  appointmentDate: AppointmentModel.appointmentDate,
                  tokenNo: AppointmentModel.tokenNo,
                })
                .from(AppointmentModel)
                .leftJoin(
                  AppointmentPaymentModel,
                  eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
                )
                .where(
                  and(
                    eq(AppointmentModel.clinicId, clinicId),
                    eq(AppointmentModel.doctorId, params.doctorId),
                    gte(AppointmentModel.appointmentDate, startOfDay),
                    lt(AppointmentModel.appointmentDate, nextDay),
                    inArray(AppointmentModel.appointmentStatus, apptStatuses)
                  )
                );

              const activeAppointments =
                await filterExpiredPendingAppointments(appointments);

              const redisLocks =
                await PaymentReservationService.getActiveLocksForDate(
                  params.doctorId,
                  dateStr
                );
              const redisRanges: any[] = [];
              for (const lock of redisLocks) {
                if (typeof lock.slotOrToken === 'string') {
                  const startMin = this.hhmmToMinutes(lock.slotOrToken);
                  if (startMin !== null) {
                    let duration = 30;
                    let patientId: string | undefined;
                    let id = lock.value;
                    try {
                      const parsed = JSON.parse(lock.value);
                      if (parsed && typeof parsed === 'object') {
                        id = parsed.bookingRefId || lock.value;
                        duration = Number(parsed.duration) || 30;
                        patientId = parsed.patientId;
                      }
                    } catch {
                      /* ignore */
                    }
                    redisRanges.push({
                      start: startMin,
                      end: startMin + duration,
                      id,
                      status: 'Pending',
                      patientId,
                    });
                  }
                }
              }

              const appointmentRanges = [
                ...(activeAppointments || [])
                  .map((a: any) => {
                    const startMin = this.hhmmToMinutes(a.appointmentTime);
                    if (startMin == null) return null;
                    const duration = Math.max(
                      1,
                      Number(a.appointmentDurationMinutes) || 30
                    );
                    return {
                      start: startMin,
                      end: startMin + duration,
                      id: a.id,
                      status: a.appointmentStatus,
                      patientId: a.patientId,
                    };
                  })
                  .filter(Boolean),
                ...redisRanges,
              ];

              const breaksByAvail: Record<
                string,
                {
                  start: number;
                  end: number;
                  id?: string;
                  breakType?: string;
                }[]
              > = {};
              for (const b of breaks || []) {
                if (!b.startTime || !b.endTime) continue;
                const s = this.hhmmToMinutes(b.startTime);
                const e = this.hhmmToMinutes(b.endTime);
                if (s == null || e == null) continue;
                if (!breaksByAvail[b.clinicAvailabilityId])
                  breaksByAvail[b.clinicAvailabilityId] = [];
                breaksByAvail[b.clinicAvailabilityId].push({
                  start: s,
                  end: e,
                  id: b.id,
                  breakType: b.breakType,
                });
              }

              for (const avail of availRows) {
                const availId = avail.id;
                const startMin = this.hhmmToMinutes(avail.startTime);
                const endMin = this.hhmmToMinutes(avail.endTime);
                if (startMin == null || endMin == null) continue;

                const breakRanges = breaksByAvail[availId] ?? [];
                const slotMinutes = Number(avail.slotMinutes) || 30;
                const bufferMinutes = Number(avail.stepMinutes) || 0;

                // Build a sorted list of all blockers (appointments + breaks) for this avail
                const allBlockers: {
                  start: number;
                  end: number;
                  type: 'appointment' | 'break';
                  data: any;
                }[] = [
                  ...appointmentRanges
                    .filter(
                      (ar) => ar && ar.start < endMin && ar.end > startMin
                    )
                    .map((ar) => ({
                      start: ar!.start,
                      end: ar!.end,
                      type: 'appointment' as const,
                      data: ar,
                    })),
                  ...breakRanges
                    .filter((br) => br.start < endMin && br.end > startMin)
                    .map((br) => ({
                      start: br.start,
                      end: br.end,
                      type: 'break' as const,
                      data: br,
                    })),
                ].sort((a, b) => a.start - b.start);

                /**
                 * Dynamic cursor: try to place a full slot at each position.
                 * On hitting a blocker, emit it and advance to
                 * max(blockerEnd + buffer, next grid position) so the next slot
                 * starts right after it rather than staying on the fixed grid.
                 * Otherwise emit the slot and advance by slotMinutes + buffer.
                 */
                let cursor = startMin;
                let blockerIndex = 0;

                while (cursor + slotMinutes <= endMin) {
                  const slotEnd = cursor + slotMinutes;

                  // Advance blocker index to first blocker that ends after cursor
                  while (
                    blockerIndex < allBlockers.length &&
                    allBlockers[blockerIndex].end <= cursor
                  ) {
                    blockerIndex++;
                  }

                  const nextBlocker =
                    blockerIndex < allBlockers.length
                      ? allBlockers[blockerIndex]
                      : null;

                  // No blocker overlaps this slot — fully available
                  if (!nextBlocker || nextBlocker.start >= slotEnd) {
                    finalSlots.push({
                      start: this.minutesToIso(dateStr, cursor),
                      end: this.minutesToIso(dateStr, slotEnd),
                      clinicAvailabilityId: availId,
                      source: 'availability',
                      status: 'available',
                    });
                    cursor = slotEnd + bufferMinutes;
                    continue;
                  }

                  // Emit the booked/break block (clipped to [cursor, endMin])
                  const blockStart = Math.max(nextBlocker.start, cursor);
                  const blockEnd = Math.min(nextBlocker.end, endMin);

                  if (blockStart < blockEnd) {
                    if (nextBlocker.type === 'appointment') {
                      finalSlots.push({
                        start: this.minutesToIso(dateStr, blockStart),
                        end: this.minutesToIso(dateStr, blockEnd),
                        clinicAvailabilityId: availId,
                        source: 'appointment',
                        status:
                          nextBlocker.data.status === 'Confirmed' ||
                          nextBlocker.data.status === 'Patient Arrived'
                            ? 'booked'
                            : 'reserved',
                        appointmentId: nextBlocker.data.id,
                        appointmentStatus: nextBlocker.data.status,
                        patientId: nextBlocker.data.patientId,
                      });
                    } else {
                      finalSlots.push({
                        start: this.minutesToIso(dateStr, blockStart),
                        end: this.minutesToIso(dateStr, blockEnd),
                        clinicAvailabilityId: availId,
                        source: 'break',
                        status: 'break',
                        breakId: nextBlocker.data.id,
                        breakType: nextBlocker.data.breakType,
                      });
                    }
                  }

                  // Advance cursor to right after the blocker ends (+ buffer),
                  // so the next available slot starts immediately after.
                  cursor = blockEnd + bufferMinutes;
                  blockerIndex++;
                }
              }
            }
          }
        }
      }

      // If caller asked only for occupied slots (appointments), filter
      if ((query as any).onlyOccupied ?? false) {
        finalSlots = finalSlots.filter((x) => x.source === 'appointment');
      }

      // Remove past slots for today based on the time provided (IST)
      const thresholdTime = query.time;
      if (!isTokenBooking && thresholdTime && dateStr) {
        const thresholdMinutes = this.hhmmToMinutes(thresholdTime);
        if (thresholdMinutes !== null) {
          const now = new Date();
          const istTodayYMD = now
            .toLocaleDateString('en-GB', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
            .split('/')
            .reverse()
            .join('-');

          if (dateStr === istTodayYMD) {
            finalSlots = finalSlots.filter((s) => {
              const slotTimePart = s.start.split('T')[1];
              const slotMinutes = this.hhmmToMinutes(slotTimePart);
              return slotMinutes !== null && slotMinutes >= thresholdMinutes;
            });
          }
        }
      }

      finalSlots.sort((a, b) => (a.start < b.start ? -1 : 1));

      // Return slots with shifts array at the root level
      const result: { slots: Slot[]; shifts?: string[] } = {
        slots: finalSlots,
      };

      if (shifts.length > 0) result.shifts = shifts;

      return result;
    });
  }

  static async createGalleryImage(
    doctorId: string,
    imageUrl: string,
    data: CreatePatientGalleryDto
  ) {
    const [result] = await database
      .insert(patientGallery)
      .values({
        appointmentId: data.appointmentId,
        patientId: data.patientId,
        doctorId: doctorId,
        imageUrl,
        description: data.description,
      })
      .returning();

    return result;
  }

  static async getPatientGallery(
    patientId?: string,
    appointmentId?: string,
    page: number = 1,
    limit: number = 30
  ) {
    const offset = (page - 1) * limit;

    // Get total count
    let total = 0;
    if (patientId && appointmentId) {
      const countResult = await database
        .select({ count: sql<number>`count(*)` })
        .from(patientGallery)
        .where(
          and(
            eq(patientGallery.patientId, patientId),
            eq(patientGallery.appointmentId, appointmentId)
          )
        );
      total = Number(countResult[0]?.count) || 0;
    } else if (patientId) {
      const countResult = await database
        .select({ count: sql<number>`count(*)` })
        .from(patientGallery)
        .where(eq(patientGallery.patientId, patientId));
      total = Number(countResult[0]?.count) || 0;
    } else if (appointmentId) {
      const countResult = await database
        .select({ count: sql<number>`count(*)` })
        .from(patientGallery)
        .where(eq(patientGallery.appointmentId, appointmentId));
      total = Number(countResult[0]?.count) || 0;
    } else {
      const countResult = await database
        .select({ count: sql<number>`count(*)` })
        .from(patientGallery);
      total = Number(countResult[0]?.count) || 0;
    }

    let data: any[] = [];
    if (patientId && appointmentId) {
      data = await database
        .select()
        .from(patientGallery)
        .where(
          and(
            eq(patientGallery.patientId, patientId),
            eq(patientGallery.appointmentId, appointmentId)
          )
        )
        .orderBy(desc(patientGallery.createdAt))
        .limit(limit)
        .offset(offset);
    } else if (patientId) {
      data = await database
        .select()
        .from(patientGallery)
        .where(eq(patientGallery.patientId, patientId))
        .orderBy(desc(patientGallery.createdAt))
        .limit(limit)
        .offset(offset);
    } else if (appointmentId) {
      data = await database
        .select()
        .from(patientGallery)
        .where(eq(patientGallery.appointmentId, appointmentId))
        .orderBy(desc(patientGallery.createdAt))
        .limit(limit)
        .offset(offset);
    } else {
      data = await database
        .select()
        .from(patientGallery)
        .orderBy(desc(patientGallery.createdAt))
        .limit(limit)
        .offset(offset);
    }

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  static async getGalleryImageById(id: string) {
    const [result] = await database
      .select()
      .from(patientGallery)
      .where(eq(patientGallery.id, id));

    return result;
  }

  static async deleteGalleryImage(id: string, doctorId: string) {
    const image = await this.getGalleryImageById(id);

    if (!image) {
      throw new HttpError(404, 'Image not found');
    }

    if (image.doctorId != doctorId) {
      throw new HttpError(403, 'You do not have access to delete this image.');
    }

    if (image.imageUrl) {
      await deleteFromS3(image.imageUrl);
    }

    const [result] = await database
      .delete(patientGallery)
      .where(eq(patientGallery.id, id))
      .returning();

    return result;
  }

  static async deleteGalleryImagesByAppointment(
    appointmentId: string,
    doctorId: string
  ) {
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId));

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found');
    }

    if (appointment.doctorId !== doctorId) {
      throw new HttpError(403, 'You do not have access to delete this images.');
    }

    const { data: images } = await this.getPatientGallery(
      undefined,
      appointmentId
    );

    for (const image of images) {
      if (image.imageUrl) {
        await deleteFromS3(image.imageUrl);
      }
    }

    const result = await database
      .delete(patientGallery)
      .where(eq(patientGallery.appointmentId, appointmentId))
      .returning();

    return result;
  }

  static async createDoctorGalleryImage(doctorId: string, imageUrl: string) {
    const [result] = await database
      .insert(doctorGallery)
      .values({
        doctorId: doctorId,
        imageUrl: imageUrl,
      })
      .returning();

    return result;
  }

  static async getDoctorGallery(
    doctorId: string,
    page: number = 1,
    limit: number = 30
  ) {
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await database
      .select({ count: sql<number>`count(*)` })
      .from(doctorGallery)
      .where(eq(doctorGallery.doctorId, doctorId));

    const total = Number(countResult[0]?.count) || 0;

    // Get paginated data
    const data = await database
      .select()
      .from(doctorGallery)
      .where(eq(doctorGallery.doctorId, doctorId))
      .orderBy(desc(doctorGallery.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  static async getDoctorGalleryImageById(id: string) {
    const [result] = await database
      .select()
      .from(doctorGallery)
      .where(eq(doctorGallery.id, id));

    return result;
  }

  static async deleteDoctorGalleryImage(id: string, doctorId: string) {
    const image = await this.getDoctorGalleryImageById(id);

    if (!image) {
      throw new HttpError(404, 'Image not found');
    }

    if (image.doctorId !== doctorId) {
      throw new HttpError(403, 'You do not have access to delete this image.');
    }

    if (image.imageUrl) {
      await deleteFromS3(image.imageUrl);
    }

    // Delete from database
    const [result] = await database
      .delete(doctorGallery)
      .where(eq(doctorGallery.id, id))
      .returning();

    return result;
  }

  private static basePath = path.join(process.cwd(), 'public', 'Doctor Images');

  static async getDoctorGalleryFromLocal(
    doctorId: string,
    page: number = 1,
    limit: number = 30
  ) {
    try {
      // Get doctor's specialty
      const specialtyResult = await database
        .select({ specialty: UserProfessionalModel.speciality })
        .from(UserModel)
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(eq(UserModel.id, doctorId));

      const doctorSpecialty =
        specialtyResult[0]?.specialty || 'General Physician';

      const baseUrl =
        'https://infninity-medisatu.s3.ap-south-1.amazonaws.com/docoter_refernce_images/Doctor%20Images';

      // Check each image with HEAD request
      const validImages: {
        id: string;
        url: string;
        filename: string;
        size: number;
        mimeType: string;
        createdAt: Date;
      }[] = [];

      const checkPromises: Promise<void>[] = [];

      for (let i = 1; i <= 20; i++) {
        const filename = `${doctorSpecialty}${i}.jpg`;
        const url = `${baseUrl}/${encodeURIComponent(doctorSpecialty)}/${encodeURIComponent(filename)}`;

        const checkPromise = fetch(url, { method: 'HEAD' })
          .then((response) => {
            if (response.ok) {
              validImages.push({
                id: filename,
                url: url,
                filename: filename,
                size: 0,
                mimeType: 'image/jpeg',
                createdAt: new Date(),
              });
            }
          })
          .catch(() => {
            // Image doesn't exist, skip
          });

        checkPromises.push(checkPromise);
      }

      await Promise.all(checkPromises);

      if (validImages.length === 0) {
        return {
          data: [],
          pagination: {
            total: 0,
            page,
            limit,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        };
      }

      validImages.sort((a, b) => {
        const numA = parseInt(a.filename.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.filename.match(/\d+/)?.[0] || '0');
        return numA - numB;
      });

      const total = validImages.length;
      const offset = (page - 1) * limit;
      const paginatedFiles = validImages.slice(offset, offset + limit);

      return {
        data: paginatedFiles,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching doctor gallery:', error);
      return {
        data: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    }
  }

  static async getMedicalCertificate(appointmentId: string, clinicId: string) {
    await AppointmentService.assertAppointmentInClinic(appointmentId, clinicId);

    const [result] = await database
      .select()
      .from(medicalCertificateModel)
      .where(eq(medicalCertificateModel.appointmentId, appointmentId));

    return result;
  }

  static async upsertMedicalCertificate(
    appointmentId: string,
    clinicId: string,
    medicalCondition?: string,
    restDays?: number,
    notes?: string[] | null
  ) {
    await AppointmentService.assertAppointmentInClinic(appointmentId, clinicId);

    try {
      const now = new Date();

      const existingCertificate = await database
        .select()
        .from(medicalCertificateModel)
        .where(eq(medicalCertificateModel.appointmentId, appointmentId))
        .limit(1);

      if (existingCertificate.length > 0) {
        const updateData: any = {
          updatedAt: now,
        };

        if (medicalCondition !== undefined)
          updateData.medicalCondition = medicalCondition;
        if (restDays !== undefined) updateData.restDays = restDays;
        if (notes !== undefined) updateData.notes = notes;

        const [updatedCertificate] = await database
          .update(medicalCertificateModel)
          .set(updateData)
          .where(eq(medicalCertificateModel.appointmentId, appointmentId))
          .returning();

        return updatedCertificate;
      } else {
        const [newCertificate] = await database
          .insert(medicalCertificateModel)
          .values({
            appointmentId: appointmentId,
            medicalCondition: medicalCondition || '',
            restDays: restDays || 0,
            notes: notes || [],
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        return newCertificate;
      }
    } catch {
      throw new HttpError(
        500,
        'An unexpected error occurred while saving medical certificate'
      );
    }
  }
}
