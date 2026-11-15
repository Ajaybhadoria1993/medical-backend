import { z } from 'zod';

// Schema for pricing a plan purchase without creating an order
export const planQuoteSchema = z.object({
  planId: z.string().uuid('Invalid planId'),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().min(1).optional(),
});
