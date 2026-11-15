import { z } from 'zod';
import { getISTDateString } from '../../../utils/istDateTime';
import { ALL_VACCINES } from '../../../utils/specialties/vaccines';

export const patientVaccinePatientParamsSchema = z.object({
  patientId: z.string().uuid('patientId must be a valid id'),
});

export const patientVaccineIdParamsSchema = z.object({
  id: z.string().uuid('id must be a valid id'),
});

// A dose typed in from the patient page; YYYY-MM-DD, never in the future.
export const addPatientVaccineSchema = z.object({
  patientId: z.string().uuid('patientId must be a valid id'),
  vaccine: z
    .string()
    .refine((v) => ALL_VACCINES.includes(v), 'Pick a vaccine from the list'),
  givenOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .refine((d) => d <= getISTDateString(), 'Date cannot be in the future'),
  batch: z.string().trim().max(50).optional(),
});

export type PatientVaccinePatientParamsDto = z.infer<
  typeof patientVaccinePatientParamsSchema
>;
export type PatientVaccineIdParamsDto = z.infer<
  typeof patientVaccineIdParamsSchema
>;
export type AddPatientVaccineDto = z.infer<typeof addPatientVaccineSchema>;
