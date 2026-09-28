import { NotificationProvider } from './provider.interface';
import { UniversalNotificationOptions } from '../types';
import { socketManager } from '../../../app';
import logger from '../../../utils/logger';

export class SocketProvider implements NotificationProvider {
  async send(
    options: UniversalNotificationOptions & { dbRecordId?: string }
  ): Promise<void> {
    const { recipient, event, title, body, data, metadata } = options;

    const room =
      recipient.socketRoom ||
      (recipient.userId ? `user:${recipient.userId}` : null);
    if (!room) {
      return; // Socket delivery requires a user ID or a custom socket room
    }

    const payload = {
      userId: recipient.userId || null,
      type: event,
      title,
      body,
      data: data || null,
      metadata: metadata || null,
      ts: new Date().toISOString(),
    };

    const message = {
      event: 'notification.new',
      payload: {
        notificationId: (options as any).dbRecordId || null,
        ...payload,
      },
      room,
      ts: payload.ts,
    };

    /*
     * One emit, fanned out across nodes by the Socket.io Redis adapter.
     *
     * This used to emit locally and then publish the same message to Kafka so
     * other nodes could re-emit it. With the Redis adapter attached, the local
     * emit already reaches every node — the Kafka half was a second delivery
     * path for the same message, and the reason a de-duplicating originNodeId
     * had to be threaded through the payload at all.
     */
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
      logger.warn('[SocketProvider] emit failed', e);
    }
  }
}
