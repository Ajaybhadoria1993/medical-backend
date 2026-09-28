import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  getISTDateString,
  getISTDayName,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import { hhmmToMinutes } from '../../../utils/time.util';
import {
  ClinicAssignModel,
  ClinicAvailability,
} from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  DoctorSessionOverrideModel,
  NewDoctorSessionOverride,
} from '../models/doctorSessionOverride.model';
import { deriveSlotCount } from '../utils/helpers';
import logger from '../../../utils/logger';
import { realtimeBus, target } from '../../realtime';
import { ScheduleShiftService, toHHMM } from './scheduleShift.service';
import {
  MAX_SLOT_CONFIG_DAYS_AHEAD,
  SetSlotConfigDto,
} from '../schemas/slotConfig.schemas';

export const DEFAULT_SLOT_MINUTES = 30;

export interface SessionSlotConfig {
  sessionStart: string;
  sessionEnd: string;
  windowMinutes: number;
  isTokenBased: boolean;
  slotMinutes: number | null;
  stepMinutes: number | null;
  numberOfSlots: number | null;
  /** True when this session has a live `slot_config` override; false means it's using day defaults. */
  customized: boolean;
}

/** Statuses that hold a token number — mirrors the booking path's collision check. */
const BLOCKING_TOKEN_STATUSES = [
  'Upcoming',
  'Confirmed',
  'Patient Arrived',
  'Pending',
  'Rescheduled',
  'Completed',
] as const;

export interface SlotConfigResult {
  date: string;
  /** True only for a token-based day with no listable time segments at all. */
  isTokenBased: boolean;
  sessions: SessionSlotConfig[];
  selected: SessionSlotConfig | null;
  /** Next free token on a day with no sessions, where the slot grid is empty
   *  and the caller has nothing else to derive an override's number from. */
  nextToken?: number;
}

/** Owns per-session slot customization — `slot_config` rows on `DoctorSessionOverrideModel`; booking-capacity only, doesn't touch the live-queue pipeline. */
export class SlotConfigService {
  static async getSlotConfig(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionStart?: string
  ): Promise<SlotConfigResult> {
    const day = await ScheduleShiftService.resolveDaySegments(
      database,
      clinicId,
      doctorId,
      date
    );

    if (!day || day.segments.length === 0) {
      // A day off still books in the doctor's own mode, so a custom slot on it asks for a token, not a clock time.
      const isTokenBased = await this.booksTokensOnDay(
        clinicId,
        doctorId,
        date
      );
      const nextToken = isTokenBased
        ? await this.nextFreeTokenForDay(clinicId, doctorId, date)
        : undefined;
      return { date, isTokenBased, sessions: [], selected: null, nextToken };
    }

    const sessions = await Promise.all(
      day.segments.map((segment) =>
        this.buildSessionConfig(clinicId, doctorId, date, segment, day)
      )
    );

    return {
      date,
      isTokenBased: false,
      sessions,
      selected: this.pickSession(sessions, sessionStart),
    };
  }

  /** Customizes one shift's slots — time-based or token-based — validated against the shift's real window. */
  static async setSlotConfig(
    clinicId: string,
    actor: { id: string; userType: string },
    dto: SetSlotConfigDto
  ): Promise<SessionSlotConfig> {
    const doctorId = this.resolveTargetDoctorId(actor, dto.doctorId);
    await this.assertDoctorBelongsToClinic(clinicId, doctorId);

    const date = this.resolveDate(dto.forDate);

    const isTokenRequest = dto.noOfPatients != null;
    const day = isTokenRequest
      ? // Adding tokens is itself an override, so a day off still resolves to
        // the weekday's sittings rather than refusing for having none.
        await ScheduleShiftService.resolveDaySegmentsForOverride(
          database,
          clinicId,
          doctorId,
          date
        )
      : await ScheduleShiftService.resolveDaySegments(
          database,
          clinicId,
          doctorId,
          date
        );
    if (!day || day.segments.length === 0) {
      throw new HttpError(
        400,
        isTokenRequest
          ? 'This doctor has no sessions on this date to customize'
          : 'This doctor has no time-based sessions on this date to customize'
      );
    }

    const segment = this.findSegment(day.segments, dto.sessionStart);
    const sessionStart = toHHMM(segment.start);
    const sessionEnd = toHHMM(segment.end);
    const windowMinutes = segment.end - segment.start;

    if (dto.noOfPatients != null) {
      await this.insertOverride(
        clinicId,
        doctorId,
        date,
        sessionStart,
        actor.id,
        {
          noOfPatients: dto.noOfPatients,
          appointmentType: dto.appointmentType ?? null,
        }
      );

      return {
        sessionStart,
        sessionEnd,
        windowMinutes,
        isTokenBased: true,
        slotMinutes: null,
        stepMinutes: null,
        numberOfSlots: dto.noOfPatients,
        customized: true,
      };
    }

    const stepMinutes = dto.stepMinutes ?? day.stepMinutes ?? 0;
    let slotMinutes = dto.slotMinutes ?? null;
    let numberOfSlots = dto.numberOfSlots ?? null;

    if (slotMinutes != null && numberOfSlots != null) {
      const required =
        numberOfSlots * slotMinutes +
        Math.max(0, numberOfSlots - 1) * stepMinutes;
      if (required > windowMinutes) {
        throw new HttpError(
          400,
          `${numberOfSlots} slots of ${slotMinutes} min (with a ${stepMinutes} min buffer) need ` +
            `${required} min, but this session is only ${windowMinutes} min long`
        );
      }
    } else if (numberOfSlots != null) {
      const available =
        windowMinutes - Math.max(0, numberOfSlots - 1) * stepMinutes;
      slotMinutes = Math.floor(available / numberOfSlots);
      if (slotMinutes < 1) {
        throw new HttpError(
          400,
          `${numberOfSlots} slots don't fit in a ${windowMinutes}-minute session`
        );
      }
    } else if (slotMinutes != null) {
      numberOfSlots = deriveSlotCount(windowMinutes, slotMinutes, stepMinutes);
      if (numberOfSlots === 0) {
        throw new HttpError(
          400,
          `A ${slotMinutes}-minute slot doesn't fit in a ${windowMinutes}-minute session`
        );
      }
    }

    await this.insertOverride(
      clinicId,
      doctorId,
      date,
      sessionStart,
      actor.id,
      {
        slotMinutes,
        stepMinutes,
        numberOfSlots,
      }
    );

    // Slot length decides which rows the day view draws, so an open timeline is
    // stale the moment this lands. Fire-and-forget after the write, as
    // DoctorArrivalService.signal is: signalling must not fail a saved config.
    try {
      realtimeBus.notify(
        target.queue(clinicId, doctorId, date),
        'slot.config.changed'
      );
      realtimeBus.notify(target.board(clinicId), 'slot.config.changed');
    } catch (error) {
      logger.warn(
        `[SlotConfig] Failed to signal slot config change for doctor=${doctorId} date=${date}`,
        { error }
      );
    }

    return {
      sessionStart,
      sessionEnd,
      windowMinutes,
      isTokenBased: false,
      slotMinutes,
      stepMinutes,
      numberOfSlots,
      customized: true,
    };
  }

  /** The live override row of the given `type` for one session, or undefined — shared by SlotConfig/ExtraSlots/AvailableSlots services. */
  static async findOverrideRow(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionStart: string,
    type: 'slot_config' | 'extra_slots' = 'slot_config'
  ) {
    const [override] = await database
      .select()
      .from(DoctorSessionOverrideModel)
      .where(
        and(
          eq(DoctorSessionOverrideModel.clinicId, clinicId),
          eq(DoctorSessionOverrideModel.doctorId, doctorId),
          eq(DoctorSessionOverrideModel.forDate, date),
          eq(DoctorSessionOverrideModel.type, type),
          eq(DoctorSessionOverrideModel.sessionStart, sessionStart)
        )
      )
      .orderBy(desc(DoctorSessionOverrideModel.createdAt))
      .limit(1);

    return override;
  }

  private static async buildSessionConfig(
    clinicId: string,
    doctorId: string,
    date: string,
    segment: { start: number; end: number },
    day: { slotMinutes: number | null; stepMinutes: number | null }
  ): Promise<SessionSlotConfig> {
    const sessionStart = toHHMM(segment.start);
    const sessionEnd = toHHMM(segment.end);
    const windowMinutes = segment.end - segment.start;

    const override = await this.findOverrideRow(
      clinicId,
      doctorId,
      date,
      sessionStart
    );

    if (override?.noOfPatients != null) {
      return {
        sessionStart,
        sessionEnd,
        windowMinutes,
        isTokenBased: true,
        slotMinutes: null,
        stepMinutes: null,
        numberOfSlots: override.noOfPatients,
        customized: true,
      };
    }

    const slotMinutes =
      override?.slotMinutes ?? day.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    const stepMinutes = override?.stepMinutes ?? day.stepMinutes ?? 0;
    const numberOfSlots =
      override?.numberOfSlots ??
      deriveSlotCount(windowMinutes, slotMinutes, stepMinutes);

    return {
      sessionStart,
      sessionEnd,
      windowMinutes,
      isTokenBased: false,
      slotMinutes,
      stepMinutes,
      numberOfSlots,
      customized: override != null,
    };
  }

  private static findSegment(
    segments: Array<{ start: number; end: number }>,
    sessionStart?: string
  ): { start: number; end: number } {
    if (sessionStart) {
      const minutes = hhmmToMinutes(sessionStart);
      const match = segments.find((segment) => segment.start === minutes);
      if (!match) {
        throw new HttpError(
          400,
          `No session starting at ${sessionStart} on this date`
        );
      }
      return match;
    }

    if (segments.length === 1) return segments[0];

    throw new HttpError(
      400,
      'This day has multiple sessions — specify sessionStart'
    );
  }

  private static pickSession(
    sessions: SessionSlotConfig[],
    sessionStart?: string
  ): SessionSlotConfig | null {
    if (sessionStart) {
      return sessions.find((s) => s.sessionStart === sessionStart) ?? null;
    }
    if (sessions.length === 1) return sessions[0];

    const { hours, minutes } = getISTHoursMinutes();
    const nowMinutes = hours * 60 + minutes;
    const active = sessions.find((s) => {
      const end = hhmmToMinutes(s.sessionEnd);
      return end !== null && end > nowMinutes;
    });
    return active ?? sessions[sessions.length - 1] ?? null;
  }

  /** Must be today or later, within a bounded lookahead — mirrors session-override's date bounds. */
  private static resolveDate(forDate: string): string {
    const today = getISTDateString();
    if (forDate < today) {
      throw new HttpError(400, 'Cannot customize slots for a past date');
    }

    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + MAX_SLOT_CONFIG_DAYS_AHEAD);
    const latest = limit.toISOString().split('T')[0];

    if (forDate > latest) {
      throw new HttpError(
        400,
        `Slot config can only be set up to ${MAX_SLOT_CONFIG_DAYS_AHEAD} days ahead`
      );
    }
    return forDate;
  }

  /** Shared with DoctorArrivalService, where a token day's shifts each need their own arrival. */
  static async isWeeklyTokenDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<boolean> {
    const dayName = getISTDayName(date);

    const [availability] = await database
      .select({
        noOfPatients: ClinicAvailability.noOfPatients,
        isAvailable: ClinicAvailability.isAvailable,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId),
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      );

    return Boolean(
      availability?.isAvailable &&
      availability.noOfPatients &&
      availability.noOfPatients > 0
    );
  }

  /**
   * For a day with no sessions, in one query: this weekday carries a token count (on or off),
   * or, failing that, the doctor issues tokens on any working weekday.
   */
  private static async booksTokensOnDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<boolean> {
    const dayName = getISTDayName(date).toLowerCase();
    const rows = await database
      .select({
        dayOfWeek: ClinicAvailability.dayOfWeek,
        noOfPatients: ClinicAvailability.noOfPatients,
        isAvailable: ClinicAvailability.isAvailable,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId)
        )
      );

    const hasTokens = (n: number | null) => Boolean(n && n > 0);
    const sameDay = rows.find((r) => r.dayOfWeek.toLowerCase() === dayName);
    if (sameDay && hasTokens(sameDay.noOfPatients)) return true;
    return rows.some((r) => r.isAvailable && hasTokens(r.noOfPatients));
  }

  /**
   * Lowest unissued token for a day with no sessions, so an override booking
   * gets a real number instead of re-offering 1 until the insert is rejected.
   */
  private static async nextFreeTokenForDay(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const nextDay = new Date(dayStart);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const booked = await database
      .select({ tokenNo: AppointmentModel.tokenNo })
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.clinicId, clinicId),
          eq(AppointmentModel.doctorId, doctorId),
          gte(AppointmentModel.appointmentDate, dayStart),
          lt(AppointmentModel.appointmentDate, nextDay),
          // Mirrors the booking path's own collision check, so the number
          // offered here is never one that insert would then reject.
          inArray(AppointmentModel.appointmentStatus, BLOCKING_TOKEN_STATUSES)
        )
      );

    const taken = new Set(
      booked
        .map((b) => Number(b.tokenNo))
        .filter((n) => Number.isFinite(n) && n > 0)
    );

    // Scans from 1 so a cancelled token is reissued rather than skipped.
    let candidate = 1;
    while (taken.has(candidate)) candidate += 1;
    return candidate;
  }

  private static async insertOverride(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionStart: string,
    createdBy: string,
    values: Partial<
      Pick<
        NewDoctorSessionOverride,
        | 'slotMinutes'
        | 'stepMinutes'
        | 'numberOfSlots'
        | 'noOfPatients'
        | 'appointmentType'
      >
    >
  ): Promise<void> {
    await database.insert(DoctorSessionOverrideModel).values({
      clinicId,
      doctorId,
      forDate: date,
      type: 'slot_config',
      sessionStart,
      createdBy,
      ...values,
    } satisfies NewDoctorSessionOverride);
  }

  private static resolveTargetDoctorId(
    actor: { id: string; userType: string },
    requestedDoctorId?: string
  ): string {
    if (actor.userType !== 'Doctor') {
      if (!requestedDoctorId) {
        throw new HttpError(400, 'doctorId is required');
      }
      return requestedDoctorId;
    }

    if (requestedDoctorId && requestedDoctorId !== actor.id) {
      throw new HttpError(403, 'A doctor can only customize their own slots');
    }
    return actor.id;
  }

  private static async assertDoctorBelongsToClinic(
    clinicId: string,
    doctorId: string
  ): Promise<void> {
    const [assigned] = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          eq(ClinicAssignModel.userId, doctorId)
        )
      );

    if (!assigned) {
      throw new HttpError(400, `Not a doctor in this clinic: ${doctorId}`);
    }
  }
}
