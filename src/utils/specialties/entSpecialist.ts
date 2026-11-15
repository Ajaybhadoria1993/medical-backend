import type { ExamTable } from './examTables';

const SIDES = [
  { key: 'right', label: 'Right ear' },
  { key: 'left', label: 'Left ear' },
] as const;
const FREQ = (key: string, label: string) =>
  ({
    key,
    label,
    type: 'number',
    hint: 'e.g. 20',
    min: -10,
    max: 120,
  }) as const;

// Values need an ENT surgeon's check (ent-specialist.md §4).
const entExamTables: readonly ExamTable[] = [
  {
    id: 'ear',
    title: 'Ear Exam',
    rows: SIDES,
    columns: [
      {
        key: 'canal',
        label: 'Ear canal',
        type: 'select',
        options: ['Clear', 'Wax', 'Discharge', 'Swelling', 'Foreign body'],
      },
      {
        key: 'drum',
        label: 'Ear drum',
        type: 'select',
        options: ['Intact', 'Perforated', 'Retracted', 'Bulging', 'Dull'],
      },
      {
        key: 'rinne',
        label: 'Rinne (512 Hz)',
        type: 'select',
        options: ['+', '−'],
      },
      {
        key: 'tympanogram',
        label: 'Tympanogram',
        type: 'select',
        options: ['A', 'As', 'Ad', 'B', 'C'],
      },
    ],
    singles: [
      {
        key: 'weber',
        label: 'Weber',
        type: 'select',
        options: ['Centre', 'Right', 'Left'],
      },
    ],
  },
  {
    id: 'hearing',
    title: 'Hearing',
    rows: SIDES,
    columns: [
      FREQ('f500', '500 Hz'),
      FREQ('f1000', '1k Hz'),
      FREQ('f2000', '2k Hz'),
      FREQ('f4000', '4k Hz'),
      {
        key: 'pta',
        label: 'PTA (dB)',
        type: 'number',
        auto: { kind: 'average', from: ['f500', 'f1000', 'f2000', 'f4000'] },
      },
      {
        key: 'grade',
        label: 'Grade',
        type: 'text',
        auto: { kind: 'whoHearingGrade', from: 'pta' },
      },
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        options: ['None', 'Conductive', 'Sensorineural', 'Mixed'],
      },
    ],
  },
  {
    id: 'nt',
    title: 'Nose & Throat',
    rows: [],
    columns: [],
    singles: [
      {
        key: 'septum',
        label: 'Septum',
        type: 'select',
        options: ['Straight', 'Deviated right', 'Deviated left'],
      },
      {
        key: 'turbinates',
        label: 'Turbinates',
        type: 'select',
        options: ['Normal', 'Enlarged', 'Pale'],
      },
      {
        key: 'polyps',
        label: 'Polyps',
        type: 'select',
        options: ['No', 'Right', 'Left', 'Both'],
      },
      {
        key: 'tonsils',
        label: 'Tonsils (Brodsky)',
        type: 'select',
        options: ['0', '1', '2', '3', '4'],
        hint: '0 in fossa · 1 ≤ 25% · 2 26–50% · 3 51–75% · 4 > 75%',
      },
      {
        key: 'throat',
        label: 'Throat note',
        type: 'text',
        hint: 'e.g. Congested pharynx',
      },
    ],
  },
];

export const entSpecialist = {
  // Shown first in Add Test; names match the global test list.
  common_tests: [
    'Pure Tone Audiometry',
    'Tympanometry',
    'BERA',
    'CT PNS',
    'CBC',
  ],
  exam_tables: entExamTables,
  header_order: [
    'Pre-Diagnosis',
    'Allergy',
    'Habits',
    'Vitals',
    'Pathology Test Name',
    'Diagnosis',
    'Advice',
    'Dietary Suggestions',
    'Visiting Days',
    'Follow-Up (days)',
    'Surgery Suggested',
  ],
  habit_list: [
    'Smoking',
    'Cold food intake',
    'Poor hygiene',
    'Allergen exposure',
    'Loud noise exposure',
  ],
  allergy_list: ['Dust', 'Pollen', 'Cold air', 'Food allergy', 'Smoke'],
  diagnosis_list: [
    'Chronic sinusitis',
    'Acute sinusitis',
    'Otitis media',
    'Allergic rhinitis',
    'Chronic tonsillitis',
    'Chronic pharyngitis',
    'Ear wax',
    'Deviated nasal septum',
    'Vertigo (BPPV)',
    'CSOM',
    'Nasal polyps',
    'Epistaxis',
    'Sensorineural hearing loss',
    'Laryngitis',
    'Adenoid hypertrophy',
    'Foreign body',
  ],
  pre_diagnosis_list: [
    'Sore throat',
    'Ear pain',
    'Blocked nose',
    'Hearing loss',
    'Ear discharge',
    'Tinnitus',
    'Nose bleed',
    'Hoarseness',
  ],
  surgery_suggested_list: [
    'Tonsillectomy',
    'Septoplasty',
    'Ear surgery',
    'Sinus surgery',
  ],
  advice_suggestions_list: [
    'Do warm saline gargles twice daily.',
    'Use steam inhalation as advised.',
    'Avoid cold drinks and cold exposure.',
    'Do not insert cotton buds into the ears.',
    'Avoid loud noise exposure.',
    'Keep water out of the ear.',
    'Do not blow the nose hard.',
    'Sleep with the head raised.',
  ],
  dietary_suggestions_list: [
    'Drink warm fluids like herbal tea.',
    'Avoid cold and refrigerated foods.',
    'Include honey to soothe the throat.',
    'Eat soft foods during infections.',
    'Stay hydrated with boiled water.',
  ],
  booking_symptoms: [
    'Earache or ear discharge',
    'Hearing loss',
    'Nasal congestion/Runny nose',
    'Sore throat',
    'Difficulty swallowing',
    'Hoarseness or voice changes',
    'Sinus pain/Pressure',
    'Ringing in ears (tinnitus)',
    'Snoring and sleep apnea',
    'Dizziness or vertigo',
  ],
} as const;
