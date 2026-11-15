import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = (max = 100) =>
  z.preprocess(emptyStringToUndefined, z.string().trim().max(max).optional());

export const getLabPatientsQuerySchema = z.object({
  page: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional().default(1)
  ),
  limit: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().max(100).optional().default(10)
  ),
  search: optionalTrimmedString(120),
});

export type GetLabPatientsQueryInput = z.infer<
  typeof getLabPatientsQuerySchema
>;
