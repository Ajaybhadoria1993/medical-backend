// src/main/subscription/schemas/addon.schemas.ts
import { z } from 'zod';

export const initiatePurchaseSchema = z
  .object({
    addOns: z
      .array(
        z.object({
          addOnId: z.string().uuid('Invalid add-on ID'),
          billingCycle: z.enum(['monthly', 'yearly']),
          quantity: z.number().int().positive().default(1),
        })
      )
      .default([]),
    /** A WhatsApp pack bought in the same order. */
    creditPackId: z.string().uuid('Invalid pack').optional(),
    couponCode: z.string().optional(),
  })
  .refine((v) => v.addOns.length > 0 || !!v.creditPackId, {
    message: 'Choose an add-on or a WhatsApp pack',
  });

export const verifyPurchaseSchema = z.object({
  orderId: z.string(),
  paymentId: z.string(),
  signature: z.string(),
  // Purchased add-ons are resolved from the Razorpay order notes; this is
  // accepted (and ignored) so older clients keep working.
  addOns: z
    .array(
      z.object({
        addOnId: z.string().uuid('Invalid add-on ID'),
        billingCycle: z.enum(['monthly', 'yearly']),
        quantity: z.number().int().positive().default(1),
      })
    )
    .optional(),
  couponId: z.string().optional(),
  originalAmount: z.string().or(z.number()).optional(),
  discountAmount: z.string().or(z.number()).optional(),
});

export const clinicAddOnIdParamsSchema = z.object({
  clinicAddOnId: z.string().uuid('Invalid clinic add-on ID'),
});

export const scheduleCancelAddOnSchema = z.object({
  deactivateUserIds: z
    .array(z.string().uuid('Invalid user ID'))
    .optional()
    .default([]),
});

export const reduceAddOnQuantitySchema = z.object({
  reduceBy: z.coerce.number().int().positive().default(1),
  deactivateUserIds: z
    .array(z.string().uuid('Invalid user ID'))
    .optional()
    .default([]),
});
