import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { varchar } from 'drizzle-orm/pg-core';
import { AppointmentModel } from './appointment.model';

export const doctorManualPrescriptionModel = pgTable(
  'doctor_manual_prescription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => AppointmentModel.id, { onDelete: 'cascade' }),
    doctorManualPrescription: varchar('doctor_manual_prescription', {
      length: 256,
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  }
);
