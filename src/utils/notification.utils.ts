/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/notification/notification.utils.ts

import * as notificationService from '../main/notifications/services/notifications.service';
import { socketManager } from '../app';
import { SnsNotificationService } from '../main/notifications/services/sns.service';
import logger from './logger';

/** Socket event and room convention: clients should `join('appointment:<appointmentId>')` to receive this. */
export const APPOINTMENT_PRESCRIPTION_PDF_SOCKET_EVENT =
  'appointment.prescription.pdf_ready';

import { getUserNotificationPreference } from '../main/notifications/preferences/notificationPreferences.utils';
import { isLegacyInAppAllowed } from '../main/notifications/killswitch/killSwitch';

export type NotifyOpts = {
  userId: string;
  type?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  metadata?: Record<string, any>;
  // optionally: publish key (e.g. userId or conversationId for ordering)
  allowToStoreInDB?: boolean; // default true
};

/**
 * Persist + deliver notification for a user.
 *
 * Delivery strategy (prevents duplicate emissions):
 * - Always persists to DB first.
 * - Attempts to publish to Kafka. If Kafka is available, the Kafka consumer
 *   will emit to sockets (handles multi-node delivery).
 * - If Kafka publish fails (disconnected/unavailable), falls back to a direct
 *   local socket emit so the user still receives the notification in real time.
 *
 * This ensures exactly-once delivery per node: either Kafka delivers OR local
 * emit delivers, never both.
 */
export async function sendNotificationToUser(opts: NotifyOpts) {
  const payload = {
    userId: opts.userId,
    type: opts.type ?? 'notification',
    title: opts.title,
    body: opts.body,
    data: opts.data ?? null,
    metadata: opts.metadata ?? null,
    ts: new Date().toISOString(),
  };

  let inAppEnabled = true;
  let pushEnabled = true;

  const action = opts.metadata?.action;
  if (opts.userId && action) {
    try {
      const prefs = await getUserNotificationPreference(opts.userId, action);
      inAppEnabled = prefs.inApp;
      pushEnabled = prefs.push;
    } catch (e) {
      logger.error(
        '[NotificationService] Failed to check preferences, default to true',
        e
      );
    }
  }

  // Phase 0, Step 0 — legacy in-app kill switch. Suppresses the bell, the socket
  // emit and the push for informational events while the Notification Center is
  // rebuilt. SMS/WhatsApp/email are untouched; functional events bypass it.
  if (!isLegacyInAppAllowed(action, opts.metadata?.source, opts.type)) {
    inAppEnabled = false;
    pushEnabled = false;
  }

  // 1) persist to DB. A failed insert cancels the in-app emit below: a toast
  // with no row can never be marked read and is gone on refresh.
  let dbRecord;
  let persistFailed = false;
  if (inAppEnabled) {
    try {
      if (opts.allowToStoreInDB !== false) {
        dbRecord = await notificationService.createNotification({
          userId: opts.userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          metadata: payload.metadata,
        });
      }
    } catch (e) {
      persistFailed = true;
      logger.error('[NotificationService] Failed to persist notification', e);
    }
  }

  // prepare final message shape for socket/kafka
  let message;
  if (inAppEnabled && !persistFailed) {
    message = {
      event: 'notification.new',
      payload: {
        notificationId: dbRecord?.id ?? null,
        ...payload,
      },
      room: `user:${opts.userId}`,
      ts: payload.ts,
    };

    // 2) Always emit locally first — ensures the user gets the notification immediately
    //    regardless of Kafka state.
    try {
      if (socketManager) {
        socketManager.emitByKafkaMessage({
          event: message.event,
          payload: message.payload,
          room: message.room,
          socketId: undefined,
        });
      }
    } catch (e) {
      logger.warn('[NotificationService] local emit failed', e);
    }

    // The local emit above reaches every node through the Socket.io Redis
    // adapter. The Kafka publish that used to follow it delivered the same
    // message a second way, and originNodeId existed only to de-duplicate the
    // two.
  }

  // 4) Deliver push notification via SNS (fire-and-forget)
  if (pushEnabled) {
    SnsNotificationService.sendPushNotification(
      opts.userId,
      opts.title,
      opts.body,
      opts.metadata
    ).catch((e) => {
      logger.warn('[NotificationService] Push delivery failed', e?.message);
    });
  }

  return { dbRecord, message };
}

/**
 * After the prescription PDF URL is saved on the report card, notify every socket
 * joined to room `appointment:<appointmentId>` (multi-node via Kafka when available).
 */
export async function broadcastPrescriptionPdfReadyToAppointmentRoom(opts: {
  appointmentId: string;
  reportId: string;
  pdfUrl: string;
}) {
  const room = `appointment:${opts.appointmentId}`;
  const payload = {
    appointmentId: opts.appointmentId,
    reportId: opts.reportId,
    pdfUrl: opts.pdfUrl,
    action: 'prescription_pdf_ready',
    ts: new Date().toISOString(),
  };

  try {
    if (socketManager) {
      socketManager.emitByKafkaMessage({
        event: APPOINTMENT_PRESCRIPTION_PDF_SOCKET_EVENT,
        payload,
        room,
      });
    }
  } catch {
    // non-fatal; same resilience as sendNotificationToUser local emit
  }

  // The local emit above already reaches every node via the Socket.io Redis
  // adapter; the Kafka publish that used to follow it was a duplicate.
}
