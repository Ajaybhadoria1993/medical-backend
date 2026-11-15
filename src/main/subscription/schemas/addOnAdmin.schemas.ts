import { z } from 'zod';

// Same cap as the Super Admin form; stops a typo like 49900 for 499.
export const MAX_ADDON_PRICE = 100000;
const price = z.coerce
  .number({ message: 'Enter a price in rupees' })
  .min(0, 'A price cannot be negative')
  .max(MAX_ADDON_PRICE, 'A price cannot be more than ₹1,00,000');

export const addOnIdParamsSchema = z.object({
  addOnId: z.string().uuid('Invalid add-on id'),
});

export const addOnPriceParamsSchema = z.object({
  addOnId: z.string().uuid('Invalid add-on id'),
  priceId: z.string().uuid('Invalid price id'),
});

export const updateAddOnSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the add-on name').max(150).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const scheduleAddOnPriceSchema = z.object({
  monthlyPrice: price,
  yearlyPrice: price,
  effectiveFrom: z.coerce.date({
    message: 'Enter the date the new price starts',
  }),
});
