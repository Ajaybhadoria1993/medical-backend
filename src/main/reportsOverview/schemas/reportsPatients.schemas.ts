import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview/patients
 */
export const reportsPatientsQuerySchema = z.object({
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

export type ReportsPatientsQueryDto = z.infer<
  typeof reportsPatientsQuerySchema
>;

/**
 * Query schema for GET /api/v1/reports-overview/patients/trend
 */
export const reportsPatientsTrendQuerySchema = z.object({
  type: z.enum(['patients', 'newVsReturning']),
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

export type ReportsPatientsTrendQueryDto = z.infer<
  typeof reportsPatientsTrendQuerySchema
>;
