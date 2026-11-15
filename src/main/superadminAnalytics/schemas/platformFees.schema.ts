import { z } from 'zod';

/** Default fees when no clinic is given; otherwise that clinic's fees. */
export const platformFeesQuerySchema = z.object({
  clinicId: z.string().uuid().optional(),
});

const fee = {
  feeType: z.enum(['CONVENIENCE_FEE', 'CLINIC_COMMISSION', 'GATEWAY_FEE']),
  method: z.enum(['PERCENTAGE', 'FIXED']),
  amount: z.coerce.number().min(0),
  enabled: z.boolean(),
};

/** One fee for the default or a clinic; starts now, or on a later date. */
export const platformFeeSaveSchema = z.object({
  clinicId: z.string().uuid().nullable().default(null),
  ...fee,
  effectiveFrom: z.coerce.date().optional(),
});

/** What a patient pays on a price, now and with the proposed change. */
export const platformFeePreviewSchema = z.object({
  clinicId: z.string().uuid().nullable().default(null),
  price: z.coerce.number().positive().max(1_000_000).default(500),
  change: z.object(fee).optional(),
});

export const platformFeeClinicParamsSchema = z.object({
  clinicId: z.string().uuid(),
});

export type PlatformFeeSaveDto = z.infer<typeof platformFeeSaveSchema>;
export type PlatformFeePreviewDto = z.infer<typeof platformFeePreviewSchema>;
