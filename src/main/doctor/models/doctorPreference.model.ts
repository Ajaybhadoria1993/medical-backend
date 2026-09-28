import { pgTable, uuid, timestamp, json, varchar } from 'drizzle-orm/pg-core';
import type { PrescriptionPrintStyle } from '../../reports/types/prescriptionTranslation.types';
import { UserModel } from '../../users/models/user.model';

export const DoctorPreferenceModel = pgTable('doctor_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id')
    .references(() => UserModel.id)
    .notNull()
    .unique(),
  headerOrder: json('header_order')
    .$type<string[]>()
    .default([
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
    ]),
  habitList: json('habit_list')
    .$type<string[]>()
    .default(['Alcohol', 'Smoking', 'Tobacco']),
  allergyList: json('allergy_list')
    .$type<string[]>()
    .default([
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
    ]),
  diagnosisList: json('diagnosis_list')
    .$type<string[]>()
    .default([
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
    ]),
  preDiagnosisList: json('pre_diagnosis_list').$type<string[]>().default([]),
  surgerySuggestedList: json('surgery_suggested_list')
    .$type<string[]>()
    .default([
      'Appendectomy',
      'Hernia repair',
      'Cataract surgery',
      'Tonsillectomy',
      'Cholecystectomy',
      'Knee arthroscopy',
    ]),
  adviceSuggestionsList: json('advice_suggestions_list')
    .$type<string[]>()
    .default([
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
    ]),
  dietarySuggestionsList: json('dietary_suggestions_list')
    .$type<string[]>()
    .default([
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
    ]),
  /** The doctor's own instruction phrases per medicine form (`{ tablet: [...] }`), shown above the built-in ones. */
  instructionSuggestions: json('instruction_suggestions').$type<
    Record<string, string[]>
  >(),
  /** Regional language prescriptions print in, set on the Translations tab; null means English only. */
  prescriptionLanguage: varchar('prescription_language', { length: 8 }),
  /** 'bilingual' also prints the English under each line; null means the translation alone. */
  prescriptionPrintStyle: varchar('prescription_print_style', {
    length: 16,
  }).$type<PrescriptionPrintStyle>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
