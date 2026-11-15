import { z } from 'zod';
import { createLabTestResultParameterWithoutTestSchema } from './labTestResultParameters.schemas';

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

export const labTestIdParamSchema = z.object({
  testId: z.string().uuid('Invalid test id'),
});

export const getLabTestsQuerySchema = z.object({
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
  departmentId: z.preprocess(
    emptyStringToUndefined,
    z.string().uuid('Invalid department id').optional()
  ),
});

// Shared with the /suggestions apply payload (labUpdated.schemas.ts) so a
// test's clinical/catalog metadata is validated identically from either API.
export const labTestClinicalFieldsSchema = z.object({
  shortName: z.string().trim().max(100).nullable().optional(),
  loincCode: z.string().trim().max(30).nullable().optional(),
  container: z.string().trim().max(100).nullable().optional(),
  sampleVolume: z.string().trim().max(100).nullable().optional(),
  stability: z.string().trim().max(2000).nullable().optional(),
  storage: z.string().trim().max(2000).nullable().optional(),
  method: z.string().trim().max(2000).nullable().optional(),
  technology: z.string().trim().max(150).nullable().optional(),
  testType: z.string().trim().max(50).nullable().optional(),
  turnaroundTimeHours: z.coerce.number().int().min(0).nullable().optional(),
  clinicalSignificance: z.string().trim().max(20000).nullable().optional(),
  limitations: z.string().trim().max(20000).nullable().optional(),
  advice: z.string().trim().max(20000).nullable().optional(),
  testDisclaimer: z.string().trim().max(20000).nullable().optional(),
  whenResultHigh: z.string().trim().max(20000).nullable().optional(),
  whenResultLow: z.string().trim().max(20000).nullable().optional(),
  whenResultCritical: z.string().trim().max(20000).nullable().optional(),
  groupId: z.string().uuid('Invalid group id').nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
});

const labTestPayloadSchema = z
  .object({
    testName: z.string().trim().min(1).max(255),
    comments: z.string().trim().max(20000).nullable().optional(),
    interpretation: z.string().trim().max(20000).nullable().optional(),
    notes: z.string().trim().max(20000).nullable().optional(),
    testCode: codeSchema('Test code'),
    sampleType: z.string().trim().min(1).max(100),
    price: z.coerce.number().int().min(0),
    status: statusSchema.optional(),
    parameters: z
      .array(createLabTestResultParameterWithoutTestSchema)
      .max(100)
      .optional(),
  })
  .merge(labTestClinicalFieldsSchema);

export const createLabTestSchema = labTestPayloadSchema.extend({
  departmentCode: codeSchema('Department code', 80),
  status: statusSchema.optional().default('active'),
  parameters: z
    .array(createLabTestResultParameterWithoutTestSchema)
    .max(100)
    .optional()
    .default([]),
});

export const updateLabTestSchema = labTestPayloadSchema
  .extend({
    departmentId: z.string().uuid('Invalid department id'),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export type CreateLabTestInput = z.infer<typeof createLabTestSchema>;
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema>;
export type GetLabTestsQueryInput = z.infer<typeof getLabTestsQuerySchema>;
