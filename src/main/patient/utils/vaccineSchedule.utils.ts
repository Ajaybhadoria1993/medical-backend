import type { CHILD_VACCINES } from '../../../utils/specialties/vaccines';

type Age = { weeks?: number; months?: number; years?: number };

// IAP 2023, simplified: the age each dose falls due. Values need a pediatrician's check (pediatrician.md §9).
const SCHEDULE: Partial<Record<(typeof CHILD_VACCINES)[number], Age[]>> = {
  BCG: [{ weeks: 0 }],
  OPV: [{ weeks: 0 }],
  'Hep B': [{ weeks: 0 }, { weeks: 6 }, { weeks: 10 }, { weeks: 14 }],
  'DTwP / DTaP': [
    { weeks: 6 },
    { weeks: 10 },
    { weeks: 14 },
    { months: 16 },
    { years: 5 },
  ],
  Hib: [{ weeks: 6 }, { weeks: 10 }, { weeks: 14 }, { months: 16 }],
  IPV: [{ weeks: 6 }, { weeks: 10 }, { weeks: 14 }, { months: 16 }],
  PCV: [{ weeks: 6 }, { weeks: 10 }, { weeks: 14 }, { months: 15 }],
  Rotavirus: [{ weeks: 6 }, { weeks: 10 }, { weeks: 14 }],
  Influenza: [{ months: 6 }, { months: 7 }],
  MMR: [{ months: 9 }, { months: 15 }, { years: 5 }],
  'Typhoid conjugate': [{ months: 9 }],
  'Hep A': [{ months: 12 }, { months: 18 }],
  Varicella: [{ months: 15 }, { months: 18 }],
  Tdap: [{ years: 10 }],
  HPV: [{ years: 9 }, { years: 9, months: 6 }],
};

// Doses further ahead than this stay off the list, so a newborn doesn't see HPV.
const LOOK_AHEAD_DAYS = 60;
const DAY = 86_400_000;

const addAge = (dob: string, age: Age) => {
  const d = new Date(`${dob}T00:00:00Z`);
  d.setUTCFullYear(
    d.getUTCFullYear() + (age.years ?? 0),
    d.getUTCMonth() + (age.months ?? 0)
  );
  return new Date(d.getTime() + (age.weeks ?? 0) * 7 * DAY)
    .toISOString()
    .slice(0, 10);
};

// Profiles store dob as free text: YYYY-MM-DD (maybe with a time) or DD-MM-YYYY / DD/MM/YYYY.
const toYmd = (raw: string | null | undefined) => {
  const iso = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = raw?.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  const ymd = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]}-${dmy[1]}`
      : null;
  return ymd && !Number.isNaN(Date.parse(`${ymd}T00:00:00Z`)) ? ymd : null;
};

export type DueVaccine = {
  vaccine: string;
  doseNo: number;
  dueOn: string;
  overdue: boolean;
};

/**
 * The next dose of each schedule vaccine, given the doses already recorded; children with a date of birth only.
 * Returns null when it can't be worked out (adult, or no date of birth).
 */
export function dueVaccines(
  rawDob: string | null | undefined,
  given: Record<string, number>,
  today: string
): DueVaccine[] | null {
  const dob = toYmd(rawDob);
  if (!dob) return null;
  if (addAge(dob, { years: 18 }) <= today) return null;
  const horizon = new Date(
    Date.parse(`${today}T00:00:00Z`) + LOOK_AHEAD_DAYS * DAY
  )
    .toISOString()
    .slice(0, 10);
  return Object.entries(SCHEDULE)
    .flatMap(([vaccine, ages]) => {
      const doseNo = (given[vaccine] ?? 0) + 1;
      const age = ages[doseNo - 1];
      if (!age) return [];
      const dueOn = addAge(dob, age);
      return dueOn <= horizon
        ? [{ vaccine, doseNo, dueOn, overdue: dueOn < today }]
        : [];
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}
