import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const packageStatusSchema = z.enum(['Active', 'Inactive']);

const codeSchema = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((value) => value.toUpperCase().replace(/\s+/g, '_'));

const labTestIdsSchema = z
  .array(z.string().uuid('Invalid test id'))
  .min(1, 'At least one test is required');

export const labTestPackageIdParamSchema = z.object({
  packageId: z.string().uuid('Invalid package id'),
});

export const getLabTestPackagesQuerySchema = z.object({
  page: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional().default(1)
  ),
  limit: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().max(100).optional().default(10)
  ),
  search: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().max(100).optional()
  ),
  status: z.preprocess(emptyStringToUndefined, packageStatusSchema.optional()),
});

export const createLabTestPackageSchema = z.object({
  packageName: z.string().trim().min(2).max(100),
  packageCode: codeSchema('Package code', 50),
  packagePrice: z.coerce.number().int().min(0),
  status: packageStatusSchema.optional().default('Active'),
  labTestIds: labTestIdsSchema,
});

export const updateLabTestPackageSchema = createLabTestPackageSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export type CreateLabTestPackageInput = z.infer<
  typeof createLabTestPackageSchema
>;
export type UpdateLabTestPackageInput = z.infer<
  typeof updateLabTestPackageSchema
>;
export type GetLabTestPackagesQueryInput = z.infer<
  typeof getLabTestPackagesQuerySchema
>;
