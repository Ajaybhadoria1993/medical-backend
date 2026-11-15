// Scan bridge sessions in Redis: unique codes, expiry, and one upload per code.
const mockStore = new Map<string, { value: string; expiresAt: number }>();

// The global mock has no storage; this one keeps values and honours EX/NX against Date.now().
jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (key: string) => {
      const entry = mockStore.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.value;
    }),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      const live = mockStore.get(key);
      if (args.includes('NX') && live && live.expiresAt > Date.now())
        return null;
      const seconds = Number(args[args.indexOf('EX') + 1]);
      mockStore.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return 'OK';
    }),
    on: jest.fn(),
  },
}));

import {
  BRIDGE_TTL_SECONDS,
  cancelBridgeSession,
  createUniqueBridgeSession,
  getBridgeSession,
  updateBridgeSession,
} from '../services/scan.bridge.service';

const codes = (...list: string[]) => {
  const queue = [...list];
  return () => queue.shift() ?? 'ZZZZZZ';
};

describe('scan bridge session', () => {
  beforeEach(() => mockStore.clear());
  afterEach(() => jest.useRealTimers());

  it('lasts ten minutes and survives an upload until then', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    expect(BRIDGE_TTL_SECONDS).toBe(600);
    await createUniqueBridgeSession(codes('LIVE01'));
    await updateBridgeSession('LIVE01', { imageBase64: '/9j/AAAA' });

    jest.setSystemTime(1_000_000 + (BRIDGE_TTL_SECONDS - 1) * 1000);
    expect((await getBridgeSession('LIVE01'))?.status).toBe('uploaded');

    jest.setSystemTime(1_000_000 + (BRIDGE_TTL_SECONDS + 1) * 1000);
    expect(await getBridgeSession('LIVE01')).toBeNull();
  });

  it('never reuses a live code', async () => {
    await createUniqueBridgeSession(codes('SAME01'));
    const second = await createUniqueBridgeSession(codes('SAME01', 'OTHER1'));
    expect(second?.otp).toBe('OTHER1');
  });

  it('a closed session refuses uploads, drops any file, and closing twice is fine', async () => {
    await createUniqueBridgeSession(codes('SHUT01'));
    await updateBridgeSession('SHUT01', { imageBase64: '/9j/AAAA' });

    await cancelBridgeSession('SHUT01');
    await cancelBridgeSession('SHUT01');
    const closed = await getBridgeSession('SHUT01');
    expect(closed?.status).toBe('cancelled');
    expect(closed?.imageBase64).toBeUndefined();

    await createUniqueBridgeSession(codes('SHUT02'));
    await cancelBridgeSession('SHUT02');
    expect(
      await updateBridgeSession('SHUT02', { imageBase64: '/9j/AAAA' })
    ).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  it('rejects a second upload and an upload after expiry', async () => {
    jest.useFakeTimers({ now: 2_000_000 });
    await createUniqueBridgeSession(codes('USED01'));
    expect(
      (await updateBridgeSession('USED01', { imageBase64: '/9j/AAAA' })).ok
    ).toBe(true);
    expect(
      await updateBridgeSession('USED01', { imageBase64: '/9j/AAAA' })
    ).toEqual({
      ok: false,
      reason: 'already_uploaded',
    });

    await createUniqueBridgeSession(codes('LATE01'));
    jest.setSystemTime(2_000_000 + (BRIDGE_TTL_SECONDS + 1) * 1000);
    expect(
      await updateBridgeSession('LATE01', { imageBase64: '/9j/AAAA' })
    ).toEqual({
      ok: false,
      reason: 'invalid_or_expired',
    });
  });
});
