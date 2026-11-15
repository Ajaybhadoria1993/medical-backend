import type { ExamTable } from './examTables';

const EYES = [
  { key: 're', label: 'RE' },
  { key: 'le', label: 'LE' },
] as const;
const VA = (key: string, label: string, hint: string) =>
  ({ key, label, type: 'text', hint }) as const;
// Vision: 6/9, 3/60, N6 (a trailing p = partial), CF, HM, PL, NPL, NIPH; anything else is refused.
const VISION = (key: string, label: string, hint: string) =>
  ({ ...VA(key, label, hint), check: 'vision' }) as const;
// Lens power in 0.25 steps; "−" or "+" sign, Plano for zero.
const DIOPTER = (
  key: string,
  label: string,
  hint: string,
  min: number,
  max: number
) => ({ ...VA(key, label, hint), check: 'diopter', min, max }) as const;
const REFRACTION = [
  DIOPTER('sph', 'SPH', 'e.g. −1.5', -30, 30),
  DIOPTER('cyl', 'CYL', 'e.g. −0.5', -10, 10),
  {
    key: 'axis',
    label: 'AXIS',
    type: 'number',
    hint: 'e.g. 90',
    min: 0,
    max: 180,
  },
] as const;

// Values need an ophthalmologist's check (ophthalmologist.md §4).
const eyeExamTables: readonly ExamTable[] = [
  {
    id: 'va',
    title: 'Visual Acuity',
    rows: EYES,
    columns: [
      VISION('ucdva', 'UCDVA', 'e.g. 6/6'),
      VISION('ucnva', 'UCNVA', 'e.g. N6'),
      VISION('pinhole', 'Pinhole', 'e.g. 6/6, NIPH'),
      VISION('bcdva', 'BCDVA', 'e.g. 6/6'),
      VISION('bcnva', 'BCNVA', 'e.g. N6'),
    ],
  },
  {
    id: 'subj',
    title: 'Subjective Refraction',
    rows: [
      { key: 're_u', label: 'RE (undilated)' },
      { key: 'le_u', label: 'LE (undilated)' },
      { key: 're_d', label: 'RE (dilated)' },
      { key: 'le_d', label: 'LE (dilated)' },
    ],
    // The glasses Rx prints the undilated reading; dilated prints only when it is all there is.
    fallbackRows: ['re_d', 'le_d'],
    columns: [
      ...REFRACTION,
      DIOPTER('add', 'ADD', 'e.g. +1.5', 0, 4),
      VISION('dva', 'DVA', 'e.g. 6/6'),
      VISION('nva', 'NVA', 'e.g. N6'),
    ],
  },
  { id: 'auto', title: 'Auto Refraction', rows: EYES, columns: REFRACTION },
  {
    id: 'eye',
    title: 'Eye Exam',
    rows: EYES,
    columns: [
      {
        key: 'iop',
        label: 'IOP (mmHg)',
        type: 'number',
        hint: 'e.g. 16',
        min: 5,
        max: 60,
      },
      VA('anterior', 'Anterior segment', 'e.g. Clear'),
      VA('fundus', 'Fundus', 'e.g. Normal'),
    ],
  },
];

export const ophthalmologist = {
  // Shown first in Add Test; names match the global test list.
  common_tests: [
    'OCT',
    'Perimetry (Visual Field)',
    'Fundus Photography',
    'A-Scan Biometry',
    'B-Scan Ultrasound',
    'Corneal Topography',
    'Random Blood Sugar',
  ],
  exam_tables: eyeExamTables,
  header_order: [
    'Pre-Diagnosis',
    'Diagnosis',
    'Surgery Suggested',
    'Advice',
    'Follow-Up (days)',
    'Visiting Days',
    'Allergy',
    'Vitals',
    'Pathology Test Name',
    'Dietary Suggestions',
    'Habits',
  ],
  habit_list: [
    'Excess screen time',
    'Poor lighting',
    'Lack of eye care',
    'Reading strain',
    'Sleep deprivation',
  ],
  allergy_list: ['Eye drops allergy', 'Dust', 'Pollen', 'Chemical exposure'],
  diagnosis_list: [
    'Cataract',
    'Conjunctivitis',
    'Myopia',
    'Presbyopia',
    'Glaucoma',
    'Diabetic retinopathy',
    'Macular degeneration',
    'Strabismus',
  ],
  pre_diagnosis_list: [
    'Blurred vision',
    'Red eye',
    'Eye pain',
    'Watering eyes',
    'Eye strain',
    'Decreased vision',
    'Floaters',
    'Double vision',
  ],
  surgery_suggested_list: [
    'LASIK',
    'Cataract surgery',
    'Retinal surgery',
    'Corneal transplant',
  ],
  advice_suggestions_list: [
    'Instil eye drops exactly as prescribed.',
    'Avoid rubbing the eyes.',
    'Use protective sunglasses outdoors.',
    'Take a screen break every 20 minutes.',
    'Report sudden vision loss, pain, or redness immediately.',
  ],
  dietary_suggestions_list: [
    'Eat foods rich in vitamin A like carrots.',
    'Include leafy greens for eye health.',
    'Stay hydrated to prevent dry eyes.',
    'Consume omega-3 fatty acids.',
    'Limit screen time and blink regularly.',
  ],
  booking_symptoms: [
    'Blurry or double vision',
    'Dry, burning, or itchy eyes',
    'Pain in or around the eyes',
    'Sudden loss of vision',
    'Flashes of light or floaters',
    'Sensitivity to light (photophobia)',
    'Red or bloodshot eyes',
    'Excess tearing or discharge',
    'Difficulty seeing at night',
    'Halos around lights',
  ],
} as const;
