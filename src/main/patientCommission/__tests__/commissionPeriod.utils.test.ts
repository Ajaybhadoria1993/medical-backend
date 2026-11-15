import {
  addDays,
  changeStartDate,
  periodContaining,
} from '../utils/commissionPeriod.utils';

describe('changeStartDate', () => {
  it('starts a monthly change on the 1st of next month', () => {
    expect(changeStartDate('2026-11-14', 'monthly', 'monthly')).toBe('2026-12-01');
  });

  it('starts a half-monthly change at the next half', () => {
    expect(changeStartDate('2026-11-14', 'half_monthly', 'half_monthly')).toBe(
      '2026-11-16'
    );
    expect(changeStartDate('2026-11-16', 'half_monthly', 'half_monthly')).toBe(
      '2026-12-01'
    );
  });

  it('waits for the 1st when the period length changes, so no day is billed twice', () => {
    expect(changeStartDate('2026-11-14', 'half_monthly', 'monthly')).toBe(
      '2026-12-01'
    );
    expect(changeStartDate('2026-11-14', 'monthly', 'half_monthly')).toBe(
      '2026-12-01'
    );
    expect(changeStartDate('2026-12-20', 'half_monthly', 'monthly')).toBe(
      '2027-01-01'
    );
  });
});

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('periodContaining — monthly', () => {
  it('is the whole calendar month', () => {
    expect(periodContaining('2026-11-14', 'monthly')).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      nextStartDate: '2026-12-01',
    });
  });

  it('holds its first and last day', () => {
    expect(periodContaining('2026-11-01', 'monthly').startDate).toBe(
      '2026-11-01'
    );
    expect(periodContaining('2026-11-30', 'monthly').endDate).toBe('2026-11-30');
  });

  it('rolls over December into January', () => {
    expect(periodContaining('2026-12-20', 'monthly')).toEqual({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      nextStartDate: '2027-01-01',
    });
  });

  it('ends February on the 28th, or the 29th in a leap year', () => {
    expect(periodContaining('2027-02-10', 'monthly').endDate).toBe('2027-02-28');
    expect(periodContaining('2028-02-10', 'monthly').endDate).toBe('2028-02-29');
  });
});

describe('periodContaining — half monthly', () => {
  it('splits the month at the 15th and 16th', () => {
    expect(periodContaining('2026-11-15', 'half_monthly')).toEqual({
      startDate: '2026-11-01',
      endDate: '2026-11-15',
      nextStartDate: '2026-11-16',
    });
    expect(periodContaining('2026-11-16', 'half_monthly')).toEqual({
      startDate: '2026-11-16',
      endDate: '2026-11-30',
      nextStartDate: '2026-12-01',
    });
  });

  it('puts the first day in the first half and the last day in the second', () => {
    expect(periodContaining('2026-11-01', 'half_monthly').startDate).toBe(
      '2026-11-01'
    );
    expect(periodContaining('2026-12-31', 'half_monthly')).toEqual({
      startDate: '2026-12-16',
      endDate: '2026-12-31',
      nextStartDate: '2027-01-01',
    });
  });

  it('gives a short second half in February', () => {
    expect(periodContaining('2027-02-20', 'half_monthly')).toEqual({
      startDate: '2027-02-16',
      endDate: '2027-02-28',
      nextStartDate: '2027-03-01',
    });
  });

  it('never overlaps: each period starts the day after the previous one ends', () => {
    let date = '2026-11-14';
    for (let i = 0; i < 6; i++) {
      const p = periodContaining(date, 'half_monthly');
      const next = periodContaining(p.nextStartDate, 'half_monthly');
      expect(addDays(p.endDate, 1)).toBe(next.startDate);
      date = next.startDate;
    }
  });
});
