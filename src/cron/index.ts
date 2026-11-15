import cron from 'node-cron';
import logger from '../utils/logger';
import { CRON_JOBS, isEnabled, runScheduled } from './registry';

/** Schedules every job in the registry (IST); call once after the server starts. Add a job in registry.ts. */
export function initCronJobs(): void {
  for (const job of CRON_JOBS) {
    if (!isEnabled(job)) {
      logger.info(`[Cron:${job.key}] Off on this server`);
      continue;
    }
    cron.schedule(job.schedule, () => runScheduled(job), {
      timezone: 'Asia/Kolkata',
    });
    if (job.runAtBoot) void runScheduled(job);
  }
  logger.info(`[Cron] ${CRON_JOBS.length} jobs registered`);
}
