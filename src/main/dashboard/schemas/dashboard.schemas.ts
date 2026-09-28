import z from 'zod';

export const dashboardQuerySchema = z.object({
  months: z.number().min(1, 'months is required').optional(),
  startDate: z.string().min(1, 'startDate is required').optional(),
  endDate: z.string().min(1, 'endDate is required').optional(),
  dateRangeStartCount: z.string().min(1, 'dateRange is required').optional(),
  dateRangeEndCount: z.string().min(1, 'dateRange is required').optional(),
});

export const dashboardDoctorQuerySchema = z.object({
  startDate: z.string().min(1, 'startDate is required').optional(),
  endDate: z.string().min(1, 'endDate is required').optional(),
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
});

export const superAdminDashboardQuerySchema = z.object({
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
});

export type DashboardQueryDto = z.infer<typeof dashboardQuerySchema>;
export type DashboardDoctorQueryDto = z.infer<
  typeof dashboardDoctorQuerySchema
>;
export type SuperAdminDashboardQueryDto = z.infer<
  typeof superAdminDashboardQuerySchema
>;

export const revenueOverviewQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  startDate: z.string().min(1, 'startDate is required').optional(),
  endDate: z.string().min(1, 'endDate is required').optional(),
});

export type RevenueOverviewQueryDto = z.infer<
  typeof revenueOverviewQuerySchema
>;

export const todayOverviewQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  // Opt-in, so callers relying on the documented own-id default are unaffected.
  scope: z.enum(['clinic']).optional(),
});

export type TodayOverviewQueryDto = z.infer<typeof todayOverviewQuerySchema>;

export const receptionOverviewQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
});

export type ReceptionOverviewQueryDto = z.infer<
  typeof receptionOverviewQuerySchema
>;

export const superAdminRevenueQuerySchema = z.object({
  period: z
    .enum([
      'month',
      'year',
      'thisMonth',
      'thisYear',
      'monthly',
      'yearly',
      'week',
      'weekly',
    ])
    .default('month'),
});

export type SuperAdminRevenueQueryDto = z.infer<
  typeof superAdminRevenueQuerySchema
>;
