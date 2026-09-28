import { NotificationProvider } from './provider.interface';
import { UniversalNotificationOptions } from '../types';
import { SnsNotificationService } from '../services/sns.service';

export class PushProvider implements NotificationProvider {
  async send(options: UniversalNotificationOptions): Promise<void> {
    const { recipient, title, body, metadata } = options;
    if (!recipient.userId) {
      // Push notifications require a registered user ID to lookup endpoints
      return;
    }
    await SnsNotificationService.sendPushNotification(
      recipient.userId,
      title,
      body,
      metadata || undefined
    );
  }
}
