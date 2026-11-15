import { anchorDayOf, nextPeriodEnd } from '../utils/renewalDate.utils';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('nextPeriodEnd', () => {
  it.each([
    [
      '15th → 15th',
      '2026-11-15T10:30:00',
      'monthly',
      15,
      '2026-12-15T10:30:00',
    ],
    [
      'Jan 31 → Feb 28',
      '2027-01-31T09:00:00',
      'monthly',
      31,
      '2027-02-28T09:00:00',
    ],
    [
      'Feb 28 → back to Mar 31',
      '2027-02-28T09:00:00',
      'monthly',
      31,
      '2027-03-31T09:00:00',
    ],
    [
      'Jan 31 → Feb 29 in a leap year',
      '2028-01-31T09:00:00',
      'monthly',
      31,
      '2028-02-29T09:00:00',
    ],
    [
      'Dec 31 → Jan 31 next year',
      '2026-12-31T18:00:00',
      'monthly',
      31,
      '2027-01-31T18:00:00',
    ],
    [
      'yearly, same date next year',
      '2026-11-03T11:00:00',
      'yearly',
      3,
      '2027-11-03T11:00:00',
    ],
    [
      'Feb 29 yearly → Feb 28',
      '2028-02-29T12:00:00',
      'yearly',
      29,
      '2029-02-28T12:00:00',
    ],
    [
      'late night IST keeps the IST date',
      '2026-11-30T23:30:00',
      'monthly',
      30,
      '2026-12-30T23:30:00',
    ],
  ] as const)('%s', (_name, start, cycle, anchor, expected) => {
    expect(nextPeriodEnd(ist(start), cycle, anchor).toISOString()).toBe(
      ist(expected).toISOString()
    );
  });

  it('runs the Jan 31 anchor through a whole year without drifting', () => {
    let end = ist('2027-01-31T09:00:00');
    const days: number[] = [];
    for (let i = 0; i < 12; i++) {
      end = nextPeriodEnd(end, 'monthly', 31);
      days.push(anchorDayOf(end));
    }
    expect(days).toEqual([28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31]);
  });
});

describe('anchorDayOf', () => {
  it('reads the day in IST, not UTC', () => {
    // 02:00 IST on the 1st is still the 31st in UTC.
    expect(anchorDayOf(ist('2026-11-01T02:00:00'))).toBe(1);
    expect(anchorDayOf(ist('2026-10-31T23:59:00'))).toBe(31);
  });
});
