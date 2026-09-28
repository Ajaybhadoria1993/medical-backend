import { z } from 'zod';

/**
 * Query schema for GET /api/v1/reports-overview/appointments
 */
export const reportsAppointmentsQuerySchema = z.object({
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
  appointmentType: z.string().optional(),
});

export type ReportsAppointmentsQueryDto = z.infer<
  typeof reportsAppointmentsQuerySchema
>;

/**
 * Query schema for GET /api/v1/reports-overview/appointments/trend
 */
export const reportsAppointmentsTrendQuerySchema = z.object({
  type: z.enum(['appointments', 'byDay', 'timeSlots', 'doctors']),
  period: z.enum([
    'daily',
    'weekly',
    'monthly',
    'thisWeek',
    'lastWeek',
    'thisMonth',
  ]),
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
  appointmentType: z.string().optional(),
});

export type ReportsAppointmentsTrendQueryDto = z.infer<
  typeof reportsAppointmentsTrendQuerySchema
>;
