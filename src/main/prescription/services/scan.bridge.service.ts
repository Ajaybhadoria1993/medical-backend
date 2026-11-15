import redisClient from '../../../configurations/redisConfig';
import { CacheKeys } from '../../../utils/cache.util';
import {
  BridgeSession,
  BridgeUpdateResult,
  ScanBridgeUploadPayload,
} from '../types/scan.bridge.types';

// In Redis, not memory: a restart or a second instance must not turn a live QR into "invalid".
export const BRIDGE_TTL_SECONDS = 10 * 60;

const keyFor = (otp: string) => CacheKeys.scanBridgeSession(otp);

export const getRemainingSessionTtlSeconds = (createdAt: number) => {
  const remainingMs = createdAt + BRIDGE_TTL_SECONDS * 1000 - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
};

export const getBridgeSession = async (
  otp: string
): Promise<BridgeSession | null> => {
  const raw = await redisClient.get(keyFor(otp));
  if (!raw) return null;
  const session = JSON.parse(raw) as BridgeSession;
  // Redis expiry is the real limit; this only guards a key read in its last second.
  return getRemainingSessionTtlSeconds(session.createdAt) > 0 ? session : null;
};

/** A new session under an unused code, or null when every attempt collided. */
export const createUniqueBridgeSession = async (
  generateOtp: () => string,
  maxRetries = 5
): Promise<BridgeSession | null> => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const session: BridgeSession = {
      otp: generateOtp(),
      status: 'waiting',
      createdAt: Date.now(),
    };
    // NX: never overwrite a live session that happens to share the code.
    const created = await redisClient.set(
      keyFor(session.otp),
      JSON.stringify(session),
      'EX',
      BRIDGE_TTL_SECONDS,
      'NX'
    );
    if (created) return session;
  }
  return null;
};

export const updateBridgeSession = async (
  otp: string,
  data: ScanBridgeUploadPayload
): Promise<BridgeUpdateResult> => {
  const existing = await getBridgeSession(otp);
  if (!existing) return { ok: false, reason: 'invalid_or_expired' };
  if (existing.status === 'cancelled')
    return { ok: false, reason: 'cancelled' };
  if (existing.status === 'uploaded') {
    return { ok: false, reason: 'already_uploaded' };
  }

  const updated: BridgeSession = {
    ...existing,
    ...data,
    status: 'uploaded',
    uploadedAt: Date.now(),
  };
  // ponytail: read-then-write, so two uploads in the same instant can both pass; WATCH/MULTI if that bites.
  // Keeps the original deadline: an upload must not extend the code's life.
  await redisClient.set(
    keyFor(otp),
    JSON.stringify(updated),
    'EX',
    Math.max(1, getRemainingSessionTtlSeconds(existing.createdAt))
  );
  return { ok: true, session: updated };
};

/**
 * The computer closed the session. A small "cancelled" record stays until the original
 * deadline, so the phone hears "closed on the computer" instead of a success nobody receives.
 */
export const cancelBridgeSession = async (otp: string): Promise<void> => {
  const existing = await getBridgeSession(otp);
  if (!existing || existing.status === 'cancelled') return;

  const cancelled: BridgeSession = {
    otp,
    status: 'cancelled',
    createdAt: existing.createdAt,
  };
  // Any uploaded file is dropped: nobody will collect it.
  await redisClient.set(
    keyFor(otp),
    JSON.stringify(cancelled),
    'EX',
    Math.max(1, getRemainingSessionTtlSeconds(existing.createdAt))
  );
};
