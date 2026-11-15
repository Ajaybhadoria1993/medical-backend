import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { AppointmentModel } from './appointment.model';
import { ClinicServiceModel } from '../../clinic/models/clinic.model';

export const appointmentMultipleService = pgTable(
  'appointment_multiple_service',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id')
      .references(() => AppointmentModel.id, { onDelete: 'cascade' })
      .notNull(),
    serviceId: uuid('service_id').references(() => ClinicServiceModel.id),
    price: varchar('price', { length: 10 }),
    paymentMode: varchar('payment_mode', { length: 20 }).default('Cash'),
    payment_notes: varchar('payment_notes', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  // Revenue sums look these up per payment row (CLINIC_AMOUNT).
  (table) => [
    index('appointment_multiple_service_appointment_id_idx').on(
      table.appointmentId
    ),
    // One row per service per visit: two clicks at once can't add it twice (money sync step 7).
    uniqueIndex('appointment_multiple_service_appt_service_uq').on(
      table.appointmentId,
      table.serviceId
    ),
  ]
);
