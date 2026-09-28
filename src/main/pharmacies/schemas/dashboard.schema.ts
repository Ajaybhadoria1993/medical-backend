import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: 'Invalid date',
  });

export const dashboardSummaryQuerySchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .refine(
    ({ startDate, endDate }) =>
      new Date(`${startDate}T00:00:00.000Z`) <=
      new Date(`${endDate}T00:00:00.000Z`),
    {
      message: 'startDate must be before or equal to endDate',
      path: ['endDate'],
    }
  );

export const salesOverviewQuerySchema = z.object({
  period: z.enum(['week', 'month', 'year']),
  metric: z.enum(['revenue', 'profit', 'orders']),
});

export const dashboardPeriodQuerySchema = z.object({
  period: z.enum(['thisMonth', 'lastMonth']),
});

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
export type SalesOverviewQuery = z.infer<typeof salesOverviewQuerySchema>;
export type DashboardPeriodQuery = z.infer<typeof dashboardPeriodQuerySchema>;
