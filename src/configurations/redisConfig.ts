import Redis from 'ioredis';
import { envConfig } from '../utils/envConfig';
import logger from '../utils/logger';

/**
 * Shared cache/session client.
 *
 * The three settings below exist together, and removing any one reintroduces a
 * crash we have actually had: ioredis defaults `maxRetriesPerRequest` to 20 and
 * throws `MaxRetriesPerRequestError` once a command exhausts them, which took
 * the whole process down during a Redis DNS outage. `null` stops that error
 * existing; `commandTimeout` is what stops the resulting queue hanging requests
 * forever instead; and `retryStrategy` keeps reconnecting so the app recovers on
 * its own. Degraded beats dead — Redis now backs the socket adapter and the
 * queues as well as the cache.
 */
const redisClient = new Redis({
  host: envConfig.REDIS_HOST,
  port: envConfig.REDIS_PORT,
  password: envConfig.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  commandTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redisClient.on('connect', () => {
  logger.info('Successfully connected to Redis');
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

export default redisClient;
