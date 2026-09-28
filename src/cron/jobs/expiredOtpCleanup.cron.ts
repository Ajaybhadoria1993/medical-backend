// src/cron/jobs/expiredOtpCleanup.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';

/**
 * Expired OTP Cleanup
 *
 * Schedule: Daily at 3:00 AM IST
 * Purpose: Removes expired OTP tokens from the database to keep it clean.
 */
export function initExpiredOtpCleanup(): void {
  cron.schedule(
    '0 3 * * *',
    async () => {
      logger.info('[Cron:OtpCleanup] Starting expired OTP cleanup...');

      try {
        const { PatientAuthService } =
          await import('../../main/patient/services/patientAuth.service');
        await PatientAuthService.cleanupExpiredOtps();
        logger.info('[Cron:OtpCleanup] Done');
      } catch (error) {
        logger.error('[Cron:OtpCleanup] Failed:', error);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info('[Cron:OtpCleanup] Scheduled at 3:00 AM IST daily');
}
