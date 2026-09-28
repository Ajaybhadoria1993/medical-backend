import { ReportService } from '../services/report.service';

const { resolvePatientAge } = ReportService;

/** A dob string for someone who turned `years` old yesterday. */
const dobAged = (years: number): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('ReportService.resolvePatientAge', () => {
  it('prefers a stored age when present', () => {
    expect(resolvePatientAge(36, '1990-01-01')).toBe('36');
    expect(resolvePatientAge('42', null)).toBe('42');
  });

  it('derives the age from dob when no age is stored', () => {
    // The real bug: profile.age is null, so the prescription printed "Y / Male".
    expect(resolvePatientAge(null, dobAged(36))).toBe('36');
    expect(resolvePatientAge(undefined, dobAged(1))).toBe('1');
  });

  it('has not counted a birthday that is still to come this year', () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 30);
    d.setDate(d.getDate() + 10);

    expect(resolvePatientAge(null, d.toISOString().slice(0, 10))).toBe('29');
  });

  it('returns empty when neither is usable, so the template hides the field', () => {
    expect(resolvePatientAge(null, null)).toBe('');
    expect(resolvePatientAge(undefined, undefined)).toBe('');
    expect(resolvePatientAge(null, 'not-a-date')).toBe('');
    expect(resolvePatientAge('', '')).toBe('');
  });

  it('rejects a future or absurd date of birth rather than printing nonsense', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);

    expect(resolvePatientAge(null, future.toISOString().slice(0, 10))).toBe('');
    expect(resolvePatientAge(null, '1500-01-01')).toBe('');
  });

  it('keeps a legitimately recorded age of 0', () => {
    expect(resolvePatientAge(0, null)).toBe('0');
  });
});
