import { z } from 'zod';
import { MAX_EXTEND_DAYS } from '../utils/autoPay.utils';

const reason = z
  .string()
  .trim()
  .min(5, 'Say why (at least 5 characters)')
  .max(500);

export const billingCheckIdParamsSchema = z.object({
  id: z.string().uuid('Invalid id'),
});
export const billingClinicParamsSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic id'),
});
export const billingClinicPaymentParamsSchema =
  billingClinicParamsSchema.extend({
    paymentId: z.string().uuid('Invalid payment id'),
  });
export const billingClinicInvoiceParamsSchema =
  billingClinicParamsSchema.extend({
    invoiceId: z.string().uuid('Invalid invoice id'),
  });

export const billingReasonSchema = z.object({ reason });
export const billingResolveSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Say what you checked or did (at least 5 characters)')
    .max(500),
});
export const billingExtendSchema = z.object({
  days: z.number().int().min(1).max(MAX_EXTEND_DAYS),
  reason,
});

/** Staging test tool actions (one clinic). */
export const billingTestParamsSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic id'),
  action: z.enum(['renew', 'grace', 'end_grace', 'reminder', 'restore']),
});
