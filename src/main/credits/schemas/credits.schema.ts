import { z } from 'zod';
import { CREDIT_TYPES } from '../utils/creditTypes.utils';

const creditType = z.enum(CREDIT_TYPES);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const reason = z
  .string()
  .trim()
  .max(255)
  .refine(
    (v) => v.split(/\s+/).filter(Boolean).length >= 5,
    'Give a reason of at least 5 words'
  );

const page = {
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const creditTypeQuerySchema = z.object({
  creditType: creditType.default('whatsapp'),
});

export const grantsQuerySchema = z.object({
  creditType: creditType.default('whatsapp'),
  ...page,
});

export const creditTypeParamSchema = z.object({ creditType });

export const clinicParamSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
});

export const historyQuerySchema = z.object(page);

export const creditChangeSchema = z.object({
  creditType: creditType.default('whatsapp'),
  credits: z.number().int().min(1).max(1_000_000),
  reason,
});

/** A new settings version. Money fields are decimal strings so nothing is lost to floats. */
export const settingsChangeSchema = z
  .object({
    expiryDays: z.number().int().min(1).max(3650),
    reminderDays: z.number().int().min(0).max(365),
    warnPercent: z.number().int().min(1).max(99),
    unitCostInr: z
      .string()
      .regex(/^\d{1,6}(\.\d{1,4})?$/, 'Up to 4 decimal places'),
    taxPercent: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Up to 2 decimal places')
      .refine((v) => Number(v) <= 100, 'Tax cannot exceed 100%'),
    /** Omitted = now; a future time schedules the change. */
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    reason,
  })
  .refine((v) => v.reminderDays < v.expiryDays, {
    message: 'The reminder must come before the credits expire',
    path: ['reminderDays'],
  });

export const packParamSchema = z.object({
  creditType,
  packId: z.string().uuid('Invalid pack ID'),
});

const packFields = {
  credits: z.number().int().min(1).max(1_000_000),
  /** Rupees, GST included; a decimal string so nothing is lost to floats. */
  priceInr: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Up to 2 decimal places'),
  sortOrder: z.number().int().min(0).max(999),
};

export const packCreateSchema = z.object({
  ...packFields,
  sortOrder: packFields.sortOrder.default(0),
  reason,
});

export const packUpdateSchema = z
  .object({
    credits: packFields.credits.optional(),
    priceInr: packFields.priceInr.optional(),
    sortOrder: packFields.sortOrder.optional(),
    active: z.boolean().optional(),
    reason,
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'Nothing to change' });

export const costReportQuerySchema = z
  .object({
    creditType: creditType.default('whatsapp'),
    from: isoDate,
    to: isoDate,
    ...page,
  })
  .refine((v) => v.from <= v.to, {
    message: '"from" must not be after "to"',
    path: ['from'],
  });
