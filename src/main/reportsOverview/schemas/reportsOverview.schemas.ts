import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview
 */
export const reportsOverviewQuerySchema = z.object({
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
  department: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

export type ReportsOverviewQueryDto = z.infer<
  typeof reportsOverviewQuerySchema
>;

/**
 * Query schema for GET /api/v1/reports-overview/trend
 */
export const reportsOverviewTrendQuerySchema = z.object({
  type: z.enum(['appointments', 'prescriptions', 'revenue']),
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
  department: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

export type ReportsOverviewTrendQueryDto = z.infer<
  typeof reportsOverviewTrendQuerySchema
>;
