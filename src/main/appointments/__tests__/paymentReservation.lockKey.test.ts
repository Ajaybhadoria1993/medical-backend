/**
 * Unit tests for token lock keys.
 *
 * Token numbering restarts at 1 in every shift, so a held morning token 3 and
 * an evening token 3 are two different appointments that merely share a
 * number. Keyed on the token alone, the first hold blocked the second.
 *
 * The session is encoded only for shifts after the first, so keys written
 * before shift-wise numbering — every lock live at deploy time — still match
 * and are not orphaned.
 */

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    setex: jest.fn(),
    keys: jest.fn(),
    mget: jest.fn(),
    del: jest.fn(),
  },
}));

import { PaymentReservationService } from '../services/paymentReservation.service';

const DOCTOR = 'doctor-1';
const DATE = new Date('2026-08-14T00:00:00Z');

describe('token lock keys', () => {
  it('keeps the original shape for the first session', async () => {
    // Locks held across a deploy were written without a session and must keep
    // matching, or a paid reservation silently stops blocking its token.
    const withSession = PaymentReservationService.buildLockKey(
      DOCTOR,
      DATE,
      3,
      1
    );
    const withoutSession = PaymentReservationService.buildLockKey(
      DOCTOR,
      DATE,
      3
    );

    expect(withSession).toBe(withoutSession);
    expect(withSession).toMatch(/:3$/);
  });

  it('separates the same token number in different shifts', async () => {
    const morning = PaymentReservationService.buildLockKey(DOCTOR, DATE, 3, 1);
    const evening = PaymentReservationService.buildLockKey(DOCTOR, DATE, 3, 2);

    expect(morning).not.toBe(evening);
  });

  it('leaves slot locks untouched', async () => {
    // Time-based bookings have no session, and a session argument must not
    // leak into their keys.
    const key = PaymentReservationService.buildLockKey(
      DOCTOR,
      DATE,
      '09:30',
      2
    );

    expect(key).toContain('slot_lock:');
    expect(key).toMatch(/09:30$/);
  });

  it('reads a session back off a key it wrote', async () => {
    const redis = (await import('../../../configurations/redisConfig')).default;
    const eveningKey = PaymentReservationService.buildLockKey(
      DOCTOR,
      DATE,
      3,
      2
    );
    const morningKey = PaymentReservationService.buildLockKey(
      DOCTOR,
      DATE,
      3,
      1
    );

    (redis.keys as jest.Mock)
      .mockResolvedValueOnce([eveningKey, morningKey])
      .mockResolvedValueOnce([]);
    (redis.mget as jest.Mock).mockResolvedValue(['{}', '{}']);

    const locks = await PaymentReservationService.getActiveLocksForDate(
      DOCTOR,
      '2026-08-14'
    );

    // Both are token 3; only the session tells them apart.
    expect(locks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotOrToken: 3, sessionIndex: 2 }),
        expect.objectContaining({ slotOrToken: 3, sessionIndex: 1 }),
      ])
    );
  });
});
