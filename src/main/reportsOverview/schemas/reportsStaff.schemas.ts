import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview/staff
 */
export const reportsStaffQuerySchema = z.object({
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
  role: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

export type ReportsStaffQueryDto = z.infer<typeof reportsStaffQuerySchema>;

/**
 * Query schema for GET /api/v1/reports-overview/staff/trend
 */
export const reportsStaffTrendQuerySchema = z.object({
  type: z.enum(['appointments', 'completed']),
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
  role: z.string().optional(),
  doctorId: z.string().uuid().optional(),
});

export type ReportsStaffTrendQueryDto = z.infer<
  typeof reportsStaffTrendQuerySchema
>;
