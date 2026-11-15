import { z } from 'zod';

export const autoPaySetupSchema = z.object({
  method: z.enum(['card', 'upi', 'emandate']),
});

export const autoPayVerifySchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});
