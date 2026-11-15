import { isDeepStrictEqual } from 'util';
import { DOCTOR_SPECIALTY_CONFIG } from './specialties';
import { SPECIALTY_CATALOG } from './specialtyCatalog';
import type { ExamTable } from './specialties/examTables';

export { DOCTOR_SPECIALTY_CONFIG };

export type DoctorSpecialty = keyof typeof DOCTOR_SPECIALTY_CONFIG;

// Type guard to check if a string is a valid specialty
export function isValidSpecialty(
  specialty: string
): specialty is DoctorSpecialty {
  return specialty in DOCTOR_SPECIALTY_CONFIG;
}

/** The main speciality if it has a config, else the first specialization that does. */
export function configSpecialty(
  speciality: string | null | undefined,
  specialization: string[] | null | undefined
) {
  return (
    [speciality, ...(specialization ?? [])].find(
      (s): s is DoctorSpecialty => !!s && isValidSpecialty(s)
    ) ?? speciality
  );
}

type PreferenceListKey =
  | 'headerOrder'
  | 'habitList'
  | 'allergyList'
  | 'diagnosisList'
  | 'preDiagnosisList'
  | 'surgerySuggestedList'
  | 'adviceSuggestionsList'
  | 'dietarySuggestionsList';

export type DoctorPreferenceLists = Record<PreferenceListKey, string[]>;

/** Specialty charts (diagrams) the prescription offers; not part of the section order. */
export type SpecialtySection = 'Dental Chart' | 'Reproductive Chart';
const CHARTS: readonly SpecialtySection[] = [
  'Dental Chart',
  'Reproductive Chart',
];

type ToolConfig = {
  sections?: readonly SpecialtySection[];
  exam_tables?: readonly ExamTable[];
};

/** A Clinical details tab id: a chart name, or `exam:<table id>` (table ids are unique across specialties). */
const examToolId = (table: ExamTable) => `exam:${table.id}`;

const EXAM_TABLE_BY_TOOL = new Map<string, ExamTable>(
  Object.values(DOCTOR_SPECIALTY_CONFIG).flatMap((cfg) =>
    ((cfg as ToolConfig).exam_tables ?? []).map(
      (t) => [examToolId(t), t] as const
    )
  )
);

/** Known tool ids only, first occurrence kept, so a stale or forged id never reaches the drawer. */
export const toKnownTools = (ids: readonly string[]) =>
  [...new Set(ids)].filter(
    (id) =>
      CHARTS.includes(id as SpecialtySection) || EXAM_TABLE_BY_TOOL.has(id)
  );

/** Every specialty's charts and exam tables, for the "add from another specialty" picker. */
export const SPECIALTY_TOOLS_RESPONSE = Object.entries(DOCTOR_SPECIALTY_CONFIG)
  .map(([specialty, cfg]) => {
    const { sections = [], exam_tables = [] } = cfg as ToolConfig;
    return {
      specialty,
      tools: [
        ...sections.map((s) => ({ id: s, title: s })),
        ...exam_tables.map((t) => ({ id: examToolId(t), title: t.title })),
      ],
    };
  })
  .filter((group) => group.tools.length > 0);

/** Lists for a doctor with no specialty config; mirrors the `doctor_preferences` column defaults. */
export const GENERIC_DOCTOR_PREFERENCES: DoctorPreferenceLists = {
  headerOrder: [
    'Pathology Test Name',
    'Advice',
    'Pre-Diagnosis',
    'Dietary Suggestions',
    'Habits',
    'Vitals',
    'Allergy',
    'Diagnosis',
    'Surgery Suggested',
    'Visiting Days',
    'Follow-Up (days)',
  ],
  habitList: ['Alcohol', 'Smoking', 'Tobacco'],
  allergyList: [
    'Codeine',
    'Contrast dye',
    'Dust',
    'Eggs',
    'Latex',
    'NKDA',
    'NSAIDs',
    'Peanuts/Nuts',
    'Penicillin',
    'Pollen',
    'Shellfish',
    'Sulfa drugs',
  ],
  diagnosisList: [
    'Acidity',
    'Allergy',
    'Body pain',
    'Cold/Cough',
    'Dengue',
    'Diarrhea',
    'Fever',
    'Flu',
    'Headache',
    'High BP',
    'Low BP',
    'Infection',
    'Malaria',
    'Migraine',
    'Stomach pain',
    'Diabetes',
    'Typhoid',
    'UTI',
    'Viral fever',
  ],
  // Complaint chips, kept apart from diagnosis; no specialty gets the GP ones.
  preDiagnosisList: [
    ...DOCTOR_SPECIALTY_CONFIG['General Physician'].pre_diagnosis_list,
  ],
  surgerySuggestedList: [
    'Appendectomy',
    'Hernia repair',
    'Cataract surgery',
    'Tonsillectomy',
    'Cholecystectomy',
    'Knee arthroscopy',
  ],
  adviceSuggestionsList: [
    'Take medicines as prescribed.',
    'Take adequate rest.',
    'Maintain proper hydration.',
    'Avoid self-medication.',
    'Complete the full course of antibiotics.',
    'Do light exercise daily.',
    'Maintain personal hygiene.',
    'Monitor temperature twice a day.',
    'Avoid smoking and alcohol.',
    'Follow up if symptoms persist.',
  ],
  dietarySuggestionsList: [
    'Drink boiled water.',
    'Eat small, frequent meals.',
    'Avoid spicy and oily foods.',
    'Include fruits and vegetables.',
    'Stay hydrated throughout the day.',
    'Limit caffeine and alcohol.',
    'Reduce salt and sugar intake.',
    'Include protein-rich foods.',
    'Avoid processed and junk foods.',
    'Maintain a balanced diet.',
  ],
};

export type SuggestionListKey = Exclude<PreferenceListKey, 'headerOrder'>;

/** Most entries a doctor may add to one suggestion list; defaults don't count. */
export const MAX_OWN_SUGGESTIONS = 50;

/** Old web-app diagnosis defaults, saved wholesale into rows until 2026-09-16. */
const LEGACY_WEB_DIAGNOSIS_LIST = [
  ...GENERIC_DOCTOR_PREFERENCES.diagnosisList,
  'Dog bite',
  'Heart failure',
  'Laser',
  'Malnutrition',
  'Pregnancy care',
  'Prostate cancer',
  'Sinusitis',
  'Tooth decay',
];

const lower = (list: string[]) => new Set(list.map((x) => x.toLowerCase()));

/** The doctor's own entries: saved minus the defaults, and minus any default list saved in full. */
function ownEntries(
  key: SuggestionListKey,
  saved: unknown,
  defaults: string[]
) {
  if (!Array.isArray(saved)) return [];
  let values = saved.map((x) => String(x ?? '').trim()).filter(Boolean);
  // Legacy first: it contains the generic list, so stripping generic first would hide it.
  const junk = [GENERIC_DOCTOR_PREFERENCES[key]];
  if (key === 'diagnosisList') junk.unshift(LEGACY_WEB_DIAGNOSIS_LIST);
  for (const list of junk) {
    const saved = lower(values);
    // ponytail: a doctor who deliberately adds every generic entry loses them; add a "customised" flag if that matters.
    if (list.every((x) => saved.has(x.toLowerCase()))) {
      const drop = lower(list);
      values = values.filter((x) => !drop.has(x.toLowerCase()));
    }
  }
  const drop = lower(defaults);
  const seen = new Set<string>();
  return values.filter((x) => {
    const k = x.toLowerCase();
    if (drop.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Suggestion lists are the doctor's own entries plus the defaults they haven't hidden.
 * `customLists` holds only the own entries; `defaultLists` the built-ins before hiding. */
export function resolvePreferenceLists(
  specialty: string | null | undefined,
  saved?:
    | (Partial<Record<PreferenceListKey, unknown>> & {
        hiddenOptions?: unknown;
        specialtyTools?: unknown;
      })
    | null
): DoctorPreferenceLists & {
  customLists: Record<SuggestionListKey, string[]>;
  defaultLists: Record<SuggestionListKey, string[]>;
  /** The doctor's Clinical details tabs in order; their specialty's own until they choose. */
  specialtyTools: string[];
  sections: SpecialtySection[];
  /** False for specialties that never prescribe (physio, psychology…); the screen hides medicines. */
  prescribesMedicines: boolean;
  /** The specialty's exam tables, filled in the Clinical details drawer. */
  examTables: readonly ExamTable[];
  /** Test names shown first in Add Test ("Common for your specialty"). */
  commonTests: string[];
} {
  const config =
    specialty && isValidSpecialty(specialty)
      ? DOCTOR_SPECIALTY_CONFIG[specialty]
      : null;

  const defaults: DoctorPreferenceLists = config
    ? {
        headerOrder: [...config.header_order],
        habitList: [...config.habit_list],
        allergyList: [...config.allergy_list],
        diagnosisList: [...config.diagnosis_list],
        preDiagnosisList: [...config.pre_diagnosis_list],
        surgerySuggestedList: [...config.surgery_suggested_list],
        adviceSuggestionsList: [...config.advice_suggestions_list],
        dietarySuggestionsList: [...config.dietary_suggestions_list],
      }
    : GENERIC_DOCTOR_PREFERENCES;

  // Header order is a layout, not a list to merge: a changed one replaces the specialty's.
  const savedOrder = saved?.headerOrder;
  const headerOrder =
    Array.isArray(savedOrder) &&
    !isDeepStrictEqual(savedOrder, GENERIC_DOCTOR_PREFERENCES.headerOrder)
      ? (savedOrder as string[])
      : defaults.headerOrder;

  const toolConfig = (config ?? {}) as ToolConfig;
  const savedTools = Array.isArray(saved?.specialtyTools)
    ? toKnownTools(saved.specialtyTools.map(String))
    : null;
  const specialtyTools = savedTools ?? [
    ...(toolConfig.sections ?? []),
    ...(toolConfig.exam_tables ?? []).map(examToolId),
  ];
  const sections = specialtyTools.filter((id): id is SpecialtySection =>
    CHARTS.includes(id as SpecialtySection)
  );

  const keys = (
    Object.keys(GENERIC_DOCTOR_PREFERENCES) as PreferenceListKey[]
  ).filter((key): key is SuggestionListKey => key !== 'headerOrder');

  const customLists = Object.fromEntries(
    keys.map((key) => [key, ownEntries(key, saved?.[key], defaults[key])])
  ) as Record<SuggestionListKey, string[]>;

  const hidden = (saved?.hiddenOptions ?? {}) as Partial<
    Record<SuggestionListKey, unknown>
  >;
  const lists = Object.fromEntries(
    keys.map((key) => {
      const off = lower(
        Array.isArray(hidden[key]) ? hidden[key].map(String) : []
      );
      const shown = defaults[key].filter((x) => !off.has(x.toLowerCase()));
      return [key, [...customLists[key], ...shown]];
    })
  ) as Record<SuggestionListKey, string[]>;

  const defaultLists = Object.fromEntries(
    keys.map((key) => [key, [...defaults[key]]])
  ) as Record<SuggestionListKey, string[]>;

  const prescribesMedicines = !(
    config &&
    'prescribes_medicines' in config &&
    config.prescribes_medicines === false
  );

  const examTables = specialtyTools.flatMap((id) => {
    const table = EXAM_TABLE_BY_TOOL.get(id);
    return table ? [table] : [];
  });

  const commonTests: string[] =
    config && 'common_tests' in config ? [...config.common_tests] : [];

  return {
    headerOrder,
    ...lists,
    customLists,
    defaultLists,
    specialtyTools,
    sections,
    prescribesMedicines,
    examTables,
    commonTests,
  };
}

/** The catalog as served to the app: each main speciality plus the symptoms offered when booking it. */
export const SPECIALTY_CATALOG_RESPONSE = SPECIALTY_CATALOG.map((group) => {
  const config = isValidSpecialty(group.mainSpecialty)
    ? DOCTOR_SPECIALTY_CONFIG[group.mainSpecialty]
    : null;
  const symptoms: readonly string[] =
    config && 'booking_symptoms' in config ? config.booking_symptoms : [];
  return { ...group, symptoms };
});
