import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { UserModel } from '../../users/models/user.model';
import { ClinicModel } from '../../clinic/models/clinic.model';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const bannerTypeEnum = pgEnum('banner_type', [
  'Referral',
  'MedicineSpotlight',
  'OperationalAlert',
  'FeatureAnnouncement',
  'PromotionalOffer',
  'SystemAlert',
]);

export const bannerPriorityEnum = pgEnum('banner_priority', [
  'P0', // Critical
  'P1', // Operational
  'P2', // Clinical
  'P3', // Promotional
]);

export const bannerPlacementEnum = pgEnum('banner_placement', [
  'DASHBOARD_TOP',
  'DASHBOARD_SIDEBAR',
  'INSIGHTS_WIDGET',
  'APPOINTMENT_HEADER',
  'LOGIN_PAGE',
  'BILLING_PAGE',
]);

export const bannerStatusEnum = pgEnum('banner_status', [
  'Active',
  'Paused',
  'Scheduled',
  'Expired',
  'Draft',
]);

// ─── Banner Table ─────────────────────────────────────────────────────────────

export const BannerModel = pgTable(
  'banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Content
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    bannerType: bannerTypeEnum('banner_type').notNull(),

    // Display config
    priority: bannerPriorityEnum('priority').notNull(),
    placement: bannerPlacementEnum('placement').notNull(),

    // Call to action
    ctaText: varchar('cta_text', { length: 100 }),
    ctaUrl: varchar('cta_url', { length: 2048 }),

    // Images — stored as URLs (local/CDN paths or full URLs)
    // Primary image: displayed in carousel/main banner area
    imageUrl: varchar('image_url', { length: 2048 }),
    // Thumbnail image: displayed in preview/list views (optional)
    thumbnailUrl: varchar('thumbnail_url', { length: 2048 }),
    // Alternative text for accessibility
    imageAlt: varchar('image_alt', { length: 255 }),

    // Scheduling
    startDate: timestamp('start_date').notNull(),
    endDate: timestamp('end_date').notNull(),

    // Targeting — stored as JSON arrays (role names, clinic IDs, specialty strings)
    // null means "target all"
    targetRoles: text('target_roles').array(),
    targetClinics: uuid('target_clinics').array(),
    targetSpecialties: text('target_specialties').array(),

    // Flags
    isSponsored: boolean('is_sponsored').notNull().default(false),
    isDismissible: boolean('is_dismissible').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),

    // Status lifecycle
    status: bannerStatusEnum('status').notNull().default('Draft'),

    // Analytics metadata (counters maintained externally or via future analytics table)
    displayOrder: integer('display_order').default(0),

    // Audit
    createdBy: uuid('created_by')
      .references(() => UserModel.id)
      .notNull(),
    updatedBy: uuid('updated_by').references(() => UserModel.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('banner_status_idx').on(table.status),
    index('banner_type_idx').on(table.bannerType),
    index('banner_placement_idx').on(table.placement),
    index('banner_start_end_idx').on(table.startDate, table.endDate),
  ]
);

// ─── Banner Dismissal Table (per-user dismissal tracking) ─────────────────────
// Enables "don't show again" behaviour and future analytics on dismissals

export const BannerDismissalModel = pgTable(
  'banner_dismissals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bannerId: uuid('banner_id')
      .references(() => BannerModel.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    dismissedAt: timestamp('dismissed_at').defaultNow().notNull(),
  },
  (table) => [
    index('banner_dismissal_user_idx').on(table.userId),
    index('banner_dismissal_banner_idx').on(table.bannerId),
  ]
);

// ─── Banner Analytics Table (impressions & clicks) ────────────────────────────
// Designed now so Phase 2 analytics APIs can simply query this table

export const BannerAnalyticsModel = pgTable(
  'banner_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bannerId: uuid('banner_id')
      .references(() => BannerModel.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => UserModel.id, { onDelete: 'cascade' })
      .notNull(),
    clinicId: uuid('clinic_id').references(() => ClinicModel.id),
    eventType: varchar('event_type', { length: 50 }).notNull(), // 'impression' | 'click' | 'dismissal'
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  },
  (table) => [
    index('banner_analytics_banner_idx').on(table.bannerId),
    index('banner_analytics_user_idx').on(table.userId),
    index('banner_analytics_event_idx').on(table.eventType),
    index('banner_analytics_occurred_idx').on(table.occurredAt),
  ]
);
