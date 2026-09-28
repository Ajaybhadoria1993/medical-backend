import redisClient from '../../../configurations/redisConfig';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import { hhmmToMinutes } from '../../../utils/time.util';
import { getRedisKey } from '../utils/helpers';
import { ScheduleShiftService, toHHMM } from './scheduleShift.service';
import { ExtraSlotsService } from './extraSlots.service';
import { SlotConfigService, DEFAULT_SLOT_MINUTES } from './slotConfig.service';

/** Cheap to recompute and only ever read while a chooser is open, so a short TTL is enough to absorb the burst without going stale across a schedule edit. */
const CACHE_TTL_SECONDS = 60;

const END_OF_DAY_MINUTES = 24 * 60;

/** Why the offered shift target is where it is — lets the UI word itself without re-deriving anything. */
export type ShiftReason = 'after_session_end';

export interface MissedSlotShiftOption {
  targetStart: string;
  targetEnd: string;
  /** True when the target doesn't exist yet and booking it must first register an extra slot. */
  needsCreation: boolean;
  reason: ShiftReason;
}

export interface MissedSlotOptionsResult {
  date: string;
  slotStart: string;
  /** False when the slot isn't actually in the past — the chooser shouldn't be offered at all. */
  isMissed: boolean;
  canShift: boolean;
  shift: MissedSlotShiftOption | null;
  /** Why shifting isn't on offer, for the UI to show instead of an enabled-looking dead option. */
  shiftBlockedReason: string | null;
  canBookAnyway: boolean;
}

const hhmm = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Decides what a receptionist may do with a slot whose time has passed.
 *
 * The client used to work this out itself — walking the rendered grid for a
 * reusable slot, then doing session arithmetic to place a new one. That put
 * booking rules in the browser and made the answer depend on what happened to
 * be rendered, which drifts from the stored session (accumulated extra slots, a
 * dismissed cell) and could propose a target the server would then reject.
 *
 * The offer is always a newly created slot after the missed slot's own session
 * ends — in the break before the next sitting, or after the day's last one —
 * bounded by the next session's start. Never an already-open slot earlier in
 * the day: those are held for ordinary bookings, and spending one on a lapsed
 * walk-in silently eats the day's remaining capacity.
 */
export class MissedSlotOptionsService {
  static async getOptions(
    clinicId: string,
    doctorId: string,
    date: string,
    slotStart: string
  ): Promise<MissedSlotOptionsResult> {
    const startMinutes = hhmmToMinutes(slotStart);
    if (startMinutes === null || Number.isNaN(startMinutes)) {
      throw new HttpError(400, 'slotStart must be a HH:mm time');
    }

    const cacheKey = getRedisKey(
      'missed_slot_options',
      clinicId,
      doctorId,
      date,
      slotStart
    );

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as MissedSlotOptionsResult;
        if (typeof parsed?.slotStart === 'string') return parsed;
      }
    } catch {
      // Unreadable or absent — compute below.
    }

    const result = await this.compute(
      clinicId,
      doctorId,
      date,
      slotStart,
      startMinutes
    );

    try {
      await redisClient.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        CACHE_TTL_SECONDS
      );
    } catch {
      // Best-effort: costs one recompute next time.
    }

    return result;
  }

  private static async compute(
    clinicId: string,
    doctorId: string,
    date: string,
    slotStart: string,
    startMinutes: number
  ): Promise<MissedSlotOptionsResult> {
    const base: MissedSlotOptionsResult = {
      date,
      slotStart,
      isMissed: this.isPast(date, startMinutes),
      canShift: false,
      shift: null,
      shiftBlockedReason: null,
      canBookAnyway: true,
    };

    if (!base.isMissed) {
      return { ...base, shiftBlockedReason: 'This slot has not passed yet' };
    }

    const day = await ScheduleShiftService.resolveDaySegments(
      database,
      clinicId,
      doctorId,
      date
    );
    const segment = day?.segments.find(
      (s) => startMinutes >= s.start && startMinutes < s.end
    );
    if (!segment) {
      return {
        ...base,
        shiftBlockedReason: 'This time is outside the doctor’s sessions',
      };
    }

    // Always a brand-new slot after this session ends — never an existing open
    // one earlier in the day. A slot still free at 11:00 is free because it is
    // being kept for someone booking it normally; handing it to a walk-in whose
    // 10:30 lapsed quietly spends the day's remaining capacity. Appending
    // instead adds capacity rather than consuming it, which is why the offer
    // lands in the break (10-1, 4-7 puts it at 1:00 PM) or after the last
    // session's end.
    const appended = await this.planAppendedSlot(
      clinicId,
      doctorId,
      date,
      segment,
      day?.segments ?? []
    );
    if (!appended) {
      return {
        ...base,
        shiftBlockedReason: 'No room after this session before the next one',
      };
    }

    return {
      ...base,
      canShift: true,
      shift: { ...appended, needsCreation: true, reason: 'after_session_end' },
    };
  }

  /** Only today can have a past slot mid-day; any earlier date is wholly past and any later one wholly future. */
  private static isPast(date: string, startMinutes: number): boolean {
    const today = getISTDateString();
    if (date < today) return true;
    if (date > today) return false;
    const { hours, minutes } = getISTHoursMinutes();
    return startMinutes < hours * 60 + minutes;
  }

  /**
   * Where the new slot goes: after this session's end, offset by the extra
   * slots already appended there, and only if it fits before the next session
   * starts. That bound is what places it inside the break rather than running
   * over the doctor's next sitting.
   */
  private static async planAppendedSlot(
    clinicId: string,
    doctorId: string,
    date: string,
    segment: { start: number; end: number },
    allSegments: Array<{ start: number; end: number }>
  ): Promise<{ targetStart: string; targetEnd: string } | null> {
    const sessionStart = toHHMM(segment.start);
    const [config, extras] = await Promise.all([
      SlotConfigService.getSlotConfig(clinicId, doctorId, date, sessionStart),
      ExtraSlotsService.getExtraSlots(clinicId, doctorId, date, sessionStart),
    ]);
    const session = config.selected;

    const duration = session?.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    const stepGap = session?.stepMinutes ?? 0;

    // Extras already appended after this session, NOT the session's own slot
    // count: `slot_config.numberOfSlots` is the total slots *inside* the
    // session (10 for a 5-hour session at 30 min), so offsetting by it pushed
    // the target five hours past the session end and failed the next-session
    // bound on a day with plenty of room.
    const appendedCount = extras.selected?.numberOfSlots ?? 0;

    const targetStart = segment.end + appendedCount * (duration + stepGap);

    // Room ends where the next session begins — which is also what keeps the
    // target out of the break sitting between them.
    const nextStart = allSegments
      .map((s) => s.start)
      .filter((start) => start > segment.start)
      .sort((a, b) => a - b)[0];
    const roomEnd = nextStart ?? END_OF_DAY_MINUTES;

    if (targetStart + duration > roomEnd) return null;

    return {
      targetStart: hhmm(targetStart),
      targetEnd: hhmm(targetStart + duration),
    };
  }
}
