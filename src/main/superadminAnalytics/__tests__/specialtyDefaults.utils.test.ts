// Which prescription defaults the Speciality Defaults page says each main speciality gets.
import { GENERIC_DOCTOR_PREFERENCES } from '../../../utils/doctorSpecialtyConfig';
import { findSpecialtyGroup } from '../../../utils/specialtyCatalog';
import {
  listSpecialtyDefaults,
  toSpecialtyDefaults,
} from '../utils/specialtyDefaults.utils';

const forMain = (main: string) =>
  toSpecialtyDefaults(findSpecialtyGroup(main)!);

describe('toSpecialtyDefaults', () => {
  it('uses the speciality’s own defaults when it has them', () => {
    const cardio = forMain('Cardiologist');
    expect(cardio.source).toBe('own');
    expect(cardio.borrowableFrom).toEqual([]);
    expect(cardio.defaults.diagnosisList).toContain('CAD');
  });

  it('falls back to generic and names the sub-specialties a doctor can borrow from', () => {
    // Every catalog main has its own lists now, so the fallback is shown with a made-up one.
    const other = toSpecialtyDefaults({
      mainSpecialty: 'Not A Specialty',
      specialties: ['Dentist'],
      alsoPractises: [],
    });
    expect(other.source).toBe('generic');
    expect(other.borrowableFrom).toContain('Dentist');
    expect(other.defaults.habitList).toEqual(
      GENERIC_DOCTOR_PREFERENCES.habitList
    );
  });

  it('gives every catalog main its own defaults', () => {
    expect(listSpecialtyDefaults().every((s) => s.source === 'own')).toBe(true);
  });

  it('covers every main speciality and leaks no own-entry lists', () => {
    const all = listSpecialtyDefaults();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => !('customLists' in s.defaults))).toBe(true);
  });
});
