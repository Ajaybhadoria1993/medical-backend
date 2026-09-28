import { UniversalNotificationOptions } from '../types';
import { PushProvider } from '../providers/push.provider';
import { EmailProvider } from '../providers/email.provider';
import { SmsProvider } from '../providers/sms.provider';
import { SocketProvider } from '../providers/socket.provider';
import * as dbService from './notifications.service';
import { getUserNotificationPreference } from '../preferences/notificationPreferences.utils';
import logger from '../../../utils/logger';
import { isLegacyInAppAllowed } from '../killswitch/killSwitch';

const pushProvider = new PushProvider();
const emailProvider = new EmailProvider();
const smsProvider = new SmsProvider();
const socketProvider = new SocketProvider();

export class UniversalNotificationService {
  /**
   * Dispatches a notification across specified channels (Push, Email, SMS, WebSockets).
   * Persists the message to the database if a userId is provided.
   */
  static async send(options: UniversalNotificationOptions) {
    const { recipient, event, channels, title, body, data, metadata } = options;

    let inAppEnabled = true;
    let pushEnabled = true;

    if (recipient.userId && event) {
      try {
        const prefs = await getUserNotificationPreference(
          recipient.userId,
          event
        );
        inAppEnabled = prefs.inApp;
        pushEnabled = prefs.push;
      } catch (err) {
        logger.error(
          '[UniversalNotificationService] Failed to check preferences, default to true',
          err
        );
      }
    }

    // Phase 0, Step 0 — legacy in-app kill switch. Suppresses the bell, the
    // socket emit and the push for informational events while the Notification
    // Center is rebuilt. The email/sms/whatsapp branches below are untouched.
    if (!isLegacyInAppAllowed(event, metadata?.source as string | undefined)) {
      inAppEnabled = false;
      pushEnabled = false;
    }

    // 1) Write to Database if a userId is present (User Inbox logs)
    //
    // Only when the in-app channel was actually requested. This used to persist
    // for any recipient with a userId regardless of `channels`, so the
    // queue-position pushes — "3 patients ahead", then 2, then 1 — each left a
    // permanent inbox row for a number that was already stale by the time it
    // was read. They are push-only by declaration and now by behaviour.
    // A failed insert also cancels the socket emit below; email/SMS/push are
    // separate channels and still go out.
    let dbRecord = null;
    let persistFailed = false;
    if (recipient.userId && inAppEnabled && channels.includes('socket')) {
      try {
        dbRecord = await dbService.createNotification({
          userId: recipient.userId,
          type: event,
          title,
          body,
          data: data || null,
          metadata: metadata || null,
        });
      } catch (err) {
        persistFailed = true;
        logger.error(
          '[UniversalNotificationService] Failed to persist notification to DB:',
          err
        );
      }
    }

    // 2) Dispatch to all requested channels concurrently
    const promises = channels.map(async (channel) => {
      try {
        switch (channel) {
          case 'push':
            if (pushEnabled) {
              await pushProvider.send(options);
            }
            break;
          case 'email':
            await emailProvider.send(options);
            break;
          case 'sms':
            await smsProvider.send(options);
            break;
          case 'socket':
            // Include database record ID if available so real-time sockets can trace/mark read
            if (inAppEnabled && !persistFailed) {
              await socketProvider.send({
                ...options,
                dbRecordId: dbRecord?.id,
              } as any);
            }
            break;
          default:
            logger.warn(
              `[UniversalNotificationService] Unsupported channel: ${channel}`
            );
        }
      } catch (err: any) {
        logger.error(
          `[UniversalNotificationService] Failure delivering channel "${channel}":`,
          err?.message || err
        );
        if (options.throwOnError) {
          throw err;
        }
      }
    });

    if (options.throwOnError) {
      await Promise.all(promises);
    } else {
      await Promise.allSettled(promises);
    }
    return dbRecord;
  }
}
