import { appointmentInstantIST, comparisonRanges } from '../istDateTime';

describe('appointmentInstantIST', () => {
  it('treats appointmentTime as IST wall-clock, not server-local', () => {
    // 10:00 IST === 04:30 UTC. The old `setHours` build produced 10:00Z here,
    // which patient messages then rendered as 3:30 PM.
    const instant = appointmentInstantIST(new Date('2026-08-10'), '10:00');
    expect(instant.toISOString()).toBe('2026-08-10T04:30:00.000Z');
  });

  it('keeps the calendar day for early-morning IST times', () => {
    const instant = appointmentInstantIST(new Date('2026-08-10'), '09:15');
    expect(instant.toISOString()).toBe('2026-08-10T03:45:00.000Z');
  });

  it('accepts HH:mm:ss and unpadded times', () => {
    expect(appointmentInstantIST('2026-08-10', '9:05:00').toISOString()).toBe(
      '2026-08-10T03:35:00.000Z'
    );
  });

  it('falls back to IST midnight when no time is set', () => {
    expect(
      appointmentInstantIST(new Date('2026-08-10'), null).toISOString()
    ).toBe('2026-08-09T18:30:00.000Z');
  });
});

describe('comparisonRanges', () => {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  it('compares month-to-date with the same days of last month', () => {
    const r = comparisonRanges('2026-10-01', '2026-10-31', '2026-10-07');
    expect([ymd(r.compareEnd), ymd(r.prevStart), ymd(r.prevEnd)]).toEqual([
      '2026-10-07',
      '2026-09-01',
      '2026-09-07',
    ]);
    expect(r.label).toBe('vs last month');
  });

  it('compares a finished month with the whole month before', () => {
    const r = comparisonRanges('2026-03-01', '2026-03-31', '2026-04-10');
    expect([ymd(r.compareEnd), ymd(r.prevStart), ymd(r.prevEnd)]).toEqual([
      '2026-03-31',
      '2026-02-01',
      '2026-02-28',
    ]);
  });

  it('cuts a week at today and shifts it back by its length', () => {
    const r = comparisonRanges('2026-10-04', '2026-10-10', '2026-10-07');
    expect([ymd(r.prevStart), ymd(r.prevEnd)]).toEqual([
      '2026-09-27',
      '2026-09-30',
    ]);
    expect(r.label).toBe('vs previous 7 days');
  });

  it('compares a single day with the day before', () => {
    const r = comparisonRanges('2026-10-07', '2026-10-07', '2026-10-07');
    expect([ymd(r.prevStart), ymd(r.prevEnd)]).toEqual([
      '2026-10-06',
      '2026-10-06',
    ]);
  });

  it('bounds whole IST days on the zone-less column', () => {
    const r = comparisonRanges('2026-10-01', '2026-10-31', '2026-10-07');
    expect(r.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });
});
