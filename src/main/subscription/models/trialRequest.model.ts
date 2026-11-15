import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ownerTypeEnum } from './subscription.model';

/** A free trial asked for before Super Admin approval; approval starts it and removes the row. */
export const TrialRequestModel = pgTable(
  'trial_requests',
  {
    ownerType: ownerTypeEnum('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    requestedBy: uuid('requested_by'),
  },
  (t) => [primaryKey({ columns: [t.ownerType, t.ownerId] })]
);
