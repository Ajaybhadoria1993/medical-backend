import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import { ClinicAssignModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import {
  DoctorSessionOverrideModel,
  NewDoctorSessionOverride,
} from '../models/doctorSessionOverride.model';
import { getRedisKey } from '../utils/helpers';
import {
  AnnounceSessionOverrideDto,
  MAX_OVERRIDE_DAYS_AHEAD,
} from '../schemas/sessionOverride.schemas';
import { DelayTrackerService } from './delayTracker.service';
import { AppointmentEngineOrchestrator } from './orchestrator.service';
import { ScheduleShiftService, ShiftPlan } from './scheduleShift.service';

export type SessionOverrideType = 'running_late' | 'schedule_shift';

/** Long enough to outlive any clinic day; the date is part of the key anyway. */
const OVERRIDE_TTL_SECONDS = 24 * 60 * 60;

/**
 * What a `schedule_shift` did (or would do) to one doctor's day.
 * `deltaMinutes` is how far this action moved it; `totalMinutes` is where the
 * day now stands — announcing 30 then 120 is a delta of 90 against a total of
 * 120. The dialog needs the total, the audit trail the delta.
 */
export interface ScheduleShiftSummary extends ShiftPlan {
  doctorId: string;
  totalMinutes: number;
}

export interface ActiveSessionOverride {
  doctorId: string;
  type: SessionOverrideType;
  /** Null for `slot_config` rows, which carry their value in the slot-config columns instead. */
  valueMinutes: number | null;
  createdBy: string;
  createdAt: string;
}

/**
 * Owns staff-declared overrides on a doctor's day — today, "running late".
 *
 * Not a separate notification path: the value is injected into
 * DelayTrackerService's projection, so the board, wait times, notifications and
 * patient app all pick it up through the existing pipeline. Announcing is
 * therefore write a row, mirror to Redis, kick the engine.
 */
export class SessionOverrideService {
  /**
   * The live override value for one doctor/day, in minutes; 0 means none.
   * On the recalculation hot path, so it is a single Redis GET, falling back to
   * the newest DB row and repopulating on a miss — otherwise a Redis restart
   * would silently drop every clinic's announced delay.
   */
  static async getActiveMinutes(
    clinicId: string,
    doctorId: string,
    date: string,
    type: SessionOverrideType = 'running_late'
  ): Promise<number> {
    const key = getRedisKey('override', type, clinicId, doctorId, date);

    try {
      const cached = await redisClient.get(key);
      if (cached !== null && cached !== undefined) {
        const parsed = parseInt(String(cached), 10);
        if (!isNaN(parsed)) return Math.max(0, parsed);
      }
    } catch (error) {
      logger.warn(
        `[SessionOverride] Redis read failed for doctor=${doctorId} date=${date}; falling back to DB`,
        { error }
      );
    }

    const minutes = await this.readNewestFromDb(doctorId, date, type);

    // Repopulate so the next recalculation is served from cache. Best-effort:
    // a failure here costs one extra DB read later, nothing more.
    void this.cacheMinutes(key, minutes);

    return minutes;
  }

  /**
   * Best-effort Redis write, wrapped rather than chained off the client's
   * promise: on this hot path a client returning a non-promise (a stub, a mock,
   * one mid-reconnect) must not take the projection down over a cache write.
   */
  private static async cacheMinutes(
    key: string,
    minutes: number
  ): Promise<void> {
    try {
      await redisClient.set(key, String(minutes), 'EX', OVERRIDE_TTL_SECONDS);
    } catch (error) {
      logger.warn(`[SessionOverride] Redis write failed for key=${key}`, {
        error,
      });
    }
  }

  /** Newest row wins — there is no status column to consult. */
  private static async readNewestFromDb(
    doctorId: string,
    date: string,
    type: SessionOverrideType
  ): Promise<number> {
    try {
      const [row] = await database
        .select({ valueMinutes: DoctorSessionOverrideModel.valueMinutes })
        .from(DoctorSessionOverrideModel)
        .where(
          and(
            eq(DoctorSessionOverrideModel.doctorId, doctorId),
            eq(DoctorSessionOverrideModel.forDate, date),
            eq(DoctorSessionOverrideModel.type, type)
          )
        )
        .orderBy(desc(DoctorSessionOverrideModel.createdAt))
        .limit(1);

      return Math.max(0, row?.valueMinutes ?? 0);
    } catch (error) {
      logger.error(
        `[SessionOverride] DB read failed for doctor=${doctorId} date=${date}`,
        { error }
      );
      return 0;
    }
  }

  /**
   * Announces (or clears, with `valueMinutes: 0`) an override, then re-runs the
   * engine. Permissions live here rather than the route because they depend on
   * both role and target ids: staff may act on any doctor in their clinic, a
   * doctor only on themselves.
   */
  static async announce(
    clinicId: string,
    actor: { id: string; userType: string },
    dto: AnnounceSessionOverrideDto
  ): Promise<{
    date: string;
    overrides: ActiveSessionOverride[];
    shifts?: ScheduleShiftSummary[];
    dryRun?: boolean;
  }> {
    const { type, valueMinutes } = dto;
    const doctorIds = Array.from(new Set(dto.doctorIds));

    if (actor.userType === 'Doctor') {
      const foreign = doctorIds.filter((id) => id !== actor.id);
      if (foreign.length > 0) {
        throw new HttpError(
          403,
          'A doctor can only announce running late for themselves'
        );
      }
    }

    await this.assertDoctorsBelongToClinic(clinicId, doctorIds);

    const date = this.resolveDate(dto.forDate);

    if (type === 'schedule_shift') {
      return this.applyScheduleShift(clinicId, actor, doctorIds, dto, date);
    }

    const rows: NewDoctorSessionOverride[] = doctorIds.map((doctorId) => ({
      clinicId,
      doctorId,
      forDate: date,
      type,
      valueMinutes,
      createdBy: actor.id,
    }));

    const inserted = await database
      .insert(DoctorSessionOverrideModel)
      .values(rows)
      .returning();

    // Mirror to Redis before kicking the engine — the recalculation below reads
    // this value back, so writing it afterwards would project the old delay.
    await Promise.all(
      doctorIds.map((doctorId) =>
        this.cacheMinutes(
          getRedisKey('override', type, clinicId, doctorId, date),
          valueMinutes
        )
      )
    );

    logger.info(
      `[SessionOverride] ${actor.userType}=${actor.id} set ${type}=${valueMinutes}m ` +
        `for ${doctorIds.length} doctor(s) in clinic=${clinicId} on ${date}`
    );

    // Push the new projection out to every affected patient. Fire-and-forget:
    // the announcement is already committed, and a broadcast failure must not
    // fail the request the receptionist is waiting on.
    void this.refreshQueuesIfLive(clinicId, doctorIds, date);

    return {
      date,
      overrides: inserted.map((row) => ({
        doctorId: row.doctorId,
        type: row.type as SessionOverrideType,
        valueMinutes: row.valueMinutes,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Applies a `schedule_shift`: appointments and the bookable window actually
   * move rather than the delay merely being described.
   *
   * The stored value is cumulative while the shift performed is the difference
   * from where the day stood — which is what makes corrections possible:
   * re-announcing 30 after a mistaken 120 moves back by 90, and 0 restores it.
   */
  private static async applyScheduleShift(
    clinicId: string,
    actor: { id: string; userType: string },
    doctorIds: string[],
    dto: AnnounceSessionOverrideDto,
    date: string
  ): Promise<{
    date: string;
    overrides: ActiveSessionOverride[];
    shifts: ScheduleShiftSummary[];
    dryRun?: boolean;
  }> {
    const { valueMinutes, dryRun, sessionStart, allSessions } = dto;
    const shifts: ScheduleShiftSummary[] = [];

    for (const doctorId of doctorIds) {
      const current = await this.getActiveMinutes(
        clinicId,
        doctorId,
        date,
        'schedule_shift'
      );
      const deltaMinutes = valueMinutes - current;

      const plan = dryRun
        ? await ScheduleShiftService.plan(
            clinicId,
            doctorId,
            date,
            deltaMinutes,
            // The preview must be scoped exactly as the write will be. Omitting
            // these made `plan` infer the session from the clock, so a caller
            // asking for the 09:00 session saw the evening's numbers and then
            // `apply` moved a different session than the one previewed.
            undefined,
            sessionStart,
            allSessions
          )
        : await ScheduleShiftService.apply(
            clinicId,
            doctorId,
            date,
            deltaMinutes,
            valueMinutes,
            actor.id,
            sessionStart,
            allSessions
          );

      shifts.push({ ...plan, doctorId, totalMinutes: valueMinutes });
    }

    if (dryRun) {
      return { date, overrides: [], shifts, dryRun: true };
    }

    const inserted = await database
      .insert(DoctorSessionOverrideModel)
      .values(
        doctorIds.map((doctorId) => ({
          clinicId,
          doctorId,
          forDate: date,
          type: 'schedule_shift' as const,
          valueMinutes,
          createdBy: actor.id,
        }))
      )
      .returning();

    await Promise.all(
      doctorIds.map((doctorId) =>
        this.cacheMinutes(
          getRedisKey('override', 'schedule_shift', clinicId, doctorId, date),
          valueMinutes
        )
      )
    );

    // The delay now lives in the appointment times themselves, so the
    // running-late floor would apply it a second time — a 120-minute shift
    // would quote 14:00 for an appointment already moved to 12:00. Clearing is
    // an insert of 0, the same way clearing works everywhere else here.
    await this.clearRunningLate(clinicId, actor.id, doctorIds, date);

    logger.info(
      `[SessionOverride] ${actor.userType}=${actor.id} shifted the schedule to ` +
        `${valueMinutes}m for ${doctorIds.length} doctor(s) in clinic=${clinicId} on ${date}`
    );

    void this.refreshQueuesIfLive(clinicId, doctorIds, date);

    return {
      date,
      overrides: inserted.map((row) => ({
        doctorId: row.doctorId,
        type: row.type as SessionOverrideType,
        valueMinutes: row.valueMinutes,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      })),
      shifts,
    };
  }

  /**
   * Retires any live `running_late` announcement, writing only for doctors that
   * have one — an unconditional insert would fill the day's history with zeros.
   */
  private static async clearRunningLate(
    clinicId: string,
    actorId: string,
    doctorIds: string[],
    date: string
  ): Promise<void> {
    const announced: string[] = [];

    for (const doctorId of doctorIds) {
      const minutes = await this.getActiveMinutes(
        clinicId,
        doctorId,
        date,
        'running_late'
      );
      if (minutes > 0) announced.push(doctorId);
    }

    if (announced.length === 0) return;

    await database.insert(DoctorSessionOverrideModel).values(
      announced.map((doctorId) => ({
        clinicId,
        doctorId,
        forDate: date,
        type: 'running_late' as const,
        valueMinutes: 0,
        createdBy: actorId,
      }))
    );

    await Promise.all(
      announced.map((doctorId) =>
        this.cacheMinutes(
          getRedisKey('override', 'running_late', clinicId, doctorId, date),
          0
        )
      )
    );
  }

  /**
   * The day an override applies to, defaulting to IST today. Future days are
   * allowed — a row is read fine when that day arrives — but not past ones, nor
   * dates so far ahead that a mistyped year waits centuries to fire.
   */
  private static resolveDate(forDate?: string): string {
    const today = getISTDateString();
    if (!forDate || forDate === today) return today;

    if (forDate < today) {
      throw new HttpError(400, 'A delay cannot be declared for a past date');
    }

    const limit = new Date(`${today}T00:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + MAX_OVERRIDE_DAYS_AHEAD);
    const latest = limit.toISOString().split('T')[0];

    if (forDate > latest) {
      throw new HttpError(
        400,
        `A delay can only be declared up to ${MAX_OVERRIDE_DAYS_AHEAD} days ahead`
      );
    }

    return forDate;
  }

  /**
   * Current overrides for today. With no `doctorIds`, returns every doctor in
   * the clinic that has a non-zero value — which is what the reception board
   * needs to badge its doctor cards in one call.
   */
  static async getActiveForClinic(
    clinicId: string,
    doctorIds?: string[],
    type: SessionOverrideType = 'running_late',
    forDate?: string
  ): Promise<{
    date: string;
    overrides: ActiveSessionOverride[];
    sessions?: Array<{
      doctorId: string;
      sessions: Array<{ start: string; end: string }>;
    }>;
  }> {
    // Defaults to today rather than returning every future row: the reception
    // board reads this to badge doctors, and a delay declared for next Tuesday
    // must not make a doctor look late this morning.
    const date = forDate ?? getISTDateString();

    const targets =
      doctorIds && doctorIds.length > 0
        ? doctorIds
        : await this.listClinicDoctorIds(clinicId);

    if (targets.length === 0) return { date, overrides: [] };

    const rows = await database
      .select()
      .from(DoctorSessionOverrideModel)
      .where(
        and(
          eq(DoctorSessionOverrideModel.clinicId, clinicId),
          eq(DoctorSessionOverrideModel.forDate, date),
          eq(DoctorSessionOverrideModel.type, type),
          inArray(DoctorSessionOverrideModel.doctorId, targets)
        )
      )
      .orderBy(desc(DoctorSessionOverrideModel.createdAt));

    // Rows arrive newest-first, so the first one seen per doctor is the live
    // one and everything after it is that doctor's history for the day.
    const newestByDoctor = new Map<string, ActiveSessionOverride>();
    for (const row of rows) {
      if (newestByDoctor.has(row.doctorId)) continue;
      newestByDoctor.set(row.doctorId, {
        doctorId: row.doctorId,
        type: row.type as SessionOverrideType,
        valueMinutes: row.valueMinutes,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
      });
    }

    const overrides = Array.from(newestByDoctor.values()).filter(
      (o) => (o.valueMinutes ?? 0) > 0
    );

    // Only when the caller named doctors and is asking about shifts: a clinic
    // -wide badging read has no use for this, and it costs a query per doctor.
    if (type !== 'schedule_shift' || !doctorIds || doctorIds.length === 0) {
      return { date, overrides };
    }

    const sessions = await Promise.all(
      targets.map(async (doctorId) => ({
        doctorId,
        sessions: await ScheduleShiftService.listSessions(
          clinicId,
          doctorId,
          date
        ),
      }))
    );

    return { date, overrides, sessions };
  }

  /**
   * Every override written for a day, newest first, cleared rows included — the
   * table is append-only, so reception can see who changed what and when.
   * `isActive` marks the row in effect per (doctor, type), computed here so the
   * client cannot derive "newest wins" differently.
   */
  static async getHistoryForClinic(
    clinicId: string,
    forDate?: string,
    doctorIds?: string[],
    limit = 20,
    /** ISO `createdAt` of the last row seen; returns strictly older rows. */
    cursor?: string
  ): Promise<{
    date: string;
    entries: Array<ActiveSessionOverride & { id: string; isActive: boolean }>;
    nextCursor: string | null;
  }> {
    const date = forDate ?? getISTDateString();

    const filters = [
      eq(DoctorSessionOverrideModel.clinicId, clinicId),
      eq(DoctorSessionOverrideModel.forDate, date),
    ];
    if (doctorIds && doctorIds.length > 0) {
      filters.push(inArray(DoctorSessionOverrideModel.doctorId, doctorIds));
    }

    if (cursor) {
      const parsed = new Date(cursor);
      if (!isNaN(parsed.getTime())) {
        filters.push(lt(DoctorSessionOverrideModel.createdAt, parsed));
      }
    }

    // One more than asked for, purely to learn whether another page exists
    // without a second count query.
    const rows = await database
      .select()
      .from(DoctorSessionOverrideModel)
      .where(and(...filters))
      .orderBy(desc(DoctorSessionOverrideModel.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    /**
     * Which rows are live, resolved independently of the page: "first seen per
     * doctor and type" only holds for the whole day at once, or page two would
     * crown its own first row and show a superseded value as in effect.
     */
    const newest = await this.readNewestPerKey(clinicId, date, doctorIds);

    return {
      date,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
      entries: page.map((row) => ({
        id: row.id,
        doctorId: row.doctorId,
        type: row.type as SessionOverrideType,
        valueMinutes: row.valueMinutes,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        isActive: newest.get(`${row.doctorId}:${row.type}`) === row.id,
      })),
    };
  }

  /** The id of the newest row for each (doctor, type) on a day. */
  private static async readNewestPerKey(
    clinicId: string,
    date: string,
    doctorIds?: string[]
  ): Promise<Map<string, string>> {
    const filters = [
      eq(DoctorSessionOverrideModel.clinicId, clinicId),
      eq(DoctorSessionOverrideModel.forDate, date),
    ];
    if (doctorIds && doctorIds.length > 0) {
      filters.push(inArray(DoctorSessionOverrideModel.doctorId, doctorIds));
    }

    const rows = await database
      .select({
        id: DoctorSessionOverrideModel.id,
        doctorId: DoctorSessionOverrideModel.doctorId,
        type: DoctorSessionOverrideModel.type,
      })
      .from(DoctorSessionOverrideModel)
      .where(and(...filters))
      .orderBy(desc(DoctorSessionOverrideModel.createdAt));

    const newest = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.doctorId}:${row.type}`;
      if (!newest.has(key)) newest.set(key, row.id);
    }
    return newest;
  }

  /**
   * Re-runs the engine for each affected doctor, clearing the notifier's 24h
   * "already notified" flags first: an announcement is a new fact, so without
   * that, raising 20 minutes to 40 would reach nobody already told about the 20.
   */
  private static async refreshQueuesIfLive(
    clinicId: string,
    doctorIds: string[],
    date: string
  ): Promise<void> {
    // The engine only ever computes today's queue. Recalculating for an
    // upcoming day would build a projection against the wrong clock and cache
    // it under that date, where tomorrow's first real recalculation would find
    // it and trust it. The row is already written; it takes effect when the
    // day arrives.
    if (date !== getISTDateString()) return;

    const orchestrator = new AppointmentEngineOrchestrator();
    const delayTracker = new DelayTrackerService();

    for (const doctorId of doctorIds) {
      try {
        const queueData = await delayTracker.getQueueDelayData(
          clinicId,
          doctorId,
          date
        );

        if (queueData?.appointments?.length) {
          await Promise.all(
            queueData.appointments.map(async (appt) => {
              try {
                await redisClient.del(
                  getRedisKey('notified', appt.appointmentId)
                );
              } catch {
                // A flag we couldn't clear only costs one missed re-notification.
              }
            })
          );
        }

        await orchestrator.onSessionOverride(clinicId, doctorId, date);
      } catch (error) {
        logger.error(
          `[SessionOverride] Failed to refresh queue for doctor=${doctorId} on ${date}`,
          { error }
        );
      }
    }
  }

  /** Rejects ids that aren't doctors assigned to this clinic. */
  private static async assertDoctorsBelongToClinic(
    clinicId: string,
    doctorIds: string[]
  ): Promise<void> {
    const assigned = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          eq(ClinicAssignModel.clinicId, clinicId),
          inArray(UserModel.userType, ['Doctor', 'Admin']),
          inArray(ClinicAssignModel.userId, doctorIds)
        )
      );

    const assignedIds = new Set(assigned.map((row) => row.userId));
    const unknown = doctorIds.filter((id) => !assignedIds.has(id));

    if (unknown.length > 0) {
      throw new HttpError(
        400,
        `Not a doctor in this clinic: ${unknown.join(', ')}`
      );
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
