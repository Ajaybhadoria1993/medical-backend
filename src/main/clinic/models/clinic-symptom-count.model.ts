import { pgTable, uuid, integer, date, uniqueIndex } from 'drizzle-orm/pg-core';
import { ClinicSymptomModel } from './clinic-symptom.model';

export const ClinicSymptomCountModel = pgTable(
  'clinic_symptom_counts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symptomId: uuid('symptom_id')
      .references(() => ClinicSymptomModel.id)
      .notNull(),
    date: date('date').notNull(),
    count: integer('count').default(0).notNull(),
  },
  (t) => [uniqueIndex('symptom_date_idx').on(t.symptomId, t.date)]
);
