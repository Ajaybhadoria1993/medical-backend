// src/utils/appointmentRealtime.ts
/**
 * Real-time appointment broadcast utility.
 *
 * Emits socket events to the clinic room so that ALL connected users
 * (doctors, receptionists, admins) in that clinic get instant UI updates
 * without polling.
 *
 * Events emitted:
 *  - "appointment.created"  → new appointment added
 *  - "appointment.updated"  → status change, reschedule, payment, etc.
 */

import { socketManager } from '../app';
import logger from './logger';

export type AppointmentRealtimeAction =
  | 'created'
  | 'updated'
  | 'confirmed'
  | 'cancelled'
  | 'rescheduled'
  | 'completed'
  | 'noshow'
  | 'payment_updated'
  | 'vitals_updated';

export interface AppointmentRealtimePayload {
  appointmentId: string;
  clinicId: string;
  doctorId?: string;
  patientId?: string;
  action: AppointmentRealtimeAction;
  performerUserId?: string;
  /** Any extra data the frontend might need to decide whether to refetch */
  data?: Record<string, unknown>;
}

/**
 * Broadcast an appointment change to the entire clinic room.
 * Fire-and-forget — never throws.
 */
export function broadcastAppointmentChange(
  payload: AppointmentRealtimePayload
): void {
  try {
    const room = `clinic:${payload.clinicId}`;
    const eventName =
      payload.action === 'created'
        ? 'appointment.created'
        : 'appointment.updated';

    socketManager.io.to(room).emit(eventName, {
      ...payload,
      ts: new Date().toISOString(),
    });

    logger.info(
      `[AppointmentRealtime] Emitted "${eventName}" to room ${room}`,
      { appointmentId: payload.appointmentId, action: payload.action }
    );
  } catch (err) {
    // Non-critical — log and move on
    logger.warn('[AppointmentRealtime] Failed to broadcast', err);
  }
}
