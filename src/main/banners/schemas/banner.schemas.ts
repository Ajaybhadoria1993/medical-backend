import { z } from 'zod';

// ─── Enum Schemas (mirror DB pgEnums) ────────────────────────────────────────

export const bannerTypeSchema = z.enum([
  'Referral',
  'MedicineSpotlight',
  'OperationalAlert',
  'FeatureAnnouncement',
  'PromotionalOffer',
  'SystemAlert',
]);

export const bannerPrioritySchema = z.enum([
  'P0', // Critical
  'P1', // Operational
  'P2', // Clinical
  'P3', // Promotional
]);

export const bannerPlacementSchema = z.enum([
  'DASHBOARD_TOP',
  'DASHBOARD_SIDEBAR',
  'INSIGHTS_WIDGET',
  'APPOINTMENT_HEADER',
  'LOGIN_PAGE',
  'BILLING_PAGE',
]);

export const bannerStatusSchema = z.enum([
  'Active',
  'Paused',
  'Scheduled',
  'Expired',
  'Draft',
]);

export const targetRoleSchema = z.enum([
  'Admin',
  'User',
  'Super_Admin',
  'Doctor',
  'Receptionist',
  'Nurse',
  'Patient',
  'Pharmacist',
  'Lab_Assistant',
  'Radiologist',
]);

// ─── Create Banner ────────────────────────────────────────────────────────────

export const createBannerSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().optional().nullable(),
    bannerType: bannerTypeSchema,
    priority: bannerPrioritySchema,
    placement: bannerPlacementSchema,
    ctaText: z.string().max(100).optional().nullable(),
    ctaUrl: z.url('CTA URL must be a valid URL').optional().nullable(),
    // Images
    imageUrl: z.string().url('Image URL must be valid').optional().nullable(),
    thumbnailUrl: z
      .string()
      .url('Thumbnail URL must be valid')
      .optional()
      .nullable(),
    imageAlt: z
      .string()
      .max(255, 'Image alt text must be 255 characters or less')
      .optional()
      .nullable(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    // Targeting — null/omitted means target all
    targetRoles: z.array(targetRoleSchema).optional().nullable(),
    targetClinics: z.array(z.uuid('Invalid clinic ID')).optional().nullable(),
    targetSpecialties: z.array(z.string().min(1)).optional().nullable(),
    // Flags
    isSponsored: z.boolean().default(false),
    isDismissible: z.boolean().default(true),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).default(0),
  })
  .refine(
    (data) => {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      // Allow same-day banners (startDate <= endDate)
      // Timestamps have millisecond precision, so same calendar day is valid
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end;
    },
    {
      message:
        'startDate must be a valid date and less than or equal to endDate',
      path: ['startDate'],
    }
  );

// ─── Update Banner ────────────────────────────────────────────────────────────

export const updateBannerSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().optional().nullable(),
    bannerType: bannerTypeSchema.optional(),
    priority: bannerPrioritySchema.optional(),
    placement: bannerPlacementSchema.optional(),
    ctaText: z.string().max(100).optional().nullable(),
    ctaUrl: z.url('CTA URL must be a valid URL').optional().nullable(),
    // Images
    imageUrl: z.string().url('Image URL must be valid').optional().nullable(),
    thumbnailUrl: z
      .string()
      .url('Thumbnail URL must be valid')
      .optional()
      .nullable(),
    imageAlt: z
      .string()
      .max(255, 'Image alt text must be 255 characters or less')
      .optional()
      .nullable(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    targetRoles: z.array(targetRoleSchema).optional().nullable(),
    targetClinics: z.array(z.uuid('Invalid clinic ID')).optional().nullable(),
    targetSpecialties: z.array(z.string().min(1)).optional().nullable(),
    isSponsored: z.boolean().optional(),
    isDismissible: z.boolean().optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
    status: bannerStatusSchema.optional(),
  })
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true; // partial update is fine
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      // Allow same-day banners (startDate <= endDate)
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end;
    },
    {
      message: 'startDate must be less than or equal to endDate',
      path: ['startDate'],
    }
  );

// ─── Params ───────────────────────────────────────────────────────────────────

export const bannerIdParamSchema = z.object({
  bannerId: z.uuid('Invalid banner ID'),
});

// ─── List / Query Banners (Super Admin) ───────────────────────────────────────

export const listBannersQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  pageNumber: z.coerce.number().int().min(1).optional().default(1),
  bannerType: bannerTypeSchema.optional(),
  priority: bannerPrioritySchema.optional(),
  placement: bannerPlacementSchema.optional(),
  status: bannerStatusSchema.optional(),
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

// ─── User-facing eligible banners query ──────────────────────────────────────

export const eligibleBannersQuerySchema = z.object({
  placement: bannerPlacementSchema.optional(),
});

// ─── Analytics event (Phase 2 ready) ─────────────────────────────────────────

export const bannerAnalyticsEventSchema = z.object({
  eventType: z.enum(['impression', 'click', 'dismissal']),
});

// Batched analytics events — lets the client flush multiple impression/click
// events in a single request instead of one POST per banner.
export const bannerAnalyticsBatchSchema = z.object({
  events: z
    .array(
      z.object({
        bannerId: z.uuid('Invalid banner ID'),
        eventType: z.enum(['impression', 'click', 'dismissal']),
      })
    )
    .min(1)
    .max(50),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type CreateBannerDto = z.infer<typeof createBannerSchema>;
export type UpdateBannerDto = z.infer<typeof updateBannerSchema>;
export type BannerIdParamDto = z.infer<typeof bannerIdParamSchema>;
export type ListBannersQueryDto = z.infer<typeof listBannersQuerySchema>;
export type EligibleBannersQueryDto = z.infer<
  typeof eligibleBannersQuerySchema
>;
export type BannerAnalyticsEventDto = z.infer<
  typeof bannerAnalyticsEventSchema
>;
export type BannerAnalyticsBatchDto = z.infer<
  typeof bannerAnalyticsBatchSchema
>;
