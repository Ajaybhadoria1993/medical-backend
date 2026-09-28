import { appointmentInstantIST } from '../istDateTime';

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
