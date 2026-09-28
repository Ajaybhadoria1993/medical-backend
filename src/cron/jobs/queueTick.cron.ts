// src/cron/jobs/queueTick.cron.ts
import cron from 'node-cron';
import logger from '../../utils/logger';
import { envConfig } from '../../utils/envConfig';

/**
 * Appointment Queue Tick
 *
 * Schedule: every minute
 * Purpose: recompute every active doctor's queue and push the result to
 *          patients and clinic dashboards when it has actually changed.
 *
 * The engine is otherwise entirely event-driven, but the dominant input to a
 * waiting-time estimate is the wall clock, which produces no events. Without
 * this tick a patient's estimate stays frozen between status changes while real
 * minutes pass. See QueueTickService for the change-detection that keeps a
 * quiet clinic from broadcasting anything at all.
 *
 * Set QUEUE_TICK_ENABLED=false to disable — useful when running several app
 * instances against one database, where only one should own the tick.
 */
export function initQueueTick(): void {
  if (String(process.env.QUEUE_TICK_ENABLED).toLowerCase() === 'false') {
    logger.info('[Cron:QueueTick] Disabled via QUEUE_TICK_ENABLED=false');
    return;
  }

  cron.schedule(
    '* * * * *',
    async () => {
      try {
        const { queueTickService } =
          await import('../../main/appointment-engine/services/queueTick.service');
        await queueTickService.tick();
      } catch (error) {
        logger.error('[Cron:QueueTick] Failed:', error);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );

  logger.info(
    `[Cron:QueueTick] Scheduled every minute (env=${envConfig.NODE_ENV})`
  );
}
