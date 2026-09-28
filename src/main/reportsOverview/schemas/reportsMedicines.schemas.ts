import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview/medicines
 */
export const reportsMedicinesQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  compareStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'compareStartDate must be YYYY-MM-DD')
    .optional(),
  compareEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'compareEndDate must be YYYY-MM-DD')
    .optional(),
  category: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  pharmacyId: z.string().uuid().optional(),
});

export type ReportsMedicinesQueryDto = z.infer<
  typeof reportsMedicinesQuerySchema
>;

/**
 * Query schema for GET /api/v1/reports-overview/medicines/trend
 */
export const reportsMedicinesTrendQuerySchema = z.object({
  type: z.enum(['sales', 'units']),
  period: z.enum(['daily', 'weekly', 'monthly']),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD'),
  compareStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'compareStartDate must be YYYY-MM-DD')
    .optional(),
  compareEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'compareEndDate must be YYYY-MM-DD')
    .optional(),
  category: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  pharmacyId: z.string().uuid().optional(),
});

export type ReportsMedicinesTrendQueryDto = z.infer<
  typeof reportsMedicinesTrendQuerySchema
>;
