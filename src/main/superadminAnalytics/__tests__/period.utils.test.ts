// Comparison window for the Super Admin date presets.
import { resolvePeriod } from '../utils/period.utils';

describe('resolvePeriod previous window', () => {
  it('week-to-date compares the same weekdays last week', () => {
    const p = resolvePeriod({
      from: '2026-09-27',
      to: '2026-09-30',
      compare: 'week',
    });
    expect(p.previous).toEqual({ from: '2026-09-20', to: '2026-09-23' });
  });

  it('month-to-date compares the same days last month, clamped to month end', () => {
    expect(
      resolvePeriod({ from: '2026-09-01', to: '2026-09-30', compare: 'month' })
        .previous
    ).toEqual({ from: '2026-08-01', to: '2026-08-30' });
    expect(
      resolvePeriod({ from: '2026-03-01', to: '2026-03-31', compare: 'month' })
        .previous
    ).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('custom range compares the equal-length window just before it', () => {
    const p = resolvePeriod({ from: '2026-09-11', to: '2026-09-20' });
    expect(p.previous).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });
});
