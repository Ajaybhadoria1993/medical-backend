import { z } from 'zod';

const ratePercent = z.coerce
  .number({ message: 'Enter the GST rate in percent, e.g. 18' })
  .min(0, 'GST cannot be negative')
  .max(40, 'GST cannot be above 40%')
  .multipleOf(0.01, 'Use at most 2 decimals, e.g. 18 or 2.5');

const mode = z.enum(['inclusive', 'exclusive', 'none'], {
  message: 'Choose inclusive, exclusive or no GST',
});

/** A new GST setting: from a date with notice, or from now when the Super Admin skips the notice. */
export const scheduleTaxRateSchema = z
  .object({
    ratePercent,
    mode,
    /** IST calendar day it starts, YYYY-MM-DD; ignored with applyNow. */
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date it starts')
      .optional(),
    /** Start now without notice; the screen asks the Super Admin to confirm. */
    applyNow: z.boolean().default(false),
    reason: z
      .string()
      .trim()
      .min(5, 'Say why GST is changing (at least 5 characters)')
      .max(255, 'Keep the reason under 255 characters'),
  })
  .refine((v) => v.mode !== 'none' || v.ratePercent === 0, {
    message: 'With no GST the rate must be 0',
    path: ['ratePercent'],
  })
  .refine((v) => v.applyNow || !!v.effectiveFrom, {
    message: 'Pick the date it starts, or choose to apply it now',
    path: ['effectiveFrom'],
  });

export type ScheduleTaxRateInput = z.infer<typeof scheduleTaxRateSchema>;

export const previewTaxRateSchema = z
  .object({ ratePercent, mode })
  .refine((v) => v.mode !== 'none' || v.ratePercent === 0, {
    message: 'With no GST the rate must be 0',
    path: ['ratePercent'],
  });

export const taxRateIdParamsSchema = z.object({
  id: z.string().uuid('Invalid GST setting id'),
});
