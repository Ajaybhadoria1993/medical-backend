// src/cron/jobs/subscriptionReminders.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';
import { RenewalReminderService } from '../../main/subscription/services/renewalReminder.service';

/**
 * Subscription Renewal Reminders
 *
 * Schedule: Daily at 7:00 AM IST
 * Purpose: Sends email + in-app notification to clinic admins
 *          whose plans expire in 7, 3, or 1 day(s).
 */
export function initSubscriptionReminders(): void {
  cron.schedule(
    '0 7 * * *',
    async () => {
      logger.info('[Cron:SubscriptionReminders] Starting daily check...');

      try {
        const result = await RenewalReminderService.sendExpiryReminders();

        logger.info(
          `[Cron:SubscriptionReminders] Done. Processed: ${result.processed}, Sent: ${result.remindersSent.length}`
        );

        if (result.remindersSent.length > 0) {
          for (const reminder of result.remindersSent) {
            logger.info(
              `[Cron:SubscriptionReminders] → ${reminder.adminEmail} (${reminder.clinicName}) — ${reminder.daysRemaining}d remaining`
            );
          }
        }

        if (result.errors.length > 0) {
          logger.error(
            `[Cron:SubscriptionReminders] Errors: ${result.errors.join(', ')}`
          );
        }
      } catch (error) {
        logger.error('[Cron:SubscriptionReminders] Failed:', error);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:SubscriptionReminders] Scheduled at 7:00 AM IST daily');
}
