// src/cron/jobs/expiredAddOns.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';
import { AddOnService } from '../../main/subscription/services/addon.service';
import { runOnce } from '../runOnce';

/**
 * Expired Add-Ons & Scheduled User Deactivations
 *
 * Schedule: Hourly (on the hour)
 * Purpose: Deactivates add-ons whose billing cycle (expiresAt) has passed,
 *          and archives/deactivates the specific doctor/staff accounts that were
 *          scheduled for deactivation by the Clinic Admin.
 */
export function initExpiredAddOns(): void {
  cron.schedule(
    '0 * * * *',
    async () => {
      await runOnce('ExpiredAddOns', 55 * 60, async () => {
        logger.info('[Cron:ExpiredAddOns] Checking for expired add-ons...');

        try {
          const result = await AddOnService.processExpiredAddOns();

          if (result.deactivatedCount > 0) {
            logger.info(
              `[Cron:ExpiredAddOns] Deactivated ${result.deactivatedCount}/${result.processed} expired add-on(s) and archived ${result.archivedUsersCount} user(s).`
            );
          }

          if (result.errors.length > 0) {
            logger.error(
              `[Cron:ExpiredAddOns] Errors: ${result.errors.join(', ')}`
            );
          }
        } catch (error) {
          logger.error('[Cron:ExpiredAddOns] Failed:', error);
        }
      });
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:ExpiredAddOns] Scheduled hourly');
}
