/**
 * The notification work queue. Redis + BullMQ, not Kafka: this needs per-job
 * retry/backoff/DLQ, and a poison message must not stall a partition.
 */

import { Queue, Worker } from 'bullmq';
import logger from '../../../utils/logger';
import { dispatch, type NotifyJobData } from '../services/dispatch.service';
import { queueConnection } from './queueConnection';
import { onJobFailed } from './queueTelemetry';

const QUEUE_NAME = 'notifications';

class NotificationQueue {
  private queue: Queue<NotifyJobData>;
  private worker: Worker<NotifyJobData>;

  constructor() {
    this.queue = new Queue<NotifyJobData>(QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        // Keep enough history to investigate a complaint, not forever.
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1000 },
      },
    });

    this.worker = new Worker<NotifyJobData>(
      QUEUE_NAME,
      async (job) => dispatch(job.data, job.id),
      {
        connection: queueConnection,
        /*
         * One job at a time — BullMQ's default — meant a burst queued rather
         * than parallelised, and a fan-out is mostly waiting: a directory
         * lookup, a preference read, one insert, a socket emit.
         *
         * Modest on purpose. The worker shares an event loop with the API, so
         * this is bounded by what a spike may take from request handling, not
         * by what Postgres could accept.
         */
        concurrency: 5,
      }
    );

    this.worker.on('failed', (job, err) =>
      onJobFailed(QUEUE_NAME)(job, err, () => ` (${job?.data?.eventKey})`)
    );

    this.worker.on('error', (err) => {
      logger.error(`[Notifications] queue worker error: ${err.message}`);
    });
  }

  async enqueue(data: NotifyJobData, jobId?: string): Promise<void> {
    // A job id makes the enqueue idempotent: BullMQ drops a duplicate id while
    // the original is still known to the queue, so a retried request or a
    // double-fired hook produces one notification rather than two. This is why
    // the notifications table needs no separate dedupe column.
    await this.queue.add(data.eventKey, data, jobId ? { jobId } : undefined);
  }
}

let instance: NotificationQueue | null = null;

/**
 * Created on first use rather than at import. Constructing a Worker opens Redis
 * connections immediately, and a module that merely imports this one should not
 * start consuming jobs as a side effect.
 */
function getQueue(): NotificationQueue {
  if (!instance) instance = new NotificationQueue();
  return instance;
}

/** Hand an event to the queue. One Redis write; never throws at the call site. */
export async function notify(
  eventKey: string,
  ctx: Record<string, unknown>,
  options?: { jobId?: string }
): Promise<void> {
  try {
    await getQueue().enqueue({ eventKey, ctx }, options?.jobId);
  } catch (err) {
    logger.error(
      `[Notifications] failed to enqueue "${eventKey}": ${(err as Error).message}`
    );
  }
}
