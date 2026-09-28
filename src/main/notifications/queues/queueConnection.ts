import { envConfig } from '../../../utils/envConfig';

/**
 * Shared BullMQ connection options.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ — without it ioredis gives
 * up on commands during a brief Redis outage and the worker dies silently.
 * Queues previously built this from raw `process.env`, bypassing envConfig.
 */
export const queueConnection = {
  host: envConfig.REDIS_HOST,
  port: envConfig.REDIS_PORT,
  password: envConfig.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  /**
   * Logical database for queues, so a cache flush cannot take pending jobs with
   * it — the same Redis also backs the preference cache, the clinic-membership
   * cache and the Socket.io adapter.
   *
   * Defaults to 0, which is where jobs live today. Changing it is not a
   * transparent config edit: jobs already queued in the old database become
   * invisible to the workers, so drain the queues first (or accept losing
   * in-flight WhatsApp sends) and change it during a quiet window.
   */
  db: Number(process.env.REDIS_QUEUE_DB ?? 0),
} as const;
