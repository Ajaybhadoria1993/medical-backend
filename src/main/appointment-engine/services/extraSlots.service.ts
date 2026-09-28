import { and, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import { hhmmToMinutes } from '../../../utils/time.util';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  DoctorSessionOverrideModel,
  NewDoctorSessionOverride,
} from '../models/doctorSessionOverride.model';
import { ScheduleShiftService, toHHMM } from './scheduleShift.service';
import { SlotConfigService } from './slotConfig.service';
import { MAX_SLOT_CONFIG_DAYS_AHEAD } from '../schemas/slotConfig.schemas';
import { SetExtraSlotsDto } from '../schemas/extraSlots.schemas';

/** Last minute of the day; extra slots may not spill into tomorrow. */
const END_OF_DAY_MINUTES = 23 * 60 + 59;

export interface ExtraSlotsConfig {
  sessionStart: string;
  sessionEnd: string;
  numberOfSlots: number;
  slotMinutes: number | null;
  stepMinutes: number | null;
}

export interface GetExtraSlotsResult {
  date: string;
  sessions: ExtraSlotsConfig[];
  selected: ExtraSlotsConfig | null;
}

/** Owns extra bookable capacity appended after a session's end (walk-in surge) — `extra_slots` rows, same table as `slot_config`. */
export class ExtraSlotsService {
  static async getExtraSlots(
    clinicId: string,
    doctorId: string,
    date: string,
    sessionStart?: string
  ): Promise<GetExtraSlotsResult> {
    // Feeds the override pickers, so a day off still lists its sittings —
    // otherwise the modal has no session to offer and refuses the booking.
    const day = await ScheduleShiftService.resolveDaySegmentsForOverride(
      database,
      clinicId,
      doctorId,
      date
    );

    if (!day || day.segments.length === 0) {
      return { date, sessions: [], selected: null };
    }

    const sessions = await Promise.all(
      day.segments.map((segment) =>
        this.buildConfig(clinicId, doctorId, date, segment)
      )
    );

    return {
      date,
      sessions,
      selected: this.pickSession(sessions, sessionStart),
    };
  }

  /** Adds (or clears with `numberOfSlots: 0`) extra slots after a session's end, validated against room before the next session/midnight. */
  static async setExtraSlots(
    clinicId: string,
    actor: { id: string; userType: string },
    dto: SetExtraSlotsDto
  ): Promise<ExtraSlotsConfig> {
    const doctorId = this.resolveTargetDoctorId(actor, dto.doctorId);
    await this.assertDoctorBelongsToClinic(clinicId, doctorId);

    const date = this.resolveDate(dto.forDate);

    const day = await ScheduleShiftService.resolveDaySegments(
      database,
      clinicId,
      doctorId,
      date
    );
    if (!day || day.segments.length === 0) {
      throw new HttpError(
        400,
        'This doctor has no time-based sessions on this date to extend'
      );
    }

    const index = this.findSegmentIndex(day.segments, dto.sessionStart);
    const segment = day.segments[index];
    const nextSegment = day.segments[index + 1];
    const sessionStart = toHHMM(segment.start);
    const sessionEnd = toHHMM(segment.end);

    const stepMinutes = dto.stepMinutes ?? 0;

    if (dto.numberOfSlots > 0) {
      const roomEnd = nextSegment ? nextSegment.start : END_OF_DAY_MINUTES;
      const roomAvailable = roomEnd - segment.end;
      const required =
        dto.numberOfSlots * dto.slotMinutes +
        Math.max(0, dto.numberOfSlots - 1) * stepMinutes;

      if (required > roomAvailable) {
        throw new HttpError(
          400,
          `${dto.numberOfSlots} extra slots of ${dto.slotMinutes} min need ${required} min after ` +
            `this session, but only ${roomAvailable} min are free before ` +
            `${nextSegment ? 'the next session' : 'midnight'}`
        );
      }
    }

    await database.insert(DoctorSessionOverrideModel).values({
      clinicId,
      doctorId,
      forDate: date,
      type: 'extra_slots',
      sessionStart,
      createdBy: actor.id,
      numberOfSlots: dto.numberOfSlots,
      slotMinutes: dto.slotMinutes,
      stepMinutes,
    } satisfies NewDoctorSessionOverride);

    return {
      sessionStart,
      sessionEnd,
      numberOfSlots: dto.numberOfSlots,
      slotMinutes: dto.slotMinutes,
      stepMinutes,
    };
  }

  private static async buildConfig(
    clinicId: string,
    doctorId: string,
    date: string,
    segment: { start: number; end: number }
  ): Promise<ExtraSlotsConfig> {
    const sessionStart = toHHMM(segment.start);
    const sessionEnd = toHHMM(segment.end);

    const override = await SlotConfigService.findOverrideRow(
      clinicId,
      doctorId,
      date,
      sessionStart,
      'extra_slots'
    );

    return {
      sessionStart,
      sessionEnd,
      numberOfSlots: override?.numberOfSlots ?? 0,
      slotMinutes: override?.slotMinutes ?? null,
      stepMinutes: override?.stepMinutes ?? null,
    };
  }

  private static findSegmentIndex(
    segments: Array<{ start: number; end: number }>,
    sessionStart?: string
  ): number {
    if (sessionStart) {
      const minutes = hhmmToMinutes(sessionStart);
      const index = segments.findIndex((segment) => segment.start === minutes);
      if (index === -1) {
        throw new HttpError(
          400,
          `No session starting at ${sessionStart} on this date`
        );
      }
      return index;
    }

    if (segments.length === 1) return 0;

    throw new HttpError(
      400,
      'This day has multiple sessions — specify sessionStart'
    );
  }

  private static pickSession(
    sessions: ExtraSlotsConfig[],
    sessionStart?: string
  ): ExtraSlotsConfig | null {
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

  /** Must be today or later, within a bounded lookahead — mirrors slot-config's date bounds. */
  private static resolveDate(forDate: string): string {
    const today = getISTDateString();
    if (forDate < today) {
      throw new HttpError(400, 'Cannot add extra slots for a past date');
    }

    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + MAX_SLOT_CONFIG_DAYS_AHEAD);
    const latest = limit.toISOString().split('T')[0];

    if (forDate > latest) {
      throw new HttpError(
        400,
        `Extra slots can only be set up to ${MAX_SLOT_CONFIG_DAYS_AHEAD} days ahead`
      );
    }
    return forDate;
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
      throw new HttpError(
        403,
        'A doctor can only add extra slots to their own day'
      );
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
