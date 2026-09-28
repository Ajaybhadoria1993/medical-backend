import {
  BridgeSession,
  BridgeUpdateResult,
  ScanBridgeUploadPayload,
} from '../types/scan.bridge.types';

const store = new Map<string, BridgeSession>();
const TTL_MS = 5 * 60 * 1000;

const isExpired = (session: BridgeSession) => {
  return Date.now() - session.createdAt > TTL_MS;
};

const cleanupIfExpired = (otp: string) => {
  const session = store.get(otp);
  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    store.delete(otp);
    return null;
  }

  return session;
};

export const BRIDGE_TTL_SECONDS = 300;

// Expiry is otherwise only checked when a code is looked up, so an abandoned session's upload
// (up to 5 MB) would stay in memory until restart. unref() keeps the timer from holding the process open.
export const sweepExpiredBridgeSessions = () => {
  for (const [otp, session] of store) {
    if (isExpired(session)) store.delete(otp);
  }
};
setInterval(sweepExpiredBridgeSessions, 60 * 1000).unref();

export const createBridgeSession = (otp: string) => {
  const session: BridgeSession = {
    otp,
    status: 'waiting',
    createdAt: Date.now(),
  };

  store.set(otp, session);
  return session;
};

export const createUniqueBridgeSession = (
  generateOtp: () => string,
  maxRetries = 5
) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const otp = generateOtp();
    const existing = cleanupIfExpired(otp);

    if (!existing) {
      return createBridgeSession(otp);
    }
  }

  return null;
};

export const updateBridgeSession = (
  otp: string,
  data: ScanBridgeUploadPayload
): BridgeUpdateResult => {
  const existing = cleanupIfExpired(otp);
  if (!existing) {
    return { ok: false, reason: 'invalid_or_expired' };
  }

  if (existing.status === 'uploaded') {
    return { ok: false, reason: 'already_uploaded' };
  }

  const updated: BridgeSession = {
    ...existing,
    ...data,
    status: 'uploaded',
    uploadedAt: Date.now(),
  };

  store.set(otp, updated);
  return { ok: true, session: updated };
};

export const getBridgeSession = (otp: string) => {
  return cleanupIfExpired(otp);
};

export const getRemainingSessionTtlSeconds = (createdAt: number) => {
  const expiresAt = createdAt + TTL_MS;
  const remainingMs = expiresAt - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
};
