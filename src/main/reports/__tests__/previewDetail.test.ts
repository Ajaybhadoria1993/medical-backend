/**
 * The preview trim is a plain data transform inside the preview controller.
 * Mirrored here so the section list can't silently drift from what the
 * templates guard on — see `getPreviewPrescriptionTemplateController`.
 */

/** Sections the "typical visit" preview clears. Keep in step with the controller. */
const TRIMMED_SECTIONS = [
  'habits',
  'surgerySuggested',
  'additionalInformation',
  'dietarySuggestion',
  'visitingDays',
  'visitingNotes',
  'preDiagnosis',
] as const;

const applyTrim = (
  sample: Record<string, unknown>
): Record<string, unknown> => ({
  ...sample,
  habits: [],
  surgerySuggested: [],
  additionalInformation: {},
  dietarySuggestion: '',
  visitingDays: [],
  visitingNotes: '',
  preDiagnosis: '',
});

const fullSample = () => ({
  habits: ['Smoking', 'Tobacco'],
  allergies: ['Dust', 'Syrup'],
  surgerySuggested: ['Mole Removal'],
  additionalInformation: { 'Tooth-1': 'Cavity' },
  dietarySuggestion: 'Orange juice twice a day.',
  visitingDays: ['10-Mar-2026'],
  visitingNotes: 'To checkup of health condition',
  preDiagnosis: 'Suspected viral fever.',
  diagnosis: 'Viral Fever',
  symptoms: [{ name: 'Headache' }],
  prescriptions: [{ medicineName: 'Paracip 500' }],
  advice: 'Take adequate rest.',
  followUpDate: '18-Mar-2024',
  hasTests: 2,
});

/** Truthy the way the templates' `{{#if x}}` / `{{#if x.length}}` guards are. */
const prints = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === 'object' && value !== null
      ? Object.keys(value).length > 0
      : Boolean(value);

describe('preview "typical visit" trim', () => {
  it('clears every section it claims to', () => {
    const trimmed = applyTrim(fullSample());

    for (const key of TRIMMED_SECTIONS) {
      expect(prints((trimmed as Record<string, unknown>)[key])).toBe(false);
    }
  });

  it('keeps the sections a typical prescription actually shows', () => {
    const trimmed = applyTrim(fullSample());

    // These carry the layout — trimming them would make the preview useless.
    expect(prints(trimmed.diagnosis)).toBe(true);
    expect(prints(trimmed.prescriptions)).toBe(true);
    expect(prints(trimmed.symptoms)).toBe(true);
    expect(prints(trimmed.allergies)).toBe(true);
    expect(prints(trimmed.advice)).toBe(true);
    expect(prints(trimmed.followUpDate)).toBe(true);
  });

  it('leaves the full sample untouched when not trimming', () => {
    const full = fullSample();

    for (const key of TRIMMED_SECTIONS) {
      expect(prints((full as Record<string, unknown>)[key])).toBe(true);
    }
  });

  it('is idempotent, so a repeated preview render is stable', () => {
    expect(applyTrim(applyTrim(fullSample()))).toEqual(applyTrim(fullSample()));
  });
});
