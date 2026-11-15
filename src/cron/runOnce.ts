import redisClient from '../configurations/redisConfig';
import logger from '../utils/logger';

/** Runs a cron job on one app instance only (Redis SET NX with a TTL); skips when Redis is down,
 *  because a delayed billing job is recoverable and a doubled one is not. */
export async function runOnce(
  jobName: string,
  ttlSeconds: number,
  work: () => Promise<void>
): Promise<void> {
  const key = `cron:lock:${jobName}`;

  let acquired = false;
  try {
    // NX: only if absent. EX: released by expiry, so a crashed instance cannot
    // hold the lock forever.
    acquired =
      (await redisClient.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  } catch (err) {
    logger.error(
      `[Cron:${jobName}] Skipped — could not reach Redis to claim the run: ${
        (err as Error).message
      }`
    );
    return;
  }

  if (!acquired) {
    logger.info(`[Cron:${jobName}] Skipped — another instance holds this run`);
    return;
  }

  try {
    await work();
  } catch (err) {
    // A run that threw did nothing for sure, so free the lock and let the next schedule retry.
    await redisClient
      .del(key)
      .catch((e: Error) =>
        logger.error(
          `[Cron:${jobName}] Could not release the lock: ${e.message}`
        )
      );
    throw err;
  }
}
