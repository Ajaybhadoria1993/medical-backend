import {
  BRIDGE_TTL_SECONDS,
  createBridgeSession,
  getBridgeSession,
  sweepExpiredBridgeSessions,
  updateBridgeSession,
} from '../services/scan.bridge.service';

describe('scan bridge session expiry', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps a session until its TTL, then the sweep removes it', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    createBridgeSession('SWEEP1');
    updateBridgeSession('SWEEP1', { imageBase64: '/9j/AAAA' });

    jest.setSystemTime(1_000_000 + (BRIDGE_TTL_SECONDS - 1) * 1000);
    sweepExpiredBridgeSessions();
    expect(getBridgeSession('SWEEP1')?.status).toBe('uploaded');

    jest.setSystemTime(1_000_000 + (BRIDGE_TTL_SECONDS + 1) * 1000);
    sweepExpiredBridgeSessions();
    expect(getBridgeSession('SWEEP1')).toBeNull();
  });

  it('rejects an upload to an expired code and a second upload to a used one', () => {
    jest.useFakeTimers({ now: 2_000_000 });
    createBridgeSession('USED01');
    expect(updateBridgeSession('USED01', { imageBase64: '/9j/AAAA' }).ok).toBe(
      true
    );
    expect(updateBridgeSession('USED01', { imageBase64: '/9j/AAAA' })).toEqual({
      ok: false,
      reason: 'already_uploaded',
    });

    createBridgeSession('LATE01');
    jest.setSystemTime(2_000_000 + (BRIDGE_TTL_SECONDS + 1) * 1000);
    expect(updateBridgeSession('LATE01', { imageBase64: '/9j/AAAA' })).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    });
  });
});
