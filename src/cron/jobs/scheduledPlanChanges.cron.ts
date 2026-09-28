// src/cron/jobs/scheduledPlanChanges.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';
import { SubscriptionService } from '../../main/subscription/services/subscription.service';
import { runOnce } from '../runOnce';

/**
 * Scheduled Plan Changes (Downgrades)
 *
 * Schedule: Hourly (on the hour)
 * Purpose: Applies plan downgrades that were scheduled for the end of a
 *          billing period, once their effective date has passed.
 */
export function initScheduledPlanChanges(): void {
  cron.schedule(
    '0 * * * *',
    async () => {
      // One instance per hour. Applying a change twice recomputes startsAt and
      // expiresAt from now, so a second run hands the clinic another billing
      // period. TTL is just under the interval, so a crashed instance cannot
      // block the next run.
      await runOnce('ScheduledPlanChanges', 55 * 60, async () => {
        logger.info(
          '[Cron:ScheduledPlanChanges] Checking for due downgrades...'
        );

        try {
          const result =
            await SubscriptionService.processDueScheduledPlanChanges();

          if (result.applied > 0) {
            logger.info(
              `[Cron:ScheduledPlanChanges] Applied ${result.applied}/${result.processed} scheduled plan change(s).`
            );
          }

          if (result.errors.length > 0) {
            logger.error(
              `[Cron:ScheduledPlanChanges] Errors: ${result.errors.join(', ')}`
            );
          }
        } catch (error) {
          logger.error('[Cron:ScheduledPlanChanges] Failed:', error);
        }
      });
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:ScheduledPlanChanges] Scheduled hourly');
}
