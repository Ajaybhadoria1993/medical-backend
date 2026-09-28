import {
  DOCTOR_SPECIALTY_CONFIG,
  GENERIC_DOCTOR_PREFERENCES,
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
    const { customLists, ...lists } =
      resolvePreferenceLists('Ayurvedic Doctor');
    expect(lists).toEqual(GENERIC_DOCTOR_PREFERENCES);

    expect(customLists.diagnosisList).toEqual([]);
    expect(resolvePreferenceLists(null, { habitList: null }).habitList).toEqual(
      GENERIC_DOCTOR_PREFERENCES.habitList
    );
  });
});
