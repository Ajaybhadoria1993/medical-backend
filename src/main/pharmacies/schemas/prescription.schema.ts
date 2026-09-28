import { z } from 'zod';

export const getPrescriptionQueueQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  status: z.enum(['PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED']).optional(),
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  search: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const checkMedicinesSchema = z.object({
  medicineNames: z.array(z.string().min(1)).min(1),
});

export const getPrescriptionByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updatePrescriptionStatusSchema = z.object({
  status: z.enum(['PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED']),
});

export const updatePrescriptionStatusParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetPrescriptionQueueQuery = z.infer<
  typeof getPrescriptionQueueQuerySchema
>;
export type UpdatePrescriptionStatusInput = z.infer<
  typeof updatePrescriptionStatusSchema
>;
