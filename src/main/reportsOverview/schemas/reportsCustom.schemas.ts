import { z } from 'zod';
import {
  CUSTOM_DATA_SOURCE_IDS,
  CUSTOM_DIMENSIONS,
  CUSTOM_METRICS,
} from '../utils/reportsCustom.catalog';

const metricId = z.string().refine((v) => v in CUSTOM_METRICS, {
  message: 'Unknown metric',
});

const dimensionId = z.string().refine((v) => v in CUSTOM_DIMENSIONS, {
  message: 'Unknown dimension',
});

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/**
 * Body for POST /api/v1/reports-overview/custom/run
 *
 * Metric, dimension and data-source ids are validated against the catalogue
 * here, so the query builder never sees a value it cannot resolve.
 */
export const reportsCustomRunSchema = z.object({
  dataSource: z.enum(CUSTOM_DATA_SOURCE_IDS as [string, ...string[]]),
  metrics: z.array(metricId).min(1, 'Select at least one metric').max(12),
  groupBy: dimensionId,
  thenBy: dimensionId.optional(),
  filters: z
    .object({
      startDate: dateString,
      endDate: dateString,
      doctorId: z.string().uuid().optional(),
      patientId: z.string().uuid().optional(),
      service: z.string().max(250).optional(),
      appointmentType: z.string().max(100).optional(),
      appointmentStatus: z.array(z.string().max(50)).max(12).optional(),
      paymentStatus: z.enum(['collected', 'pending', 'refunded']).optional(),
      paymentMode: z.string().max(50).optional(),
    })
    .refine((f) => f.startDate <= f.endDate, {
      message: 'startDate must be on or before endDate',
    }),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  includeZeroValues: z.coerce.boolean().default(true),
});

export type ReportsCustomRunDto = z.infer<typeof reportsCustomRunSchema>;
