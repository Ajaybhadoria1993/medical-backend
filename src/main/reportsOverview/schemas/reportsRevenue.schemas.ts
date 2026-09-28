import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview/revenue
 */
export const reportsRevenueQuerySchema = z.object({
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
  paymentMode: z.string().optional(),
});

export type ReportsRevenueQueryDto = z.infer<typeof reportsRevenueQuerySchema>;

/**
 * Query schema for GET /api/v1/reports-overview/revenue/trend
 */
export const reportsRevenueTrendQuerySchema = z.object({
  type: z.enum(['revenue', 'collected']),
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
  paymentMode: z.string().optional(),
});

export type ReportsRevenueTrendQueryDto = z.infer<
  typeof reportsRevenueTrendQuerySchema
>;
