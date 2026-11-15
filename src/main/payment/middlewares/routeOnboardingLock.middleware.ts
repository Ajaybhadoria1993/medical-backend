import { randomUUID } from 'crypto';
import redisClient from '../../../configurations/redisConfig';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';

/** One Razorpay onboarding change per clinic at a time, across every server; released when the response ends. */
export const lockRouteOnboarding = asyncHandler(async (req, res, next) => {
  const clinicId = req.clinicId;
  if (!clinicId) throw new HttpError(400, 'Clinic context required');
  const key = `razorpay_route_onboarding_lock:${clinicId}`;
  const token = randomUUID();
  const acquired = await redisClient.set(key, token, 'EX', 300, 'NX');
  if (acquired !== 'OK') {
    throw new HttpError(
      409,
      'Razorpay onboarding is already being processed. Please retry shortly.'
    );
  }
  const release = () => {
    void redisClient
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token
      )
      .catch(() => undefined);
  };
  res.once('finish', release);
  res.once('close', release);
  return next();
});
