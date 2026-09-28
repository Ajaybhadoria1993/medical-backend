/**
 * Coordinates engine operations after an appointment status change, dispatching
 * by the new status:
 *
 * - Completed / Patient Arrived → recalculate delay, evaluate running-late,
 *   compute time-to-next, then broadcast queue and patient updates.
 * - NoShow → shift subsequent appointments forward first, then the same
 *   recalculate/evaluate/broadcast chain (without time-to-next).
 *
 * All fire-and-forget: errors are caught and logged, never propagated, so the
 * original status change cannot fail because of the engine.
 */

import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { endConsultationIfOccupant } from './queueHoldStore.service';
import { getRedisKey } from '../utils/helpers';
import { getISTDateString } from '../../../utils/istDateTime';
import { AppointmentRecord, AppointmentStatus } from '../types/engine.types';
import { DelayTrackerService } from './delayTracker.service';
import { NoShowShiftService } from './noShowShift.service';
import { QueueBroadcastService } from './queueBroadcast.service';
import { RunningLateNotifier } from './runningLateNotifier.service';
import {
  MAX_REPEAT_ATTEMPTS,
  REPEAT_INTERVAL_MS,
} from './runningLateQueue.service';

/**
 * The activity flag must outlive the entire running-late repeat window, or
 * RunningLateQueue's "recent activity" gap check silently stops applying
 * during the final stretch of repeat attempts. Add a margin on top of the
 * max repeat duration so the two never drift out of sync again.
 */
const LAST_ACTIVITY_TTL_SECONDS =
  Math.ceil((MAX_REPEAT_ATTEMPTS * REPEAT_INTERVAL_MS) / 1000) + 3600;
import { TimeToNextService } from './timeToNext.service';
import { runningLateQueue } from './runningLateQueue.service';
import { realtimeBus, target } from '../../realtime';
import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';

export class AppointmentEngineOrchestrator {
  private delayTrackerService: DelayTrackerService;
  private runningLateNotifier: RunningLateNotifier;
  private noShowShiftService: NoShowShiftService;
  private timeToNextService: TimeToNextService;
  private queueBroadcastService: QueueBroadcastService;

  constructor() {
    // Single shared instance of DelayTrackerService — avoids redundant cache reads
    this.delayTrackerService = new DelayTrackerService();
    this.runningLateNotifier = new RunningLateNotifier();
    this.noShowShiftService = new NoShowShiftService();
    this.timeToNextService = new TimeToNextService();
    this.queueBroadcastService = new QueueBroadcastService();
  }

  /**
   * Called after an appointment status change has been committed to the database.
   * Dispatches to the appropriate engine services based on the new appointment status.
   *
   * This method is fire-and-forget — it catches all errors internally and never
   * throws, ensuring the original status change operation is not affected.
   *
   * @param appointment - The appointment record with the updated status
   * @param previousStatus - The appointment's status before the change
   */
  async onStatusChange(
    appointment: AppointmentRecord,
    previousStatus: AppointmentStatus
  ): Promise<void> {
    const { id, clinicId, doctorId, appointmentDate, appointmentStatus } =
      appointment;

    try {
      const date =
        appointmentDate instanceof Date
          ? getISTDateString(appointmentDate)
          : String(appointmentDate).split('T')[0];

      logger.info(
        `[AppointmentEngine] Orchestrator handling status change for appointment=${id}: ` +
          `${previousStatus} → ${appointmentStatus}`
      );

      // Cancel running-late delayed jobs — doctor is now active
      runningLateQueue.cancelAllForDoctor(clinicId, doctorId).catch(() => {});

      switch (appointmentStatus) {
        case 'Completed':
          // Before the recalculation below, which reads the room pointer and
          // the end instant this writes.
          await endConsultationIfOccupant(clinicId, doctorId, date, id);
          this.stampDoctorActivity(clinicId, doctorId);
          await this.handleCompletedOrArrived(clinicId, doctorId, date);
          break;

        case 'Confirmed':
        case 'Patient Arrived':
          this.stampDoctorActivity(clinicId, doctorId);
          await this.handleCompletedOrArrived(clinicId, doctorId, date);
          break;

        case 'NoShow':
          await endConsultationIfOccupant(clinicId, doctorId, date, id);
          this.stampDoctorActivity(clinicId, doctorId);
          await this.handleNoShow(id, clinicId, doctorId, date);
          break;

        default:
          logger.info(
            `[AppointmentEngine] No engine action for status="${appointmentStatus}" on appointment=${id}`
          );
          break;
      }
    } catch (error) {
      // Fire-and-forget: log the error and do not re-throw.
      // The orchestrator must never affect the original status change operation.
      logger.error(
        `[AppointmentEngine] Orchestrator error for appointment=${id}, ` +
          `status change ${previousStatus} → ${appointmentStatus}`,
        { error }
      );
    }
  }

  /**
   * Called after staff announce or clear a session override. The override is
   * already written and mirrored to Redis, and DelayTrackerService reads it in
   * the recalculation below — so this reuses the status-change fan-out rather
   * than growing a parallel notification path. Fire-and-forget.
   */
  async onSessionOverride(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      logger.info(
        `[AppointmentEngine] Orchestrator handling session override for ` +
          `clinic=${clinicId}, doctor=${doctorId}, date=${date}`
      );
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator session-override error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }

  /** Called after a doctor's arrival is recorded — same recalculate/broadcast fan-out as `onSessionOverride`. */
  async onDoctorArrival(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      logger.info(
        `[AppointmentEngine] Orchestrator handling doctor arrival for ` +
          `clinic=${clinicId}, doctor=${doctorId}, date=${date}`
      );
      this.stampDoctorActivity(clinicId, doctorId);
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator doctor-arrival error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }

  /**
   * Called after a queue-board action (send-in / hold / skip / resume) changes
   * the room or the waiting list without a status write. QueueService commits
   * the Redis pointer before calling this, so it is safe immediately after.
   */
  async onQueueAction(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      logger.info(
        `[AppointmentEngine] Orchestrator handling queue action for ` +
          `clinic=${clinicId}, doctor=${doctorId}, date=${date}`
      );
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator queue-action error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }

  /**
   * Called after a reschedule changes date or time without necessarily changing
   * status. The move shifts where this appointment — and everyone cascading
   * from it — lands, so it needs the same refresh a status change gets.
   */
  async onReschedule(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      logger.info(
        `[AppointmentEngine] Orchestrator handling reschedule for ` +
          `clinic=${clinicId}, doctor=${doctorId}, date=${date}`
      );
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator reschedule error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }
  /**
   * `/queue-state` serves the snapshot just recalculated, so this is the first
   * moment a refetch reads the new times; earlier signals raced the recompute.
   */
  private signalQueue(clinicId: string, doctorId: string, date: string): void {
    // Dashboard caches retired first, for the same refetch-reads-stale reason.
    void invalidateClinicDashboardCaches(clinicId).finally(() => {
      realtimeBus.notify(
        target.queue(clinicId, doctorId, date),
        'queue.recalculated'
      );
      realtimeBus.notify(target.board(clinicId), 'queue.recalculated');
    });
  }

  private stampDoctorActivity(clinicId: string, doctorId: string): void {
    redisClient
      .set(
        getRedisKey('last_activity', clinicId, doctorId),
        String(Date.now()),
        'EX',
        LAST_ACTIVITY_TTL_SECONDS
      )
      .catch(() => {});
  }

  /**
   * Handles Completed or Patient Arrived: recalculate the queue's delay, then
   * evaluate running-late, compute time-to-next, and emit queue.updated and
   * appointment.updated. `queueData` is passed down so nothing re-reads it.
   */
  private async handleCompletedOrArrived(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    // Step 1: Recalculate delay (1 DB query — fetchDailyQueue)
    const queueDelayData = await this.delayTrackerService.recalculate(
      clinicId,
      doctorId,
      date
    );
    this.signalQueue(clinicId, doctorId, date);

    // Step 2: Evaluate running-late notifications using pre-fetched data (0 extra DB queries)
    try {
      await this.runningLateNotifier.evaluateFromCache(
        clinicId,
        doctorId,
        date,
        queueDelayData
      );
    } catch (error) {
      logger.error(
        `[AppointmentEngine] RunningLateNotifier.evaluate failed for clinic=${clinicId}, doctor=${doctorId}, date=${date}`,
        { error }
      );
    }

    // Step 3: Compute and broadcast time-to-next using pre-fetched queue data (0 extra DB for cache read)
    try {
      await this.timeToNextService.computeAndBroadcastFromQueue(
        clinicId,
        doctorId,
        date,
        queueDelayData
      );
    } catch (error) {
      logger.error(
        `[AppointmentEngine] TimeToNextService.computeAndBroadcast failed for clinic=${clinicId}, doctor=${doctorId}, date=${date}`,
        { error }
      );
    }

    // Step 4: Emit queue.updated to clinic room
    try {
      this.queueBroadcastService.emitQueueUpdated(clinicId, queueDelayData);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] QueueBroadcastService.emitQueueUpdated failed for clinic=${clinicId}`,
        { error }
      );
    }

    // Step 5: Emit appointment.updated to each affected patient
    this.queueBroadcastService
      .emitPatientUpdated(queueDelayData)
      .catch((error) => {
        logger.error(
          `[AppointmentEngine] QueueBroadcastService.emitPatientUpdated failed`,
          { error }
        );
      });
  }

  /**
   * Handles NoShow: shift subsequent appointments forward, recalculate the
   * queue's delay, then evaluate running-late and emit queue.updated and
   * appointment.updated.
   */
  private async handleNoShow(
    appointmentId: string,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    // Step 1: Shift forward subsequent appointments
    try {
      await this.noShowShiftService.shiftForward(appointmentId);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] NoShowShiftService.shiftForward failed for appointment=${appointmentId}`,
        { error }
      );
      // Even if shift fails, still proceed with recalculation and broadcast
    }

    // Step 2: Recalculate delay (reflects shifts and removed no-show)
    const queueDelayData = await this.delayTrackerService.recalculate(
      clinicId,
      doctorId,
      date
    );
    this.signalQueue(clinicId, doctorId, date);

    // Step 3: Evaluate running-late notifications using pre-fetched data
    try {
      await this.runningLateNotifier.evaluateFromCache(
        clinicId,
        doctorId,
        date,
        queueDelayData
      );
    } catch (error) {
      logger.error(
        `[AppointmentEngine] RunningLateNotifier.evaluate failed for clinic=${clinicId}, doctor=${doctorId}, date=${date}`,
        { error }
      );
    }

    // Step 4: Emit queue.updated to clinic room
    try {
      this.queueBroadcastService.emitQueueUpdated(clinicId, queueDelayData);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] QueueBroadcastService.emitQueueUpdated failed for clinic=${clinicId}`,
        { error }
      );
    }

    // Step 5: Emit appointment.updated to each affected patient
    this.queueBroadcastService
      .emitPatientUpdated(queueDelayData)
      .catch((error) => {
        logger.error(
          `[AppointmentEngine] QueueBroadcastService.emitPatientUpdated failed`,
          { error }
        );
      });
  }
}
