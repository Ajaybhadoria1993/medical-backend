// billingPeriod and crossedWarning: renewal-date months in IST, and the warning point.
import {
  billingPeriod,
  crossedWarning,
  istDateRange,
} from '../utils/billingPeriod.utils';

// An IST wall-clock moment as a real instant ("2026-11-20T10:00" IST → 04:30Z).
const ist = (s: string) => new Date(`${s}+05:30`);

describe('billingPeriod', () => {
  it('runs from the renewal day to the same day next month', () => {
    const anchor = ist('2026-01-20T15:00:00');
    expect(billingPeriod(anchor, ist('2026-11-25T09:00:00'))).toEqual({
      start: ist('2026-11-20T00:00:00'),
      end: ist('2026-12-20T00:00:00'),
    });
  });

  it('belongs to the previous month before the renewal day', () => {
    const anchor = ist('2026-01-20T15:00:00');
    expect(billingPeriod(anchor, ist('2026-11-19T23:59:00'))).toEqual({
      start: ist('2026-10-20T00:00:00'),
      end: ist('2026-11-20T00:00:00'),
    });
  });

  it('starts a new period at IST midnight, not UTC midnight', () => {
    const anchor = ist('2026-01-20T15:00:00');
    // 00:10 IST on the 20th is still the 19th in UTC.
    expect(billingPeriod(anchor, ist('2026-11-20T00:10:00')).start).toEqual(
      ist('2026-11-20T00:00:00')
    );
  });

  it('puts a 31st renewal on the last day of shorter months', () => {
    const anchor = ist('2026-01-31T10:00:00');
    expect(billingPeriod(anchor, ist('2026-02-28T12:00:00'))).toEqual({
      start: ist('2026-02-28T00:00:00'),
      end: ist('2026-03-31T00:00:00'),
    });
  });

  it('crosses the year boundary', () => {
    const anchor = ist('2026-03-15T10:00:00');
    expect(billingPeriod(anchor, ist('2027-01-05T10:00:00'))).toEqual({
      start: ist('2026-12-15T00:00:00'),
      end: ist('2027-01-15T00:00:00'),
    });
  });

  it('starts the first period at the anchor, so an upgrade gets a fresh allowance', () => {
    const upgradedAt = ist('2026-11-20T15:00:00');
    expect(billingPeriod(upgradedAt, ist('2026-11-20T16:00:00')).start).toEqual(
      upgradedAt
    );
  });
});

describe('crossedWarning', () => {
  it('fires only on the message that reaches the warning point', () => {
    expect(crossedWarning(799, 800, 1000, 80)).toBe(true);
    expect(crossedWarning(800, 801, 1000, 80)).toBe(false);
    expect(crossedWarning(798, 799, 1000, 80)).toBe(false);
  });

  it('handles a warning point between whole messages', () => {
    // 80% of 3 = 2.4, so the 3rd message is the one that crosses it.
    expect(crossedWarning(2, 3, 3, 80)).toBe(true);
    expect(crossedWarning(1, 2, 3, 80)).toBe(false);
  });

  it('never fires for a zero limit', () => {
    expect(crossedWarning(0, 1, 0, 80)).toBe(false);
  });
});

describe('istDateRange', () => {
  it('covers whole IST days, end exclusive, across a month end', () => {
    expect(istDateRange('2026-11-01', '2026-11-30')).toEqual({
      start: ist('2026-11-01T00:00:00'),
      end: ist('2026-12-01T00:00:00'),
    });
  });

  it('covers a single day', () => {
    expect(istDateRange('2026-12-31', '2026-12-31')).toEqual({
      start: ist('2026-12-31T00:00:00'),
      end: ist('2027-01-01T00:00:00'),
    });
  });
});
