import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';
import { QueueDelayData } from '../types/engine.types';
import { DelayTrackerService } from './delayTracker.service';
import {
  formatDelayDuration,
  getRedisKey,
  isTerminalStatus,
} from '../utils/helpers';
import { getDoctorDisplayName } from '../utils/doctorDisplayName';
import { getISTHoursMinutes } from '../../../utils/istDateTime';
import { IN_CONSULTATION } from '../types/engine.types';

const DEFAULT_THRESHOLD_MINUTES = 10;
const MIN_THRESHOLD_MINUTES = 5;
const MAX_THRESHOLD_MINUTES = 60;
const NOTIFIED_FLAG_TTL_SECONDS = 24 * 60 * 60; // 24 hours
/** Min gap between running-late pushes: each dip below the threshold clears
 *  `notified` (it is UI state too), so without this every wobble re-pushes. */
const PUSH_COOLDOWN_SECONDS = 30 * 60;

/**
 * Evaluates whether the cumulative delay in a doctor's daily queue exceeds the
 * clinic's running-late threshold, notifying affected patients over push and
 * socket channels.
 */
export class RunningLateNotifier {
  private delayTrackerService: DelayTrackerService;

  constructor() {
    this.delayTrackerService = new DelayTrackerService();
  }

  /**
   * Evaluates threshold crossings and sends Running_Late_Notifications: reads
   * the clinic's threshold (default 10) and the cached QueueDelayData, then
   * notifies every appointment over it, skipping "Confirmed" (already with the
   * doctor) and terminal ones. The notification carries the estimated new time
   * and the delay in minutes, over push and socket.
   */
  async evaluate(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<void> {
    try {
      // Step 1: Read the clinic's running-late threshold
      const threshold = await this.getThresholdMinutes(clinicId);

      // Step 2: Get the cached queue delay data
      const queueData = await this.delayTrackerService.getQueueDelayData(
        clinicId,
        doctorId,
        date
      );

      if (!queueData || queueData.appointments.length === 0) {
        return;
      }

      // Step 3: Evaluate each appointment
      await this.evaluateAppointments(queueData, threshold);
    } catch (error) {
      logger.error(
        `[RunningLateNotifier] Error evaluating threshold for clinic=${clinicId}, doctor=${doctorId}, date=${date}`,
        { error }
      );
    }
  }

  /**
   * Evaluates running-late using pre-fetched QueueDelayData.
   * Called by the periodic cron — zero DB queries (threshold is Redis-cached).
   */
  async evaluateFromCache(
    clinicId: string,
    _doctorId: string,
    _date: string,
    queueData: QueueDelayData
  ): Promise<void> {
    try {
      const threshold = await this.getThresholdMinutes(clinicId);
      await this.evaluateAppointments(queueData, threshold);
    } catch (error) {
      logger.error(
        `[RunningLateNotifier] evaluateFromCache error for clinic=${clinicId}`,
        { error }
      );
    }
  }

  /**
   * Evaluates running-late for a single appointment within pre-fetched
   * QueueDelayData, instead of the whole doctor's queue. Used by the
   * patient-facing live-queue read path (REST page load / socket join),
   * which runs per patient screen-open — evaluating every other appointment
   * in the doctor's queue on every such call is redundant work (idempotent,
   * but wasted Redis round-trips that scale with how many patients from the
   * same queue happen to open their screen around the same time).
   */
  async evaluateSingleFromCache(
    clinicId: string,
    appointmentId: string,
    queueData: QueueDelayData
  ): Promise<void> {
    try {
      const appointment = queueData.appointments.find(
        (a) => a.appointmentId === appointmentId
      );
      if (!appointment) return;

      const threshold = await this.getThresholdMinutes(clinicId);
      const isAnyoneBeingServed = queueData.appointments.some(
        (a) => a.status === IN_CONSULTATION
      );
      const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
      const nowMinutes = istHours * 60 + istMinutes;

      await this.evaluateSingleAppointment(
        appointment,
        threshold,
        isAnyoneBeingServed,
        nowMinutes,
        this.doctorNameOnce(queueData.doctorId)
      );
    } catch (error) {
      logger.error(
        `[RunningLateNotifier] evaluateSingleFromCache error for appointment=${appointmentId}`,
        { error }
      );
    }
  }

  /**
   * Reads the clinic's configured runningLateThresholdMinutes.
   * Cached in Redis for 1 hour. Returns the default (10 minutes) if not configured.
   *
   * Public because the patient-facing payload derives `isRunningLate` from the
   * same threshold this notifier uses — reading it anywhere else would let the
   * two disagree about what "late" means.
   */
  async getThresholdMinutes(clinicId: string): Promise<number> {
    // Try Redis cache first
    const cacheKey = getRedisKey('threshold', clinicId);
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) {
        return parseInt(cached, 10);
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    try {
      const [settings] = await database
        .select({
          runningLateThresholdMinutes:
            ClinicSettingsModel.runningLateThresholdMinutes,
        })
        .from(ClinicSettingsModel)
        .where(eq(ClinicSettingsModel.clinicId, clinicId))
        .limit(1);

      if (!settings?.runningLateThresholdMinutes) {
        await redisClient
          .set(cacheKey, String(DEFAULT_THRESHOLD_MINUTES), 'EX', 3600)
          .catch(() => {});
        return DEFAULT_THRESHOLD_MINUTES;
      }

      const value = settings.runningLateThresholdMinutes;

      // Ensure it's within the valid range (5-60 minutes)
      if (value < MIN_THRESHOLD_MINUTES || value > MAX_THRESHOLD_MINUTES) {
        logger.warn(
          `[RunningLateNotifier] Threshold ${value} for clinic=${clinicId} is out of range [${MIN_THRESHOLD_MINUTES}-${MAX_THRESHOLD_MINUTES}]. Using default ${DEFAULT_THRESHOLD_MINUTES}.`
        );
        await redisClient
          .set(cacheKey, String(DEFAULT_THRESHOLD_MINUTES), 'EX', 3600)
          .catch(() => {});
        return DEFAULT_THRESHOLD_MINUTES;
      }

      // Cache for 1 hour
      await redisClient
        .set(cacheKey, String(value), 'EX', 3600)
        .catch(() => {});
      return value;
    } catch (error) {
      logger.warn(
        `[RunningLateNotifier] Failed to read threshold for clinic=${clinicId}. Using default ${DEFAULT_THRESHOLD_MINUTES}.`,
        { error }
      );
      return DEFAULT_THRESHOLD_MINUTES;
    }
  }

  /**
   * Evaluates each appointment in the queue against the threshold
   * and sends notifications for those exceeding it.
   *
   * Implements once-per-crossing semantics (Requirements 3.3, 3.7):
   * - Before sending: check if `appointment_engine:notified:{appointmentId}` exists in Redis.
   *   If it does, skip (already notified for this crossing).
   * - After sending: set the flag in Redis with 24h TTL.
   * - When delay drops below threshold: clear the flag (enabling re-notification on next crossing).
   *
   * Notifies patients still waiting on the doctor ("Upcoming" or "Patient
   * Arrived") — only "Confirmed" (doctor actively seeing them) or terminal
   * states are excluded.
   *
   * Handles notification channel failure (Requirement 3.6):
   * - Uses Promise.allSettled for concurrent notification dispatch.
   * - Logs failures without retrying.
   */
  private async evaluateAppointments(
    queueData: QueueDelayData,
    threshold: number
  ): Promise<void> {
    const notificationPromises: Promise<void>[] = [];

    // Check if doctor is inactive (no one currently being served). Only
    // Only the in-room status counts — "Patient Arrived" means checked in/waiting, not
    // yet with the doctor, so it must not suppress the delay check for a
    // still-waiting first-in-queue patient (see delayTracker.service.ts).
    const isAnyoneBeingServed = queueData.appointments.some(
      (a) => a.status === IN_CONSULTATION
    );

    // Current time in minutes since midnight, evaluated in IST
    const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
    const nowMinutes = istHours * 60 + istMinutes;

    // Shared by every patient in this run: one lookup, however many cross.
    const doctorName = this.doctorNameOnce(queueData.doctorId);

    for (const appointment of queueData.appointments) {
      const promise = this.evaluateSingleAppointment(
        appointment,
        threshold,
        isAnyoneBeingServed,
        nowMinutes,
        doctorName
      );
      notificationPromises.push(promise);
    }

    // Send all notifications concurrently using Promise.allSettled (Requirement 3.6)
    const results = await Promise.allSettled(notificationPromises);

    // Log any failures without retrying
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('[RunningLateNotifier] Notification dispatch failed', {
          error: result.reason,
        });
      }
    }
  }

  /**
   * Evaluates a single appointment against the threshold: sends (and flags)
   * a notification if it just crossed above, or clears the flag if it's
   * back at/below threshold. No-op for "Confirmed" or terminal statuses —
   * see evaluateAppointments' doc comment for why "Patient Arrived" is
   * still evaluated.
   */
  private async evaluateSingleAppointment(
    appointment: QueueDelayData['appointments'][number],
    threshold: number,
    isAnyoneBeingServed: boolean,
    nowMinutes: number,
    doctorName: () => Promise<string | null>
  ): Promise<void> {
    // A closed shift's patient cannot be told the doctor is running late: the
    // hours they were booked into are over, so there is nothing to be late for.
    if (
      appointment.status === IN_CONSULTATION ||
      isTerminalStatus(appointment.status) ||
      appointment.isMissedSession
    ) {
      return;
    }

    const flagKey = getRedisKey('notified', appointment.appointmentId);

    // Compute effective delay:
    // 1. Queue-based delay (estimatedWaitMinutes) — from queue position
    // 2. Real-time lateness — when doctor is inactive and scheduled time has passed
    let effectiveDelay = appointment.estimatedWaitMinutes;

    if (!isAnyoneBeingServed && appointment.scheduledTime) {
      const scheduledMinutes = this.parseTimeToMinutes(
        appointment.scheduledTime
      );
      if (scheduledMinutes !== null && nowMinutes > scheduledMinutes) {
        // Real-time lateness: current time has passed the scheduled time
        // and doctor hasn't started seeing anyone
        const realtimeDelay = nowMinutes - scheduledMinutes;
        effectiveDelay = Math.max(effectiveDelay, realtimeDelay);
      }
    }

    if (effectiveDelay > threshold) {
      // Delay exceeds threshold — check if already notified for this crossing
      const alreadyNotified = await this.isNotificationFlagSet(flagKey);

      if (!alreadyNotified) {
        // Compute the estimated new time for the notification content
        const projectedStartMinutes = appointment.scheduledTime
          ? (this.parseTimeToMinutes(appointment.scheduledTime) ?? 0) +
            effectiveDelay
          : nowMinutes + effectiveDelay;

        const appointmentWithDelay = {
          ...appointment,
          estimatedWaitMinutes: effectiveDelay,
          projectedStartTime: this.minutesToTimeString(projectedStartMinutes),
        };
        await this.sendAndFlagNotification(
          appointmentWithDelay,
          doctorName,
          flagKey,
          effectiveDelay
        );
      }
    } else {
      // Delay is at or below threshold — clear the notification flag
      // so that a future re-crossing will trigger a new notification
      await this.clearNotificationFlag(flagKey);
    }
  }

  /**
   * Parses a time string (e.g., "09:30", "18:00:00") into minutes since midnight.
   * Returns null if parsing fails.
   */
  private parseTimeToMinutes(time: string | null): number | null {
    if (!time) return null;
    const parts = time.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }

  /**
   * Converts minutes since midnight to a time string (e.g., "09:30").
   */
  /** Lazy, at most once per evaluation: most runs cross no threshold and
   *  never look the name up. */
  private doctorNameOnce(doctorId: string): () => Promise<string | null> {
    let lookup: Promise<string | null> | undefined;
    return () => (lookup ??= getDoctorDisplayName(doctorId));
  }

  private minutesToTimeString(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Checks whether the notification sent flag exists in Redis.
   * If Redis is unavailable, treats as "not sent" (may send a duplicate — acceptable trade-off).
   */
  private async isNotificationFlagSet(flagKey: string): Promise<boolean> {
    try {
      const exists = await redisClient.exists(flagKey);
      return exists === 1;
    } catch (error) {
      logger.warn(
        `[RunningLateNotifier] Redis unavailable for flag check key=${flagKey}. Treating as not sent.`,
        { error }
      );
      return false;
    }
  }

  /**
   * Sends the running-late notification (if the push slot is free) and sets
   * the Redis flag.
   */
  private async sendAndFlagNotification(
    appointment: QueueDelayData['appointments'][number],
    doctorName: () => Promise<string | null>,
    flagKey: string,
    delayMinutes: number
  ): Promise<void> {
    if (await this.claimPushSlot(appointment.appointmentId)) {
      await this.sendRunningLateNotification(appointment, doctorName);
    }

    // Set the notification flag in Redis with 24h TTL. The flag's value
    // (delay minutes, not just a boolean marker) doubles as durable
    // "is running late" state, read by liveQueueHelper/queueBroadcast so
    // the patient-facing payload survives a page refresh.
    await this.setNotificationFlag(flagKey, delayMinutes);
  }

  /** SET NX: concurrent evaluators can all pass the read-then-write `notified`
   *  check; only the claimant pushes. Fails closed — a missed push beats a storm. */
  private async claimPushSlot(appointmentId: string): Promise<boolean> {
    try {
      const claimed = await redisClient.set(
        getRedisKey('late_push', appointmentId),
        '1',
        'EX',
        PUSH_COOLDOWN_SECONDS,
        'NX'
      );
      return claimed === 'OK';
    } catch (error) {
      logger.warn(
        `[RunningLateNotifier] Failed to claim push slot for appointment=${appointmentId}. Skipping push.`,
        { error }
      );
      return false;
    }
  }

  /**
   * Sets the notification sent flag in Redis with a 24-hour TTL. Stores the
   * effective delay in minutes as the value so it can double as durable
   * running-late state for the patient-facing queue payload.
   * Logs a warning if Redis is unavailable but does not throw.
   */
  private async setNotificationFlag(
    flagKey: string,
    delayMinutes: number
  ): Promise<void> {
    try {
      await redisClient.set(
        flagKey,
        String(delayMinutes),
        'EX',
        NOTIFIED_FLAG_TTL_SECONDS
      );
    } catch (error) {
      logger.warn(
        `[RunningLateNotifier] Failed to set notification flag in Redis key=${flagKey}. Notification was sent but flag may not persist.`,
        { error }
      );
    }
  }

  /**
   * Clears the notification sent flag from Redis (when delay drops below threshold).
   * This enables re-notification on the next upward threshold crossing.
   * Logs a warning if Redis is unavailable but does not throw.
   */
  private async clearNotificationFlag(flagKey: string): Promise<void> {
    try {
      await redisClient.del(flagKey);
    } catch (error) {
      logger.warn(
        `[RunningLateNotifier] Failed to clear notification flag in Redis key=${flagKey}.`,
        { error }
      );
    }
  }

  /**
   * Sends a Running_Late_Notification to a patient via push and socket channels.
   *
   * Notification content includes (Requirement 3.2):
   * - Estimated new appointment time (original time + delay)
   * - Delay duration in minutes
   */
  private async sendRunningLateNotification(
    appointment: QueueDelayData['appointments'][number],
    doctorName: () => Promise<string | null>
  ): Promise<void> {
    const {
      appointmentId,
      userId,
      scheduledTime,
      estimatedWaitMinutes,
      projectedStartTime,
    } = appointment;

    const delayDuration = estimatedWaitMinutes;
    const estimatedNewTime = projectedStartTime;
    const delayText = formatDelayDuration(delayDuration);

    // The delay goes in the title — often all a lock screen shows.
    const doctor = await doctorName();
    const title = `${doctor ?? 'Your doctor'} is running about ${delayText} late`;
    const body = scheduledTime
      ? `Your ${scheduledTime} appointment is now expected around ${estimatedNewTime}.`
      : `Your appointment is now expected around ${estimatedNewTime}.`;

    try {
      await UniversalNotificationService.send({
        recipient: {
          userId,
          socketRoom: `user:${userId}`,
        },
        event: 'running_late',
        channels: ['push', 'socket'],
        title,
        body,
        data: {
          appointmentId,
          estimatedNewTime,
          delayMinutes: delayDuration,
          originalTime: scheduledTime,
        },
      });
    } catch (error) {
      logger.error(
        `[RunningLateNotifier] Failed to send notification for appointment=${appointmentId}`,
        { error }
      );
    }
  }
}
