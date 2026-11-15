import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Super Admin's display order of the main specialities; empty table = catalog order. */
export const SpecialtyOrderModel = pgTable('specialty_display_order', {
  mainSpecialty: varchar('main_specialty', { length: 100 }).primaryKey(),
  position: integer('position').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
