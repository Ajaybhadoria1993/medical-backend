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

/** Outlives the whole running-late repeat window, or the queue's "recent activity" check lapses near its end. */
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
    this.delayTrackerService = new DelayTrackerService();
    this.runningLateNotifier = new RunningLateNotifier();
    this.noShowShiftService = new NoShowShiftService();
    this.timeToNextService = new TimeToNextService();
    this.queueBroadcastService = new QueueBroadcastService();
  }

  /** Runs after a committed status change; never throws, so the engine can't fail the change itself. */
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

      // Any status change means the doctor is active, so pending running-late checks are moot.
      runningLateQueue.cancelAllForDoctor(clinicId, doctorId).catch(() => {});

      switch (appointmentStatus) {
        case 'Completed':
          // Before the recalculation, which reads the room pointer and end instant this writes.
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
          break;
      }
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator error for appointment=${id}, ` +
          `status change ${previousStatus} → ${appointmentStatus}`,
        { error }
      );
    }
  }

  /** After a session override is saved: the recalculation reads it, so the status-change fan-out is reused. */
  async onSessionOverride(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
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

  /** After a send-in/hold/skip/resume, which moves the room or line without a status write. */
  async onQueueAction(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator queue-action error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }

  /** After a reschedule: the move shifts everyone behind it, so it gets a status change's refresh. */
  async onReschedule(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      await this.handleCompletedOrArrived(clinicId, doctorId, date);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] Orchestrator reschedule error for ` +
          `clinic=${clinicId}, doctor=${doctorId}`,
        { error }
      );
    }
  }
  /** Signals only after the recalculation, the first moment a refetch reads the new times. */
  private signalQueue(clinicId: string, doctorId: string, date: string): void {
    void invalidateClinicDashboardCaches(clinicId).finally(() => {
      realtimeBus.notify(
        target.queue(clinicId, doctorId, date),
        'queue.recalculated'
      );
      realtimeBus.notify(target.board(clinicId), 'queue.recalculated');
    });
  }

  /** Records when the doctor last acted, read by the running-late gap check. */
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

  /** Recalculates once, then running-late, time-to-next and broadcasts all reuse that queue data. */
  private async handleCompletedOrArrived(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    const queueDelayData = await this.delayTrackerService.recalculate(
      clinicId,
      doctorId,
      date
    );
    this.signalQueue(clinicId, doctorId, date);

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

    try {
      this.queueBroadcastService.emitQueueUpdated(clinicId, queueDelayData);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] QueueBroadcastService.emitQueueUpdated failed for clinic=${clinicId}`,
        { error }
      );
    }

    this.queueBroadcastService
      .emitPatientUpdated(queueDelayData)
      .catch((error) => {
        logger.error(
          `[AppointmentEngine] QueueBroadcastService.emitPatientUpdated failed`,
          { error }
        );
      });
  }

  /** Shifts later bookings first so the recalculation sees their new times. */
  private async handleNoShow(
    appointmentId: string,
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      await this.noShowShiftService.shiftForward(appointmentId);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] NoShowShiftService.shiftForward failed for appointment=${appointmentId}`,
        { error }
      );
      // Even if shift fails, still proceed with recalculation and broadcast
    }

    const queueDelayData = await this.delayTrackerService.recalculate(
      clinicId,
      doctorId,
      date
    );
    this.signalQueue(clinicId, doctorId, date);

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

    try {
      this.queueBroadcastService.emitQueueUpdated(clinicId, queueDelayData);
    } catch (error) {
      logger.error(
        `[AppointmentEngine] QueueBroadcastService.emitQueueUpdated failed for clinic=${clinicId}`,
        { error }
      );
    }

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
