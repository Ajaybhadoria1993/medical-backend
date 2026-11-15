import { NotificationProvider } from './provider.interface';
import { UniversalNotificationOptions } from '../types';
import { SnsNotificationService } from '../services/sns.service';

/** Sends a push to every device of the recipient, carrying the event and its data. */
export class PushProvider implements NotificationProvider {
  /** Push needs a user id to find the devices; without one this is a no-op. */
  async send(options: UniversalNotificationOptions): Promise<void> {
    const { recipient, event, title, body, data, metadata } = options;
    if (!recipient.userId) return;
    await SnsNotificationService.sendPushNotification(
      recipient.userId,
      title,
      body,
      toPushData({ event, ...(data ?? {}), ...(metadata ?? {}) })
    );
  }
}

/** FCM drops non-string data values, so every value is sent as a string and nulls are left out. */
function toPushData(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}
