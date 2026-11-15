import { z } from 'zod';
import {
  checkSpecializationLimits,
  specialitySchema,
  specializationSchema,
  splitSpecializations,
} from '../specialtyCatalog';
import { configSpecialty } from '../doctorSpecialtyConfig';

const profile = z
  .object({
    speciality: specialitySchema.optional(),
    specialization: specializationSchema.optional(),
  })
  .superRefine((data, ctx) => checkSpecializationLimits(data, ctx));

describe('specialtyCatalog', () => {
  it('saves a main speciality in catalog spelling and rejects other names', () => {
    expect(specialitySchema.parse(' cardiologist ')).toBe('Cardiologist');
    expect(specialitySchema.parse('')).toBe('');
    expect(specialitySchema.safeParse('Neonatologist').success).toBe(false);
  });

  it('canonicalises catalog names, keeps custom ones, drops duplicates', () => {
    expect(
      specializationSchema.parse([
        'allergist',
        'voice  care',
        'Allergist',
        'HIV care',
      ])
    ).toEqual(['Allergist', 'Voice Care', 'HIV Care']);
  });

  it('splits by the main speciality; custom entries are sub-specialties', () => {
    expect(
      splitSpecializations('ENT Specialist', [
        'ENT Specialist',
        'ENT Surgeon',
        'Allergist',
        'Voice care',
      ])
    ).toEqual({
      subSpecialties: ['ENT Surgeon', 'Voice care'],
      alsoPractises: ['Allergist'],
    });
  });

  it('caps each group at 5 when the main speciality is known', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(
      profile.safeParse({ speciality: 'Dentist', specialization: six }).success
    ).toBe(false);
    expect(profile.safeParse({ specialization: six }).success).toBe(true);
  });

  it('falls back to a specialization for prescription defaults', () => {
    expect(configSpecialty('Custom Specialty', ['Cardiologist'])).toBe(
      'Cardiologist'
    );
    expect(configSpecialty('Endocrinologist', ['Cardiologist'])).toBe(
      'Endocrinologist'
    );
    expect(configSpecialty('Custom Specialty', ['Other'])).toBe(
      'Custom Specialty'
    );
  });
});
