import {
  isValidSpecialty,
  resolvePreferenceLists,
} from '../../../utils/doctorSpecialtyConfig';
import {
  SPECIALTY_CATALOG,
  type SpecialtyGroup,
} from '../../../utils/specialtyCatalog';
import type { SpecialtyDefaults } from '../types/specialtyDefaults.types';

/** What a new doctor of this main speciality starts with, before any own entries. */
export function toSpecialtyDefaults(group: SpecialtyGroup): SpecialtyDefaults {
  const hasOwn = isValidSpecialty(group.mainSpecialty);
  // Same order configSpecialty() tries a doctor's picks in, so the hint matches what they get.
  const borrowableFrom = hasOwn
    ? []
    : [...group.specialties, ...group.alsoPractises].filter(isValidSpecialty);
  const { customLists: _own, ...defaults } = resolvePreferenceLists(
    group.mainSpecialty
  );
  return {
    mainSpecialty: group.mainSpecialty,
    specialties: group.specialties,
    alsoPractises: group.alsoPractises,
    source: hasOwn ? 'own' : 'generic',
    borrowableFrom,
    defaults,
  };
}

export const listSpecialtyDefaults = () =>
  SPECIALTY_CATALOG.map(toSpecialtyDefaults);
