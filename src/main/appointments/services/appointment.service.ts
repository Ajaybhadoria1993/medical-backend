/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import {
  ScheduleShiftService,
  toHHMM,
} from '../../appointment-engine/services/scheduleShift.service';
import { database } from '../../../configurations/dbConnection';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { HttpError } from '../../../middlewear/errorHandler';
import { envConfig, notificationsEnabled } from '../../../utils/envConfig';
import { ExaminationService } from '../../examination';
import { notify } from '../../notifications/queues/notification.queue';
import { CacheKeys, invalidateCacheByPattern } from '../../../utils/cache.util';
import logger from '../../../utils/logger';
import { lockDoctorDay } from '../../../utils/doctorDayLock';
import {
  getUserById,
  notifyAppointmentCanceled,
  notifyAppointmentConfirmed,
  notifyAppointmentCreated,
  notifyAppointmentRescheduled,
} from '../../../utils/notificationHelpers';
import { broadcastAppointmentChange } from '../../../utils/appointmentRealtime';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { doctorScopeFilter } from '../../permissions/utils/staffScope.utils';
import { ClinicCancellationPolicyModel } from '../../cancellation-policy/models/cancellationPolicy.model';
import { ClinicSymptomCountModel } from '../../clinic/models/clinic-symptom-count.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import { ClinicSymptomService } from '../../clinic/services/clinic-symptom.service';
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
import { AppointmentNotificationService } from '../../notifications/services/appointmentNotification.service';
import { whatsAppReminderQueue } from '../../notifications/services/appointmentWhatsappReminder.service';
import {
  ReportCardModel,
  PrescriptionModel,
} from '../../reports/models/reports.model';
import { UserModel } from '../../users/models/user.model';
import { UserService } from '../../users/services/user.service';
import {
  APPOINTMENT_TYPE_CONSULTATION,
  APPOINTMENT_TYPE_CUSTOM,
  APPOINTMENT_TYPE_TREATMENT,
  isOverrideAppointmentType,
} from '../utils/appointmentType.constants';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { AppointmentClinicalModel } from '../models/appointmentClinical.model';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import {
  PaymentMode,
  normalizePaymentMode,
  isPayLaterMode,
  isOnlinePaymentMode,
} from '../utils/paymentMode.constants';
import { AppointmentMoneySync } from './appointmentMoneySync.service';
import { MoneyReadService, SYSTEM_ACTOR_ID } from '../../money';
import { AppointmentModel } from '../models/appointment.model';
import { DoctorReviewsModel } from '../../doctor/models/doctorReview.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';
import {
  appointmentInstantIST,
  getISTDateString,
  toStoredAppointmentDate,
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
import { doctorManualPrescriptionModel } from '../models/doctorManualPrescription.model';
import { PaymentReservationService } from './paymentReservation.service';
import {
  createAppointmentDto,
  createCustomAppointmentDto,
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
import { coveringVisit } from '../utils/serviceCoverage.utils';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

const DOCTOR_ONLY_STATUSES = new Set(['Confirmed', 'Completed']);
// Roles that may only confirm/complete their own appointments; Receptionist and Nurse are not here.
const DOCTOR_OWNED_ROLES = new Set(['Doctor', 'Admin', 'Super_Admin']);

/** Re-export; the query must join AppointmentPaymentModel (the filter reads appointment_payments). */
export const buildActiveAppointmentFilter =
  PaymentReservationService.buildActiveAppointmentFilter;
export const filterExpiredPendingAppointments =
  PaymentReservationService.filterExpiredPendingAppointments;

/** Minutes since midnight; accepts "9:00", "09:00 AM", "5:30PM", "17:30". */
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

/** English weekday name (e.g. "Monday"), as stored in availability. */
function getDayNameFromDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

/** Booking, updates, lists, slots/tokens, payments, gallery and certificates for clinic appointments. */
export class AppointmentService {
  /** Checks a normal booking against the doctor's schedule, slots/tokens and duplicates. */
  static async validateAppointmentBooking(
    userId: string,
    clinicId: string,
    payload: createAppointmentDto,
    performerUserId?: string,
    tx: any = database
  ) {
    // Shape is validated at the route; patientId is optional there, so re-check the pair.
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
      symptomNames: _symptomNames,
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

    // Independent reads run in parallel. Not cached: these reads and the Redis holds
    // are the double-booking guard.
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

    // Resolve shift + capacity per session, so evening patients don't get morning numbers.
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

    const istTodayYMD = getISTDateString(now);

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
      // Only this shift's tokens compete; null-session (legacy) rows count as session 1.
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

      // First free token in THIS session; numbering restarts at 1 per shift.
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

  /** Override booking: only checks future slot, active doctor/patient/service and token clash.
   * Skips schedule, hours, breaks and one-per-day rules. Auth is the route's requirePermission. */
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

    // Only the date is checked: staff often enter a walk-in after it happened.
    const now = new Date();
    const istTodayYMD = getISTDateString(now);

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

    // Availability is read for slot length only; a missing row is normal on an off day.
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

    // 0/absent slotMinutes means a token day with no grid, so fall back to the 30-min default.
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

    // Token clash still blocked (breaks queue order); max-token limit is not, that's the override.
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
    } else if (isPayLaterMode(payload.paymentMode)) {
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

  /** options.customSlot switches to the override validator; set only by the /custom route,
   * never from the body, or the normal endpoint becomes a bypass. */
  static async createAppointment(
    userId: string,
    clinicId: string,
    payload: createAppointmentDto,
    performerUserId?: string,
    options?: {
      customSlot?: { reason?: string | null };
      /** Set only by the treatment plan adapter: books a plan step as a "Treatment" visit. */
      treatment?: boolean;
    }
  ) {
    const isCustomSlot = !!options?.customSlot;

    const created = await database.transaction(async (trx) => {
      // Lock doctor+date before validation so two concurrent bookings can't both see a slot free.
      const lockDate = new Date(payload.appointmentDate);
      if (payload.doctorId && !Number.isNaN(lockDate.getTime())) {
        await lockDoctorDay(trx, payload.doctorId, lockDate);
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
      // Status derived from payment mode; clients rarely send paymentStatus, else all land as Paid.
      const _paymentStatus =
        payload.paymentStatus ?? derivedPaymentStatus ?? 'Paid';
      // A paid booking must say how it was paid; an explicit status can't skip the mode.
      if (_paymentStatus.toLowerCase() === 'paid' && !_paymentMode?.trim()) {
        throw new HttpError(400, 'Choose how the patient paid');
      }
      const _price = payload.price ?? null;
      const _primarySvcPrice = payload.primaryServicePrice ?? null;
      const _paymentNotes = payload.paymentNotes ?? null;

      const [appointment] = await trx
        .insert(AppointmentModel)
        .values({
          // Marks override rows (free-text type, no schema change); re-checked so no caller can
          // land a non-override type on an unvalidated booking.
          appointmentType: isCustomSlot
            ? isOverrideAppointmentType(payload.appointmentType)
              ? (payload.appointmentType as string)
              : APPOINTMENT_TYPE_CUSTOM
            : options?.treatment
              ? APPOINTMENT_TYPE_TREATMENT
              : APPOINTMENT_TYPE_CONSULTATION,
          appointmentDate: toStoredAppointmentDate(apptDateObj),
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

      // Override audit (who + why), awaited inside the tx: an unrecorded override must never exist.
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

      // Insert payment data into separate table
      await trx.insert(AppointmentPaymentModel).values({
        appointmentId: appointment.id,
        paymentMode: _paymentMode ? normalizePaymentMode(_paymentMode) : null,
        paymentStatus: _paymentStatus ?? 'Paid',
        price: _price ?? null,
        primaryServicePrice: _primarySvcPrice ?? _price ?? null,
        paymentNotes: _paymentNotes ?? null,
      });
      // Paid at the desk while booking: record that payment directly. Pay Later, free and online
      // bookings take no money here (online money arrives through the Razorpay confirm paths).
      const bookedMode = _paymentMode
        ? normalizePaymentMode(_paymentMode)
        : null;
      const paidAtDesk =
        ['paid', 'already paid'].includes(
          String(_paymentStatus ?? 'Paid').toLowerCase()
        ) &&
        !!bookedMode &&
        !isPayLaterMode(bookedMode) &&
        !isOnlinePaymentMode(bookedMode, null);
      await AppointmentMoneySync.afterChange(
        trx,
        appointment.id,
        performerUserId || userId,
        paidAtDesk
          ? {
              move: {
                kind: 'pay',
                paymentMode: bookedMode,
                channel: 'desk',
                requestId: `appt:${appointment.id}:booking`,
              },
            }
          : { chargesOnly: true }
      );

      // Insert clinical data into separate table
      const { commonSymptoms } = payload;
      const namedSymptomIds = await ClinicSymptomService.resolveIdsByName(
        trx,
        clinicId,
        payload.symptomNames ?? []
      );
      const clinicSymptomIds = [
        ...new Set([...(payload.clinicSymptomIds ?? []), ...namedSymptomIds]),
      ];
      await trx.insert(AppointmentClinicalModel).values({
        appointmentId: appointment.id,
        commonSymptoms: commonSymptoms ?? [],
        clinicSymptomIds: clinicSymptomIds ?? [],
        appointmentNotes: appointmentNotes ?? null,
      });

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

      // One upsert for all symptoms; ids are de-duplicated above, which a multi-row upsert requires.
      if (clinicSymptomIds && clinicSymptomIds.length > 0) {
        const dateStr = apptDateObj.toISOString().split('T')[0];
        await trx
          .insert(ClinicSymptomCountModel)
          .values(
            clinicSymptomIds.map((symptomId) => ({
              symptomId,
              date: dateStr,
              count: 1,
            }))
          )
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
            ? // A plan visit takes no fee here because the plan bills it, not because it is free.
              appointment.appointmentType === APPOINTMENT_TYPE_TREATMENT
              ? 'Billed through the treatment plan; nothing is collected on this visit'
              : 'Payment not required for this appointment as it is free consultation'
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

      // Clear reception overview cache (60s, one key per doctor scope) so counts update now.
      await invalidateCacheByPattern(
        CacheKeys.receptionOverviewPattern(clinicId)
      );

      return appointment;
    });

    // Notify after commit: it uses another connection, so a rollback could orphan it.
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

    // After commit: the notification reads the appointment, so the row must be visible.
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

    // Realtime: recompute the queue after commit (the tx can't see the row), then signal.
    if (created) {
      // Retire dashboard caches now: this request's own client refetches on the
      // response, well before the queue recalculation below lets the signal go.
      void invalidateClinicDashboardCaches(clinicId);
      const createdDay = getISTDateString(new Date(created.appointmentDate));
      const isTodayQueue =
        Boolean(createdDoctorId && created.appointmentTime) &&
        createdDay === getISTDateString();

      const refreshQueue = isTodayQueue
        ? import('../../appointment-engine/services/delayTracker.service').then(
            async ({ DelayTrackerService }) => {
              const queueData = await new DelayTrackerService().recalculate(
                clinicId,
                createdDoctorId!,
                createdDay
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

  /** Runs after the update commits: WhatsApp calls must not run while rows are locked. */
  private static async dispatchUpdateNotifications(
    updated: typeof AppointmentModel.$inferSelect,
    payload: UpdateAppointmentDto,
    performerUserId?: string
  ): Promise<void> {
    const performer = await getUserById(performerUserId || 'system');
    if (!performer) return;

    // Check reschedule before status branches, or a rescheduled Confirmed appt never notifies.
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
      // In-app only: one WhatsApp per appointment, already sent at booking.
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

  /** A paid visit can't be cancelled while "Covered" visits still lean on it, or they'd stay free with nothing paid.
   * ponytail: blocks even if another paid visit could cover them too; re-evaluate dependents if that becomes common. */
  static async assertNoCoveredDependents(
    trx: DbTransaction,
    parent: typeof AppointmentModel.$inferSelect
  ) {
    if (!parent.clinicServiceId || !parent.appointmentDate) return;

    const [payment] = await trx
      .select({
        paymentMode: AppointmentPaymentModel.paymentMode,
        paymentStatus: AppointmentPaymentModel.paymentStatus,
      })
      .from(AppointmentPaymentModel)
      .where(eq(AppointmentPaymentModel.appointmentId, parent.id))
      .limit(1);
    if (!payment?.paymentMode || payment.paymentStatus === 'Refunded') return;

    const [service] = await trx
      .select({ durationDays: ClinicServiceModel.durationDays })
      .from(ClinicServiceModel)
      .where(eq(ClinicServiceModel.id, parent.clinicServiceId))
      .limit(1);
    const days = Number(service?.durationDays ?? 0);
    if (days <= 0) return;

    // Lower bound also catches visits wrongly covered by a later parent (old booking bug).
    const from = new Date(parent.appointmentDate);
    from.setDate(from.getDate() - days);
    const to = new Date(parent.appointmentDate);
    to.setDate(to.getDate() + days);

    const dependents = await trx
      .select({ appointmentDate: AppointmentModel.appointmentDate })
      .from(AppointmentModel)
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentModel.id, AppointmentPaymentModel.appointmentId)
      )
      .where(
        and(
          eq(AppointmentModel.clinicId, parent.clinicId),
          eq(AppointmentModel.patientId, parent.patientId),
          eq(AppointmentModel.doctorId, parent.doctorId!),
          eq(AppointmentModel.clinicServiceId, parent.clinicServiceId),
          ne(AppointmentModel.id, parent.id),
          gte(AppointmentModel.appointmentDate, from),
          lte(AppointmentModel.appointmentDate, to),
          inArray(AppointmentModel.appointmentStatus, [
            'Completed',
            'Confirmed',
            'Pending',
          ]),
          isNull(AppointmentPaymentModel.paymentMode),
          eq(AppointmentPaymentModel.paymentStatus, 'Already Paid')
        )
      )
      .orderBy(asc(AppointmentModel.appointmentDate));

    if (dependents.length) {
      const dates = dependents
        .map((d) =>
          new Date(d.appointmentDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          })
        )
        .join(', ');
      throw new HttpError(
        409,
        `This visit's payment covers the visit on ${dates}. Cancel that visit or collect its payment first.`
      );
    }
  }

  /** Refund only what this visit took; returns the add-on method an unpaid-consultation refund records. */
  static async checkRefundAmount(
    trx: DbTransaction,
    appointmentId: string,
    payload: UpdateAppointmentDto,
    existingPaymentRecord:
      typeof AppointmentPaymentModel.$inferSelect | undefined,
    isRefundRequest: boolean,
    primaryUnpaid: boolean
  ): Promise<string | null> {
    let refundAddOnMode: string | null = null;
    if (!payload.refundedAmount && !isRefundRequest) return refundAddOnMode;

    const addOns = await trx
      .select({
        price: appointmentMultipleService.price,
        paymentMode: appointmentMultipleService.paymentMode,
      })
      .from(appointmentMultipleService)
      .where(eq(appointmentMultipleService.appointmentId, appointmentId));
    const addOnTotal = addOns.reduce((sum, s) => sum + Number(s.price ?? 0), 0);
    // The consultation took nothing, so the refund covers paid add-ons only and the record takes their method.
    if (isRefundRequest && primaryUnpaid) {
      if (addOnTotal <= 0) {
        throw new HttpError(
          400,
          'Nothing was collected for this visit, so there is nothing to refund'
        );
      }
      refundAddOnMode =
        addOns.find((s) => s.paymentMode?.trim())?.paymentMode ?? null;
    }
    // Older rows lack primaryServicePrice; price is the running total, so back the add-ons out.
    const primaryPrice =
      existingPaymentRecord?.primaryServicePrice != null
        ? Number(existingPaymentRecord.primaryServicePrice)
        : Math.max(0, Number(existingPaymentRecord?.price ?? 0) - addOnTotal);
    const refundable = (primaryUnpaid ? 0 : primaryPrice) + addOnTotal;
    if (Number(payload.refundedAmount) > refundable + 0.005) {
      throw new HttpError(
        400,
        `Refund cannot exceed ₹${refundable.toFixed(2)} collected for this visit`
      );
    }
    return refundAddOnMode;
  }

  /** Re-resolves the session when date/token changes, so a token never lands in the wrong shift. */
  static async resolveTokenPlacement(
    trx: DbTransaction,
    existing: typeof AppointmentModel.$inferSelect,
    payload: UpdateAppointmentDto,
    newDate: Date
  ): Promise<number | null | undefined> {
    const isTokenBasedAppointment =
      existing.tokenNo !== null || payload.tokenNo;
    const tokenPlacementChanged = Boolean(
      payload.appointmentDate || typeof payload.tokenNo !== 'undefined'
    );
    if (!isTokenBasedAppointment || !tokenPlacementChanged) return undefined;

    const targetDate = newDate.toISOString().split('T')[0];
    const session = await TokenSessionService.resolve(
      trx,
      existing.clinicId,
      existing.doctorId!,
      targetDate,
      // Explicit session wins; otherwise inferred the same way booking does.
      payload.sessionIndex ?? null
    );

    const targetToken = payload.tokenNo ?? existing.tokenNo;

    // Clash check, so a taken token reads as a 400, not a raw unique-index error.
    if (targetToken != null) {
      const [clash] = await trx
        .select({ id: AppointmentModel.id })
        .from(AppointmentModel)
        .where(
          and(
            eq(AppointmentModel.clinicId, existing.clinicId),
            eq(AppointmentModel.doctorId, existing.doctorId!),
            eq(AppointmentModel.appointmentDate, newDate),
            eq(AppointmentModel.tokenNo, targetToken),
            ne(AppointmentModel.id, existing.id),
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

    return session.sessionIndex;
  }

  /** Writes the payment row; returns whether anything was actually written. */
  static async savePaymentChanges(
    trx: DbTransaction,
    appointmentId: string,
    payload: UpdateAppointmentDto,
    paymentSetObj: Record<string, any>,
    existingPayment: typeof AppointmentPaymentModel.$inferSelect | undefined
  ): Promise<boolean> {
    if (Object.keys(paymentSetObj).length === 0) return false;
    paymentSetObj.updatedAt = new Date();

    if (!existingPayment) {
      await trx.insert(AppointmentPaymentModel).values({
        appointmentId,
        // Said here, not left to the column default: paid only for a real mode, never Pay Later.
        paymentStatus:
          paymentSetObj.paymentMode &&
          !isPayLaterMode(paymentSetObj.paymentMode as string)
            ? 'Paid'
            : 'Pending',
        ...paymentSetObj,
      });
      return true;
    }

    const alreadyPaid = existingPayment.paymentStatus?.toLowerCase() === 'paid';
    const requestedStatus = payload.paymentStatus?.toLowerCase();

    // Two receptionists may hold the same appointment open: never undo
    // a collection the second one can't see, nor collect it twice.
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

    // updatedAt alone is not a change.
    if (Object.keys(paymentSetObj).length <= 1) return false;
    await trx
      .update(AppointmentPaymentModel)
      .set(paymentSetObj)
      .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
    return true;
  }

  /** Upserts the clinical row; returns whether anything was written. */
  static async saveClinicalChanges(
    trx: DbTransaction,
    appointmentId: string,
    clinicalSetObj: Record<string, any>
  ): Promise<boolean> {
    if (Object.keys(clinicalSetObj).length === 0) return false;
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
    return true;
  }

  /** Picks the one activity-log entry for an update; the highest-priority action wins. */
  static describeActivity(
    payload: UpdateAppointmentDto,
    existing: typeof AppointmentModel.$inferSelect,
    updated: typeof AppointmentModel.$inferSelect,
    previousPaymentStatus: string | null,
    performerUserType?: string
  ) {
    type Action =
      | 'UPDATED'
      | 'CONFIRMED'
      | 'STATUS_CHANGED'
      | 'RESCHEDULED'
      | 'PATIENT_ARRIVED'
      | 'CANCELLED'
      | 'COMPLETED'
      | 'PAYMENT_STATUS'
      | 'VITALS_UPDATED';
    const actions: Action[] = [];
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

    if (payload.vitals && performerUserType?.toLowerCase() === 'receptionist') {
      actions.push('VITALS_UPDATED');
      remarks = `Vitals updated`;
    }

    if (
      payload.paymentStatus &&
      payload.paymentStatus !== previousPaymentStatus
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

    const priority: Action[] = [
      'CANCELLED',
      'CONFIRMED',
      'COMPLETED',
      'RESCHEDULED',
      'PATIENT_ARRIVED',
      'STATUS_CHANGED',
      'PAYMENT_STATUS',
      'VITALS_UPDATED',
    ];
    const primaryAction: Action =
      priority.find((a) => actions.includes(a)) ?? 'UPDATED';
    return { primaryAction, remarks };
  }

  /** The realtime event name for an update, most significant change first. */
  static realtimeActionFor(
    payload: UpdateAppointmentDto
  ): import('../../../utils/appointmentRealtime').AppointmentRealtimeAction {
    if (payload.appointmentStatus === 'Cancelled') return 'cancelled';
    if (payload.appointmentStatus === 'Confirmed') return 'confirmed';
    if (payload.appointmentStatus === 'Completed') return 'completed';
    if (payload.appointmentStatus === 'NoShow') return 'noshow';
    if (payload.appointmentDate || payload.appointmentTime)
      return 'rescheduled';
    if (payload.paymentStatus) return 'payment_updated';
    if (payload.vitals) return 'vitals_updated';
    return 'updated';
  }

  /** Parks whoever is in the doctor's room and puts this appointment in, stamping both consultation times. */
  private static async takeRoomOnConfirm(
    clinicId: string,
    doctorId: string,
    day: string,
    appointmentId: string
  ) {
    const displaced = await getCurrentAppointmentId(clinicId, doctorId, day);
    if (displaced && displaced !== appointmentId) {
      await holdAppointment(clinicId, doctorId, day, displaced, 'held');
      // The room changing hands ends the previous consultation; record when.
      await setConsultationEndedAt(
        clinicId,
        doctorId,
        day,
        new Date().toISOString()
      );
    }
    // Confirming supersedes any hold on the patient being taken in.
    await resumeAppointment(clinicId, doctorId, day, appointmentId);
    await setCurrentAppointment(clinicId, doctorId, day, appointmentId);
    // Stamp consultation start, same as QueueService.putInRoom.
    await setConsultationStartedAt(
      clinicId,
      doctorId,
      day,
      new Date().toISOString()
    );
  }

  /** Updates an appointment and fires post-commit notifications and realtime signals. */
  static async updateAppointment(
    appointmentId: string,
    payload: UpdateAppointmentDto,
    performerUserId?: string,
    performerUserType?: string,
    ctx?: {
      previousPayment?: typeof AppointmentPaymentModel.$inferSelect | null;
    }
  ) {
    updateAppointmentSchema.parse(payload);

    // Captured in the transaction for post-commit hooks and the realtime signal;
    // the flags let clinical/payment-only edits signal too.
    let previousAppointmentStatus: string | null = null;
    let previousAppointmentDate: Date | string | null = null;
    let clinicalChanged = false;
    let paymentChanged = false;
    // Queue jobs and broadcasts collected in the transaction; they run only once it commits.
    const afterCommit: Array<() => Promise<unknown>> = [];

    const updated = await database.transaction(async (trx) => {
      // ─── Load existing appointment + payment ───
      const [existing] = await trx
        .select()
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, appointmentId));
      if (!existing || !existing.doctorId) {
        throw new HttpError(404, 'Appointment not found');
      }

      // Starting or finishing a consultation is the doctor's own act; reception keeps its assignment scope.
      const isStatusChange =
        payload.appointmentStatus !== undefined &&
        payload.appointmentStatus !== existing.appointmentStatus;
      if (
        isStatusChange &&
        DOCTOR_ONLY_STATUSES.has(payload.appointmentStatus!) &&
        DOCTOR_OWNED_ROLES.has(performerUserType ?? '') &&
        performerUserId !== existing.doctorId
      ) {
        throw new HttpError(
          403,
          "Only this appointment's doctor can confirm or complete it"
        );
      }

      // Cancelling must pass the clinic's cancellation policy and leave no covered visits orphaned.
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
        await AppointmentService.assertNoCoveredDependents(trx, existing);
      }

      previousAppointmentStatus = existing.appointmentStatus;
      previousAppointmentDate = existing.appointmentDate;

      const [existingPaymentRecord] = await trx
        .select()
        .from(AppointmentPaymentModel)
        .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));
      if (ctx) ctx.previousPayment = existingPaymentRecord ?? null;

      const previousPaymentStatus =
        existingPaymentRecord?.paymentStatus ?? null;

      // A covered (no mode), free or unpaid primary took no money on this visit.
      const primaryUnpaid =
        !existingPaymentRecord?.paymentMode ||
        ['already paid', 'pending', 'free consultation'].includes(
          String(existingPaymentRecord?.paymentStatus ?? '').toLowerCase()
        );

      // Same states the UI offers a refund in; Confirmed is the convert-to-free path.
      const isRefundRequest =
        payload.paymentStatus?.toLowerCase() === 'refunded';
      const statusAfter =
        payload.appointmentStatus ?? existing.appointmentStatus;
      if (
        isRefundRequest &&
        !['Cancelled', 'NoShow', 'Confirmed'].includes(statusAfter)
      ) {
        throw new HttpError(
          400,
          `Cannot refund an appointment that is ${statusAfter}`
        );
      }

      const refundAddOnMode = await AppointmentService.checkRefundAmount(
        trx,
        appointmentId,
        payload,
        existingPaymentRecord,
        isRefundRequest,
        primaryUnpaid
      );

      // ─── Token / session placement ───
      const rawDate = payload.appointmentDate
        ? new Date(payload.appointmentDate)
        : new Date(existing.appointmentDate);
      if (Number.isNaN(rawDate.getTime())) {
        throw new HttpError(400, 'Invalid appointmentDate');
      }
      // Reschedule sends a date+time instant; stored as the same day-at-midnight shape booking writes.
      const newDate = payload.appointmentDate
        ? toStoredAppointmentDate(rawDate)
        : rawDate;
      // Only a date change is checked, so editing a past visit's payment or notes still saves.
      const newDateIST = getISTDateString(newDate);
      // Arrived/Confirmed put the patient in today's queue, so the visit must be dated today.
      if (
        isStatusChange &&
        ['Confirmed', 'Patient Arrived'].includes(payload.appointmentStatus!) &&
        newDateIST !== getISTDateString()
      ) {
        throw new HttpError(409, 'Move this appointment to today first');
      }
      if (
        payload.appointmentDate &&
        newDateIST !== getISTDateString(new Date(existing.appointmentDate)) &&
        newDateIST < getISTDateString()
      ) {
        throw new HttpError(400, 'Appointment date cannot be in the past');
      }
      const now = new Date();

      const newTime =
        typeof payload.appointmentTime !== 'undefined'
          ? payload.appointmentTime
          : existing.appointmentTime;

      const resolvedSessionIndex =
        await AppointmentService.resolveTokenPlacement(
          trx,
          existing,
          payload,
          newDate
        );

      // Only end the plan this visit paid for; a covered visit's plan belongs to the earlier paid visit.
      if (isRefundRequest && !primaryUnpaid && existing.clinicServiceId) {
        await trx
          .update(ClinicAppointmentPlainModel)
          .set({
            paymentStatus: 'refunded',
            status: 'inactive',
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
      // ─── Build update sets (only provided fields) ───
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

      // ─── Late patient handling ───
      // First arrival only: stamp arrivedAt and apply the clinic's late policy.
      if (
        payload.appointmentStatus === 'Patient Arrived' &&
        !existing.arrivedAt
      ) {
        const arrivedAt = new Date();
        setObj.arrivedAt = arrivedAt;

        // Reception can waive the late penalty (keepQueuePosition).
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

        // An arrived patient isn't a no-show: cancel the grace-timer job.
        afterCommit.push(() => autoNoShowQueue.removeAutoNoShow(appointmentId));
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

      // An unpaid consultation stays ₹0 received once refunded; otherwise every money screen counts it as paid.
      if (isRefundRequest && primaryUnpaid) {
        paymentSetObj.primaryServicePrice = '0';
        if (refundAddOnMode) paymentSetObj.paymentMode = refundAddOnMode;
      }

      // Every money record names its method, so no screen has to show a payment as "Unknown".
      const finalPaymentStatus = payload.paymentStatus?.toLowerCase();
      if (
        finalPaymentStatus === 'paid' &&
        !(
          paymentSetObj.paymentMode ?? existingPaymentRecord?.paymentMode
        )?.trim()
      ) {
        throw new HttpError(
          400,
          'Choose how the patient paid before marking this visit paid'
        );
      }
      if (finalPaymentStatus === 'refunded' && !payload.refundMode?.trim()) {
        throw new HttpError(400, 'Choose how the refund was given');
      }

      // Clinical fields → AppointmentClinicalModel
      if (typeof payload.appointmentNotes !== 'undefined')
        clinicalSetObj.appointmentNotes = payload.appointmentNotes;
      if (payload.consentNotes)
        clinicalSetObj.consentNotes = payload.consentNotes;
      if (payload.clinicSymptomIds)
        clinicalSetObj.clinicSymptomIds = payload.clinicSymptomIds;
      if (payload.vitals) clinicalSetObj.vitals = payload.vitals;
      if (payload.referrals) clinicalSetObj.referrals = payload.referrals;

      if (payload.bookingSource) setObj.bookingSource = payload.bookingSource;

      if (payload.reReasonForCancellation)
        setObj.reReasonForCancellation = payload.reReasonForCancellation;

      if (payload.reasionForReSchedule)
        setObj.reasionForReSchedule = payload.reasionForReSchedule;

      if (typeof payload.tokenNo !== 'undefined')
        setObj.tokenNo = payload.tokenNo;

      // Session is written with the token; prefer the recomputed one over the caller's.
      if (typeof resolvedSessionIndex !== 'undefined')
        setObj.sessionIndex = resolvedSessionIndex;
      else if (typeof payload.sessionIndex !== 'undefined')
        setObj.sessionIndex = payload.sessionIndex;

      setObj.updatedAt = new Date();

      const [updated] = await trx
        .update(AppointmentModel)
        .set(setObj)
        .where(eq(AppointmentModel.id, appointmentId))
        .returning();

      if (!updated) throw new HttpError(400, 'Failed to update appointment');

      paymentChanged = await AppointmentService.savePaymentChanges(
        trx,
        appointmentId,
        payload,
        paymentSetObj,
        existingPaymentRecord
      );

      // Bill changes only: money moves through the payments/refunds endpoints, never a status.
      if (paymentChanged || payload.appointmentStatus)
        await AppointmentMoneySync.afterChange(
          trx,
          appointmentId,
          performerUserId ?? SYSTEM_ACTOR_ID,
          { chargesOnly: true }
        );

      clinicalChanged = await AppointmentService.saveClinicalChanges(
        trx,
        appointmentId,
        clinicalSetObj
      );

      // ─── Reminders & queue recalculation on reschedule ───
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
        // IST day: the key every engine queue is stored under.
        const dateStr = getISTDateString(new Date(updated.appointmentDate));
        if (dateStr === getISTDateString()) {
          const doctorId = updated.doctorId;
          afterCommit.push(async () => {
            new AppointmentEngineOrchestrator()
              .onReschedule(existing.clinicId, doctorId, dateStr)
              .catch(() => {});
          });
        }
      }

      if (notificationsEnabled())
        afterCommit.push(async () => {
          if ((dateChanged || timeChanged) && updated.appointmentTime) {
            const appointmentDateTime = appointmentInstantIST(
              updated.appointmentDate,
              updated.appointmentTime
            );

            const [clinic_name] = await database
              .select({ clinicName: ClinicModel.clinicName })
              .from(ClinicModel)
              .where(eq(ClinicModel.id, existing.clinicId));

            const [patient] = await database
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

              await whatsAppReminderQueue.scheduleWhatsAppReminders(
                updated.id,
                patient.mobile,
                existing.clinicId,
                clinic_name.clinicName,
                appointmentDateTime,
                null
              );

              // Re-arm the running-late check for the new time.
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
              }
            }
          } else if (
            payload.appointmentStatus === 'Cancelled' ||
            payload.appointmentStatus === 'Completed' ||
            payload.appointmentStatus === 'NoShow'
          ) {
            await autoNoShowQueue.removeAutoNoShow(appointmentId);

            import('../../appointment-engine/services/runningLateQueue.service')
              .then(({ runningLateQueue }) =>
                runningLateQueue.cancelCheck(appointmentId)
              )
              .catch(() => {});
          }
        });

      // ─── Activity log ───
      const { primaryAction, remarks } = AppointmentService.describeActivity(
        payload,
        existing,
        updated,
        previousPaymentStatus,
        performerUserType
      );

      await AppointmentActivityHistoryService.logActivity({
        appointmentId: updated.id,
        action: primaryAction,
        performedBy: performerUserId || 'system',
        previousState: existing,
        newState: updated,
        remarks: remarks,
        tx: trx,
      });

      // Realtime broadcast to the clinic room.
      afterCommit.push(async () =>
        broadcastAppointmentChange({
          appointmentId: updated.id,
          clinicId: updated.clinicId,
          doctorId: updated.doctorId || undefined,
          patientId: updated.patientId,
          action: AppointmentService.realtimeActionFor(payload),
          performerUserId: performerUserId || 'system',
          data: {
            appointmentStatus: updated.appointmentStatus,
            appointmentDate: updated.appointmentDate,
            appointmentTime: updated.appointmentTime,
          },
        })
      );

      return updated;
    });

    // The save is committed, so a failed queue job is logged rather than failing the request.
    for (const job of afterCommit) {
      try {
        await job();
      } catch (err) {
        logger.error(
          `[Appointment] post-commit step failed for appointment=${updated.id}`,
          { error: err }
        );
      }
    }

    // ─── Patient notifications (post-commit, fire-and-forget) ───
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

    // ─── Appointment engine hook (post-commit, never throws) ───
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

    // The visit's IST day, which every queue/room key below is scoped to.
    const queueDay = getISTDateString(new Date(updated.appointmentDate));

    // ─── Arriving clears any hold ───
    if (
      updated?.doctorId &&
      payload.appointmentStatus === 'Patient Arrived' &&
      previousAppointmentStatus !== 'Patient Arrived'
    ) {
      // Awaited: every screen refetches on the signal below.
      try {
        await resumeAppointment(
          updated.clinicId,
          updated.doctorId,
          queueDay,
          updated.id
        );
      } catch (err) {
        logger.warn(
          `[Queue] Failed to clear hold on check-in for appointment=${updated.id}`,
          err
        );
      }
    }

    // ─── Doctor/Admin confirming takes the room ───
    // Whoever was in the room is parked; reception confirming doesn't move the room.
    if (
      updated?.doctorId &&
      payload.appointmentStatus === 'Confirmed' &&
      previousAppointmentStatus !== 'Confirmed' &&
      (performerUserType === 'Doctor' || performerUserType === 'Admin')
    ) {
      try {
        await AppointmentService.takeRoomOnConfirm(
          updated.clinicId,
          updated.doctorId,
          queueDay,
          updated.id
        );
        void AppointmentNotificationService.sendPatientWhatsApp(
          updated.id,
          'consultationStarted'
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

    // ─── Terminal status empties the room ───
    // Awaited so screens never refetch a queue still naming this row.
    if (
      updated?.doctorId &&
      payload.appointmentStatus &&
      payload.appointmentStatus !== previousAppointmentStatus &&
      ['Completed', 'Cancelled', 'NoShow'].includes(payload.appointmentStatus)
    ) {
      await endConsultationIfOccupant(
        updated.clinicId,
        updated.doctorId,
        queueDay,
        updated.id
      );
    }

    // ─── Realtime signal ───
    // Status, reschedule, clinical-only or payment-only edits all refresh open screens.
    if (updated) {
      const statusChanged = Boolean(
        payload.appointmentStatus &&
        previousAppointmentStatus &&
        payload.appointmentStatus !== previousAppointmentStatus
      );
      // A token moved to another shift is a reschedule too, even on the same day.
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

      // Payment recorded: clear the desk's action notification (fire-and-forget).
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

      // Tell the desk a consultation finished; only on a real status change.
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

  /** Escapes %, _ and \ so user text is matched literally in LIKE. */
  static escapeLike(s: string) {
    return s.replace(/[%_\\]/g, (m) => `\\${m}`);
  }

  /** Name of whoever last changed this appointment's payment status. */
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

  /** One appointment's full details, if the requesting user may see it. */
  static async getAppointmentDetails(
    appointmentId: string,
    requestingUser: { id: string; userType: string; clinicId?: string }
  ) {
    const DoctorUser = alias(UserModel, 'doctor');
    const trx = database;
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
      case 'Nurse':
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
          paymentNotes: AppointmentPaymentModel.paymentNotes,
          transactionId: AppointmentPaymentModel.transactionId,
          gatewayOrderId: AppointmentPaymentModel.gatewayOrderId,
          gatewayResponse: AppointmentPaymentModel.gatewayResponse,
          consentNotes: AppointmentClinicalModel.consentNotes,
          consentFile: AppointmentClinicalModel.consentFile,
          commonSymptoms: AppointmentClinicalModel.commonSymptoms,
          clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
          bookingSource: AppointmentModel.bookingSource,
        },
        doctor: {
          id: DoctorUser.id,
          name: DoctorUser.name,
          email: DoctorUser.email,
          mobile: DoctorUser.mobile,
          speciality: UserProfessionalModel.speciality,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${DoctorUser.id} LIMIT 1)`,
          averageRating: sql<string>`COALESCE(${UserProfessionalModel.averageRating}, '0.00')`,
          reviewCount: sql<number>`COALESCE(${UserProfessionalModel.reviewCount}, 0)`,
        },
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .innerJoin(AppointmentModel, eq(UserModel.id, AppointmentModel.patientId))
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
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, DoctorUser.id)
      )
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!result.length) return null;

    const baseData = result[0];
    const { clinicServiceId, clinicSymptomIds } = baseData.appointment;

    // None of these needs another's result, so they run together.
    const [manualPrescription, serviceResult, symptoms, reportCards, reviews] =
      await Promise.all([
        trx
          .select({
            id: doctorManualPrescriptionModel.id,
            doctorManualPrescription:
              doctorManualPrescriptionModel.doctorManualPrescription,
            createdAt: doctorManualPrescriptionModel.createdAt,
            updatedAt: doctorManualPrescriptionModel.updatedAt,
          })
          .from(doctorManualPrescriptionModel)
          .where(eq(doctorManualPrescriptionModel.appointmentId, appointmentId))
          .limit(1),
        clinicServiceId
          ? trx
              .select({
                id: ClinicServiceModel.id,
                serviceName: ClinicServiceModel.serviceName,
                price: ClinicServiceModel.price,
                currency: ClinicServiceModel.currency,
                durationDays: ClinicServiceModel.durationDays,
                additionalServices: ClinicServiceModel.additionalServices,
              })
              .from(ClinicServiceModel)
              .where(eq(ClinicServiceModel.id, clinicServiceId))
              .limit(1)
          : Promise.resolve([]),
        Array.isArray(clinicSymptomIds) && clinicSymptomIds.length > 0
          ? trx
              .select({
                id: ClinicSymptomModel.id,
                name: ClinicSymptomModel.name,
                description: ClinicSymptomModel.description,
                status: ClinicSymptomModel.status,
              })
              .from(ClinicSymptomModel)
              .where(inArray(ClinicSymptomModel.id, clinicSymptomIds))
          : Promise.resolve([]),
        trx
          .select({
            ...getTableColumns(ReportCardModel),
            additionalInformation: ExaminationService.findingsColumn(
              ReportCardModel.appointmentId,
              ReportCardModel.additionalInformation
            ),
          })
          .from(ReportCardModel)
          .where(eq(ReportCardModel.appointmentId, appointmentId))
          .limit(1),
        trx
          .select({
            id: DoctorReviewsModel.id,
            rating: DoctorReviewsModel.rating,
            reviewText: DoctorReviewsModel.reviewText,
            replyText: DoctorReviewsModel.replyText,
            createdAt: DoctorReviewsModel.createdAt,
          })
          .from(DoctorReviewsModel)
          .where(eq(DoctorReviewsModel.appointmentId, appointmentId))
          .limit(1),
      ]);
    const clinicService = serviceResult[0] ?? null;

    // Medicines need the report card; started here so they overlap the coveredBy read.
    const prescriptionsRead =
      reportCards.length > 0
        ? trx
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
            .where(eq(PrescriptionModel.reportCardId, reportCards[0].id))
        : Promise.resolve([]);

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
            coveringVisit()
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

    const [digitalPrescriptions, refunds] = await Promise.all([
      prescriptionsRead,
      MoneyReadService.refundsOf([baseData.appointment.id]),
    ]);
    const refund = refunds.get(baseData.appointment.id);

    return {
      ...baseData,
      appointment: {
        ...baseData.appointment,
        refundMode: refund?.refundMode ?? null,
        refundedAmount: refund?.refundedAmount ?? null,
        refundNotes: refund?.refundNotes ?? null,
        coveredBy,
      },
      clinicService,
      symptoms,
      manualPrescription: manualPrescription[0] ?? null,
      reportCard:
        reportCards.length === 0
          ? null
          : {
              ...reportCards[0],
              additionalInformation: ExaminationService.notesFor(
                reportCards[0].additionalInformation,
                requestingUser.userType
              ),
            },
      prescriptions: digitalPrescriptions,
      review: reviews[0] ?? null,
      ...(await UserService.getPatientHealthProfile(baseData.id)),
    };
  }

  /** Doctor ids the user may read: Doctor = self, Receptionist/Nurse = assigned, Admin = null (all). */
  private static async readableDoctorIds(user: AuthUser, clinicId: string) {
    if (user.userType === 'Doctor') return [user.id];
    return StaffScopeService.getAccessibleDoctorIds(user, clinicId);
  }

  /** Patient profile plus one of their appointments here (with a doctor the user may read); null if none. */
  static async getPatientWithAppointment(
    patientId: string,
    clinicId: string,
    user: AuthUser
  ) {
    const allowed = await AppointmentService.readableDoctorIds(user, clinicId);
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
        .where(
          and(
            eq(UserModel.id, patientId),
            eq(AppointmentModel.clinicId, clinicId),
            doctorScopeFilter(AppointmentModel.doctorId, allowed)
          )
        )
        .limit(1);

      return result.length > 0 ? result[0] : null;
    });
  }

  /** The patient's latest report card from this clinic, or null; 403 if the patient isn't assigned here. */
  static async getLastPatientReportCard(patientId: string, clinicId: string) {
    // Assignment check and read are independent, so they run together; the check still gates the result.
    const [isAssigned, reportCards] = await Promise.all([
      database
        .select({ id: ClinicAssignModel.id })
        .from(ClinicAssignModel)
        .where(
          and(
            eq(ClinicAssignModel.userId, patientId),
            eq(ClinicAssignModel.clinicId, clinicId)
          )
        )
        .limit(1),
      database
        .select({
          id: ReportCardModel.id,
          appointmentId: ReportCardModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          habits: ReportCardModel.habits,
          provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
          allergies: ReportCardModel.allergies,
          createdAt: ReportCardModel.createdAt,
        })
        .from(ReportCardModel)
        .innerJoin(
          AppointmentModel,
          eq(ReportCardModel.appointmentId, AppointmentModel.id)
        )
        .where(
          and(
            eq(ReportCardModel.petientId, patientId),
            eq(AppointmentModel.clinicId, clinicId)
          )
        )
        .orderBy(desc(ReportCardModel.createdAt))
        .limit(1),
    ]);

    if (!isAssigned.length) {
      throw new HttpError(
        403,
        'Access denied. Patient is not assigned to this clinic.'
      );
    }

    return reportCards[0] ?? null;
  }
}
