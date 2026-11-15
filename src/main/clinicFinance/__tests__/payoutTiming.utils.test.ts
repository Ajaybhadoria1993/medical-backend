import { expectedPayoutDate } from '../utils/payoutTiming.utils';

const day = (d: Date) => d.toISOString().slice(0, 10);

describe('expected payout date', () => {
  it('Fri 13 Nov 2026: skips the 2nd Saturday and Sunday, lands Tue 17', () => {
    expect(day(expectedPayoutDate('2026-11-13', false))).toBe('2026-11-17');
  });

  it('counts a 1st Saturday as a working day', () => {
    // Fri 6 Nov 2026 → Sat 7 (1st Saturday) → Mon 9.
    expect(day(expectedPayoutDate('2026-11-06', false))).toBe('2026-11-09');
  });

  it('UPI is paid the same day', () => {
    expect(day(expectedPayoutDate('2026-11-13', true))).toBe('2026-11-13');
  });
});
