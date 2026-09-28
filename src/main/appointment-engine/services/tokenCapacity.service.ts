import { and, desc, eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import {
  ClinicAvailability,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
} from '../../clinic/models/clinic.model';
import { getISTDayName } from '../../../utils/istDateTime';
import { DoctorSessionOverrideModel } from '../models/doctorSessionOverride.model';
import { DoctorWeeklyShiftCapacityModel } from '../models/doctorWeeklyShiftCapacity.model';
import { utcMidnight } from './scheduleShift.service';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
/** The booking transaction when called from inside one, else the pool. */
type Executor = DbTransaction | typeof database;

/** Where a session's token capacity came from — surfaced for debugging and tests. */
export type TokenCapacitySource =
  /** A staff member customised this session today. */
  | 'session_override'
  /** A standing per-shift capacity on the date's time-slot row. */
  | 'date_time_slot'
  /** The doctor's standing per-shift capacity for this weekday. */
  | 'weekly_shift'
  /** The weekly row's single number, applied to this shift. */
  | 'weekly'
  /** The doctor is not in token mode, or the day has no capacity at all. */
  | 'none';

export interface ResolvedTokenCapacity {
  /** Tokens bookable in this session. 0 means nothing is bookable. */
  capacity: number;
  source: TokenCapacitySource;
  /** Why an override added capacity — only ever set on `session_override`. */
  appointmentType?: string;
}

/**
 * TokenCapacityService
 *
 * Answers "how many tokens does THIS shift hold?" — the question the booking
 * path could not previously ask, because capacity lived only as a single
 * `ClinicAvailability.noOfPatients` for the whole day.
 *
 * Resolution runs most-specific first:
 *
 *   1. `slot_config` session override — a staff member customised this session
 *      today. Same-day and ad-hoc; already written by SlotConfigService.
 *   2. `clinic_date_availability_time_slots.noOfPatients` — this one date's
 *      shift, for a day that departs from the doctor's usual pattern.
 *   3. `doctor_weekly_shift_capacity` — the doctor's standing pattern: every
 *      Monday, 20 tokens in the morning clinic and 30 in the evening. Set once
 *      rather than re-entered per date.
 *   4. `clinic_availability.noOfPatients` — the day-wide number, applied **per
 *      shift**. A doctor set to 20 on a split-shift day holds 20 in the morning
 *      and 20 in the evening, not 20 across both: the number describes how many
 *      patients the doctor sees in a sitting, and a split-shift day is two
 *      sittings.
 *
 * Step 1 is keyed differently from 2 and 3 on purpose. An override is addressed
 * by `sessionStart` because it is a same-day statement re-read constantly,
 * while a standing capacity is addressed by `sessionIndex` because it must
 * survive the shift being moved — see AppointmentModel.sessionIndex.
 */
export class TokenCapacityService {
  /**
   * Capacity for one session of one doctor-day.
   *
   * `sessionStart` is the segment's current start in IST 'HH:mm', used only to
   * look up a same-day override; pass the value derived from the same segment
   * list that produced `sessionIndex` so the two cannot disagree.
   */
  static async resolveForSession(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionStart: string,
    segmentSlotId?: string,
    executor: Executor = database,
    /**
     * Which shift of the day this is, 1-based — the key the standing weekly
     * capacity is stored against. Omitted, that step is skipped and resolution
     * falls through to the day-wide number, which is the behaviour every
     * caller had before per-shift capacity existed.
     */
    sessionIndex?: number
  ): Promise<ResolvedTokenCapacity> {
    // 1. Same-day customisation wins over anything standing.
    //
    // Queried here rather than through SlotConfigService.findOverrideRow so it
    // runs on the caller's executor: booking resolves capacity inside its own
    // transaction, and a read on the pool would miss rows that transaction has
    // written and cannot see its locks.
    const [override] = await executor
      .select({
        noOfPatients: DoctorSessionOverrideModel.noOfPatients,
        appointmentType: DoctorSessionOverrideModel.appointmentType,
      })
      .from(DoctorSessionOverrideModel)
      .where(
        and(
          eq(DoctorSessionOverrideModel.clinicId, clinicId),
          eq(DoctorSessionOverrideModel.doctorId, doctorId),
          eq(DoctorSessionOverrideModel.forDate, date),
          eq(DoctorSessionOverrideModel.type, 'slot_config'),
          eq(DoctorSessionOverrideModel.sessionStart, sessionStart)
        )
      )
      .orderBy(desc(DoctorSessionOverrideModel.createdAt))
      .limit(1);

    if (override?.noOfPatients != null && override.noOfPatients > 0) {
      return {
        capacity: override.noOfPatients,
        source: 'session_override',
        appointmentType: override.appointmentType ?? undefined,
      };
    }

    // 2. Standing per-shift capacity, when this date has explicit shift rows.
    if (segmentSlotId) {
      const [slot] = await executor
        .select({ noOfPatients: ClinicDateAvailabilityTimeSlots.noOfPatients })
        .from(ClinicDateAvailabilityTimeSlots)
        .where(eq(ClinicDateAvailabilityTimeSlots.id, segmentSlotId));

      if (slot?.noOfPatients != null && slot.noOfPatients > 0) {
        return { capacity: slot.noOfPatients, source: 'date_time_slot' };
      }
    }

    // 3 & 4. The recurring capacity, which is also what an override is
    // measured against — see `resolveStandingCapacity`.
    return this.resolveStanding(
      clinicId,
      doctorId,
      date,
      sessionIndex,
      executor
    );
  }

  /** The capacity this shift runs weekly, ignoring any per-date override —
   *  numbers past it exist only because an override added them. */
  static async resolveStandingCapacity(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionIndex?: number,
    executor: Executor = database
  ): Promise<number> {
    const { capacity } = await this.resolveStanding(
      clinicId,
      doctorId,
      date,
      sessionIndex,
      executor
    );
    return capacity;
  }

  private static async resolveStanding(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionIndex?: number,
    executor: Executor = database
  ): Promise<ResolvedTokenCapacity> {
    const dayName = getISTDayName(date);

    // The doctor's standing per-shift capacity for this weekday — "every
    // Monday, 20 in the morning and 30 in the evening". Recurring, so it does
    // not have to be re-entered per date the way a session override does.
    if (sessionIndex != null) {
      const [weeklyShift] = await executor
        .select({ noOfPatients: DoctorWeeklyShiftCapacityModel.noOfPatients })
        .from(DoctorWeeklyShiftCapacityModel)
        .where(
          and(
            eq(DoctorWeeklyShiftCapacityModel.clinicId, clinicId),
            eq(DoctorWeeklyShiftCapacityModel.doctorId, doctorId),
            // `day_of_week` is a free varchar with rows in both casings.
            sql`lower(${DoctorWeeklyShiftCapacityModel.dayOfWeek}) = ${dayName.toLowerCase()}`,
            eq(DoctorWeeklyShiftCapacityModel.sessionIndex, sessionIndex)
          )
        );

      if (weeklyShift?.noOfPatients != null && weeklyShift.noOfPatients > 0) {
        return {
          capacity: weeklyShift.noOfPatients,
          source: 'weekly_shift',
        };
      }
    }

    // The day-wide weekly number, applied to this shift.
    const [weekly] = await executor
      .select({ noOfPatients: ClinicAvailability.noOfPatients })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          // Matched case-insensitively the way every other reader does it —
          // `day_of_week` is a free varchar with rows in both casings.
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      );

    if (weekly?.noOfPatients != null && weekly.noOfPatients > 0) {
      return { capacity: weekly.noOfPatients, source: 'weekly' };
    }

    return { capacity: 0, source: 'none' };
  }

  /**
   * Whether this doctor books by token on this date.
   *
   * Kept here rather than re-derived at each call site: the answer is "any
   * session has capacity", which stops being a single-row question the moment
   * a day can hold per-shift numbers.
   */
  static async isTokenMode(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<boolean> {
    const dayName = getISTDayName(date);
    const [weekly] = await database
      .select({ noOfPatients: ClinicAvailability.noOfPatients })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      );

    if (weekly?.noOfPatients != null && weekly.noOfPatients > 0) return true;

    // A date row can put a doctor into token mode for one day even when the
    // weekly template is time-based.
    const [dateRow] = await database
      .select({ id: ClinicDateAvailability.id })
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, clinicId),
          eq(ClinicDateAvailability.doctorId, doctorId),
          eq(ClinicDateAvailability.date, utcMidnight(date))
        )
      );

    if (!dateRow) return false;

    const slots = await database
      .select({ noOfPatients: ClinicDateAvailabilityTimeSlots.noOfPatients })
      .from(ClinicDateAvailabilityTimeSlots)
      .where(
        eq(ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId, dateRow.id)
      );

    return slots.some(
      (slot) => slot.noOfPatients != null && slot.noOfPatients > 0
    );
  }
}
