import { z } from 'zod';

export const labTestIdParamSchema = z.object({
  testId: z.string().uuid('Invalid test id'),
});

export const labTestResultParameterIdParamSchema = z.object({
  parameterId: z.string().uuid('Invalid parameter id'),
});

export const labTestResultParameterInputTypeSchema = z.enum([
  'text',
  'number',
  'textarea',
  'select',
  'date',
  'boolean',
]);

// Only for inputType 'number' — see docs/lab/LAB_CATALOG_SCHEMA_REWORK.md.
const parameterReferenceRangePayloadSchema = z.object({
  gender: z.enum(['All', 'Male', 'Female']).optional(),
  ageFromYears: z.coerce.number().min(0).max(150).nullable().optional(),
  ageToYears: z.coerce.number().min(0).max(150).nullable().optional(),
  condition: z.string().trim().max(100).nullable().optional(),
  type: z.enum(['range', 'lt', 'gt', 'band']).optional(),
  lowRange: z.coerce.number().nullable().optional(),
  highRange: z.coerce.number().nullable().optional(),
  label: z.string().trim().max(100).nullable().optional(),
});

// Only for inputType 'select' — see docs/lab/LAB_CATALOG_SCHEMA_REWORK.md.
const parameterReferenceRangeSchema =
  parameterReferenceRangePayloadSchema.extend({
    gender: z.enum(['All', 'Male', 'Female']).optional().default('All'),
    type: z.enum(['range', 'lt', 'gt', 'band']).optional().default('range'),
  });

const parameterOptionPayloadSchema = z.object({
  optionValue: z.string().trim().min(1).max(100),
  isNormal: z.boolean().optional(),
});

const parameterOptionSchema = parameterOptionPayloadSchema.extend({
  isNormal: z.boolean().optional().default(false),
});

const labTestResultParameterPayloadSchema = z.object({
  testId: z.string().uuid('Invalid test id'),
  parameterName: z.string().trim().min(1).max(255),
  code: z.string().trim().max(50).nullable().optional(),
  inputType: labTestResultParameterInputTypeSchema.optional(),
  unit: z.string().trim().max(80).nullable().optional(),
  unitless: z.boolean().optional(),
  decimals: z.coerce.number().int().min(0).max(6).optional(),
  section: z.string().trim().max(150).nullable().optional(),
  formula: z.string().trim().max(500).nullable().optional(),
  referenceRange: z.string().trim().max(255).nullable().optional(),
  referenceGender: z.enum(['All', 'Male', 'Female']).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  ranges: z.array(parameterReferenceRangePayloadSchema).max(50).optional(),
  options: z.array(parameterOptionPayloadSchema).max(50).optional(),
});

export const createLabTestResultParameterSchema =
  labTestResultParameterPayloadSchema.extend({
    inputType: labTestResultParameterInputTypeSchema.optional().default('text'),
    unitless: z.boolean().optional().default(false),
    decimals: z.coerce.number().int().min(0).max(6).optional().default(1),
    isRequired: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    ranges: z.array(parameterReferenceRangeSchema).max(50).optional(),
    options: z.array(parameterOptionSchema).max(50).optional(),
  });

export const createLabTestResultParameterWithoutTestSchema =
  createLabTestResultParameterSchema.omit({ testId: true });

export const updateLabTestResultParameterSchema =
  labTestResultParameterPayloadSchema
    .omit({ testId: true })
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be updated',
    });

export type CreateLabTestResultParameterInput = z.infer<
  typeof createLabTestResultParameterSchema
>;
export type UpdateLabTestResultParameterInput = z.infer<
  typeof updateLabTestResultParameterSchema
>;
