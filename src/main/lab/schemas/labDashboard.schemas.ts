import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const isValidDateKey = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const optionalDateKey = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
    .refine(isValidDateKey, 'Date must be a valid calendar date')
    .optional()
);

const rawLabDashboardQuerySchema = z.object({
  dateRangeFrom: optionalDateKey,
  dateRangeTo: optionalDateKey,
  // Supported for consistency with the clinic dashboard API.
  startDate: optionalDateKey,
  endDate: optionalDateKey,
  dateRangeStartCount: optionalDateKey,
  dateRangeEndCount: optionalDateKey,
});

export const labDashboardQuerySchema = rawLabDashboardQuerySchema
  .superRefine((query, ctx) => {
    const dateRangeFrom =
      query.dateRangeFrom ?? query.startDate ?? query.dateRangeStartCount;
    const dateRangeTo =
      query.dateRangeTo ?? query.endDate ?? query.dateRangeEndCount;

    if (Boolean(dateRangeFrom) !== Boolean(dateRangeTo)) {
      ctx.addIssue({
        code: 'custom',
        path: dateRangeFrom ? ['dateRangeTo'] : ['dateRangeFrom'],
        message: 'Both date range dates are required when filtering by date',
      });
      return;
    }

    if (dateRangeFrom && dateRangeTo && dateRangeFrom > dateRangeTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateRangeTo'],
        message: 'dateRangeTo must be on or after dateRangeFrom',
      });
    }
  })
  .transform((query) => ({
    dateRangeFrom:
      query.dateRangeFrom ?? query.startDate ?? query.dateRangeStartCount,
    dateRangeTo: query.dateRangeTo ?? query.endDate ?? query.dateRangeEndCount,
  }));

export type LabDashboardQueryInput = z.infer<typeof labDashboardQuerySchema>;

export const labOrderCountTrendQuerySchema = z.object({
  filter: z.preprocess(
    emptyStringToUndefined,
    z.enum(['This Week', 'This Month'])
  ),
});

export type LabOrderCountTrendQueryInput = z.infer<
  typeof labOrderCountTrendQuerySchema
>;
