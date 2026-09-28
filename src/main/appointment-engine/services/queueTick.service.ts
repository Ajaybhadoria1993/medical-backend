import { and, gte, lt, ne, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { getISTDateString, startOfDayIST } from '../../../utils/istDateTime';
import { QueueDelayData } from '../types/engine.types';
import { getRedisKey } from '../utils/helpers';
import { realtimeBus, target } from '../../realtime';
import { DelayTrackerService } from './delayTracker.service';
import { QueueBroadcastService } from './queueBroadcast.service';
import { RunningLateNotifier } from './runningLateNotifier.service';

/**
 * How long a fingerprint survives. Only needs to outlive one clinic day; the
 * date is part of the key, so a stale one can never be read tomorrow.
 */
const FINGERPRINT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Granularity the change detection compares at.
 * Status changes are compared exactly, so "you're next" still lands instantly.
 */
const BUCKET_MINUTES = 5;

const bucketMinutes = (minutes: number): number =>
  Math.floor(minutes / BUCKET_MINUTES);

/** Buckets an "HH:MM" projection to the same granularity. */
const bucketTime = (time: string | null): string => {
  if (!time) return '-';
  const [hours, mins] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return time;
  return String(bucketMinutes(hours * 60 + mins));
};

/**
 * QueueTickService
 *
 * Recomputes every active doctor's queue on a fixed interval and broadcasts
 * only the ones that actually moved.
 *
 * Why this exists: until now the engine recalculated only when *something
 * happened* — a status change, a patient opening their screen, or the
 * per-appointment running-late job (which fires only while the doctor is
 * inactive, repeats every 15 minutes, and caps out). But the largest input to a
 * waiting-time estimate is the wall clock, and the clock moves with no event to
 * observe. Between two status changes a patient's "18 minutes" sat frozen while
 * 18 real minutes passed, and the queue only caught up when someone happened to
 * touch it.
 *
 * The expensive part is broadcasting, not recalculating: a recalculation is one
 * indexed query, while a broadcast fans out to every patient's socket room. So
 * each doctor's projection is fingerprinted and the emit is skipped when nothing
 * a patient could see has changed. A quiet clinic therefore costs one query per
 * doctor per tick and no sockets at all.
 */
export class QueueTickService {
  private delayTracker = new DelayTrackerService();
  private broadcaster = new QueueBroadcastService();
  private notifier = new RunningLateNotifier();

  /** Guards against a slow tick overlapping the next one. */
  private running = false;

  /**
   * One pass over every doctor with a live queue today.
   * Never throws — a failing tick must not take the cron down with it.
   */
  async tick(): Promise<{
    doctorsScanned: number;
    doctorsBroadcast: number;
  }> {
    if (this.running) {
      logger.warn(
        '[QueueTick] Previous tick still running — skipping this interval'
      );
      return { doctorsScanned: 0, doctorsBroadcast: 0 };
    }

    this.running = true;
    const startedAt = Date.now();
    const date = getISTDateString();

    let doctorsScanned = 0;
    let doctorsBroadcast = 0;

    try {
      const doctors = await this.findActiveDoctors(date);
      doctorsScanned = doctors.length;

      // Sequential, not Promise.all. A clinic with many doctors would otherwise
      // open that many concurrent DB connections every minute, and this is
      // background work with no one waiting on it — finishing a few hundred
      // milliseconds sooner is worth less than not competing with live requests
      // for the pool.
      for (const { clinicId, doctorId } of doctors) {
        try {
          const changed = await this.refreshDoctor(clinicId, doctorId, date);
          if (changed) {
            doctorsBroadcast++;
          }
        } catch (error) {
          logger.error(
            `[QueueTick] Failed for clinic=${clinicId} doctor=${doctorId}`,
            { error }
          );
        }
      }

      const elapsed = Date.now() - startedAt;
      if (doctorsBroadcast > 0 || elapsed > 5000) {
        logger.info(
          `[QueueTick] Scanned ${doctorsScanned} doctor(s), broadcast ${doctorsBroadcast}, took ${elapsed}ms`
        );
      }
    } catch (error) {
      logger.error('[QueueTick] Tick failed', { error });
    } finally {
      this.running = false;
    }

    return { doctorsScanned, doctorsBroadcast };
  }

  /**
   * Recalculates one doctor's queue and broadcasts if the result differs from
   * the last tick. Returns whether a broadcast happened.
   */
  private async refreshDoctor(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<boolean> {
    const queueData = await this.delayTracker.recalculate(
      clinicId,
      doctorId,
      date
    );

    if (!queueData || queueData.appointments.length === 0) return false;

    // Running-late is evaluated before the listener gate below, deliberately.
    //
    // The per-appointment BullMQ running-late job is only ever scheduled when a
    // patient opens their live-queue screen (see liveQueueHelper), so for a
    // queue nobody is watching this tick is the *only* thing that will notice a
    // doctor crossing the threshold. A push must reach a patient whether or not
    // they have the app open, so this cannot be skipped to save work.
    await this.notifier
      .evaluateFromCache(clinicId, doctorId, date, queueData)
      .catch((error) =>
        logger.warn(`[QueueTick] Running-late evaluation failed`, { error })
      );

    // With nobody connected there is no one to broadcast to, and the socket
    // fan-out plus the board rebuild are the expensive part of a tick — far
    // more than the recalculation above. Anyone who connects later gets a fresh
    // projection from computeLiveQueuePayload, which never trusts the cache.
    if (!(await this.hasListeners(clinicId, doctorId))) return false;

    const fingerprint = this.fingerprint(queueData);
    const key = getRedisKey('tick_fingerprint', clinicId, doctorId, date);

    let previous: string | null = null;
    try {
      previous = await redisClient.get(key);
    } catch {
      // Redis unreadable — fall through and broadcast. A duplicate payload is
      // harmless; a silently frozen queue is not.
    }

    if (previous === fingerprint) return false;

    try {
      await redisClient.set(key, fingerprint, 'EX', FINGERPRINT_TTL_SECONDS);
    } catch {
      // Best-effort: at worst we re-broadcast an identical payload next tick.
    }

    // The board is rebuilt once per clinic at the end of the pass, not here.
    this.broadcaster.emitQueueUpdated(clinicId, queueData);
    await this.broadcaster.emitPatientUpdated(queueData);
    // Web screens refetch on the section signal, not `queue.updated`; without it
    // the delay and estimates froze between events. Snapshot is already fresh.
    realtimeBus.notify(
      target.queue(clinicId, doctorId, date),
      'queue.recalculated'
    );

    return true;
  }

  /**
   * A stable summary of everything a patient could notice.
   *
   * Deliberately excludes `lastCalculatedAt`, which changes on every single
   * recalculation — including it would make every fingerprint unique and defeat
   * the whole point of comparing them.
   */
  /**
   * Whether anyone is connected who would receive this doctor's broadcast:
   * a clinic dashboard, or a patient who joined the live queue.
   *
   * Uses `fetchSockets`, which is cluster-aware through the Redis adapter — a
   * local room check would see only this instance's connections and skip
   * clinics being watched from another.
   *
   * Fails open: if the socket layer cannot be reached we broadcast anyway. A
   * wasted emit costs nothing; a queue that silently stops updating because a
   * check failed is the outcome this whole service exists to prevent.
   */
  private async hasListeners(
    clinicId: string,
    doctorId: string
  ): Promise<boolean> {
    try {
      const { socketManager } = require('../../../app');
      if (!socketManager?.io) return true;

      const rooms = [
        `clinic:${clinicId}`,
        `live-queue:${clinicId}:${doctorId}`,
      ];

      for (const room of rooms) {
        const sockets = await socketManager.io.in(room).fetchSockets();
        if (sockets.length > 0) return true;
      }

      return false;
    } catch (error) {
      logger.warn(
        `[QueueTick] Listener check failed for clinic=${clinicId}; broadcasting anyway`,
        { error }
      );
      return true;
    }
  }

  private fingerprint(queueData: QueueDelayData): string {
    const parts = queueData.appointments.map((appointment) =>
      [
        appointment.appointmentId,
        // Status changes are what patients react to, so they are compared
        // exactly and always push immediately.
        appointment.status,
        bucketTime(appointment.projectedStartTime),
        bucketMinutes(appointment.estimatedWaitMinutes),
      ].join('|')
    );

    return `${bucketMinutes(queueData.cumulativeDelayMinutes)}#${parts.join(';')}`;
  }

  /**
   * Distinct (clinicId, doctorId) pairs with at least one non-terminal
   * appointment today. Doctors whose day is finished, cancelled or empty are
   * never recalculated — that is what keeps the tick cheap on a large tenant.
   */
  private async findActiveDoctors(
    date: string
  ): Promise<Array<{ clinicId: string; doctorId: string }>> {
    const startOfDay = startOfDayIST(date);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const rows = await database
      .selectDistinct({
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
      })
      .from(AppointmentModel)
      .where(
        and(
          gte(AppointmentModel.appointmentDate, startOfDay),
          lt(AppointmentModel.appointmentDate, nextDay),
          ne(AppointmentModel.appointmentStatus, 'Completed'),
          ne(AppointmentModel.appointmentStatus, 'Cancelled'),
          ne(AppointmentModel.appointmentStatus, 'NoShow'),
          sql`${AppointmentModel.doctorId} IS NOT NULL`
        )
      );

    return rows.filter((row): row is { clinicId: string; doctorId: string } =>
      Boolean(row.doctorId)
    );
  }
}

export const queueTickService = new QueueTickService();
