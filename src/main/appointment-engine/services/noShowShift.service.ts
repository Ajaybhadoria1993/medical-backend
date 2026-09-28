import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  ClinicAvailability,
  ClinicAvailabilityBreak,
} from '../../clinic/models/clinic.model';
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';
import { broadcastAppointmentChange } from '../../../utils/appointmentRealtime';
import { ShiftResult } from '../types/engine.types';
import {
  effectiveAppointmentTime,
  isShiftableStatus,
  resolveAppointmentDuration,
} from '../utils/helpers';
import { getDoctorDisplayName } from '../utils/doctorDisplayName';
import { DelayTrackerService } from './delayTracker.service';
import {
  getISTDateString,
  getISTDayName,
  startOfDayIST,
} from '../../../utils/istDateTime';

/**
 * Rows whose stored time is a real slot. A token's '23:59' placeholder sorts
 * after every one, so a mixed day rewrote it into a bogus late-night time.
 */
const TIME_BASED_ROW = or(
  isNull(AppointmentModel.tokenNo),
  notInArray(AppointmentModel.appointmentTime, ['23:59', '23:59:00'])
);

export class NoShowShiftService {
  private delayTrackerService: DelayTrackerService;

  constructor() {
    this.delayTrackerService = new DelayTrackerService();
  }
  async shiftForward(noShowAppointmentId: string): Promise<ShiftResult> {
    // Step 1: Look up the no-show appointment
    const [noShowAppt] = await database
      .select({
        id: AppointmentModel.id,
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        sessionIndex: AppointmentModel.sessionIndex,
        appointmentDurationMinutes: AppointmentModel.appointmentDurationMinutes,
        appointmentStatus: AppointmentModel.appointmentStatus,
        patientId: AppointmentModel.patientId,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, noShowAppointmentId))
      .limit(1);

    if (!noShowAppt) {
      logger.warn(
        `[NoShowShift] Appointment not found: ${noShowAppointmentId}`
      );
      return { shiftedAppointments: [] };
    }

    if (!noShowAppt.doctorId) {
      logger.warn(
        `[NoShowShift] No doctor assigned to appointment: ${noShowAppointmentId}`
      );
      return { shiftedAppointments: [] };
    }

    const date = getISTDateString(noShowAppt.appointmentDate);

    // Step 2: Determine shiftAmount from the no-show appointment's duration
    const slotMinutes = await this.resolveSlotMinutes(
      noShowAppt.clinicId,
      noShowAppt.doctorId,
      date
    );
    const shiftAmount = resolveAppointmentDuration(
      noShowAppt.appointmentDurationMinutes,
      slotMinutes
    );

    const subsequentAppointments = await this.fetchSubsequentAppointments(
      noShowAppt.clinicId,
      noShowAppt.doctorId,
      noShowAppt.appointmentDate,
      effectiveAppointmentTime(noShowAppt),
      noShowAppt.tokenNo,
      noShowAppt.sessionIndex
    );

    // Filter to only shiftable statuses
    const shiftableAppointments = subsequentAppointments.filter((appt) =>
      isShiftableStatus(appt.appointmentStatus)
    );

    if (shiftableAppointments.length === 0) {
      logger.info(
        `[NoShowShift] No shiftable appointments found after appointment ${noShowAppointmentId}`
      );
      return { shiftedAppointments: [] };
    }

    // A token queue is identified by tokenNo alone. Testing appointmentTime
    // for null never matched, because booking writes a '23:59' placeholder.
    const isTokenBasedQueue = shiftableAppointments.every(
      (appt) => effectiveAppointmentTime(appt) == null
    );

    if (isTokenBasedQueue) {
      // Token-based handling: do NOT modify appointmentTime,
      // recalculate Estimated_Wait_Time instead
      logger.info(
        `[NoShowShift] Token-based queue detected for appointment ${noShowAppointmentId}. ` +
          `Skipping time shift; triggering delay recalculation for ${shiftableAppointments.length} token appointments.`
      );

      await this.delayTrackerService.recalculate(
        noShowAppt.clinicId,
        noShowAppt.doctorId,
        date
      );

      return { shiftedAppointments: [] };
    }

    // Fetch active breaks for break avoidance
    const activeBreaks = await this.fetchActiveBreaks(
      noShowAppt.clinicId,
      noShowAppt.doctorId,
      date
    );

    // Step 4 & 5: Compute new times with break avoidance, execute in a single transaction
    const shiftedAppointments: ShiftResult['shiftedAppointments'] = [];

    try {
      await database.transaction(async (tx) => {
        for (const appt of shiftableAppointments) {
          // Belt and braces: the fetch already drops placeholder rows, but a
          // token's '23:59' must never be rewritten as though it were a slot.
          const slotTime = effectiveAppointmentTime(appt);
          if (!slotTime) continue;

          const currentMinutes = parseTimeToMinutes(slotTime);
          let newMinutes = currentMinutes - shiftAmount;
          newMinutes = Math.max(0, newMinutes);

          // Break avoidance: check if new time falls within any active break
          newMinutes = this.avoidBreaks(newMinutes, activeBreaks);

          const newTime = minutesToTimeString(newMinutes);

          // Update the appointment time in the database
          await tx
            .update(AppointmentModel)
            .set({ appointmentTime: newTime })
            .where(eq(AppointmentModel.id, appt.id));

          shiftedAppointments.push({
            appointmentId: appt.id,
            patientId: appt.patientId,
            userId: appt.patientId,
            oldTime: slotTime,
            newTime,
          });
        }
      });

      logger.info(
        `[NoShowShift] Successfully shifted ${shiftedAppointments.length} appointments forward by ${shiftAmount} minutes for no-show appointment ${noShowAppointmentId}`
      );
    } catch (error) {
      logger.error(
        `[NoShowShift] Transaction failed for no-show appointment ${noShowAppointmentId}. All changes rolled back.`,
        { error }
      );
      throw error;
    }

    // Fire-and-forget notifications after successful shift
    // Never fail the overall operation because of notification errors
    if (shiftedAppointments.length > 0) {
      this.notifyShiftedAppointments(
        shiftedAppointments,
        noShowAppt.clinicId,
        noShowAppt.doctorId
      ).catch((error) => {
        logger.error(
          `[NoShowShift] Unexpected error in notification dispatch for no-show appointment ${noShowAppointmentId}`,
          { error }
        );
      });
    }

    // Token rows on a mixed day are excluded from the fetch above; the
    // orchestrator recalculates their wait right after this returns.
    return { shiftedAppointments };
  }
  private async notifyShiftedAppointments(
    shiftedAppointments: ShiftResult['shiftedAppointments'],
    clinicId: string,
    doctorId: string | null
  ): Promise<void> {
    // Send patient notifications via UniversalNotificationService
    // One lookup for the whole batch: every shifted appointment shares the doctor.
    const doctor = await getDoctorDisplayName(doctorId);
    const notificationPromises = shiftedAppointments.map((shifted) =>
      UniversalNotificationService.send({
        recipient: {
          userId: shifted.userId,
          socketRoom: `user:${shifted.userId}`,
        },
        event: 'appointment_shifted',
        channels: ['push', 'socket'],
        // "Earlier" is the fact the patient must act on, so it leads the title.
        title: `Your appointment is earlier: ${shifted.newTime}`,
        body: doctor
          ? `Moved up from ${shifted.oldTime} with ${doctor}. Please arrive on time.`
          : `Moved up from ${shifted.oldTime}. Please arrive on time.`,
        data: {
          appointmentId: shifted.appointmentId,
          oldTime: shifted.oldTime,
          newTime: shifted.newTime,
        },
      }).catch((error) => {
        logger.error(
          `[NoShowShift] Failed to notify patient for appointment=${shifted.appointmentId}`,
          { error }
        );
      })
    );

    await Promise.allSettled(notificationPromises);

    // Broadcast schedule shift to clinic room via broadcastAppointmentChange
    for (const shifted of shiftedAppointments) {
      broadcastAppointmentChange({
        appointmentId: shifted.appointmentId,
        clinicId,
        doctorId: doctorId ?? undefined,
        patientId: shifted.patientId,
        action: 'rescheduled',
        data: {
          reason: 'noshow_shift',
          oldTime: shifted.oldTime,
          newTime: shifted.newTime,
        },
      });
    }

    logger.info(
      `[NoShowShift] Notification dispatch completed for ${shiftedAppointments.length} shifted appointments in clinic=${clinicId}`
    );
  }

  private avoidBreaks(
    timeMinutes: number,
    breaks: Array<{ startTime: string | null; endTime: string | null }>
  ): number {
    for (const brk of breaks) {
      const breakStart = parseTimeToMinutes(brk.startTime);
      const breakEnd = parseTimeToMinutes(brk.endTime);

      // Skip invalid break windows (startTime >= endTime)
      if (breakStart >= breakEnd) {
        logger.error(
          `[NoShowShift] Invalid break window detected: startTime=${brk.startTime} >= endTime=${brk.endTime}. Skipping break.`
        );
        continue;
      }

      if (timeMinutes >= breakStart && timeMinutes < breakEnd) {
        logger.info(
          `[NoShowShift] Shifted time ${minutesToTimeString(timeMinutes)} falls within break ` +
            `(${brk.startTime}-${brk.endTime}). Placing at break end: ${brk.endTime}`
        );
        return breakEnd;
      }
    }

    return timeMinutes;
  }

  private async fetchActiveBreaks(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<Array<{ startTime: string | null; endTime: string | null }>> {
    // Determine the day of week to find the ClinicAvailability record
    const dayOfWeek = getISTDayName(date);

    // Find the ClinicAvailability record for this doctor/clinic/day
    const availabilityRecords = await database
      .select({
        id: ClinicAvailability.id,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          eq(ClinicAvailability.dayOfWeek, dayOfWeek)
        )
      );

    if (availabilityRecords.length === 0) {
      return [];
    }

    const availabilityIds = availabilityRecords.map((r) => r.id);

    // Fetch active breaks for these availability records
    const breaks = await database
      .select({
        startTime: ClinicAvailabilityBreak.startTime,
        endTime: ClinicAvailabilityBreak.endTime,
      })
      .from(ClinicAvailabilityBreak)
      .where(
        and(
          inArray(
            ClinicAvailabilityBreak.clinicAvailabilityId,
            availabilityIds
          ),
          eq(ClinicAvailabilityBreak.status, true)
        )
      );

    return breaks;
  }
  private async fetchSubsequentAppointments(
    clinicId: string,
    doctorId: string,
    appointmentDate: Date,
    appointmentTime: string | null,
    tokenNo: number | null,
    sessionIndex: number | null
  ) {
    const dateStr = getISTDateString(appointmentDate);
    const startOfDay = startOfDayIST(dateStr);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const baseConditions = [
      eq(AppointmentModel.clinicId, clinicId),
      eq(AppointmentModel.doctorId, doctorId),
      gte(AppointmentModel.appointmentDate, startOfDay),
      lt(AppointmentModel.appointmentDate, nextDay),
    ];

    if (appointmentTime) {
      // Time-based: fetch appointments with time after the no-show's time
      const appointments = await database
        .select({
          id: AppointmentModel.id,
          appointmentTime: AppointmentModel.appointmentTime,
          tokenNo: AppointmentModel.tokenNo,
          appointmentStatus: AppointmentModel.appointmentStatus,
          patientId: AppointmentModel.patientId,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
        })
        .from(AppointmentModel)
        .where(
          and(
            ...baseConditions,
            TIME_BASED_ROW,
            gt(AppointmentModel.appointmentTime, appointmentTime)
          )
        )
        .orderBy(
          asc(AppointmentModel.appointmentTime),
          asc(AppointmentModel.sessionIndex),
          asc(AppointmentModel.tokenNo)
        );

      return appointments;
    } else if (tokenNo !== null) {
      // Token-based: fetch appointments with tokenNo > noShowTokenNo
      const appointments = await database
        .select({
          id: AppointmentModel.id,
          appointmentTime: AppointmentModel.appointmentTime,
          tokenNo: AppointmentModel.tokenNo,
          appointmentStatus: AppointmentModel.appointmentStatus,
          patientId: AppointmentModel.patientId,
          appointmentDurationMinutes:
            AppointmentModel.appointmentDurationMinutes,
        })
        .from(AppointmentModel)
        .where(
          and(
            ...baseConditions,
            gt(AppointmentModel.tokenNo, tokenNo),

            (sessionIndex ?? 1) === 1
              ? or(
                  eq(AppointmentModel.sessionIndex, 1),
                  isNull(AppointmentModel.sessionIndex)
                )
              : eq(AppointmentModel.sessionIndex, sessionIndex!)
          )
        )
        .orderBy(asc(AppointmentModel.tokenNo));

      return appointments;
    }

    // No time or token reference — return empty
    logger.warn(
      `[NoShowShift] No-show appointment has neither appointmentTime nor tokenNo. Cannot determine subsequent appointments.`
    );
    return [];
  }

  /**
   * Resolves the slot duration for this doctor/clinic/date.
   * Uses DelayTrackerService.resolveSlotMinutes which checks Redis cache first.
   */
  private async resolveSlotMinutes(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number | null> {
    // Delegate to the shared delay tracker which has Redis caching
    return this.delayTrackerService.resolveSlotMinutes(
      clinicId,
      doctorId,
      date
    );
  }
}

// ─── Local Helper Functions ───────────────────────────────────────────────────

/**
 * Parses a time string (e.g., "09:00", "9:00 AM", "14:30") into minutes since midnight.
 * Returns 0 if the time cannot be parsed.
 */
function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const t = time.trim();

  // Handle 12-hour format with AM/PM
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  // Handle 24-hour format HH:MM or HH:MM:SS
  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  return 0;
}

/**
 * Converts minutes since midnight back to a "HH:MM" time string.
 */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}
