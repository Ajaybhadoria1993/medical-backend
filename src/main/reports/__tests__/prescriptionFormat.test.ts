import { ReportService } from '../services/report.service';

const { formatPrescriptionDate, formatPrescriptionTime } = ReportService;

describe('prescription date/time formatting', () => {
  it('formats a visit date the way the templates expect', () => {
    expect(formatPrescriptionDate('2024-03-15')).toBe('15-Mar-2024');
    expect(formatPrescriptionDate(new Date('2026-09-08'))).toBe('8-Sep-2026');
  });

  it('formats a clock time as 12-hour with a meridiem', () => {
    expect(formatPrescriptionTime('10:30')).toBe('10:30 AM');
    expect(formatPrescriptionTime('13:05')).toBe('1:05 PM');
    expect(formatPrescriptionTime('00:15')).toBe('12:15 AM');
    expect(formatPrescriptionTime('12:00')).toBe('12:00 PM');
  });

  it('returns empty for missing or unusable input rather than "Invalid Date"', () => {
    expect(formatPrescriptionDate('')).toBe('');
    expect(formatPrescriptionDate('not-a-date')).toBe('');
    expect(formatPrescriptionTime('')).toBe('');
  });

  it('passes through a time it cannot parse instead of blanking it', () => {
    expect(formatPrescriptionTime('morning')).toBe('morning');
  });
});
