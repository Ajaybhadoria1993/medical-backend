import { z } from 'zod';
import { createLabDepartmentSchema } from './labDepartment.schemas';
import { createLabTestResultParameterWithoutTestSchema } from './labTestResultParameters.schemas';
import { labTestClinicalFieldsSchema } from './labTests.schemas';

const statusSchema = z.enum(['active', 'inactive']);

const richTextFieldSchema = z.string().trim().max(20000).nullable().optional();

const codeSchema = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((value) => value.toUpperCase().replace(/\s+/g, '_'));

const labUpdatedSuggestionTestSchema = z
  .object({
    testName: z.string().trim().min(1).max(255),
    comments: richTextFieldSchema,
    interpretation: richTextFieldSchema,
    notes: richTextFieldSchema,
    testCode: codeSchema('Test code'),
    sampleType: z.string().trim().min(1).max(100),
    price: z.coerce.number().int().min(0).optional(),
    departmentId: z.string().uuid('Invalid department id').optional(),
    departmentCode: codeSchema('Department code', 80).optional(),
    status: statusSchema.optional().default('active'),
    parameters: z
      .array(createLabTestResultParameterWithoutTestSchema)
      .max(100)
      .optional()
      .default([]),
  })
  .merge(labTestClinicalFieldsSchema)
  .extend({
    // Suggestions can name a group by text (auto-created/matched, like
    // departmentCode) in addition to the direct-API groupId.
    groupName: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => data.departmentId || data.departmentCode, {
    message: 'departmentId or departmentCode is required',
  });

export const applyLabUpdatedSuggestionsSchema = z
  .object({
    departmentCodes: z.array(z.string().trim()).optional(),
    testCodes: z.array(z.string().trim()).optional(),
    testPrices: z
      .record(
        codeSchema('Test code'),
        z.coerce.number().int().min(0, 'price cannot be negative')
      )
      .optional(),
    departments: z.array(createLabDepartmentSchema).optional(),
    tests: z.array(labUpdatedSuggestionTestSchema).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Select at least one department or test',
  });

export type ApplyLabUpdatedSuggestionsInput = z.infer<
  typeof applyLabUpdatedSuggestionsSchema
>;

const uuidArrayQuerySchema = z.preprocess(
  (value) => {
    const values = Array.isArray(value) ? value : [value];

    return values
      .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean);
  },
  z
    .array(z.string().uuid('Invalid test id'))
    .min(1, 'At least one test id is required')
);

export const getLabTestResultParametersByTestIdsSchema = z.object({
  testIds: uuidArrayQuerySchema,
});

export type GetLabTestResultParametersByTestIdsInput = z.infer<
  typeof getLabTestResultParametersByTestIdsSchema
>;

const singleOrMultipleUuidSchema = z
  .union([
    z.string().uuid('Invalid lab order id'),
    z
      .array(z.string().uuid('Invalid lab order id'))
      .min(1, 'At least one lab order id is required')
      .max(100, 'A maximum of 100 lab order ids is allowed'),
  ])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export const getLabOrderActivitiesSchema = z.object({
  labOrderIds: singleOrMultipleUuidSchema,
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type GetLabOrderActivitiesInput = z.infer<
  typeof getLabOrderActivitiesSchema
>;

export const updateLabSampleCodeSettingsSchema = z.object({
  autoGenerateSampleCode: z.boolean(),
});

export const getReferringDoctorsQuerySchema = z.object({
  page: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().optional().default(1)
  ),
  limit: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().positive().max(100).optional().default(10)
  ),
  search: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().max(120).optional()
  ),
});

export type GetReferringDoctorsQueryInput = z.infer<
  typeof getReferringDoctorsQuerySchema
>;

export type UpdateLabSampleCodeSettingsInput = z.infer<
  typeof updateLabSampleCodeSettingsSchema
>;
