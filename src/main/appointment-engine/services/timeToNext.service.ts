import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentDelayEntry, QueueDelayData } from '../types/engine.types';
import { DelayTrackerService } from './delayTracker.service';
import { getRedisKey, isTerminalStatus } from '../utils/helpers';
import { ARRIVED } from '../utils/queueBoard';
import { IN_CONSULTATION } from '../types/engine.types';
import {
  getISTDateString,
  getISTHoursMinutes,
} from '../../../utils/istDateTime';

/**
 * TimeToNextService
 *
 * Computes the estimated minutes until the next patient for the doctor/receptionist view.
 *
 * Three cases:
 * 1. In-progress appointment (status "Patient Arrived"):
 *    timeToNext = max(0, ceil(duration − elapsedSinceArrival)) in whole minutes rounded up
 * 2. No appointment in-progress:
 *    timeToNext = max(0, nextProjectedStart − now) in whole minutes
 * 3. No further appointments exist: return null (omit from display)
 */
export class TimeToNextService {
  private delayTrackerService: DelayTrackerService;

  constructor() {
    this.delayTrackerService = new DelayTrackerService();
  }

  /**
   * Computes the estimated time (in whole minutes) until the next appointment.
   *
   * @param clinicId - The clinic identifier
   * @param doctorId - The doctor identifier
   * @param date - The date string (YYYY-MM-DD)
   * @returns The estimated minutes to next appointment, or null if no further appointments
   */
  async compute(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number | null> {
    // Get the queue delay data (from cache or recalculate)
    let queueData = await this.delayTrackerService.getQueueDelayData(
      clinicId,
      doctorId,
      date
    );

    if (!queueData) {
      // No cached data — recalculate
      queueData = await this.delayTrackerService.recalculate(
        clinicId,
        doctorId,
        date
      );
    }

    const appointments = queueData.appointments;

    // The patient in the room, or checked in and about to be. A merely
    // Confirmed booking is neither — see isPresentStatus.
    const inProgressAppointment = appointments.find(
      (a) => a.status === ARRIVED || a.status === IN_CONSULTATION
    );

    if (inProgressAppointment) {
      // Only show time-to-next if there IS a next patient waiting after the current one
      const hasNextWaiting = this.findNextNonTerminalAppointment(
        appointments,
        new Date(),
        date
      );

      if (!hasNextWaiting) {
        // Current patient is the last one — no "next" to show
        logger.info(
          `[TimeToNext] In-progress appointment=${inProgressAppointment.appointmentId} is the last one for clinic=${clinicId}, doctor=${doctorId}. Returning null.`
        );
        return null;
      }

      logger.info(
        `[TimeToNext] Found in-progress appointment=${inProgressAppointment.appointmentId} (status=${inProgressAppointment.status}) for clinic=${clinicId}, doctor=${doctorId}`
      );
      return this.computeFromInProgress(inProgressAppointment);
    }

    // No in-progress appointment — find the next waiting appointment
    const now = new Date();
    const nextAppointment = this.findNextNonTerminalAppointment(
      appointments,
      now,
      date
    );

    if (!nextAppointment) {
      // No further appointments exist
      logger.info(
        `[TimeToNext] No further appointments for clinic=${clinicId}, doctor=${doctorId}, date=${date}. Returning null.`
      );
      return null;
    }

    logger.info(
      `[TimeToNext] No in-progress, using next appointment=${nextAppointment.appointmentId} for clinic=${clinicId}, doctor=${doctorId}`
    );
    return this.computeFromNextProjectedStart(nextAppointment, now, date);
  }

  /**
   * Computes the time-to-next value and broadcasts it via WebSocket
   * only if it differs from the last broadcast value by ≥ 1 minute.
   *
   * Stores the last broadcast value in Redis at key
   * `appointment_engine:time_to_next:{clinicId}:{doctorId}` with 1h TTL.
   *
   * @param clinicId - The clinic identifier
   * @param doctorId - The doctor identifier
   * @param date - The date string (YYYY-MM-DD)
   * @returns The computed time-to-next value (or null)
   */
  async computeAndBroadcast(
    clinicId: string,
    doctorId: string,
    date: string
  ): Promise<number | null> {
    const value = await this.compute(clinicId, doctorId, date);
    return this.broadcastValue(clinicId, doctorId, value);
  }

  /**
   * Computes time-to-next from pre-fetched QueueDelayData and broadcasts.
   * Eliminates the Redis cache read — used when the orchestrator already
   * has fresh queue data from a preceding recalculate() call.
   *
   * @param clinicId - The clinic identifier
   * @param doctorId - The doctor identifier
   * @param date - The date string (YYYY-MM-DD)
   * @param queueData - Pre-fetched queue data from DelayTrackerService.recalculate()
   * @returns The computed time-to-next value (or null)
   */
  async computeAndBroadcastFromQueue(
    clinicId: string,
    doctorId: string,
    _date: string,
    queueData: QueueDelayData
  ): Promise<number | null> {
    const value = await this.computeFromQueue(clinicId, doctorId, queueData);
    return this.broadcastValue(clinicId, doctorId, value);
  }

  /**
   * Computes time-to-next from pre-fetched QueueDelayData (no cache read).
   */
  private async computeFromQueue(
    clinicId: string,
    doctorId: string,
    queueData: QueueDelayData
  ): Promise<number | null> {
    const appointments = queueData.appointments;

    const inProgressAppointment = appointments.find(
      (a) => a.status === ARRIVED || a.status === IN_CONSULTATION
    );

    if (inProgressAppointment) {
      // Only show time-to-next if there IS a next patient waiting after the current one
      const hasNextWaiting = this.findNextNonTerminalAppointment(
        appointments,
        new Date(),
        queueData.date
      );

      if (!hasNextWaiting) {
        // Current patient is the last one — no "next" to show
        logger.info(
          `[TimeToNext] In-progress appointment=${inProgressAppointment.appointmentId} is the last one. Returning null.`
        );
        return null;
      }

      logger.info(
        `[TimeToNext] Found in-progress appointment=${inProgressAppointment.appointmentId} (status=${inProgressAppointment.status}) for clinic=${clinicId}, doctor=${doctorId}`
      );
      return this.computeFromInProgress(inProgressAppointment);
    }

    const now = new Date();
    const today = getISTDateString(now);
    const nextAppointment = this.findNextNonTerminalAppointment(
      appointments,
      now,
      today
    );

    if (!nextAppointment) {
      logger.info(
        `[TimeToNext] No further appointments for clinic=${clinicId}, doctor=${doctorId}. Returning null.`
      );
      return null;
    }

    logger.info(
      `[TimeToNext] No in-progress, using next appointment=${nextAppointment.appointmentId} for clinic=${clinicId}, doctor=${doctorId}`
    );
    return this.computeFromNextProjectedStart(nextAppointment, now, today);
  }

  /**
   * Shared broadcast logic: emits WebSocket event if value changed by ≥ 1 minute.
   */
  private async broadcastValue(
    clinicId: string,
    doctorId: string,
    value: number | null
  ): Promise<number | null> {
    const redisKey = getRedisKey('time_to_next', clinicId, doctorId);

    try {
      const lastBroadcastRaw = await redisClient.get(redisKey);
      const lastBroadcast =
        lastBroadcastRaw !== null ? parseInt(lastBroadcastRaw, 10) : null;

      // Determine if we should broadcast:
      // - If no last broadcast exists (key missing), always broadcast
      // - If current value is null and last broadcast was not null, broadcast
      // - If the absolute difference is ≥ 1 minute, broadcast
      let shouldBroadcast = false;

      if (lastBroadcast === null || isNaN(lastBroadcast)) {
        // No previous broadcast — always emit
        shouldBroadcast = value !== null;
      } else if (value === null) {
        // No more appointments — broadcast null (clear state)
        shouldBroadcast = true;
      } else {
        // Both values are numbers — check if difference ≥ 1 minute
        shouldBroadcast = Math.abs(value - lastBroadcast) >= 1;
      }

      if (shouldBroadcast) {
        this.emitTimeToNext(clinicId, value);

        // Store the new broadcast value in Redis with 1h TTL
        if (value !== null) {
          await redisClient.set(redisKey, value.toString(), 'EX', 3600);
        } else {
          // Clear the key if no further appointments
          await redisClient.del(redisKey);
        }
      }
    } catch (err) {
      // Redis or broadcast failure — log and continue
      logger.warn(
        `[TimeToNext] Broadcast throttle error for clinic=${clinicId}, doctor=${doctorId}. Emitting anyway.`,
        err
      );
      // On error, still attempt to broadcast to avoid stale data
      this.emitTimeToNext(clinicId, value);
    }

    return value;
  }

  /**
   * Emits the time-to-next WebSocket event to the clinic room.
   * Fire-and-forget — never throws.
   */
  private emitTimeToNext(clinicId: string, value: number | null): void {
    try {
      // Dynamic import to avoid circular dependency issues at module load
      const { socketManager } = require('../../../app');
      const room = `clinic:${clinicId}`;

      socketManager.io.to(room).emit('timeToNext.updated', {
        clinicId,
        timeToNextMinutes: value,
        ts: new Date().toISOString(),
      });

      logger.info(`[TimeToNext] Broadcast timeToNext=${value} to room ${room}`);
    } catch (err) {
      logger.warn('[TimeToNext] Failed to emit WebSocket event', err);
    }
  }

  /**
   * Case 1: An appointment is currently in-progress (status = "Patient Arrived" or "Confirmed").
   * timeToNext = max(0, ceil(duration − elapsedSinceStatusChange)) in whole minutes rounded up.
   *
   * We determine elapsed time by querying the appointment's `updatedAt` timestamp,
   * which reflects when the status was last changed (to "Confirmed" or "Patient Arrived").
   */
  private async computeFromInProgress(
    inProgressEntry: AppointmentDelayEntry
  ): Promise<number> {
    const now = new Date();

    // Fetch the appointment's updatedAt to determine when "Patient Arrived" was set
    const [appointmentRecord] = await database
      .select({
        updatedAt: AppointmentModel.updatedAt,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, inProgressEntry.appointmentId))
      .limit(1);

    if (!appointmentRecord || !appointmentRecord.updatedAt) {
      // If we can't determine arrival time, return 0
      logger.warn(
        `[TimeToNext] Cannot determine arrival time for appointment ${inProgressEntry.appointmentId}. Returning 0.`
      );
      return 0;
    }

    const arrivalTime = appointmentRecord.updatedAt;
    const elapsedMs = now.getTime() - arrivalTime.getTime();
    const elapsedMinutes = elapsedMs / (1000 * 60);

    const duration = inProgressEntry.durationMinutes;
    const remaining = duration - elapsedMinutes;

    logger.info(
      `[TimeToNext] In-progress: appointment=${inProgressEntry.appointmentId}, ` +
        `duration=${duration}min, elapsed=${elapsedMinutes.toFixed(1)}min, ` +
        `remaining=${remaining.toFixed(1)}min, result=${Math.max(0, Math.ceil(remaining))}`
    );

    // max(0, ceil(duration - elapsed)) — rounded up to whole minutes
    return Math.max(0, Math.ceil(remaining));
  }

  /**
   * Finds the next waiting appointment that hasn't started yet.
   * Skips terminal statuses AND in-progress statuses (Patient Arrived, Confirmed).
   * Returns the first "Upcoming" appointment — the actual next patient waiting.
   */
  private findNextNonTerminalAppointment(
    appointments: AppointmentDelayEntry[],
    _now: Date,
    _date: string
  ): AppointmentDelayEntry | null {
    for (const appt of appointments) {
      if (isTerminalStatus(appt.status)) {
        continue;
      }
      // Skip in-progress appointments (doctor is seeing them)
      if (appt.status === ARRIVED || appt.status === IN_CONSULTATION) {
        continue;
      }
      // This is an "Upcoming" appointment — the next patient waiting
      return appt;
    }

    return null;
  }

  /**
   * Case 2: No appointment is currently in-progress.
   * timeToNext = max(0, nextProjectedStart − now) in whole minutes.
   */
  private computeFromNextProjectedStart(
    nextAppointment: AppointmentDelayEntry,
    now: Date,
    _date: string
  ): number {
    // Parse the projected start time into a Date for today
    const projectedStartMinutes = parseTimeToMinutes(
      nextAppointment.projectedStartTime
    );
    const { hours: istHours, minutes: istMinutes } = getISTHoursMinutes(now);
    const nowMinutes = istHours * 60 + istMinutes + now.getSeconds() / 60;

    const diffMinutes = projectedStartMinutes - nowMinutes;

    logger.info(
      `[TimeToNext] No in-progress: next appointment=${nextAppointment.appointmentId}, ` +
        `projectedStart=${nextAppointment.projectedStartTime} (${projectedStartMinutes}min), ` +
        `now=${nowMinutes.toFixed(1)}min, diff=${diffMinutes.toFixed(1)}min, ` +
        `result=${Math.max(0, Math.ceil(diffMinutes))}`
    );

    // max(0, nextProjectedStart - now) in whole minutes
    return Math.max(0, Math.ceil(diffMinutes));
  }
}

// ─── Local Helper Functions ───────────────────────────────────────────────────

/**
 * Parses a time string (e.g., "09:00", "14:30") into minutes since midnight.
 * Returns 0 if the time cannot be parsed.
 */
function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const t = time.trim();

  // Handle 12-hour format with AM/PM
  const ampmMatch = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const min = Number(ampmMatch[2] ?? 0);
    const ampm = ampmMatch[3].toLowerCase();
    if (hour === 12 && ampm === 'am') hour = 0;
    if (hour !== 12 && ampm === 'pm') hour += 12;
    return hour * 60 + min;
  }

  // Handle 24-hour format HH:MM or HH:MM:SS
  const hhmmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const min = Number(hhmmMatch[2]);
    return hour * 60 + min;
  }

  return 0;
}
