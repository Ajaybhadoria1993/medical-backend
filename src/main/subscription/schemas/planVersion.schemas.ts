import { z } from 'zod';

const price = z.coerce.number().min(0, 'A price cannot be negative').nullable();

export const planVersionParamsSchema = z.object({
  planId: z.string().uuid('Invalid plan id'),
});

export const createPlanVersionSchema = z.object({
  monthlyPrice: price.default(null),
  yearlyPrice: price.default(null),
  effectiveFrom: z.coerce.date({
    message: 'Enter the date this version starts',
  }),
  limits: z
    .array(
      z.object({
        featureKey: z.string().min(1),
        limitValue: z.number().int().min(0).nullable().default(null),
        isUnlimited: z.boolean().default(false),
        enabled: z.boolean().default(true),
        /** Only read for a feature the plan does not have yet. */
        type: z.enum(['numeric', 'boolean']).optional(),
        displayName: z.string().trim().max(150).optional(),
      })
    )
    .optional(),
  addOnCaps: z
    .array(
      z.object({
        addOnId: z.string().uuid('Invalid add-on id'),
        maxCap: z.number().int().min(0).nullable(),
      })
    )
    .optional(),
});

export const planVisibilitySchema = z.object({ isActive: z.boolean() });

export const endPlanSchema = z.object({
  endsAt: z.coerce.date({ message: 'Enter the date the plan ends' }),
  replacementPlanId: z.string().uuid('Invalid plan id').nullable(),
});

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, 'Enter the plan name').max(100),
  description: z.string().trim().max(255).nullable().optional(),
  kind: z.enum(['paid', 'free']).default('paid'),
  monthlyPrice: price.default(null),
  yearlyPrice: price.default(null),
  features: z
    .array(
      z.object({
        featureKey: z.string().min(1).max(100),
        displayName: z.string().max(150).nullable().optional(),
        description: z.string().max(255).nullable().optional(),
        type: z.string().min(1).max(20),
        limitValue: z.number().int().min(0).nullable().default(null),
        isUnlimited: z.boolean().default(false),
        enabled: z.boolean().default(true),
        isMarketingFeature: z.boolean().optional(),
      })
    )
    .default([]),
  addOnCaps: z
    .array(
      z.object({
        addOnId: z.string().uuid(),
        maxCap: z.number().int().min(0).nullable(),
      })
    )
    .optional(),
});

export const planFeatureParamsSchema = z.object({
  planId: z.string().uuid('Invalid plan id'),
  featureKey: z.string().min(1).max(100),
});

export const renamePlanFeatureSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Enter a name').max(150).optional(),
    description: z.string().trim().max(255).nullable().optional(),
    linkedFeatureKey: z.string().min(1).max(100).nullable().optional(),
    /** Selling points only: false hides the line from clinics. */
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.description !== undefined ||
      v.linkedFeatureKey !== undefined ||
      v.enabled !== undefined,
    { message: 'Nothing to change' }
  );

export const reorderPlanFeaturesSchema = z.object({
  featureKeys: z.array(z.string().min(1).max(100)).min(1).max(200),
});

export const addPlanFeatureSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name').max(150),
  description: z.string().trim().max(255).nullable().optional(),
});

export const planVersionIdParamsSchema = z.object({
  planId: z.string().uuid('Invalid plan id'),
  versionId: z.string().uuid('Invalid version id'),
});
