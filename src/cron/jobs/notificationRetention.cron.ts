// src/cron/jobs/notificationRetention.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';
import { envConfig } from '../../utils/envConfig';

/**
 * Nightly retention: deletes read notifications older than the window.
 * Gated on NOTIFICATIONS_INAPP_ENABLED — it is the only part of the rebuild
 * that deletes, and §6's archive-and-classify comes first.
 */
export function initNotificationRetention(): void {
  // Off until in-app notifications ship: this deletes exactly the rows the
  // plan's §6 archive-and-classify procedure has to see first.
  if (!envConfig.NOTIFICATIONS_INAPP_ENABLED) {
    logger.info(
      '[Cron:NotificationRetention] Skipped — NOTIFICATIONS_INAPP_ENABLED is off'
    );
    return;
  }

  cron.schedule(
    '30 3 * * *',
    async () => {
      logger.info('[Cron:NotificationRetention] Starting...');

      try {
        const { purgeExpiredNotifications } =
          await import('../../main/notifications/services/retention.service');
        const result = await purgeExpiredNotifications();
        logger.info(
          `[Cron:NotificationRetention] Removed ${result.notifications} read notifications and ${result.activity} activity rows`
        );
      } catch (error) {
        logger.error('[Cron:NotificationRetention] Failed:', error);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:NotificationRetention] Scheduled at 3:30 AM IST daily');
}
