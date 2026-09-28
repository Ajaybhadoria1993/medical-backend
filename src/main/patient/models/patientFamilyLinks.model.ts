import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';

/**
 * patient_family_links
 *
 * Links a primary patient (the one who has a mobile / app account) to their
 * dependent family members.  Both sides are Patient rows in `users`.
 *
 * Rules:
 *  - A family member with mobile = NULL can only be accessed through the
 *    primary patient.
 *  - A family member with their own mobile can also log in independently,
 *    but the link still allows the primary patient to book on their behalf.
 *  - The same pair cannot be linked twice (unique constraint).
 */
export const PatientFamilyLinksModel = pgTable(
  'patient_family_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The patient who owns / manages this family group */
    primaryPatientId: uuid('primary_patient_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),

    /** The linked family member (also a Patient row) */
    linkedPatientId: uuid('linked_patient_id')
      .notNull()
      .references(() => UserModel.id, { onDelete: 'cascade' }),

    /** Relationship of the linked member to the primary patient */
    relationship: varchar('relationship', { length: 50 })
      .$type<'spouse' | 'child' | 'parent' | 'sibling' | 'friend' | 'other'>()
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // A pair can only be linked once
    unique('uq_family_link_pair').on(
      table.primaryPatientId,
      table.linkedPatientId
    ),
    // Fast lookup: "give me all family members for patient X"
    index('family_links_primary_idx').on(table.primaryPatientId),
    // Fast lookup: "who is the primary patient for this dependent"
    index('family_links_linked_idx').on(table.linkedPatientId),
  ]
);
