import crypto from 'crypto';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';

const LOCK_TTL_MS = 60_000;
const DEFAULT_WAIT_MS = 20_000;
const RETRY_INTERVAL_MS = 150;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

/** The lock is held by another activation and the caller chose not to wait. */
export class ActivationLockBusyError extends HttpError {
  constructor() {
    super(
      409,
      'Another payment for this clinic is still being processed. Please retry in a moment.'
    );
  }
}

/**
 * Serializes everything that turns a payment into a subscription for one clinic.
 *
 * A single checkout reaches the backend several ways at once — the frontend's
 * verify call, the `payment.captured` / `subscription.charged` /
 * `subscription.authenticated` webhooks, and the status-page self-healing
 * refresh. Each checks "was this payment already applied?" and then inserts.
 * Without serializing, a second caller can run in the window between the first
 * caller's insert and the rest of its bookkeeping and create a second paid
 * subscription row, a second invoice and a second timeline entry for one charge.
 *
 * Callers must re-check idempotency *inside* `work`, because the check they made
 * before taking the lock may already be stale. The lock is not re-entrant: do not
 * nest it for the same clinic.
 *
 * `waitMs: 0` fails immediately with `ActivationLockBusyError` — for opportunistic
 * callers (status polls) that would rather skip than queue behind a webhook.
 */
export const withSubscriptionActivationLock = async <T>(
  clinicId: string,
  work: () => Promise<T>,
  options: { waitMs?: number } = {}
): Promise<T> => {
  const key = `lock:subscription-activation:${clinicId}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);

  // NX: only if absent. PX: released by expiry, so a crashed instance cannot
  // hold the lock forever.
  while (
    (await redisClient.set(key, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK'
  ) {
    if (Date.now() >= deadline) throw new ActivationLockBusyError();
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  try {
    return await work();
  } finally {
    // Compare-and-delete, so a lock that expired and was re-taken by someone
    // else is never released by us.
    await redisClient.eval(RELEASE_SCRIPT, 1, key, token).catch(() => 0);
  }
};
