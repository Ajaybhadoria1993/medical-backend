import { z } from 'zod';

export const labHomeCollectionUnitSchema = z.enum(['m', 'km']);

const rangeValueSchema = z.coerce
  .number()
  .finite()
  .min(0, 'Range cannot be negative');

const priceSchema = z.coerce
  .number()
  .int('Price must be a whole number')
  .min(0, 'Price cannot be negative');

export const createLabHomeCollectionSchema = z
  .object({
    fromRange: rangeValueSchema,
    toRange: rangeValueSchema,
    unit: labHomeCollectionUnitSchema.optional().default('km'),
    price: priceSchema,
    isActive: z.boolean().optional().default(true),
  })
  .refine((data) => data.toRange > data.fromRange, {
    path: ['toRange'],
    message: 'toRange must be greater than fromRange',
  });

export const updateLabHomeCollectionSchema = z
  .object({
    fromRange: rangeValueSchema.optional(),
    toRange: rangeValueSchema.optional(),
    unit: labHomeCollectionUnitSchema.optional(),
    price: priceSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const getLabHomeCollectionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(10),
  unit: labHomeCollectionUnitSchema.optional(),
  isActive: z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return value;
  }, z.boolean().optional()),
});

export const labHomeCollectionIdParamSchema = z.object({
  homeCollectionId: z.string().uuid('Invalid home collection pricing id'),
});

export type CreateLabHomeCollectionInput = z.infer<
  typeof createLabHomeCollectionSchema
>;
export type UpdateLabHomeCollectionInput = z.infer<
  typeof updateLabHomeCollectionSchema
>;
export type GetLabHomeCollectionsQueryInput = z.infer<
  typeof getLabHomeCollectionsQuerySchema
>;
