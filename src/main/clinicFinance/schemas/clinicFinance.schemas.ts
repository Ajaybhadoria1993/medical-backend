import { z } from 'zod';

const dateRangeFields = {
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

export const clinicFinanceDateRangeSchema = z
  .object(dateRangeFields)
  .refine((value) => value.startDate <= value.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['startDate'],
  });

export const revenueBreakdownQuerySchema = z
  .object({
    ...dateRangeFields,
    view: z.enum(['daily', 'doctor', 'service']).default('daily'),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['startDate'],
  });

export const settlementListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['COMPLETED', 'PROCESSING', 'FAILED']).optional(),
    startDate: dateRangeFields.startDate.optional(),
    endDate: dateRangeFields.endDate.optional(),
  })
  .refine(
    (value) =>
      (value.startDate === undefined) === (value.endDate === undefined),
    {
      message: 'startDate and endDate must be provided together',
      path: ['startDate'],
    }
  )
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    {
      message: 'startDate must be on or before endDate',
      path: ['startDate'],
    }
  );

export const settlementParamsSchema = z.object({
  settlementId: z.string().uuid(),
});

export const settlementStatementQuerySchema = z.object({
  format: z.enum(['pdf', 'csv']).default('pdf'),
});

export const refundReviewParamsSchema = z.object({
  appointmentId: z.string().uuid(),
});

export const refundReviewDecisionSchema = z.object({
  decision: z.enum(['approved', 'declined']),
  note: z.string().max(1000).optional(),
});

export const disputeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['UNDER_REVIEW', 'RESOLVED_CLINIC', 'RESOLVED_PATIENT'])
    .optional(),
});

export const disputeParamsSchema = z.object({
  disputeId: z.string().uuid(),
});

export type ClinicFinanceDateRangeDto = z.infer<
  typeof clinicFinanceDateRangeSchema
>;
export type RevenueBreakdownQueryDto = z.infer<
  typeof revenueBreakdownQuerySchema
>;

/** A calendar month, "YYYY-MM", for the monthly statement. */
export const statementMonthParamsSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month like 2026-11'),
});
