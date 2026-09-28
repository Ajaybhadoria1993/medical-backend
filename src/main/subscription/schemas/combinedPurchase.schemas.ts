import { z } from 'zod';

// Schema for subscribing with add-ons in one call
export const subscribeWithAddOnsSchema = z.object({
  planId: z.string().uuid('Invalid planId'),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  addOns: z
    .array(
      z.object({
        addOnId: z.string().uuid('Invalid addOnId'),
        quantity: z.number().int().positive().default(1),
      })
    )
    .optional(),
});

// Schema for pricing a plan purchase without creating an order
export const planQuoteSchema = z.object({
  planId: z.string().uuid('Invalid planId'),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().min(1).optional(),
});

// Schema for verifying combined purchase
export const verifyCombinedPurchaseSchema = z.object({
  orderId: z.string(),
  paymentId: z.string(),
  signature: z.string(),
  // Purchase details are resolved from the Razorpay order notes; these are
  // accepted (and ignored) so older clients keep working.
  planId: z.string().uuid('Invalid planId').optional(),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
  addOns: z
    .array(
      z.object({
        addOnId: z.string().uuid('Invalid addOnId'),
        quantity: z.number().int().positive(),
      })
    )
    .optional(),
});

export type SubscribeWithAddOnsDto = z.infer<typeof subscribeWithAddOnsSchema>;
export type PlanQuoteDto = z.infer<typeof planQuoteSchema>;
export type VerifyCombinedPurchaseDto = z.infer<
  typeof verifyCombinedPurchaseSchema
>;
