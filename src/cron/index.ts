// src/cron/index.ts
/**
 * Centralized Cron Job Registry
 *
 * All scheduled tasks are registered here.
 * Call initCronJobs() once after the server starts.
 *
 * To add a new cron job:
 * 1. Create a file in src/cron/jobs/ (e.g., myJob.cron.ts)
 * 2. Export a function that calls cron.schedule()
 * 3. Import and call it in this file
 */
import logger from '../utils/logger';
import { initSubscriptionReminders } from './jobs/subscriptionReminders.cron';
import { initExpiredOtpCleanup } from './jobs/expiredOtpCleanup.cron';
import { initScheduledPlanChanges } from './jobs/scheduledPlanChanges.cron';
import { initExpiredAddOns } from './jobs/expiredAddOns.cron';
import { initQueueTick } from './jobs/queueTick.cron';
import { initNotificationRetention } from './jobs/notificationRetention.cron';
import { initMissedAppointments } from './jobs/missedAppointments.cron';

export function initCronJobs(): void {
  logger.info('[Cron] Initializing scheduled jobs...');

  initSubscriptionReminders();
  initExpiredOtpCleanup();
  initScheduledPlanChanges();
  initExpiredAddOns();
  initQueueTick();
  initNotificationRetention();
  initMissedAppointments();

  logger.info('[Cron] All scheduled jobs registered');
}
