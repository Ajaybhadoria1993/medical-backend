import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const statusSchema = z.enum(['active', 'inactive']);

const codeSchema = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((value) => value.toUpperCase().replace(/\s+/g, '_'));

export const labDepartmentIdParamSchema = z.object({
  departmentId: z.string().uuid('Invalid department id'),
});

export const getLabDepartmentsQuerySchema = z.object({
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
  status: z.preprocess(emptyStringToUndefined, statusSchema.optional()),
});

export const createLabDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(255),
  code: codeSchema('Department code', 80),
  status: statusSchema.optional().default('active'),
});

export const updateLabDepartmentSchema = createLabDepartmentSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export type CreateLabDepartmentInput = z.infer<
  typeof createLabDepartmentSchema
>;
export type UpdateLabDepartmentInput = z.infer<
  typeof updateLabDepartmentSchema
>;
export type GetLabDepartmentsQueryInput = z.infer<
  typeof getLabDepartmentsQuerySchema
>;
