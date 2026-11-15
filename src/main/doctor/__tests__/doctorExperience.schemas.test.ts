import {
  doctorExperienceSchema,
  doctorExperiencesSchema,
  MAX_DOCTOR_EXPERIENCES,
} from '../schemas/doctor.schemas';
import { languagesSpokenSchema } from '../../../utils/indianLanguages';

const base = {
  organisation: 'Apollo Hospitals',
  role: 'Consultant',
  startMonth: 6,
  startYear: 2016,
};

describe('doctor experience and languages schemas', () => {
  it('accepts a current role without an end date', () => {
    expect(
      doctorExperienceSchema.safeParse({ ...base, isCurrent: true }).success
    ).toBe(true);
  });

  it('needs an end date for a past role, after the start', () => {
    expect(doctorExperienceSchema.safeParse(base).success).toBe(false);
    expect(
      doctorExperienceSchema.safeParse({ ...base, endMonth: 5, endYear: 2016 })
        .success
    ).toBe(false);
    expect(
      doctorExperienceSchema.safeParse({ ...base, endMonth: 3, endYear: 2021 })
        .success
    ).toBe(true);
  });

  it('caps the list', () => {
    const rows = Array.from({ length: MAX_DOCTOR_EXPERIENCES + 1 }, () => ({
      ...base,
      isCurrent: true,
    }));
    expect(doctorExperiencesSchema.safeParse(rows).success).toBe(false);
  });

  it('keeps listed language codes, drops duplicates, rejects others and more than 8', () => {
    expect(languagesSpokenSchema.parse(['en', 'hi', 'en'])).toEqual([
      'en',
      'hi',
    ]);
    expect(languagesSpokenSchema.safeParse(['Hindi']).success).toBe(false);
    expect(
      languagesSpokenSchema.safeParse([
        'en',
        'hi',
        'ta',
        'te',
        'ur',
        'or',
        'brx',
        'doi',
        'ne',
      ]).success
    ).toBe(false);
  });
});
