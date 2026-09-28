// src/schemas/subscription.schemas.ts
import { z } from 'zod';

export const createPlanSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  price: z.string().or(z.number()).optional(),
  currency: z.string().optional(),
  features: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(), // optional array
});

export const subscribeClinicSchema = z.object({
  planId: z.uuid('invalid planId'),
  provider: z.string().optional(),
  providerSubscriptionId: z.string().optional(),
  paymentMode: z.string().optional(),
  transactionId: z.string().optional(),
  paymentStatus: z.string().optional(),
  price: z.string().or(z.number()).optional(),
  couponCode: z.string().optional(),
});

export const verifySubscriptionSchema = z
  .object({
    orderId: z.string().optional(),
    subscriptionId: z.string().optional(),
    paymentId: z.string(),
    providerSubscriptionId: z.string().optional(),
    signature: z.string(),
    // Purchase details are read from the Razorpay order notes, not from the
    // client. These stay accepted (and ignored) so older clients keep working.
    planId: z.string().uuid().optional(),
    couponId: z.string().optional(),
    couponCode: z.string().optional(),
    originalAmount: z.string().or(z.number()).optional(),
    discountAmount: z.string().or(z.number()).optional(),
  })
  .refine((data) => data.orderId || data.subscriptionId, {
    message: 'Either orderId or subscriptionId is required',
  });

export const reportPaymentFailedSchema = z.object({
  orderId: z.string().optional(),
  paymentId: z.string().optional(),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
});

export const initialSubscribeSchema = z.object({
  planId: z.uuid('invalid planId'),
});

export const checkPlanDowngradeSchema = z.object({
  targetPlanId: z.string().uuid('Invalid target plan id'),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
});

export const schedulePlanDowngradeSchema = z.object({
  targetPlanId: z.string().uuid('Invalid target plan id'),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  preferredActiveStaffIds: z.array(z.string().uuid()).optional(),
  preferredActiveDoctorIds: z.array(z.string().uuid()).optional(),
});

export const subscribeWithAutoPaySchema = z.object({
  planId: z.string().uuid('Invalid plan id'),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  couponCode: z.string().optional().nullable(),
});

export const cancelSubscribeSchema = z.object({
  subscriptionId: z.uuid('invalid subscriptionId'),
});

export const manageFeaturesParamsSchema = z.object({
  planId: z.string().uuid('Invalid planId'),
});

export const planIdParamsSchema = z.object({
  id: z.string().uuid('Invalid plan id'),
});

export const updatePlanSchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.string().or(z.number()).optional(),
  currency: z.string().optional(),
});

export const manageFeaturesBodySchema = z.object({
  add: z
    .array(
      z.object({
        name: z.string().min(1, 'Feature name is required'),
        description: z.string().optional(),
      })
    )
    .optional(),
  update: z
    .array(
      z.object({
        id: z.string().uuid('Invalid feature ID'),
        name: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .optional(),
  delete: z.array(z.string().uuid('Invalid feature ID')).optional(),
});

export type CreatePlanDto = z.infer<typeof createPlanSchema>;
export type SubscribeClinicDto = z.infer<typeof subscribeClinicSchema>;
export type ManageFeaturesParamsDto = z.infer<
  typeof manageFeaturesParamsSchema
>;
export type ManageFeaturesBodyDto = z.infer<typeof manageFeaturesBodySchema>;
