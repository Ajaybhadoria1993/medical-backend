// pharmacyMedicineTags.model.ts
import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pharmacyMedicineModel } from './pharmacyMedicine.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';

export const PharmacyMedicineTagsModel = pgTable(
  'pharmacy_medicine_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pharmacyId: uuid('pharmacy_id').references(() => PharmacyModel.id, {
      onDelete: 'cascade',
    }),
    tag: varchar('tag', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_pharmacy_tag').on(t.pharmacyId, t.tag),
    index('idx_pharmacy_tags_pharmacy_id').on(t.pharmacyId),
    index('idx_pharmacy_tags_tag').on(t.tag),
    index('idx_pharmacy_tags_created_at').on(t.createdAt),
  ]
);

export const PharmacyTagsMapModel = pgTable(
  'pharmacy_tags_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    medicineId: uuid('medicine_id')
      .references(() => pharmacyMedicineModel.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => PharmacyMedicineTagsModel.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [
    uniqueIndex('uk_medicine_tag').on(t.medicineId, t.tagId),
    index('idx_tags_map_medicine_id').on(t.medicineId),
    index('idx_tags_map_tag_id').on(t.tagId),
  ]
);
