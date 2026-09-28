import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';
import { hhmmToMinutes } from '../../../utils/time.util';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { UserModel } from '../../users/models/user.model';
import {
  DoctorArrivalModel,
  NewDoctorArrival,
} from '../models/doctorArrival.model';
import { getRedisKey } from '../utils/helpers';
import { CacheKeys } from '../../../utils/cache.util';
import { MarkDoctorArrivalDto } from '../schemas/doctorArrival.schemas';
import { AppointmentEngineOrchestrator } from './orchestrator.service';
import { ScheduleShiftService } from './scheduleShift.service';
import { SlotConfigService } from './slotConfig.service';
import { realtimeBus, target } from '../../realtime';

export type DoctorArrivalSource = 'self' | 'reception' | 'auto_confirm';

/** Outlives the day it's keyed to; the date in the key stops it matching tomorrow. */
const SEEN_TTL_SECONDS = 36 * 60 * 60;

const ARRIVAL_TTL_SECONDS = 24 * 60 * 60;

/** Redis keys are string-joined — a real session-start value can never collide with this. */
const NO_SESSION_SEGMENT = '_single';

export interface ActiveDoctorArrival {
  doctorId: string;
  arrivedAt: string;
  sessionStart: string | null;
  source: DoctorArrivalSource;
  createdBy: string;
}

/**
 * Owns doctor arrival, scoped per (doctor, day, shift) — a doctor working two
 * shifts arrives for each independently, with no "sign off" needed: a shift
 * with no arrival row is just answered "not arrived" fresh, every time.
 */
export class DoctorArrivalService {
  /** Records arrival. Doctor can only target self; Admin/Receptionist can target any clinic doctor. */
  static async markArrival(
    clinicId: string,
    actor: { id: string; userType: string },
    dto: MarkDoctorArrivalDto,
    source: DoctorArrivalSource = 'self'
  ): Promise<ActiveDoctorArrival> {
    const doctorId = this.resolveTargetDoctorId(actor, dto.doctorId);

    if (source !== 'auto_confirm') {
      await this.assertDoctorBelongsToClinic(clinicId, doctorId);
    }

    const date = getISTDateString();
    const arrivedAt = this.resolveArrivedAt(dto.arrivedAt);
    const sessionStart = await this.resolveSessionStart(
      clinicId,
      doctorId,
      date,
      dto.sessionStart
    );

    const [inserted] = await database
      .insert(DoctorArrivalModel)
      .values({
        clinicId,
        doctorId,
        forDate: date,
        sessionStart,
        arrivedAt,
        source,
        createdBy: actor.id,
      } satisfies NewDoctorArrival)
      .returning();

    // Written before the engine refresh so recalculation doesn't read a stale cache.
    await this.cacheArrival(clinicId, doctorId, date, inserted);

    // The "on duty" stat counts arrivals, so its snapshot is stale the moment
    // one is recorded. Retired before the signal, or the refetch that signal
    // triggers can still be served the pre-arrival count.
    await invalidateClinicDashboardCaches(clinicId);

    // Arrival changes what the doctor's own timeline and the reception board
    // show, and neither was told: the engine refresh below recalculates the
    // queue but signals nothing, so every other screen kept saying "Not
    // arrived yet" until it was reloaded by hand.
    this.signal(clinicId, doctorId, date);

    void this.refreshQueueIfLive(clinicId, doctorId, date);

    return this.toActive(inserted);
  }

  /** Fallback: confirming a patient implies arrival for that patient's shift. No-ops if already recorded. */
  static async autoMarkOnConfirm(
    clinicId: string,
    doctorId: string,
    confirmedByUserId: string,
    appointment?: {
      appointmentDate: Date | string;
      sessionIndex: number | null;
    }
  ): Promise<void> {
    const date = getISTDateString();
    // Confirming another day's booking says nothing about today's arrival.
    if (
      appointment &&
      getISTDateString(new Date(appointment.appointmentDate)) !== date
    ) {
      return;
    }

    // One Redis read after a shift's first arrival, instead of the session lookup on every confirm.
    const seenKey =
      appointment?.sessionIndex != null
        ? CacheKeys.doctorShiftArrived(
            clinicId,
            doctorId,
            date,
            appointment.sessionIndex
          )
        : null;
    if (seenKey && (await redisClient.get(seenKey).catch(() => null))) return;
    const markSeen = () =>
      seenKey
        ? redisClient
            .setex(seenKey, SEEN_TTL_SECONDS, '1')
            .catch(() => undefined)
        : undefined;

    // The patient's own shift, not the clock's: a morning token seen in the gap belongs to the morning.
    let sessionStart: string | undefined;
    if (appointment?.sessionIndex != null) {
      const sessions = await ScheduleShiftService.listSessions(
        clinicId,
        doctorId,
        date,
        true
      ).catch(() => []);
      sessionStart = sessions[appointment.sessionIndex - 1]?.start;
    }

    const existing = await this.getArrival(
      clinicId,
      doctorId,
      date,
      sessionStart
    );
    if (!existing) {
      await this.markArrival(
        clinicId,
        { id: confirmedByUserId, userType: 'Doctor' },
        { sessionStart },
        'auto_confirm'
      );
    }
    // Unresolved shift means the arrival went to the clock's shift, so don't flag the patient's.
    if (sessionStart) await markSeen();
  }

  /** Reads today's arrival for the currently-relevant shift, Redis first with DB fallback. */
  static async getArrival(
    clinicId: string,
    doctorId: string,
    date: string = getISTDateString(),
    sessionStart?: string
  ): Promise<ActiveDoctorArrival | null> {
    const resolvedSession =
      sessionStart ??
      (await this.resolveSessionStart(clinicId, doctorId, date));

    const key = getRedisKey(
      'arrival',
      clinicId,
      doctorId,
      date,
      resolvedSession ?? NO_SESSION_SEGMENT
    );

    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached) as ActiveDoctorArrival;
    } catch (error) {
      logger.warn(
        `[DoctorArrival] Redis read failed for doctor=${doctorId} date=${date}; falling back to DB`,
        { error }
      );
    }

    const [row] = await database
      .select()
      .from(DoctorArrivalModel)
      .where(
        and(
          eq(DoctorArrivalModel.doctorId, doctorId),
          eq(DoctorArrivalModel.forDate, date),
          resolvedSession === null
            ? isNull(DoctorArrivalModel.sessionStart)
            : eq(DoctorArrivalModel.sessionStart, resolvedSession)
        )
      )
      .orderBy(desc(DoctorArrivalModel.createdAt))
      .limit(1);

    if (row) {
      const active = this.toActive(row);
      void this.cacheArrival(clinicId, doctorId, date, row);
      return active;
    }

    // A token day's sittings are separately numbered clinics, so an evening
    // with no arrival of its own is "not arrived" — never the morning's time.
    if (await SlotConfigService.isWeeklyTokenDay(clinicId, doctorId, date)) {
      return null;
    }

    // A time day splits on lunch rather than on a second sitting: the 09:00
    // arrival still stands after the break, so carry the day's last one over.
    const [fallback] = await database
      .select()
      .from(DoctorArrivalModel)
      .where(
        and(
          eq(DoctorArrivalModel.doctorId, doctorId),
          eq(DoctorArrivalModel.forDate, date)
        )
      )
      .orderBy(desc(DoctorArrivalModel.arrivedAt))
      .limit(1);

    if (!fallback) return null;

    // Cached under its own session key, not the one just asked for, so the
    // fallback never masks a later arrival for the current shift.
    void this.cacheArrival(clinicId, doctorId, date, fallback);
    return this.toActive(fallback);
  }

  /** Today's arrived doctors for the clinic, each checked against their own current shift. */
  static async getActiveForClinic(
    clinicId: string,
    doctorIds?: string[],
    allSessions = false
  ): Promise<{ date: string; arrivals: ActiveDoctorArrival[] }> {
    const date = getISTDateString();

    const targets =
      doctorIds && doctorIds.length > 0
        ? doctorIds
        : await this.listClinicDoctorIds(clinicId);

    if (targets.length === 0) return { date, arrivals: [] };

    // Opt-in only: the default stays one row per doctor, which is what every
    // caller indexing this by doctorId already assumes.
    if (allSessions) {
      return { date, arrivals: await this.listAllForDay(targets, date) };
    }

    const arrivals = await Promise.all(
      targets.map((doctorId) => this.getArrival(clinicId, doctorId, date))
    );

    return {
      date,
      arrivals: arrivals.filter((a): a is ActiveDoctorArrival => a !== null),
    };
  }

  /** Every shift's arrival for the day, one row per (doctor, shift). */
  private static async listAllForDay(
    doctorIds: string[],
    date: string
  ): Promise<ActiveDoctorArrival[]> {
    const rows = await database
      .select()
      .from(DoctorArrivalModel)
      .where(
        and(
          inArray(DoctorArrivalModel.doctorId, doctorIds),
          eq(DoctorArrivalModel.forDate, date)
        )
      )
      .orderBy(desc(DoctorArrivalModel.createdAt));

    // The table is append-only, so a corrected arrival sits beside the one it
    // replaces: newest wins, and the rest of that shift's history is dropped.
    const newest = new Map<string, ActiveDoctorArrival>();
    for (const row of rows) {
      const key = `${row.doctorId}:${row.sessionStart ?? NO_SESSION_SEGMENT}`;
      if (!newest.has(key)) newest.set(key, this.toActive(row));
    }

    return Array.from(newest.values());
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
      throw new HttpError(403, 'A doctor can only mark their own arrival');
    }
    return actor.id;
  }

  /** Must be today, and not in the future. */
  private static resolveArrivedAt(arrivedAt?: string): Date {
    if (!arrivedAt) return new Date();

    const parsed = new Date(arrivedAt);
    const now = new Date();

    if (parsed.getTime() > now.getTime()) {
      throw new HttpError(400, 'arrivedAt cannot be in the future');
    }
    if (getISTDateString(parsed) !== getISTDateString(now)) {
      throw new HttpError(400, "arrivedAt must be on today's date");
    }
    return parsed;
  }

  /** Explicit value wins; otherwise picks whichever session the clock currently falls in. */
  private static async resolveSessionStart(
    clinicId: string,
    doctorId: string,
    date: string,
    requested?: string
  ): Promise<string | null> {
    if (requested) return requested;

    let sessions: Array<{ start: string; end: string }>;
    try {
      sessions = await ScheduleShiftService.listSessions(
        clinicId,
        doctorId,
        date,
        // Token days included, else every token doctor's arrival is saved with
        // no shift and reads as the day's first one.
        true
      );
    } catch (error) {
      logger.warn(
        `[DoctorArrival] Failed to resolve sessions for doctor=${doctorId} date=${date}`,
        { error }
      );
      return null;
    }

    if (sessions.length === 0) return null;

    const { hours, minutes } = getISTHoursMinutes();
    const nowMinutes = hours * 60 + minutes;

    const active = sessions.find((session) => {
      const end = hhmmToMinutes(session.end);
      return end !== null && end > nowMinutes;
    });

    return (active ?? sessions[sessions.length - 1]).start;
  }

  private static toActive(
    row: typeof DoctorArrivalModel.$inferSelect
  ): ActiveDoctorArrival {
    return {
      doctorId: row.doctorId,
      arrivedAt: row.arrivedAt.toISOString(),
      sessionStart: row.sessionStart,
      source: row.source as DoctorArrivalSource,
      createdBy: row.createdBy,
    };
  }

  private static async cacheArrival(
    clinicId: string,
    doctorId: string,
    date: string,
    row: typeof DoctorArrivalModel.$inferSelect
  ): Promise<void> {
    try {
      await redisClient.set(
        getRedisKey(
          'arrival',
          clinicId,
          doctorId,
          date,
          row.sessionStart ?? NO_SESSION_SEGMENT
        ),
        JSON.stringify(this.toActive(row)),
        'EX',
        ARRIVAL_TTL_SECONDS
      );
    } catch (error) {
      logger.warn(
        `[DoctorArrival] Redis write failed for doctor=${doctorId} date=${date}`,
        { error }
      );
    }
  }

  /**
   * Tells the doctor's own screen and the reception board to re-read, the same
   * way a queue action does. Fire-and-forget after the write: a signalling
   * failure must never fail an arrival that is already recorded.
   */
  private static signal(
    clinicId: string,
    doctorId: string,
    date: string
  ): void {
    try {
      realtimeBus.notify(
        target.queue(clinicId, doctorId, date),
        'doctor.arrived'
      );
      realtimeBus.notify(target.board(clinicId), 'doctor.arrived');
    } catch (error) {
      logger.warn(
        `[DoctorArrival] Failed to signal arrival for doctor=${doctorId} date=${date}`,
        { error }
      );
    }
  }

  private static async refreshQueueIfLive(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    if (date !== getISTDateString()) return;

    try {
      const orchestrator = new AppointmentEngineOrchestrator();
      await orchestrator.onDoctorArrival(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[DoctorArrival] Failed to refresh queue for doctor=${doctorId} on ${date}`,
        { error }
      );
    }
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
          inArray(UserModel.userType, ['Doctor', 'Admin']),
          eq(ClinicAssignModel.userId, doctorId)
        )
      );

    if (!assigned) {
      throw new HttpError(400, `Not a doctor in this clinic: ${doctorId}`);
    }
  }

  private static async listClinicDoctorIds(
    clinicId: string
  ): Promise<string[]> {
    const rows = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, ['Doctor', 'Admin'])
        )
      );

    return rows.map((row) => row.userId);
  }
}
