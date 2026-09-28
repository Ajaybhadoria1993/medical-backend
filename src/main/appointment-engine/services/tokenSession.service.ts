import { HttpError } from '../../../middlewear/errorHandler';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import {
  DaySegments,
  ScheduleShiftService,
  toHHMM,
} from './scheduleShift.service';
import { TokenCapacityService } from './tokenCapacity.service';

type DbExecutor = Parameters<typeof ScheduleShiftService.resolveDaySegments>[0];

export interface ResolvedTokenSession {
  /** 1-based ordinal stored on the appointment. */
  sessionIndex: number;
  /** The session's current window, minutes since IST midnight. */
  start: number;
  end: number;
  /** Current start as IST 'HH:mm' — for override lookups and messages. */
  sessionStart: string;
  /** Tokens this session holds. */
  capacity: number;
  /** How many sessions the day has, so callers can label a token M-3 vs E-3. */
  totalSessions: number;
}

/**
 * TokenSessionService
 *
 * Decides *which shift* a token belongs to, which is the question the booking
 * path never asked. Token numbering restarts at 1 in every shift, so a doctor
 * running a morning and an evening clinic has two token 3s; without a session
 * the number alone cannot identify an appointment, and a day-wide `1..N` scan
 * hands the evening patient a morning number or refuses them outright once the
 * morning has filled.
 */
export class TokenSessionService {
  /**
   * The session a booking lands in.
   *
   * `requested` wins when given. Otherwise: a single-session day has only one
   * answer; today falls to the first session that has not already ended, so a
   * walk-in at 18:00 books the evening rather than being told the day is over;
   * and a future date with more than one session is refused rather than
   * guessed, because booking someone into the wrong half of the day is worse
   * than asking which half they meant.
   */
  static async resolve(
    executor: DbExecutor,
    clinicId: string,
    doctorId: string,
    date: string,
    requested?: number | null
  ): Promise<ResolvedTokenSession> {
    const day = await ScheduleShiftService.resolveDaySegmentsForTokens(
      executor,
      clinicId,
      doctorId,
      date
    );

    if (!day || day.segments.length === 0) {
      throw new HttpError(400, 'Doctor has no working sessions on this date');
    }

    const index = this.pickIndex(day, date, requested);
    const segment = day.segments[index - 1];
    const sessionStart = toHHMM(segment.start);

    const { capacity } = await TokenCapacityService.resolveForSession(
      clinicId,
      doctorId,
      date,
      sessionStart,
      segment.slotId,
      executor,
      index
    );

    return {
      sessionIndex: index,
      start: segment.start,
      end: segment.end,
      sessionStart,
      capacity,
      totalSessions: day.segments.length,
    };
  }

  private static pickIndex(
    day: DaySegments,
    date: string,
    requested?: number | null
  ): number {
    const total = day.segments.length;

    if (requested != null) {
      if (requested < 1 || requested > total) {
        throw new HttpError(
          400,
          `This day has ${total} session${total === 1 ? '' : 's'}; sessionIndex ${requested} does not exist`
        );
      }
      return requested;
    }

    // Nothing to choose between.
    if (total === 1) return 1;

    // Today: the first session still open. Deliberately compares against each
    // session's *end*, not its start — someone booking at 14:00 on a
    // 09:00-13:00 / 17:00-21:00 day means the evening, and the old day-wide
    // end check refused them outright.
    if (date === getISTDateString()) {
      const { hours, minutes } = getISTHoursMinutes();
      const nowMinutes = hours * 60 + minutes;
      const open = day.segments.findIndex(
        (segment) => nowMinutes < segment.end
      );
      // All ended: the last one stays open. A late doctor still sees walk-ins, and
      // there is no later shift to send them to; the web form books it too.
      return open === -1 ? total : open + 1;
    }

    // A future date carries no clock to infer from.
    throw new HttpError(
      400,
      'This day has multiple sessions — specify sessionIndex'
    );
  }
}
