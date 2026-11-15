import { integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { LabsModel } from '../../lab/models/lab.model';

/** Last receipt number per clinic per year, taken inside the payment transaction. */
export const ReceiptSequenceModel = pgTable(
  'receipt_sequences',
  {
    clinicId: uuid('clinic_id')
      .references(() => ClinicModel.id, { onDelete: 'restrict' })
      .notNull(),
    year: integer('year').notNull(),
    lastNo: integer('last_no').default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.year] })]
);

/** Last lab receipt number per lab per year; a separate series from the clinic's. */
export const LabReceiptSequenceModel = pgTable(
  'lab_receipt_sequences',
  {
    labId: uuid('lab_id')
      .references(() => LabsModel.id, { onDelete: 'restrict' })
      .notNull(),
    year: integer('year').notNull(),
    lastNo: integer('last_no').default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.labId, t.year] })]
);
