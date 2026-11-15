import { z } from 'zod';
import { MAX_TIERS } from '../utils/commissionPricing.utils';
import { PERIOD_KINDS } from '../utils/commissionPeriod.utils';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date');

const reason = z
  .string()
  .trim()
  .max(255)
  .refine(
    (v) => v.split(/\s+/).filter(Boolean).length >= 5,
    'Give a reason of at least 5 words'
  );

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

const tier = z.object({
  fromPatients: z.number().int().min(0).max(1_000_000),
  /** Rupees per patient. */
  ratePerPatient: z
    .number()
    .min(0)
    .max(1000)
    .refine(twoDecimals, 'Up to 2 decimal places'),
});

const tiers = z
  .array(tier)
  .min(1)
  .max(MAX_TIERS)
  .superRefine((list, ctx) => {
    if (list[0]?.fromPatients !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'The first tier must start at 0 patients',
        path: [0, 'fromPatients'],
      });
    }
    list.forEach((t, i) => {
      if (i > 0 && t.fromPatients <= list[i - 1].fromPatients) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each tier must start at more patients than the one before',
          path: [i, 'fromPatients'],
        });
      }
    });
  });

export const periodQuerySchema = z.object({ date: isoDate.optional() });

export const doctorAppointmentsQuerySchema = z.object({
  date: isoDate.optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const doctorParamSchema = z.object({
  doctorId: z.string().uuid('Invalid doctor ID'),
});

export const clinicParamSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** A new platform default; it starts with the next billing period. */
export const defaultPricingChangeSchema = z.object({
  periodKind: z.enum(PERIOD_KINDS),
  tiers,
  reason,
});

/** A clinic's own pricing, or `useDefault: true` to go back to the platform default. */
export const clinicPricingChangeSchema = z.discriminatedUnion('useDefault', [
  z.object({ useDefault: z.literal(true), reason }),
  z.object({
    useDefault: z.literal(false),
    periodKind: z.enum(PERIOD_KINDS),
    tiers,
    reason,
  }),
]);

export type DefaultPricingChange = z.infer<typeof defaultPricingChangeSchema>;
export type ClinicPricingChange = z.infer<typeof clinicPricingChangeSchema>;
