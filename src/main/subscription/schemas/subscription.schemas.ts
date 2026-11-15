// src/schemas/subscription.schemas.ts
import { z } from 'zod';

export const addOnLimitInputSchema = z.object({
  addOnId: z.string().uuid('Invalid add-on ID'),
  maxCap: z.number().int().nonnegative().nullable().optional(),
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
  /** Pay the first month and approve AutoPay in the same checkout (monthly plans only). */
  autoPay: z.object({ method: z.enum(['card', 'upi', 'emandate']) }).optional(),
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
  /** Stable client-generated ID for retries before a Razorpay order exists. */
  failureReportId: z.string().uuid().optional(),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
  /** Set by Checkout's modal-dismiss callback to distinguish abandonment from a declined payment. */
  droppedCheckout: z.boolean().optional(),
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
  /** true: everyone not in a sent keep list is switched off, even if the new plan has room. */
  exactKeep: z.boolean().optional(),
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
  addOnLimits: z.array(addOnLimitInputSchema).optional(),
  /** Display-only "was" price; null clears it. */
  compareAtMonthly: z.number().nonnegative().nullable().optional(),
  compareAtYearly: z.number().nonnegative().nullable().optional(),
});
