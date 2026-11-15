import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DOCTOR_SPECIALTY_CONFIG,
  GENERIC_DOCTOR_PREFERENCES,
  SPECIALTY_CATALOG_RESPONSE,
  SPECIALTY_TOOLS_RESPONSE,
  resolvePreferenceLists,
} from '../doctorSpecialtyConfig';

const dentistOrder = [...DOCTOR_SPECIALTY_CONFIG.Dentist.header_order];
const cardioDiagnosis = [
  ...DOCTOR_SPECIALTY_CONFIG.Cardiologist.diagnosis_list,
];

describe('resolvePreferenceLists', () => {
  it('gives a Dentist with no saved row the Dentist layout', () => {
    expect(resolvePreferenceLists('Dentist').headerOrder).toEqual(dentistOrder);
  });

  it('names the specialty diagrams the prescription shows', () => {
    expect(resolvePreferenceLists('Dentist').sections).toEqual([
      'Dental Chart',
    ]);
    expect(resolvePreferenceLists('Fertility Specialist').sections).toEqual([
      'Reproductive Chart',
    ]);
    expect(resolvePreferenceLists('General Physician').sections).toEqual([]);
  });

  it('ignores generic column defaults written by a partial save', () => {
    const lists = resolvePreferenceLists('Dentist', GENERIC_DOCTOR_PREFERENCES);
    expect(lists.headerOrder).toEqual(dentistOrder);
    expect(lists.habitList).toEqual([
      ...DOCTOR_SPECIALTY_CONFIG.Dentist.habit_list,
    ]);
    expect(lists.customLists.habitList).toEqual([]);
  });

  it('keeps a header order the doctor actually changed', () => {
    const own = ['Diagnosis', 'Advice'];
    expect(
      resolvePreferenceLists('Dentist', { headerOrder: own }).headerOrder
    ).toEqual(own);
  });

  it('puts the doctor’s own entries before the specialty defaults', () => {
    const lists = resolvePreferenceLists('Cardiologist', {
      diagnosisList: ['Angina', 'Hypertension'],
    });
    expect(lists.customLists.diagnosisList).toEqual(['Angina']);
    expect(lists.diagnosisList).toEqual(['Angina', ...cardioDiagnosis]);
  });

  it('strips the old web defaults saved wholesale into a Cardiologist row', () => {
    const polluted = [
      'Acidity',
      'Allergy',
      'Body pain',
      'Cold/Cough',
      'Dengue',
      'Diarrhea',
      'Dog bite',
      'Fever',
      'Flu',
      'Headache',
      'Heart failure',
      'High BP',
      'Low BP',
      'Infection',
      'Laser',
      'Malaria',
      'Malnutrition',
      'Migraine',
      'Pregnancy care',
      'Prostate cancer',
      'Sinusitis',
      'Stomach pain',
      'Tooth decay',
      'Diabetes',
      'Typhoid',
      'UTI',
      'Viral fever',
      'Angina',
    ];
    const lists = resolvePreferenceLists('Cardiologist', {
      diagnosisList: polluted,
    });
    expect(lists.diagnosisList).toEqual(['Angina', ...cardioDiagnosis]);
  });

  it('gives a specialty its complaint chips as pre-diagnosis', () => {
    expect(resolvePreferenceLists('Cardiologist').preDiagnosisList[0]).toBe(
      'Chest pain'
    );
  });

  it('falls back to the generic lists for an unknown or missing specialty', () => {
    const {
      customLists,
      sections,
      prescribesMedicines,
      examTables,
      commonTests,
      ...lists
    } = resolvePreferenceLists('Not A Specialty');
    expect(lists).toEqual(GENERIC_DOCTOR_PREFERENCES);
    expect(sections).toEqual([]);
    expect(prescribesMedicines).toBe(true);
    expect(examTables).toEqual([]);
    expect(commonTests).toEqual([]);

    expect(customLists.diagnosisList).toEqual([]);
    expect(resolvePreferenceLists(null, { habitList: null }).habitList).toEqual(
      GENERIC_DOCTOR_PREFERENCES.habitList
    );
  });

  it('gives batch-1 specialties their own lists, not the generic ones', () => {
    const physio = resolvePreferenceLists('Physiotherapist');
    expect(physio.diagnosisList).toContain('Frozen shoulder');
    expect(physio.headerOrder).not.toContain('Surgery Suggested');
    expect(
      resolvePreferenceLists('Emergency Medicine Specialist')
        .surgerySuggestedList
    ).toContain('Wound suturing');
    expect(
      resolvePreferenceLists('Dietitian / Nutritionist').dietarySuggestionsList
    ).not.toEqual(GENERIC_DOCTOR_PREFERENCES.dietarySuggestionsList);
  });

  it('gives batch-2 specialties their own lists, not the generic ones', () => {
    expect(resolvePreferenceLists('Nephrologist').diagnosisList).toContain(
      'CKD stage 3'
    );
    expect(
      resolvePreferenceLists('Speech Therapist').headerOrder
    ).not.toContain('Vitals');
    expect(
      resolvePreferenceLists('Rheumatologist').adviceSuggestionsList
    ).toContain('Methotrexate is taken ONCE A WEEK — never daily.');
  });

  it('gives batch-3 specialties their own lists; Endocrinologist keeps the diabetes ones', () => {
    const endo = resolvePreferenceLists('Endocrinologist').diagnosisList;
    expect(endo).toContain('Type 2 diabetes');
    expect(endo).toContain('Hypothyroidism');
    expect(
      resolvePreferenceLists('Hematologist').surgerySuggestedList
    ).toContain('Blood transfusion');
    expect(resolvePreferenceLists('Oncologist').headerOrder).not.toContain(
      'Habits'
    );
  });

  it('part 2a: surgical specialties start with complaints and gain common diagnoses', () => {
    for (const s of [
      'Ophthalmologist',
      'General Surgeon',
      'Orthopedic Doctor',
      'Plastic Surgeon',
    ]) {
      expect(resolvePreferenceLists(s).headerOrder[0]).toBe('Pre-Diagnosis');
    }
    expect(resolvePreferenceLists('ENT Specialist').diagnosisList).toContain(
      'CSOM'
    );
    expect(resolvePreferenceLists('Urologist').adviceSuggestionsList).toContain(
      'Do not miss the stent removal date.'
    );
  });

  it('part 2b: psychologist has 6 sections; psychiatry keeps ECT and gains rTMS', () => {
    expect(resolvePreferenceLists('Psychologist').headerOrder).toEqual([
      'Pre-Diagnosis',
      'Diagnosis',
      'Advice',
      'Visiting Days',
      'Follow-Up (days)',
      'Habits',
    ]);
    const procedures =
      resolvePreferenceLists('Psychiatrist').surgerySuggestedList;
    expect(procedures).toContain('Electroconvulsive therapy (ECT)');
    expect(procedures).toContain('rTMS');
    expect(resolvePreferenceLists('Pediatrician').diagnosisList).toContain(
      'Febrile seizure'
    );
  });

  it('part 2c: fertility, lung and gut start with complaints; gyn and cardiology gain procedures', () => {
    for (const s of [
      'Fertility Specialist',
      'Pulmonologist',
      'Gastroenterologist',
    ]) {
      expect(resolvePreferenceLists(s).headerOrder[0]).toBe('Pre-Diagnosis');
    }
    expect(resolvePreferenceLists('Fertility Specialist').sections).toEqual([
      'Reproductive Chart',
    ]);
    expect(
      resolvePreferenceLists('Gynecologist').surgerySuggestedList
    ).toContain('IUD insertion');
    expect(
      resolvePreferenceLists('Cardiologist').surgerySuggestedList
    ).toContain('TAVI');
  });

  it('cleanup: only catalog mains have a block; merged sub entries live in the main', () => {
    expect(Object.keys(DOCTOR_SPECIALTY_CONFIG)).toHaveLength(33);
    expect(Object.keys(DOCTOR_SPECIALTY_CONFIG)).not.toContain('Diabetologist');
    expect(resolvePreferenceLists('Urologist').surgerySuggestedList).toContain(
      'Varicocelectomy'
    );
    expect(
      resolvePreferenceLists('Dermatologist').surgerySuggestedList
    ).toContain('Chemical peel');
  });

  it('marks the four non-prescribing specialties so the screen hides medicines', () => {
    for (const s of [
      'Physiotherapist',
      'Psychologist',
      'Speech Therapist',
      'Dietitian / Nutritionist',
    ]) {
      expect(resolvePreferenceLists(s).prescribesMedicines).toBe(false);
    }
    expect(
      resolvePreferenceLists('General Physician').prescribesMedicines
    ).toBe(true);
  });

  it('serves booking symptoms for every catalog main, Dietitian and Anaesthesia included', () => {
    expect(SPECIALTY_CATALOG_RESPONSE.every((g) => g.symptoms.length > 0)).toBe(
      true
    );
    const diet = SPECIALTY_CATALOG_RESPONSE.find(
      (g) => g.mainSpecialty === 'Dietitian / Nutritionist'
    );
    expect(diet?.symptoms).toContain('PCOS diet');
  });
});

describe('common tests per specialty', () => {
  // Read as text: importing the seed would open a database connection.
  const seed = readFileSync(
    join(__dirname, '../../drizzle/seeds/patientTest.seed.ts'),
    'utf8'
  );
  const seeded = new Set(
    [...seed.matchAll(/name: '([^']*)'/g)].map((m) => m[1])
  );

  it('names only tests that exist in the global test list', () => {
    const missing = Object.entries(DOCTOR_SPECIALTY_CONFIG).flatMap(
      ([specialty, config]) =>
        'common_tests' in config
          ? config.common_tests
              .filter((name) => !seeded.has(name))
              .map((name) => `${specialty}: ${name}`)
          : []
    );
    expect(missing).toEqual([]);
  });

  it('returns them with the preferences, empty for a generic doctor', () => {
    expect(resolvePreferenceLists('Ophthalmologist').commonTests).toContain(
      'OCT'
    );
    expect(resolvePreferenceLists(null).commonTests).toEqual([]);
  });
});

describe('hidden built-ins and chosen Clinical details tabs', () => {
  it('drops a hidden built-in from the list but keeps it in the defaults', () => {
    const lists = resolvePreferenceLists('Dentist', {
      hiddenOptions: { diagnosisList: ['dental caries'] },
    });
    expect(lists.diagnosisList).not.toContain('Dental caries');
    expect(lists.defaultLists.diagnosisList).toContain('Dental caries');
  });

  it('uses the chosen tabs in order and ignores unknown ids', () => {
    const lists = resolvePreferenceLists('Dentist', {
      specialtyTools: ['exam:ear', 'Dental Chart', 'exam:nope'],
    });
    expect(lists.specialtyTools).toEqual(['exam:ear', 'Dental Chart']);
    expect(lists.sections).toEqual(['Dental Chart']);
    expect(lists.examTables.map((t) => t.id)).toEqual(['ear']);
  });

  it('falls back to the specialty tabs until the doctor chooses', () => {
    expect(resolvePreferenceLists('ENT Specialist').specialtyTools).toEqual([
      'exam:ear',
      'exam:hearing',
      'exam:nt',
    ]);
    expect(
      resolvePreferenceLists('Dentist', { specialtyTools: [] }).sections
    ).toEqual([]);
  });

  it('lists every specialty that has a tab, for the picker', () => {
    const dentist = SPECIALTY_TOOLS_RESPONSE.find(
      (g) => g.specialty === 'Dentist'
    );
    expect(dentist?.tools).toEqual([
      { id: 'Dental Chart', title: 'Dental Chart' },
    ]);
  });
});
