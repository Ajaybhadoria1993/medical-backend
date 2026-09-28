/**
 * RunningLateQueue
 *
 * BullMQ-based delayed job that fires exactly when a patient's wait
 * exceeds the clinic's running-late threshold.
 *
 * Flow:
 * 1. At appointment booking → schedule a delayed job for (scheduledTime + threshold)
 * 2. When job fires → check if doctor is still inactive (no one being served)
 * 3. If inactive → send running_late notification
 * 4. If doctor has started (status change happened) → job is already removed or skipped
 *
 * No cron, no polling, no periodic DB queries.
 * Cost: 1 Redis delayed job per appointment (self-cleaning).
 */

import { Job, Queue, Worker } from 'bullmq';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { DelayTrackerService } from './delayTracker.service';
import { RunningLateNotifier } from './runningLateNotifier.service';
import { getRedisKey } from '../utils/helpers';
import { IN_CONSULTATION } from '../types/engine.types';
import {
  getISTDateString,
  getISTHoursMinutes,
  startOfDayIST,
} from '../../../utils/istDateTime';

interface RunningLateJobData {
  appointmentId: string;
  clinicId: string;
  doctorId: string;
  scheduledTime: string; // "09:30"
  date: string; // "2025-06-29"
  attempt?: number; // tracks how many times this has fired (for repeat notifications)
}

const QUEUE_NAME = 'running-late-check';
/** Re-notify every 15 minutes while doctor remains inactive */
export const REPEAT_INTERVAL_MS = 15 * 60 * 1000;
/** Stop re-notifying after 3 hours of inactivity */
export const MAX_REPEAT_ATTEMPTS = 12;

/** BullMQ reports lock loss as `Missing lock for job <id>. <operation>`. */
function isMissingLockError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.toLowerCase().includes('missing lock')
  );
}

/**
 * Remove a job unless it is currently being processed. Removing an active job
 * deletes the worker's lock underneath it, which is exactly what produces the
 * `Missing lock for job ...` failure when the handler then tries to finish.
 */
async function removeIfNotActive(job: Job | undefined): Promise<void> {
  if (!job) return;
  try {
    if (await job.isActive()) return;
    await job.remove();
  } catch {
    // Job already gone or locked by a worker — nothing to clean up
  }
}

class RunningLateQueueService {
  private queue: Queue;
  private worker: Worker;

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = new Worker(QUEUE_NAME, this.processJob.bind(this), {
      connection,
      concurrency: 5,
      // The handler shares its event loop with the API server and does a DB
      // recalculation plus socket broadcasts. Under the 30s default lock, a
      // busy (or briefly blocked) event loop let the lock expire mid-run:
      // BullMQ's stalled-checker then re-queued the job and the original run
      // died with `Missing lock for job ... moveToFinished`. A longer lock and
      // stalled interval keep a slow-but-alive run valid.
      lockDuration: 120_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    });

    this.worker.on('failed', (job, err) => {
      // Lock loss is benign here: the handler is idempotent (the notifier's
      // once-per-crossing Redis flag suppresses duplicate notifications), so
      // keep it out of the error stream.
      if (isMissingLockError(err)) {
        logger.warn(
          `[RunningLateQueue] Job ${job?.id} lost its lock (stalled/re-queued) — ` +
            'processing is idempotent, no notification was lost'
        );
        return;
      }
      logger.error(`[RunningLateQueue] Job ${job?.id} failed: ${err.message}`);
    });

    // Without an 'error' listener, BullMQ's internal errors (Redis blips,
    // lock-renewal failures) surface as unhandled EventEmitter errors and get
    // dumped raw to the console.
    this.worker.on('error', (err) => {
      if (isMissingLockError(err)) return;
      logger.warn(`[RunningLateQueue] Worker error: ${err.message}`);
    });
  }

  /**
   * Stop the worker and queue cleanly. Called on process shutdown so an
   * in-flight job releases its lock instead of being killed mid-run (which
   * leaves it stalled until the lock expires).
   */
  async close(): Promise<void> {
    try {
      await this.worker.close();
      await this.queue.close();
    } catch {
      // Shutting down anyway
    }
  }

  /**
   * Schedule a running-late check for a specific appointment.
   * Fires at: appointmentTime + thresholdMinutes.
   *
   * If the job already exists (same appointmentId), it's replaced.
   */
  async scheduleCheck(
    appointmentId: string,
    clinicId: string,
    doctorId: string,
    appointmentDate: Date | string,
    appointmentTime: string, // "09:30" or "09:30:00"
    thresholdMinutes?: number
  ): Promise<void> {
    try {
      // Resolve threshold (from Redis cache or default)
      const threshold = thresholdMinutes ?? (await this.getThreshold(clinicId));

      // Parse appointment datetime
      const dateStr =
        appointmentDate instanceof Date
          ? getISTDateString(appointmentDate)
          : String(appointmentDate).split('T')[0];

      const [hours, minutes] = appointmentTime.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      // Compute fire time: IST midnight of dateStr + (appointmentTime + threshold)
      // minutes. Using millisecond arithmetic on the IST-midnight instant (rather
      // than `new Date(...).setHours(...)`, which reads/writes wall-clock time in
      // the server's local timezone) keeps this correct regardless of server TZ.
      const fireAt = new Date(
        startOfDayIST(dateStr).getTime() +
          (hours * 60 + minutes + threshold) * 60 * 1000
      );

      const now = new Date();
      const delay = fireAt.getTime() - now.getTime();

      // If fire time is in the past but appointment is today, schedule to fire
      // in 1 minute (patient already past threshold — check immediately)
      // If fire time is more than 24h in the past, skip entirely.
      const effectiveDelay =
        delay > 0
          ? delay
          : Math.abs(delay) < 24 * 60 * 60 * 1000
            ? 60 * 1000
            : -1;

      if (effectiveDelay < 0) return;

      const jobId = `running_late_${appointmentId}`;

      // Remove existing job if rescheduling
      await removeIfNotActive(await this.queue.getJob(jobId));

      await this.queue.add(
        jobId,
        {
          appointmentId,
          clinicId,
          doctorId,
          scheduledTime: appointmentTime,
          date: dateStr,
        },
        {
          delay: effectiveDelay,
          jobId,
          removeOnComplete: true,
          removeOnFail: { age: 3600 }, // Clean up after 1 hour
        }
      );

      logger.info(
        `[RunningLateQueue] Scheduled check for appointment=${appointmentId} ` +
          `at ${fireAt.toISOString()} (delay=${Math.round(effectiveDelay / 60000)}min)`
      );
    } catch (error) {
      logger.warn(
        `[RunningLateQueue] Failed to schedule check for appointment=${appointmentId}`,
        { error }
      );
    }
  }

  /**
   * Schedule a running-late check using a projected start time (for token-based appointments).
   * Called from live-queue when the projected time is computed from the delay tracker.
   * Fires at: projectedStartTime + thresholdMinutes.
   */
  async scheduleCheckFromProjectedTime(
    appointmentId: string,
    clinicId: string,
    doctorId: string,
    date: string,
    projectedStartTime: string, // "09:30"
    thresholdMinutes?: number
  ): Promise<void> {
    try {
      const threshold = thresholdMinutes ?? (await this.getThreshold(clinicId));

      const [hours, minutes] = projectedStartTime.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      const fireAt = new Date(
        startOfDayIST(date).getTime() +
          (hours * 60 + minutes + threshold) * 60 * 1000
      );

      const now = new Date();
      const rawDelay = fireAt.getTime() - now.getTime();

      // A non-positive delay means the threshold has already elapsed — the
      // doctor is late right now. Returning here meant token-based
      // appointments (whose projected time is often already past by the time
      // the patient opens the screen) never got a job at all. Evaluate
      // immediately instead; the notifier's own once-per-crossing Redis flag
      // prevents duplicate notifications.
      //
      // Only for today, though: opening a past appointment must not trigger a
      // retrospective "running late" notification.
      if (rawDelay <= 0 && date !== getISTDateString(new Date())) return;
      const delay = Math.max(0, rawDelay);

      const jobId = `running_late_${appointmentId}`;

      // Don't replace if already scheduled (booking-time schedule takes precedence)
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) return;

      await this.queue.add(
        jobId,
        {
          appointmentId,
          clinicId,
          doctorId,
          scheduledTime: projectedStartTime,
          date,
        },
        {
          delay,
          jobId,
          removeOnComplete: true,
          removeOnFail: { age: 3600 },
        }
      );
    } catch {
      // Non-critical
    }
  }

  /**
   * Cancel a scheduled running-late check and any repeat jobs.
   */
  async cancelCheck(appointmentId: string): Promise<void> {
    try {
      // Cancel initial job
      const jobId = `running_late_${appointmentId}`;
      await removeIfNotActive(await this.queue.getJob(jobId));

      // Cancel any repeat jobs (attempt 2 through MAX_REPEAT_ATTEMPTS)
      for (let i = 2; i <= MAX_REPEAT_ATTEMPTS; i++) {
        const repeatJobId = `running_late_${appointmentId}_repeat_${i}`;
        const repeatJob = await this.queue.getJob(repeatJobId);
        if (repeatJob) {
          await removeIfNotActive(repeatJob);
        } else {
          break; // No more repeat jobs scheduled
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Cancel running-late checks for appointments whose time has already passed.
   * Called when a status change occurs (doctor is now active).
   * Does NOT cancel jobs for future appointments — those still need monitoring.
   */
  async cancelAllForDoctor(clinicId: string, doctorId: string): Promise<void> {
    try {
      const delayTrackerService = new DelayTrackerService();
      const today = getISTDateString();

      const queueData = await delayTrackerService.getQueueDelayData(
        clinicId,
        doctorId,
        today
      );

      if (!queueData) return;

      // Current time in minutes since midnight, evaluated in IST
      const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes();
      const nowMinutes = istHours * 60 + istMinutes;

      for (const appt of queueData.appointments) {
        // Only cancel jobs for appointments whose scheduled time has passed
        if (appt.scheduledTime) {
          const [h, m] = appt.scheduledTime.split(':').map(Number);
          if (!isNaN(h) && !isNaN(m) && h * 60 + m <= nowMinutes) {
            await this.cancelCheck(appt.appointmentId);
          }
        }
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Process the delayed job — fires when threshold is crossed.
   * If doctor is still inactive after notification, reschedules itself
   * to fire again in 15 minutes (up to MAX_REPEAT_ATTEMPTS times).
   */
  private async processJob(job: Job<RunningLateJobData>): Promise<void> {
    const {
      appointmentId,
      clinicId,
      doctorId,
      scheduledTime,
      date,
      attempt = 1,
    } = job.data;

    try {
      const delayTrackerService = new DelayTrackerService();
      const runningLateNotifier = new RunningLateNotifier();

      // "Gap between patients" protection (zero DB):
      // The orchestrator stamps `last_activity` on every real status change.
      // If one happened within the threshold window, the doctor is active —
      // just between patients — so don't send a false notification.
      // (lastCalculatedAt can't be used here: it's bumped by any recalculation,
      // including new bookings and this job's own recalculate.)
      const threshold = await this.getThreshold(clinicId);
      const lastActivityRaw = await redisClient
        .get(getRedisKey('last_activity', clinicId, doctorId))
        .catch(() => null);

      if (lastActivityRaw) {
        const sinceActivityMs = Date.now() - parseInt(lastActivityRaw, 10);
        if (
          !isNaN(sinceActivityMs) &&
          sinceActivityMs < threshold * 60 * 1000
        ) {
          return;
        }
      }

      // Cheap pre-check on cached queue (zero DB): statuses in cache are fresh
      // as of the last status change, so if someone is being served, skip
      // without touching the DB. Only "Confirmed" counts as "being served" —
      // "Patient Arrived" is checked-in/waiting, not with the doctor yet, and
      // must not suppress the running-late check for the waiting patient
      // themselves (self-referential otherwise: their own check-in would
      // silence their own overdue notification).
      const cached = await delayTrackerService.getQueueDelayData(
        clinicId,
        doctorId,
        date
      );
      if (cached?.appointments.some((a) => a.status === IN_CONSULTATION)) {
        return;
      }

      // Recalculate from DB (1 indexed query). Cached wait times go stale as
      // real time passes, and the cache may be cold (Redis restart) — the
      // notification must be evaluated on fresh delay values either way.
      const queueData = await delayTrackerService.recalculate(
        clinicId,
        doctorId,
        date
      );

      if (queueData.appointments.length === 0) {
        return;
      }

      // Re-check on fresh data in case the cache was cold or stale
      const isAnyoneBeingServed = queueData.appointments.some(
        (a) => a.status === IN_CONSULTATION
      );

      if (isAnyoneBeingServed) {
        // Doctor is actively with a patient — no notification needed
        return;
      }

      // Check if this specific appointment is still active
      const myEntry = queueData.appointments.find(
        (a) => a.appointmentId === appointmentId
      );

      if (
        !myEntry ||
        myEntry.status === 'Completed' ||
        myEntry.status === 'Cancelled' ||
        myEntry.status === 'NoShow'
      ) {
        return;
      }

      // For repeat attempts (attempt > 1), clear the notification flag so
      // the repeated "still running late" notification can fire.
      // For the first attempt, let the notifier's once-per-crossing check
      // handle deduplication (the event-driven flow may have already notified).
      if (attempt > 1) {
        const flagKey = getRedisKey('notified', appointmentId);
        await redisClient.del(flagKey).catch(() => {});
      }

      // Doctor is inactive, appointment is active → evaluate threshold
      await runningLateNotifier.evaluateFromCache(
        clinicId,
        doctorId,
        date,
        queueData
      );

      // Broadcast the fresh delay data to the dashboard so delay details are
      // visible in real-time when doctor is running late (no extra DB query —
      // queueData was just recalculated above)
      try {
        const { QueueBroadcastService } =
          await import('./queueBroadcast.service');
        const broadcaster = new QueueBroadcastService();
        broadcaster.emitQueueUpdated(clinicId, queueData);
        await broadcaster.emitPatientUpdated(queueData);
      } catch {
        // Non-critical — notification was still sent
      }

      logger.info(
        `[RunningLateQueue] Triggered running-late notification for appointment=${appointmentId} ` +
          `(scheduled=${scheduledTime}, attempt=${attempt})`
      );

      // Self-reschedule: fire again in 15 minutes if doctor is still inactive
      if (attempt < MAX_REPEAT_ATTEMPTS) {
        const nextJobId = `running_late_${appointmentId}_repeat_${attempt + 1}`;

        await this.queue.add(
          nextJobId,
          {
            appointmentId,
            clinicId,
            doctorId,
            scheduledTime,
            date,
            attempt: attempt + 1,
          },
          {
            delay: REPEAT_INTERVAL_MS,
            jobId: nextJobId,
            removeOnComplete: true,
            removeOnFail: { age: 3600 },
          }
        );
      }
    } catch (error) {
      logger.error(
        `[RunningLateQueue] Failed to process job for appointment=${appointmentId}`,
        { error }
      );
    }
  }

  /**
   * Reads threshold from Redis cache. Returns default 10 if not cached.
   * No DB query — if cache is cold, uses default.
   */
  private async getThreshold(clinicId: string): Promise<number> {
    try {
      const cacheKey = getRedisKey('threshold', clinicId);
      const cached = await redisClient.get(cacheKey);
      if (cached !== null) {
        return parseInt(cached, 10);
      }
    } catch {
      // Redis unavailable
    }
    return 10; // Default threshold
  }
}

// Singleton
export const runningLateQueue = new RunningLateQueueService();
