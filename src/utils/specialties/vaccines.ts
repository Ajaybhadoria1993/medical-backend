// Vaccine names a visit can record; IAP schedule for children (pediatrician.md §3a). Values need a doctor's check.
export const CHILD_VACCINES = [
  'BCG',
  'OPV',
  'Hep B',
  'DTwP / DTaP',
  'Hib',
  'IPV',
  'PCV',
  'Rotavirus',
  'Influenza',
  'MMR',
  'Typhoid conjugate',
  'Varicella',
  'Hep A',
  'Tdap',
  'HPV',
  'Meningococcal',
  'JE',
] as const;

export const ADULT_VACCINES = [
  'Influenza',
  'Pneumococcal (PCV / PPSV23)',
  'Hep B',
  'Tdap',
  'Td',
  'HPV',
  'Typhoid conjugate',
  'Varicella',
  'Zoster',
  'COVID-19',
  'Rabies',
] as const;

export const PREGNANCY_VACCINES = ['TT / Td', 'Tdap', 'Influenza'] as const;

/** Every name the patient vaccine record accepts. */
export const ALL_VACCINES: readonly string[] = [
  ...new Set<string>([
    ...CHILD_VACCINES,
    ...ADULT_VACCINES,
    ...PREGNANCY_VACCINES,
  ]),
];
