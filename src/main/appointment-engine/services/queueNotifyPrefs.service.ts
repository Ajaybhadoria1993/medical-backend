/**
 * QueueNotifyPrefsService
 *
 * Backs the patient Live Queue "Notify me when" toggles:
 *   - My turn          → patientsAhead === 0 (patient reaches the front, still waiting)
 *   - N patients before → patientsAhead <= patientsAheadThreshold
 *   - Doctor arrives    → the doctor becomes active (any "Confirmed" entry in the queue)
 *
 * Preferences and per-condition dedupe flags live in Redis (no DB changes).
 * Delivery is push-only via UniversalNotificationService (device tokens already
 * exist in UserDevicesModel, delivered over AWS SNS). Each condition uses the same
 * once-per-crossing flag pattern as RunningLateNotifier so the patient isn't spammed
 * on every recalculation, but is re-notified if a condition re-crosses (e.g. the queue
 * reshuffles after a no-show).
 */

import redisClient from '../../../configurations/redisConfig';
import logger from '../../../utils/logger';
import { UniversalNotificationService } from '../../notifications/services/universalNotification.service';
import { QueueDelayData } from '../types/engine.types';
import { IN_CONSULTATION } from '../types/engine.types';
import { getRedisKey, isTerminalStatus, patientCount } from '../utils/helpers';
import { getDoctorDisplayName } from '../utils/doctorDisplayName';

export interface QueueNotifyPrefs {
  /** Notify when the patient reaches the front of the queue (0 patients ahead). */
  myTurn: boolean;
  /** Notify when patientsAhead <= this value. null = off. */
  patientsAheadThreshold: number | null;
  /** Notify when the doctor becomes active (starts consulting). */
  doctorArrives: boolean;
}

/** 24h — daily data, same as the other appointment-engine keys. */
const PREFS_TTL_SECONDS = 24 * 60 * 60;
const FLAG_TTL_SECONDS = 24 * 60 * 60;

/** Redis flag key `type` per condition (once-per-crossing dedupe). */
const FLAG_TYPES = {
  myTurn: 'notified_myturn',
  patientsAhead: 'notified_ahead',
  doctorArrives: 'notified_dr_active',
} as const;

// ─── Preferences storage ──────────────────────────────────────────────────────

/**
 * Reads a single appointment's notify preferences. Returns null if unset or on
 * a Redis error (treated as "no preferences" — no notifications).
 */
export async function getPrefs(
  appointmentId: string
): Promise<QueueNotifyPrefs | null> {
  try {
    const raw = await redisClient.get(
      getRedisKey('notify_prefs', appointmentId)
    );
    if (!raw) return null;
    return JSON.parse(raw) as QueueNotifyPrefs;
  } catch (err) {
    logger.warn(
      `[QueueNotify] Failed to read prefs for appointment=${appointmentId}`,
      err
    );
    return null;
  }
}

/**
 * Batch-reads notify preferences for many appointments in a single Redis mget,
 * for the per-patient broadcast loop (avoids N round-trips).
 */
export async function getPrefsBatch(
  appointmentIds: string[]
): Promise<Map<string, QueueNotifyPrefs>> {
  const result = new Map<string, QueueNotifyPrefs>();
  if (appointmentIds.length === 0) return result;

  try {
    const keys = appointmentIds.map((id) => getRedisKey('notify_prefs', id));
    const values = await redisClient.mget(...keys);
    values.forEach((raw, i) => {
      if (!raw) return;
      try {
        result.set(appointmentIds[i], JSON.parse(raw) as QueueNotifyPrefs);
      } catch {
        // Corrupted entry — skip
      }
    });
  } catch (err) {
    logger.warn('[QueueNotify] Failed to batch-read prefs', err);
  }

  return result;
}

/**
 * Persists a patient's notify preferences (24h TTL). Fire-and-forget safe:
 * throws only if the caller wants to surface the failure (the REST controller does).
 */
export async function setPrefs(
  appointmentId: string,
  prefs: QueueNotifyPrefs
): Promise<void> {
  await redisClient.set(
    getRedisKey('notify_prefs', appointmentId),
    JSON.stringify(prefs),
    'EX',
    PREFS_TTL_SECONDS
  );
}

// ─── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluates all three notify conditions for every active appointment in the queue
 * that has preferences set, and sends push notifications for newly-crossed
 * conditions. Called fire-and-forget from QueueBroadcastService.emitPatientUpdated
 * on every recalculation — Redis-only (zero DB queries) except, when a condition
 * fires, one doctor-name lookup and the push dispatch itself. Never throws.
 */
export async function evaluateQueueNotifications(
  queueData: QueueDelayData
): Promise<void> {
  try {
    const activeAppointments = queueData.appointments.filter(
      (a) => !isTerminalStatus(a.status)
    );
    if (activeAppointments.length === 0) return;

    const activeIds = activeAppointments.map((a) => a.appointmentId);
    const prefsByAppointment = await getPrefsBatch(activeIds);
    if (prefsByAppointment.size === 0) return;

    // "Doctor is active" = any Confirmed entry (Confirmed only — Patient Arrived
    // is checked-in/waiting, not with the doctor; consistent with the rest of
    // the engine).
    const doctorActive = queueData.appointments.some(
      (a) => a.status === IN_CONSULTATION
    );

    // One lookup per evaluation, and only once a condition actually fires —
    // most recalculations send nothing and stay DB-free.
    let doctorNameLookup: Promise<string | null> | undefined;
    const doctorName = () =>
      (doctorNameLookup ??= getDoctorDisplayName(queueData.doctorId));

    const tasks: Promise<void>[] = [];

    activeAppointments.forEach((entry, index) => {
      const prefs = prefsByAppointment.get(entry.appointmentId);
      if (!prefs) return;

      // A patient still "waiting" = not yet being seen and not terminal.
      // (isTerminalStatus already excluded above.) Once Confirmed, the my-turn /
      // patients-ahead conditions no longer apply to them.
      const isWaiting = entry.status !== IN_CONSULTATION;
      const patientsAhead = index; // index in active-ordered list (time/token)

      // My turn: front of queue, still waiting.
      tasks.push(
        evaluateCondition(
          entry.appointmentId,
          FLAG_TYPES.myTurn,
          prefs.myTurn && isWaiting && patientsAhead === 0,
          async () => {
            const doctor = await doctorName();
            await sendQueueNotification(entry.userId, 'queue_my_turn', {
              title: doctor ? `You're next to see ${doctor}` : "You're next",
              body: 'Please stay near the consultation room.',
              appointmentId: entry.appointmentId,
              patientsAhead,
              doctorId: queueData.doctorId,
            });
          }
        )
      );

      // N patients before: patientsAhead <= threshold, still waiting.
      const threshold = prefs.patientsAheadThreshold;
      tasks.push(
        evaluateCondition(
          entry.appointmentId,
          FLAG_TYPES.patientsAhead,
          threshold !== null && isWaiting && patientsAhead <= threshold,
          async () => {
            const doctor = await doctorName();
            await sendQueueNotification(entry.userId, 'queue_patients_ahead', {
              title:
                patientsAhead === 0
                  ? doctor
                    ? `You're next to see ${doctor}`
                    : "You're next"
                  : `${patientCount(patientsAhead)} ahead of you`,
              body:
                patientsAhead > 0 && doctor
                  ? `In ${doctor}'s queue. Please stay close by.`
                  : 'Please stay close by.',
              appointmentId: entry.appointmentId,
              patientsAhead,
              doctorId: queueData.doctorId,
            });
          }
        )
      );

      // Doctor arrives: doctor became active while this patient is still waiting.
      tasks.push(
        evaluateCondition(
          entry.appointmentId,
          FLAG_TYPES.doctorArrives,
          prefs.doctorArrives && isWaiting && doctorActive,
          async () => {
            const doctor = await doctorName();
            await sendQueueNotification(entry.userId, 'queue_doctor_active', {
              title: `${doctor ?? 'Your doctor'} has started seeing patients`,
              body:
                patientsAhead === 0
                  ? "You're next."
                  : `${patientCount(patientsAhead)} ahead of you.`,
              appointmentId: entry.appointmentId,
              patientsAhead,
              doctorId: queueData.doctorId,
            });
          }
        )
      );
    });

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.error('[QueueNotify] Notification dispatch failed', {
          error: r.reason,
        });
      }
    }
  } catch (err) {
    logger.error('[QueueNotify] evaluateQueueNotifications failed', err);
  }
}

/**
 * Once-per-crossing evaluation for a single (appointment, condition):
 * - condition true  + flag unset → run the action, set the flag
 * - condition true  + flag set   → no-op (already notified this crossing)
 * - condition false + flag set   → clear the flag (re-arm for the next crossing)
 */
async function evaluateCondition(
  appointmentId: string,
  flagType: string,
  conditionMet: boolean,
  action: () => Promise<void>
): Promise<void> {
  const flagKey = getRedisKey(flagType, appointmentId);

  if (conditionMet) {
    const exists = await redisClient.exists(flagKey).catch(() => 0);
    if (exists === 1) return; // already notified for this crossing
    await action();
    await redisClient.set(flagKey, '1', 'EX', FLAG_TTL_SECONDS).catch(() => {});
  } else {
    // Clear the flag so a future re-crossing notifies again.
    await redisClient.del(flagKey).catch(() => {});
  }
}

interface QueueNotificationContent {
  title: string;
  body: string;
  appointmentId: string;
  patientsAhead: number;
  doctorId: string;
}

async function sendQueueNotification(
  userId: string,
  event: string,
  content: QueueNotificationContent
): Promise<void> {
  await UniversalNotificationService.send({
    recipient: { userId },
    event,
    channels: ['push'],
    title: content.title,
    body: content.body,
    // Push custom data comes from `metadata`, not `data` (see push.provider.ts).
    metadata: {
      appointmentId: content.appointmentId,
      patientsAhead: content.patientsAhead,
      doctorId: content.doctorId,
    },
  });
}
