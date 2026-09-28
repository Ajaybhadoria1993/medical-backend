import redisClient from '../configurations/redisConfig';
import logger from '../utils/logger';

/**
 * Runs a scheduled job on one instance only.
 *
 * Every cron in this app fires in every app process. With one container that is
 * invisible; with two it means every job runs twice, and the jobs that mutate
 * state do their work twice. `scheduledPlanChanges` is the case in hand: both
 * instances fire on the same second, both read a subscription whose
 * `scheduledPlanId` is still set, and both apply it — recomputing `startsAt`
 * and `expiresAt` from `now`, so the clinic silently gains a second billing
 * period, plus a duplicate activity record.
 *
 * A Redis SET NX with a TTL is the smallest thing that fixes it: the first
 * instance to claim the window runs, the rest skip.
 *
 * **Fails closed.** If Redis is unreachable the job is skipped rather than run,
 * because for a billing mutation a delayed run is recoverable on the next tick
 * and a doubled one is not. Jobs that are naturally idempotent (deleting rows
 * already past a retention window) do not need this and should not pay for it.
 */
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

  await work();
}
