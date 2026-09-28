// clinic-symptom.schema.ts
import z from 'zod';

export const createClinicSymptomSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  description: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export const updateClinicSymptomSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
});
