/**
 * QueueBroadcastService
 *
 * Handles WebSocket event emission after queue state changes.
 * - "queue.updated" to clinic dashboard rooms
 * - "appointment.updated" to individual patient rooms (user:{userId})
 * - "queue.update" to patients in live-queue rooms (join.live-queue)
 *
 * All broadcasts are fire-and-forget: failures are logged, never thrown.
 */

import logger from '../../../utils/logger';
import { QueueDelayData } from '../types/engine.types';
import { isTerminalStatus } from '../utils/helpers';
import { buildPayloadFromQueue } from './liveQueueHelper';
import { evaluateQueueNotifications } from './queueNotifyPrefs.service';
import { RunningLateNotifier } from './runningLateNotifier.service';

export class QueueBroadcastService {
  /**
   * Emits "queue.updated" to the clinic room for the dashboard.
   * Also broadcasts "queue.update" to patients in live-queue rooms.
   */
  emitQueueUpdated(clinicId: string, queueData: QueueDelayData): void {
    const room = `clinic:${clinicId}`;

    // 1-based rank among appointments actually progressing toward being seen
    // — array order already is queue order (DelayTrackerService walks it
    // chronologically), so this is just numbering that order rather than
    // leaving the dashboard to infer position from array index itself.
    // Terminal (done) and held/skipped (paused) appointments get no
    // position: neither is "next in line" for anyone watching. The patient
    // currently with the doctor still counts — they are position 1.
    let nextPosition = 1;
    const positionByAppointmentId = new Map<string, number>();
    for (const entry of queueData.appointments) {
      if (isTerminalStatus(entry.status) || entry.isOnHold) continue;
      positionByAppointmentId.set(entry.appointmentId, nextPosition);
      nextPosition++;
    }

    const payload = {
      clinicId: queueData.clinicId,
      doctorId: queueData.doctorId,
      date: queueData.date,
      cumulativeDelay: queueData.cumulativeDelayMinutes,
      lastCalculatedAt: queueData.lastCalculatedAt,
      appointments: queueData.appointments.map((entry) => ({
        appointmentId: entry.appointmentId,
        status: entry.status,
        appointmentTime: entry.scheduledTime,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        cumulativeDelay: queueData.cumulativeDelayMinutes,
        // Included because it changes on every recalculation, exactly like the
        // wait estimate beside it. Omitting it left dashboards showing whatever
        // projected time happened to be true when the page first loaded, which
        // defeats the point of recalculating the queue at all.
        projectedStartTime: entry.projectedStartTime,
        // Without these a socket update erases the hold client-side, so a
        // parked patient reverts to reading as Confirmed until the next fetch.
        isOnHold: Boolean(entry.isOnHold),
        holdReason: entry.holdReason ?? null,
        arrivedAt: entry.arrivedAt ?? null,
        position: positionByAppointmentId.get(entry.appointmentId) ?? null,
      })),
    };

    try {
      const { socketManager } = require('../../../app');
      socketManager.io.to(room).emit('queue.updated', payload);
      logger.info(
        `[AppointmentEngine] Emitted queue.updated to room ${room} (${queueData.appointments.length} appointments)`
      );

      // Broadcast to patients in live-queue rooms
      this.emitLiveQueueUpdates(socketManager, clinicId, queueData);
    } catch (err) {
      logger.warn(
        `[AppointmentEngine] Failed to emit queue.updated to room ${room}`,
        { clinicId, error: err }
      );
    }
  }

  /*
   * `reception.liveQueue.updated` and its `emitReceptionBoard` entry point
   * were removed here.
   *
   * They rebuilt every doctor's board for the whole clinic on every queue
   * action and pushed it to the clinic room — the most expensive thing in this
   * path, and REALTIME_SIGNAL_CONTRACT.md flagged it for deletion once the
   * last consumer migrated. That consumer was the reception dashboard, which
   * now re-reads `GET /appointments/reception/live-queue` when the `board:{c}`
   * signal says the version moved: one request, only when something changed,
   * and no server-side rebuild for clinics with nobody watching.
   */

  /**
   * Emits "appointment.updated" to each patient's user:{userId} room.
   * Includes full live queue data for the patient app.
   *
   * Delegates payload construction to buildPayloadFromQueue (shared with the
   * live-queue socket path) instead of re-deriving the queue stage inline, so
   * the two broadcast paths can't drift out of sync.
   */
  async emitPatientUpdated(queueData: QueueDelayData): Promise<void> {
    let emittedCount = 0;
    const appointments = queueData.appointments;

    // Same threshold the notifier uses, so a pushed payload and one fetched
    // on join can never disagree about whether the doctor is running late.
    const thresholdMinutes = await new RunningLateNotifier()
      .getThresholdMinutes(queueData.clinicId)
      .catch(() => null);

    for (const entry of appointments) {
      if (isTerminalStatus(entry.status)) continue;

      const room = `user:${entry.userId}`;
      const eventPayload = buildPayloadFromQueue(
        entry.appointmentId,
        queueData,
        thresholdMinutes
      );

      try {
        const { socketManager } = require('../../../app');
        socketManager.io.to(room).emit('appointment.updated', eventPayload);
        emittedCount++;
      } catch (err) {
        logger.warn(
          `[AppointmentEngine] Failed to emit appointment.updated to ${room}`,
          { appointmentId: entry.appointmentId, error: err }
        );
      }
    }

    logger.info(
      `[AppointmentEngine] Emitted appointment.updated to ${emittedCount} patient rooms`
    );

    // Evaluate patient "Notify me when" push conditions against the same fresh
    // queue data. Fire-and-forget — Redis-only, never blocks or throws into the
    // broadcast path (same discipline as the rest of the engine).
    evaluateQueueNotifications(queueData).catch((err) => {
      logger.warn('[AppointmentEngine] evaluateQueueNotifications failed', err);
    });
  }

  /**
   * Emits "queue.update" to patients who joined via join.live-queue.
   * - Skips patients whose appointment is now terminal
   * - Auto-removes terminated patients from room (sends "queue.completed")
   * - Only computes payload for active queue members
   */
  private async emitLiveQueueUpdates(
    socketManager: {
      io: { in: (room: string) => { fetchSockets: () => Promise<any[]> } };
    },
    clinicId: string,
    queueData: QueueDelayData
  ): Promise<void> {
    const lqRoom = `live-queue:${clinicId}:${queueData.doctorId}`;

    try {
      const sockets = await socketManager.io.in(lqRoom).fetchSockets();
      if (sockets.length === 0) return;

      // Same threshold the notifier and the join path use, so a pushed
      // payload can't disagree with the one fetched on join.
      const thresholdMinutes = await new RunningLateNotifier()
        .getThresholdMinutes(clinicId)
        .catch(() => null);

      for (const socket of sockets) {
        const lqData = (socket as any).liveQueueData;
        if (!lqData?.appointmentId) continue;

        const myEntry = queueData.appointments.find(
          (a) => a.appointmentId === lqData.appointmentId
        );

        // Appointment completed/cancelled/noshow — auto-remove from live queue
        if (!myEntry || isTerminalStatus(myEntry.status)) {
          socket.emit('queue.completed', {
            appointmentId: lqData.appointmentId,
            status: myEntry?.status ?? 'unknown',
            message: 'Your appointment is no longer in the queue',
          });
          socket.leave(lqRoom);
          (socket as any).liveQueueData = null;
          continue;
        }

        socket.emit(
          'queue.update',
          buildPayloadFromQueue(
            lqData.appointmentId,
            queueData,
            thresholdMinutes
          )
        );
      }
    } catch (err) {
      logger.warn('[AppointmentEngine] Failed to emit to live-queue room', err);
    }
  }
}
