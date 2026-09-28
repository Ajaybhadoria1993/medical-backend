import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  getISTDateString,
  getISTDayName,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import {
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
} from '../../clinic/models/clinic.model';
import { realtimeBus, target } from '../../realtime';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { getRedisKey, normalizeBreaks } from '../utils/helpers';
import { hhmmToMinutes } from '../../../utils/time.util';
import { getCurrentAppointmentId } from './queueHoldStore.service';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type Executor = DbTransaction | typeof database;

/**
 * Statuses a shift moves, as an allowlist rather than "not terminal".
 * `Missed` is excluded: its time records when the clinic expected someone who
 * never came, and sliding it forward would invent a promise. `Rescheduled` is
 * included — the slot generator counts it as occupying the day.
 */
export const MOVABLE_STATUSES = [
  'Upcoming',
  'Pending',
  'Confirmed',
  'Patient Arrived',
  'Rescheduled',
] as const;

/**
 * Last minute an appointment may *start* at. A start time is a real clock
 * value that gets written back as 'HH:MM', so 24:00 is not one of them.
 */
const END_OF_DAY_MINUTES = 23 * 60 + 59;

/**
 * Exclusive end of day, for boundaries rather than start times: a clinic
 * running to 23:30 shifted by 30 minutes ends exactly at 00:00, which
 * validating against 23:59 rejected by a single minute.
 */
const END_OF_DAY_EXCLUSIVE_MINUTES = 24 * 60;

/**
 * Marks a `clinic_date_availability` row this feature created, so a revert can
 * delete it. A date row shadows the weekly template, so one left behind makes
 * later weekly edits silently do nothing on that date. Rows the clinic built
 * by hand are only ever shifted, never removed.
 */
const SHIFT_NOTE_PREFIX = 'Schedule shifted by';

const isShiftOwnedRow = (notes: string | null): boolean =>
  (notes ?? '').startsWith(SHIFT_NOTE_PREFIX);

/**
 * A doctor's working day as the blocks they consult in. `segments` is sorted
 * by start and defines a "session": index 0 is session 1, and that ordinal is
 * what `appointments.sessionIndex` stores.
 */
export interface DaySegments {
  source: 'date' | 'weekly';
  dateRowId?: string;
  slotMinutes: number | null;
  stepMinutes: number | null;
  segments: Array<{ start: number; end: number; slotId?: string }>;
}

export interface ShiftedAppointment {
  appointmentId: string;
  patientId: string;
  /** Current stored time, IST 'HH:mm'. */
  from: string;
  /** Time after the shift, IST 'HH:mm'. */
  to: string;
}

export interface ShiftPlan {
  /** How far this action moves the day; negative when correcting or clearing. */
  deltaMinutes: number;
  appointments: ShiftedAppointment[];
  /** Appointments deliberately left where they are, with the reason. */
  skipped: Array<{ appointmentId: string; reason: string }>;
  /** End of the affected session once shifted, IST 'HH:mm'. */
  sessionEnd: string | null;
  /**
   * Which session moved, as 'HH:mm–HH:mm' — set only when the day has more than
   * one, where "the schedule shifted" is otherwise ambiguous to the reader.
   */
  shiftWindowLabel: string | null;
  /**
   * Every session the doctor works that day, so the caller can offer a choice
   * rather than accepting the one inferred from the clock. Empty on a day with
   * a single session, where there is nothing to choose.
   */
  sessions: Array<{ start: string; end: string }>;
  /** The session this plan acted on, 'HH:mm'; null when every session moved. */
  sessionStart: string | null;
  /** True when the whole day moved rather than one session. */
  appliedToAllSessions: boolean;
}

/**
 * Minutes since midnight from a stored time. Uses the shared helper because the
 * DB holds two formats — appointment times are 24-hour, availability times are
 * 12-hour with a meridiem — and a 24-hour-only reader turns '06:00 PM' into 360
 * and decides a 09:00 start is after the end.
 */
const toMinutes = hhmmToMinutes;

export const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60
  ).padStart(2, '0')}`;

/**
 * Minutes since midnight to the 12-hour form the availability tables store —
 * '01:30 PM', not '13:30'.
 */
const toClockTime = (minutes: number): string => {
  // A session end may legitimately land on midnight (1440). Left as-is that
  // reads as hours24 = 24, and 24 % 12 === 0 maps to 12 with a 'PM' suffix —
  // '12:00 PM', which is noon. A clinic shifted to finish at midnight would
  // have been written back as finishing at lunchtime. 23:59 is the same
  // boundary in a form the availability tables can hold.
  const clamped = Math.min(minutes, END_OF_DAY_MINUTES);
  const hours24 = Math.floor(clamped / 60);
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${String(hours12).padStart(2, '0')}:${String(clamped % 60).padStart(
    2,
    '0'
  )} ${suffix}`;
};

/**
 * `clinic_date_availability.date` and `appointments.appointment_date` both
 * store UTC midnight of the calendar day — NOT the instant IST midnight maps
 * to. `startOfDayIST` returns the latter (18:30 the previous day) and silently
 * matches no rows here, so both queries build the boundary this way instead.
 */
export const utcMidnight = (dateStr: string): Date =>
  new Date(`${dateStr}T00:00:00Z`);

/**
 * Moves the day rather than re-describing it: every remaining appointment and
 * the bookable window slide forward by the same minutes, so the running order
 * and the capacity behind the delay both survive.
 *
 * Times are rewritten (unlike `lateQueueDemotion`, a mere order nudge) because
 * a shift is a new promise, like a reschedule — so wait times measured against
 * it stay correct. Evidence lives in the override row and activity history.
 *
 * The caller clears the `running_late` announcement afterwards: with the delay
 * in the times, the projection floor would otherwise count it twice.
 */
export class ScheduleShiftService {
  /**
   * What a shift of `deltaMinutes` would do, without writing. Backs both the
   * confirm dialog and the write, so what is approved cannot disagree with
   * what lands.
   */
  static async plan(
    clinicId: string,
    doctorId: string,
    date: string,
    deltaMinutes: number,
    executor: Executor = database,
    /**
     * Which session to move, 'HH:mm'. Omitted means "the one the clock implies"
     * — right for a doctor who is late right now, wrong for "we already know he
     * will be late for this evening", which is why the caller can say.
     */
    sessionStart?: string,
    /**
     * Move every session that day rather than one — right when the doctor is
     * out entirely. Opt-in, because "late for the morning" says nothing about
     * the evening.
     */
    allSessions?: boolean
  ): Promise<ShiftPlan> {
    const dayStart = utcMidnight(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const rows = await executor
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
      })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, dayStart),
          lt(AppointmentModel.appointmentDate, dayEnd),
          inArray(AppointmentModel.appointmentStatus, [...MOVABLE_STATUSES])
        )
      );

    // Who is with the doctor right now. This is the queue's Redis pointer, not
    // a status: moving the time of the consultation already in progress would
    // rewrite something that is happening, not something still promised.
    const currentAppointmentId = await getCurrentAppointmentId(
      clinicId,
      doctorId,
      date
    );

    let appointments: ShiftedAppointment[] = [];
    const skipped: ShiftPlan['skipped'] = [];

    for (const row of rows) {
      if (row.id === currentAppointmentId) {
        skipped.push({ appointmentId: row.id, reason: 'in_consultation' });
        continue;
      }

      const current = toMinutes(row.appointmentTime);
      if (current === null) {
        // A token row has a number, not a clock time — nothing to slide.
        skipped.push({ appointmentId: row.id, reason: 'no_time' });
        continue;
      }

      const shifted = current + deltaMinutes;

      // Skipped, not fatal: one unmovable appointment used to abort the whole
      // shift, so a single 23:59 walk-in made the day unshiftable for everyone
      // else. It stays put and is reported in `skipped`. A negative result is
      // still fatal — that is a delta larger than the day.
      if (shifted < 0) {
        throw new HttpError(
          400,
          `A ${Math.abs(deltaMinutes)}-minute shift would move an appointment ` +
            `before the start of the day.`
        );
      }

      if (shifted > END_OF_DAY_MINUTES) {
        skipped.push({ appointmentId: row.id, reason: 'past_end_of_day' });
        continue;
      }

      appointments.push({
        appointmentId: row.id,
        patientId: row.patientId,
        from: toHHMM(current),
        to: toHHMM(shifted),
      });
    }

    appointments.sort((a, b) => (a.from < b.from ? -1 : 1));

    const day = await this.resolveDaySegments(
      executor,
      clinicId,
      doctorId,
      date
    );

    let sessionEnd: string | null = null;
    let shiftWindowLabel: string | null = null;
    let chosenSessionStart: string | null = null;
    let sessions: ShiftPlan['sessions'] = [];

    if (day) {
      // The first appointment still owed a consultation anchors the delay; with
      // none, the clock on today and the first block on a future day.
      const earliest = appointments.length
        ? Math.min(...appointments.map((a) => toMinutes(a.from) ?? 0))
        : date === getISTDateString()
          ? (() => {
              const { hours, minutes } = getISTHoursMinutes();
              return hours * 60 + minutes;
            })()
          : day.segments[0].start;

      if (allSessions) {
        // Every block moves by the same amount, so the gaps between them are
        // preserved and only the last one can fall off the end of the day.
        const first = day.segments[0];
        const last = day.segments[day.segments.length - 1];

        if (
          first.start + deltaMinutes < 0 ||
          last.end + deltaMinutes > END_OF_DAY_EXCLUSIVE_MINUTES
        ) {
          throw new HttpError(
            400,
            `A ${Math.abs(deltaMinutes)}-minute shift would move this doctor's ` +
              `last session past the end of the day. Shorten it, or build custom ` +
              `slots for the rest of the day.`
          );
        }

        return {
          deltaMinutes,
          appointments,
          skipped,
          // A day may now end exactly at midnight, which toHHMM would render
          // as the non-existent '24:00'. '23:59' is the same instant for every
          // consumer of this field (a bookable-until boundary) and is a time
          // the rest of the system can parse.
          sessionEnd: toHHMM(
            Math.min(last.end + deltaMinutes, END_OF_DAY_MINUTES)
          ),
          shiftWindowLabel: day.segments.length > 1 ? 'all sessions' : null,
          sessions:
            day.segments.length > 1
              ? day.segments.map((current) => ({
                  start: toHHMM(current.start),
                  end: toHHMM(current.end),
                }))
              : [],
          sessionStart: null,
          appliedToAllSessions: true,
        };
      }

      const chosen = sessionStart != null ? toMinutes(sessionStart) : null;

      const { segment, index } =
        chosen !== null
          ? (() => {
              const at = day.segments.findIndex(
                (candidate) => candidate.start === chosen
              );
              if (at === -1) {
                throw new HttpError(
                  400,
                  `${sessionStart} is not one of this doctor's sessions on ${date}.`
                );
              }
              return { segment: day.segments[at], index: at };
            })()
          : this.pickAffectedSegment(day.segments, earliest);
      const next = day.segments[index + 1];

      // Only what falls inside this block moves; a later block belongs to a
      // session nobody was declared late for. The two ceilings differ:
      // `next.start` is a collision (two sessions cannot claim the same hour),
      // while the end of day is exclusive at 24:00, not 23:59.
      const blockEnd = next ? next.start : END_OF_DAY_EXCLUSIVE_MINUTES;
      const outside = appointments.filter((appointment) => {
        const at = toMinutes(appointment.from);
        return at === null || at < segment.start || at >= blockEnd;
      });

      for (const appointment of outside) {
        skipped.push({
          appointmentId: appointment.appointmentId,
          reason: 'other_shift',
        });
      }

      appointments = appointments.filter(
        (appointment) => !outside.includes(appointment)
      );

      const shiftedStart = segment.start + deltaMinutes;
      const shiftedEnd = segment.end + deltaMinutes;

      // Validated rather than clamped, against the next block rather than
      // midnight. `>=` against a following session: a morning ending exactly
      // when the evening begins puts the doctor in two places at once. `>`
      // against the end of day, which is exclusive at 24:00.
      const runsIntoNext = next
        ? shiftedEnd >= blockEnd
        : shiftedEnd > blockEnd;

      if (shiftedStart < 0 || runsIntoNext) {
        throw new HttpError(
          400,
          next
            ? `A ${Math.abs(deltaMinutes)}-minute shift would run this session into ` +
                `the next one at ${toHHMM(next.start)}. Shorten it, or build custom ` +
                `slots for the rest of the day.`
            : `A ${Math.abs(deltaMinutes)}-minute shift would move this doctor's ` +
                `hours outside the day. Build custom slots for the rest of the day instead.`
        );
      }

      // Clamped for the same reason as the all-sessions branch above: a last
      // session may now finish exactly at midnight, and toHHMM would render
      // that as '24:00' — an hour no clock has, which downstream 12-hour
      // formatters turn into noon.
      sessionEnd = toHHMM(Math.min(shiftedEnd, END_OF_DAY_MINUTES));
      chosenSessionStart = toHHMM(segment.start);

      if (day.segments.length > 1) {
        shiftWindowLabel = `${toHHMM(segment.start)}–${toHHMM(segment.end)}`;
        sessions = day.segments.map((current) => ({
          start: toHHMM(current.start),
          end: toHHMM(current.end),
        }));
      }
    }

    return {
      deltaMinutes,
      appointments,
      skipped,
      sessionEnd,
      shiftWindowLabel,
      sessions,
      sessionStart: chosenSessionStart,
      appliedToAllSessions: false,
    };
  }

  /**
   * The sessions this doctor works, as 'HH:mm' pairs. Exposed so a caller can
   * show them before asking for a shift — for a two-clinic doctor, which
   * session is delayed is the first decision, not the last.
   */
  static async listSessions(
    clinicId: string,
    doctorId: string,
    date: string,
    /** Opt-in: a token day has no grid to shift, but it does have shifts to name. */
    includeTokenMode = false
  ): Promise<Array<{ start: string; end: string }>> {
    const day = includeTokenMode
      ? await this.resolveDaySegmentsForTokens(
          database,
          clinicId,
          doctorId,
          date
        )
      : await this.resolveDaySegments(database, clinicId, doctorId, date);

    if (!day || day.segments.length < 2) return [];

    return day.segments.map((segment) => ({
      start: toHHMM(segment.start),
      end: toHHMM(segment.end),
    }));
  }

  /**
   * Performs the shift: appointments and the day's bookable window move
   * together, in one transaction, so the grid can never disagree with what is
   * booked on it.
   */
  static async apply(
    clinicId: string,
    doctorId: string,
    date: string,
    deltaMinutes: number,
    totalMinutes: number,
    actorId?: string,
    sessionStart?: string,
    allSessions?: boolean
  ): Promise<ShiftPlan> {
    const plan = await database.transaction(async (tx) => {
      const computed = await this.plan(
        clinicId,
        doctorId,
        date,
        deltaMinutes,
        tx,
        sessionStart,
        allSessions
      );

      for (const appointment of computed.appointments) {
        await tx
          .update(AppointmentModel)
          .set({ appointmentTime: appointment.to, updatedAt: new Date() })
          .where(eq(AppointmentModel.id, appointment.appointmentId));

        // In the transaction on purpose: a moved time with no record of who
        // moved it is the version of this feature that becomes an argument at
        // the front desk. `appointments.reason_for_reschedule` is deliberately
        // left alone — it holds the patient's own reason, and overwriting it
        // would destroy that to say something the history already says.
        await AppointmentActivityHistoryService.logActivity({
          appointmentId: appointment.appointmentId,
          action: 'RESCHEDULED',
          performedBy: actorId,
          previousState: { appointmentTime: appointment.from },
          newState: { appointmentTime: appointment.to },
          remarks:
            deltaMinutes >= 0
              ? `Doctor delayed — schedule shifted by ${deltaMinutes} minutes ` +
                `(${appointment.from} → ${appointment.to})`
              : `Delay reduced — schedule moved back by ${Math.abs(
                  deltaMinutes
                )} minutes (${appointment.from} → ${appointment.to})`,
          tx,
        });
      }

      await this.shiftWindow(
        tx,
        clinicId,
        doctorId,
        date,
        deltaMinutes,
        totalMinutes,
        // The session the plan settled on, not a re-derivation: recomputing the
        // anchor here could land on a different block if an appointment changed
        // status mid-transaction, moving a session the preview never showed.
        computed.sessionStart ?? sessionStart,
        computed.appliedToAllSessions
      );

      return computed;
    });

    await this.invalidateDayConfig(clinicId, doctorId, date);
    this.signal(clinicId, doctorId, date, plan);

    logger.info(
      `[ScheduleShift] doctor=${doctorId} clinic=${clinicId} date=${date} ` +
        `moved ${plan.appointments.length} appointment(s) by ${deltaMinutes}m`
    );

    return plan;
  }

  /**
   * Slides the doctor's bookable window, materialised as a date-specific
   * availability row rather than handled in the slot generator — that path
   * already prefers date rows, so the grid moves without touching a function
   * every booking screen depends on. A day that already has a date row has its
   * own slots moved; breaks survive as the gaps between segments.
   */
  private static async shiftWindow(
    tx: DbTransaction,
    clinicId: string,
    doctorId: string,
    date: string,
    deltaMinutes: number,
    totalMinutes: number,
    sessionStart?: string,
    allSessions?: boolean
  ): Promise<void> {
    const day = await this.resolveDaySegments(tx, clinicId, doctorId, date);
    if (!day) return;

    const [existing] = await tx
      .select({
        id: ClinicDateAvailability.id,
        notes: ClinicDateAvailability.notes,
      })
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          eq(ClinicDateAvailability.doctorId, doctorId),
          eq(ClinicDateAvailability.date, utcMidnight(date))
        )
      );

    // Back to zero on a row we created: remove it, restoring the weekly
    // template rather than leaving a shifted copy of it in the way. A leftover
    // row shadows the weekly hours for that date forever.
    if (existing && totalMinutes === 0 && isShiftOwnedRow(existing.notes)) {
      await tx
        .delete(ClinicDateAvailability)
        .where(eq(ClinicDateAvailability.id, existing.id));
      return;
    }

    // `plan` already decided which session this is; it passes the answer in so
    // the write cannot land on a different block than the preview showed.
    const chosen = sessionStart != null ? toMinutes(sessionStart) : null;
    const at =
      chosen !== null
        ? day.segments.findIndex((candidate) => candidate.start === chosen)
        : -1;

    // Only the index is needed here — the write below reads each moving block
    // straight from `day.segments`, so the segment itself would be a second
    // handle on the same row.
    const { index } =
      at !== -1
        ? { index: at }
        : this.pickAffectedSegment(
            day.segments,
            await this.resolveAnchorMinutes(tx, clinicId, doctorId, date)
          );

    if (existing) {
      // Only the affected block's row moves, unless the whole day was asked
      // for. The evening clinic otherwise keeps its hours.
      const moving = allSessions
        ? day.segments
        : day.segments.filter((_, at) => at === index);

      for (const current of moving) {
        if (!current.slotId) continue;

        await tx
          .update(ClinicDateAvailabilityTimeSlots)
          .set({
            startTime: toClockTime(current.start + deltaMinutes),
            endTime: toClockTime(current.end + deltaMinutes),
            updatedAt: new Date(),
          })
          .where(eq(ClinicDateAvailabilityTimeSlots.id, current.slotId));
      }
      return;
    }

    const [created] = await tx
      .insert(ClinicDateAvailability)
      .values({
        clinicId,
        doctorId,
        date: utcMidnight(date),
        isAvailable: true,
        slotMinutes: day.slotMinutes,
        stepMinutes: day.stepMinutes,
        notes: `${SHIFT_NOTE_PREFIX} ${totalMinutes} minutes`,
      })
      .returning({ id: ClinicDateAvailability.id });

    // Every block is written, but only the affected one is moved — materialising
    // just the shifted block would silently delete the doctor's other session.
    await tx.insert(ClinicDateAvailabilityTimeSlots).values(
      day.segments.map((current, currentIndex) => {
        const offset = allSessions || currentIndex === index ? deltaMinutes : 0;
        return {
          clinicDateAvailabilityId: created.id,
          startTime: toClockTime(current.start + offset),
          endTime: toClockTime(current.end + offset),
          isAvailable: true,
        };
      })
    );
  }

  /**
   * The minute the delay is anchored to: the first appointment still owed a
   * consultation, else the clock today, else the first block of a future day.
   */
  private static async resolveAnchorMinutes(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number> {
    const dayStart = utcMidnight(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const rows = await executor
      .select({ appointmentTime: AppointmentModel.appointmentTime })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, dayStart),
          lt(AppointmentModel.appointmentDate, dayEnd),
          inArray(AppointmentModel.appointmentStatus, [...MOVABLE_STATUSES])
        )
      );

    const times = rows
      .map((row) => toMinutes(row.appointmentTime))
      .filter((value): value is number => value !== null);

    if (times.length > 0) return Math.min(...times);

    if (date === getISTDateString()) {
      const { hours, minutes } = getISTHoursMinutes();
      return hours * 60 + minutes;
    }

    return 0;
  }

  /**
   * The day's working blocks, from whichever source the slot generator reads.
   * A segment is one continuous block; a lunch break and a morning/evening
   * split both produce two, and the rule is the same either way.
   */
  /** Public: also read by SlotConfigService to resolve a session's real window. */
  static async resolveDaySegments(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<DaySegments | null> {
    return this.resolveDaySegmentsInternal(
      executor,
      clinicId,
      doctorId,
      date,
      false
    );
  }

  /**
   * The same day, resolved for token-based doctors too. `resolveDaySegments`
   * returns null for them, keeping slot-grid features away from doctors with no
   * grid; shift-wise numbering needs the opposite, since the morning/evening
   * split is what decides a token's session. A separate entry point, because
   * relaxing the check inside would hand non-null days to every grid caller.
   */
  static async resolveDaySegmentsForTokens(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<DaySegments | null> {
    return this.resolveDaySegmentsInternal(
      executor,
      clinicId,
      doctorId,
      date,
      true
    );
  }

  /**
   * The day's sittings for an override booking, which is placed *because* the
   * doctor is off duty — so a day off resolves to its weekday shifts here.
   */
  static async resolveDaySegmentsForOverride(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<DaySegments | null> {
    return this.resolveDaySegmentsInternal(
      executor,
      clinicId,
      doctorId,
      date,
      true,
      true
    );
  }

  private static async resolveDaySegmentsInternal(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string,
    includeTokenMode: boolean,
    forOverride = false
  ): Promise<DaySegments | null> {
    const [existing] = await executor
      .select({
        id: ClinicDateAvailability.id,
        slotMinutes: ClinicDateAvailability.slotMinutes,
        stepMinutes: ClinicDateAvailability.stepMinutes,
      })
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          eq(ClinicDateAvailability.doctorId, doctorId),
          eq(ClinicDateAvailability.date, utcMidnight(date))
        )
      );

    if (existing) {
      const rows = await executor
        .select({
          id: ClinicDateAvailabilityTimeSlots.id,
          startTime: ClinicDateAvailabilityTimeSlots.startTime,
          endTime: ClinicDateAvailabilityTimeSlots.endTime,
        })
        .from(ClinicDateAvailabilityTimeSlots)
        .where(
          eq(
            ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
            existing.id
          )
        );

      const segments = rows
        .map((row) => ({
          start: toMinutes(row.startTime),
          end: toMinutes(row.endTime),
          slotId: row.id,
        }))
        .filter(
          (
            segment
          ): segment is { start: number; end: number; slotId: string } =>
            segment.start !== null &&
            segment.end !== null &&
            segment.end > segment.start
        )
        .sort((a, b) => a.start - b.start);

      // A day off is a date row with no slots; an override still needs a
      // sitting, so it falls through to the weekday template rather than null.
      if (segments.length > 0 || !forOverride) {
        if (segments.length === 0) return null;
        return {
          source: 'date',
          dateRowId: existing.id,
          slotMinutes: existing.slotMinutes,
          stepMinutes: existing.stepMinutes,
          segments,
        };
      }
    }

    const weekly = await this.readWeekly(
      executor,
      clinicId,
      doctorId,
      date,
      includeTokenMode,
      forOverride
    );
    if (!weekly || weekly.segments.length === 0) return null;

    return {
      source: 'weekly',
      slotMinutes: weekly.slotMinutes,
      stepMinutes: weekly.stepMinutes,
      segments: [...weekly.segments].sort((a, b) => a.start - b.start),
    };
  }

  /**
   * Which block the delay applies to. Arriving late for the morning says
   * nothing about the evening clinic, so moving that block would invent a delay
   * nobody declared. The anchor is the first appointment still owed a
   * consultation (falling back to the clock today, or the first block on a
   * future day); whichever block holds it moves, and the rest stay put.
   */
  private static pickAffectedSegment<T extends { start: number; end: number }>(
    segments: T[],
    anchorMinutes: number
  ): { segment: T; index: number } {
    const index = segments.findIndex((segment) => anchorMinutes < segment.end);
    const resolved = index === -1 ? segments.length - 1 : index;
    return { segment: segments[resolved], index: resolved };
  }

  /**
   * The weekly template for this weekday, as segments with breaks cut out.
   * Null for a day the doctor does not work, and for a token day — a token
   * queue has no clock times to slide.
   */
  private static async readWeekly(
    executor: Executor,
    clinicId: string,
    doctorId: string,
    date: string,
    includeTokenMode = false,
    forOverride = false
  ): Promise<{
    slotMinutes: number | null;
    stepMinutes: number | null;
    segments: Array<{ start: number; end: number }>;
  } | null> {
    const dayName = getISTDayName(date);

    const [availability] = await executor
      .select()
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          // Matched case-insensitively, the way the slot generator does it —
          // `day_of_week` is a free varchar and rows exist in both casings.
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      );

    if (!availability) return null;
    // An override is booked *because* the doctor is off duty, so it needs the
    // sittings the weekday would have run. Booking still sees nothing.
    if (!availability.isAvailable && !forOverride) return null;

    // A token doctor has no slot grid, so the grid features that read this must
    // not see the day at all. Shift-wise token numbering is the one caller that
    // must — its whole question is which of the day's blocks a token sits in.
    if (
      !includeTokenMode &&
      !forOverride &&
      availability.noOfPatients &&
      availability.noOfPatients > 0
    ) {
      return null;
    }

    const start = toMinutes(availability.startTime);
    const end = toMinutes(availability.endTime);
    if (start === null || end === null || end <= start) return null;

    const breakRows = await executor
      .select({
        startTime: ClinicAvailabilityBreak.startTime,
        endTime: ClinicAvailabilityBreak.endTime,
      })
      .from(ClinicAvailabilityBreak)
      .where(
        and(
          eq(ClinicAvailabilityBreak.clinicAvailabilityId, availability.id),
          eq(ClinicAvailabilityBreak.status, true)
        )
      );

    const breaks = normalizeBreaks([
      // The legacy single break pair still populated on older rows.
      {
        startMinutes: toMinutes(availability.breaksStart),
        endMinutes: toMinutes(availability.breaksEnd),
      },
      ...breakRows.map((row) => ({
        startMinutes: toMinutes(row.startTime),
        endMinutes: toMinutes(row.endTime),
      })),
    ]);

    const segments: Array<{ start: number; end: number }> = [];
    let cursor = start;
    for (const window of breaks) {
      if (window.startMinutes > cursor) {
        segments.push({
          start: cursor,
          end: Math.min(window.startMinutes, end),
        });
      }
      cursor = Math.max(cursor, window.endMinutes);
    }
    if (cursor < end) segments.push({ start: cursor, end });

    return {
      slotMinutes: availability.slotMinutes,
      stepMinutes: availability.stepMinutes,
      segments: segments.filter((segment) => segment.end > segment.start),
    };
  }

  /**
   * Drops the cached day config. `resolveDayConfig` caches it for an hour since
   * availability rarely changes mid-day — a shift is the exception, and a stale
   * entry would project against the old session start while the appointments
   * already carry the new times.
   */
  static async invalidateDayConfig(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      await redisClient.del(
        getRedisKey('day_config', clinicId, doctorId, date)
      );
    } catch (error) {
      logger.warn(
        `[ScheduleShift] Failed to clear day_config for doctor=${doctorId} on ${date}`,
        { error }
      );
    }
  }

  /**
   * Tells every screen holding a stale time to refetch. Fire-and-forget: the
   * shift is committed, and a broadcast failure must not fail the request.
   */
  private static signal(
    clinicId: string,
    doctorId: string,
    date: string,
    plan: ShiftPlan
  ): void {
    // Moved times change dashboard figures, so retire those caches before signalling.
    void invalidateClinicDashboardCaches(clinicId).finally(() =>
      this.notifyShift(clinicId, doctorId, date, plan)
    );
  }

  private static notifyShift(
    clinicId: string,
    doctorId: string,
    date: string,
    plan: ShiftPlan
  ): void {
    try {
      realtimeBus.notify(
        target.queue(clinicId, doctorId, date),
        'appointment.rescheduled'
      );
      realtimeBus.notify(target.board(clinicId), 'appointment.rescheduled');

      for (const appointment of plan.appointments) {
        realtimeBus.notify(
          target.appointment(appointment.appointmentId, appointment.patientId),
          'appointment.rescheduled'
        );
      }
    } catch (error) {
      logger.warn(
        `[ScheduleShift] Failed to signal shift for doctor=${doctorId} on ${date}`,
        { error }
      );
    }
  }
}
