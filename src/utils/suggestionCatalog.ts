import {
  DOCTOR_SPECIALTY_CONFIG,
  GENERIC_DOCTOR_PREFERENCES,
  type SuggestionListKey,
} from './doctorSpecialtyConfig';

export const SUGGESTION_SECTIONS = [
  'habit',
  'allergy',
  'diagnosis',
  'preDiagnosis',
  'surgery',
  'advice',
  'dietary',
] as const;
export type SuggestionSection = (typeof SUGGESTION_SECTIONS)[number];

const SECTION_KEYS: Record<
  SuggestionSection,
  { list: SuggestionListKey; config: string }
> = {
  habit: { list: 'habitList', config: 'habit_list' },
  allergy: { list: 'allergyList', config: 'allergy_list' },
  diagnosis: { list: 'diagnosisList', config: 'diagnosis_list' },
  preDiagnosis: { list: 'preDiagnosisList', config: 'pre_diagnosis_list' },
  surgery: { list: 'surgerySuggestedList', config: 'surgery_suggested_list' },
  advice: { list: 'adviceSuggestionsList', config: 'advice_suggestions_list' },
  dietary: {
    list: 'dietarySuggestionsList',
    config: 'dietary_suggestions_list',
  },
};

const SUGGESTION_SEARCH_LIMIT = 25;
const GENERAL = 'General';

type Entry = { label: string; key: string; specialties: string[] };

/** One entry per label per section; a label shared by several specialties lists them all. */
const CATALOG = Object.fromEntries(
  SUGGESTION_SECTIONS.map((section) => {
    const { list, config } = SECTION_KEYS[section];
    const byKey = new Map<string, Entry>();
    const add = (label: string, specialty: string) => {
      const key = label.trim().toLowerCase();
      const entry = byKey.get(key);
      if (entry) {
        if (!entry.specialties.includes(specialty))
          entry.specialties.push(specialty);
      } else
        byKey.set(key, { label: label.trim(), key, specialties: [specialty] });
    };
    for (const [specialty, cfg] of Object.entries(DOCTOR_SPECIALTY_CONFIG)) {
      const values = (cfg as Record<string, unknown>)[config];
      if (Array.isArray(values))
        values.forEach((v) => add(String(v), specialty));
    }
    GENERIC_DOCTOR_PREFERENCES[list].forEach((v) => add(v, GENERAL));
    return [section, [...byKey.values()]];
  })
) as Record<SuggestionSection, Entry[]>;

// Lower is better: exact → starts with → a word starts with → contains.
const matchTier = (key: string, q: string) => {
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(` ${q}`)) return 2;
  return key.includes(q) ? 3 : -1;
};

/** One section's suggestions containing `q`, limited to `specialty` when given.
 *  Without `q` a specialty's whole list comes back A–Z; without either, nothing. */
export function searchSuggestions(
  section: SuggestionSection,
  q: string,
  specialty?: string
) {
  const query = q.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!specialty && query.length < 2) return [];

  const rows = CATALOG[section]
    .filter((e) => !specialty || e.specialties.includes(specialty))
    .map((e) => ({ e, tier: matchTier(e.key, query) }))
    .filter(({ tier }) => tier >= 0)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (query ? a.e.label.length - b.e.label.length : 0) ||
        a.e.label.localeCompare(b.e.label)
    );

  return (query ? rows.slice(0, SUGGESTION_SEARCH_LIMIT) : rows).map(
    ({ e }) => ({ label: e.label, specialties: e.specialties })
  );
}
