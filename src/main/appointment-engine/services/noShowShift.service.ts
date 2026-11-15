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
import { lockDoctorDay } from '../../../utils/doctorDayLock';
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

/** Rows with a real slot time; a token's '23:59' placeholder would be shifted into a bogus late time. */
const TIME_BASED_ROW = or(
  isNull(AppointmentModel.tokenNo),
  notInArray(AppointmentModel.appointmentTime, ['23:59', '23:59:00'])
);

/** Pulls later time-based bookings earlier when a patient no-shows. */
export class NoShowShiftService {
  private delayTrackerService: DelayTrackerService;

  constructor() {
    this.delayTrackerService = new DelayTrackerService();
  }
  /** Moves every later shiftable booking earlier by the no-show's length, under the doctor-day lock. */
  async shiftForward(noShowAppointmentId: string): Promise<ShiftResult> {
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

    const doctorId = noShowAppt.doctorId;
    let shiftAmount = 0;
    const shiftedAppointments: ShiftResult['shiftedAppointments'] = [];
    let isTokenBasedQueue = false;

    try {
      await database.transaction(async (tx) => {
        // Same lock as booking: two no-shows or a booking can't act on a stale schedule.
        await lockDoctorDay(tx, doctorId, noShowAppt.appointmentDate);
        const [current] = await tx
          .select({ status: AppointmentModel.appointmentStatus })
          .from(AppointmentModel)
          .where(eq(AppointmentModel.id, noShowAppointmentId));
        if (current?.status !== 'NoShow') return;

        const shiftableAppointments = (
          await this.fetchSubsequentAppointments(
            noShowAppt.clinicId,
            doctorId,
            noShowAppt.appointmentDate,
            effectiveAppointmentTime(noShowAppt),
            noShowAppt.tokenNo,
            noShowAppt.sessionIndex,
            tx
          )
        ).filter((appt) => isShiftableStatus(appt.appointmentStatus));
        if (shiftableAppointments.length === 0) return;

        // A token queue is identified by tokenNo alone; booking writes a '23:59' placeholder time.
        isTokenBasedQueue = shiftableAppointments.every(
          (appt) => effectiveAppointmentTime(appt) == null
        );
        if (isTokenBasedQueue) return;

        // Read only once there is something to move.
        shiftAmount = resolveAppointmentDuration(
          noShowAppt.appointmentDurationMinutes,
          await this.resolveSlotMinutes(noShowAppt.clinicId, doctorId, date)
        );
        const activeBreaks = await this.fetchActiveBreaks(
          noShowAppt.clinicId,
          doctorId,
          date
        );

        for (const appt of shiftableAppointments) {
          // The fetch drops placeholders already; a token's '23:59' must still never be rewritten.
          const slotTime = effectiveAppointmentTime(appt);
          if (!slotTime) continue;

          const currentMinutes = parseTimeToMinutes(slotTime);
          let newMinutes = currentMinutes - shiftAmount;
          newMinutes = Math.max(0, newMinutes);

          newMinutes = this.avoidBreaks(newMinutes, activeBreaks);

          const newTime = minutesToTimeString(newMinutes);

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

    // Token queue: times stay put, only the estimated wait is recalculated.
    if (isTokenBasedQueue) {
      await this.delayTrackerService.recalculate(
        noShowAppt.clinicId,
        doctorId,
        date
      );
      return { shiftedAppointments: [] };
    }

    // Fire-and-forget: a failed notification must not undo a committed shift.
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

    // Mixed-day token rows were skipped; the orchestrator recalculates their wait next.
    return { shiftedAppointments };
  }

  /** Tells each moved patient their new time and refreshes clinic screens. */
  private async notifyShiftedAppointments(
    shiftedAppointments: ShiftResult['shiftedAppointments'],
    clinicId: string,
    doctorId: string | null
  ): Promise<void> {
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
  }

  /** A time inside a break moves to the break's end. */
  private avoidBreaks(
    timeMinutes: number,
    breaks: Array<{ startTime: string | null; endTime: string | null }>
  ): number {
    for (const brk of breaks) {
      const breakStart = parseTimeToMinutes(brk.startTime);
      const breakEnd = parseTimeToMinutes(brk.endTime);

      if (breakStart >= breakEnd) {
        logger.error(
          `[NoShowShift] Invalid break window detected: startTime=${brk.startTime} >= endTime=${brk.endTime}. Skipping break.`
        );
        continue;
      }

      if (timeMinutes >= breakStart && timeMinutes < breakEnd) {
        return breakEnd;
      }
    }

    return timeMinutes;
  }

  /** Breaks in the doctor's availability for that weekday. */
  private async fetchActiveBreaks(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<Array<{ startTime: string | null; endTime: string | null }>> {
    const dayOfWeek = getISTDayName(date);

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

  /** Same-day bookings after the no-show: later slot times, or later tokens in its shift. */
  private async fetchSubsequentAppointments(
    clinicId: string,
    doctorId: string,
    appointmentDate: Date,
    appointmentTime: string | null,
    tokenNo: number | null,
    sessionIndex: number | null,
    db: Pick<typeof database, 'select'> = database
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
      const appointments = await db
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
      const appointments = await db
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

    logger.warn(
      `[NoShowShift] No-show appointment has neither appointmentTime nor tokenNo. Cannot determine subsequent appointments.`
    );
    return [];
  }

  /** Slot length for this doctor's day, cached in Redis by the delay tracker. */
  private async resolveSlotMinutes(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number | null> {
    return this.delayTrackerService.resolveSlotMinutes(
      clinicId,
      doctorId,
      date
    );
  }
}

/** "09:00" / "9:00 AM" to minutes since midnight; 0 when unparseable. */
function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const t = time.trim();

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

  return 0;
}

/** Minutes since midnight to "HH:MM". */
function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}
