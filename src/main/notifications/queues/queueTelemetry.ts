import logger from '../../../utils/logger';

/**
 * Counts jobs that exhausted every retry.
 *
 * A job that gives up is currently logged and forgotten — nothing watches the
 * failed set, so a queue can be quietly dropping work for days. This keeps a
 * running count per queue so `/api/health` can expose it and an uptime monitor
 * can alert on it, without adding a metrics stack.
 *
 * In-process and therefore per-instance and reset by a restart: it answers "is
 * something failing right now", not "how many failed this month". BullMQ's
 * failed set is still the record — `removeOnFail` keeps the last 1000.
 */
const exhausted = new Map<
  string,
  { count: number; lastAt: string; lastError: string }
>();

export function recordExhaustedJob(queue: string, error: string): void {
  const prev = exhausted.get(queue);
  exhausted.set(queue, {
    count: (prev?.count ?? 0) + 1,
    lastAt: new Date().toISOString(),
    lastError: error.slice(0, 200),
  });
}

export function getQueueFailureSnapshot(): {
  totalExhausted: number;
  queues: Record<string, { count: number; lastAt: string; lastError: string }>;
} {
  const queues = Object.fromEntries(exhausted);
  return {
    totalExhausted: Object.values(queues).reduce((n, q) => n + q.count, 0),
    queues,
  };
}

/**
 * Shared `failed` handler. Distinguishes a retry from a give-up, because only
 * the second is worth waking someone for.
 */
export function onJobFailed(queue: string) {
  return (
    job:
      | { id?: string; attemptsMade?: number; opts?: { attempts?: number } }
      | undefined,
    err: Error,
    describe?: () => string
  ): void => {
    const attempts = job?.opts?.attempts ?? 0;
    const made = job?.attemptsMade ?? 0;
    const gaveUp = made >= attempts;
    const detail = describe?.() ?? '';

    if (gaveUp) recordExhaustedJob(queue, err.message);

    logger.error(
      `[${queue}] job ${job?.id}${detail} ${
        gaveUp ? 'GAVE UP after' : 'failed on'
      } attempt ${made}/${attempts}: ${err.message}`
    );
  };
}
