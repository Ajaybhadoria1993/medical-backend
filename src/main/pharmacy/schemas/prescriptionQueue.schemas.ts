import { z } from 'zod';

export const updatePrescriptionStatusSchema = z.object({
  status: z.enum(['PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED']),
});
export const updatePrescriptionStatusParamsSchema = z.object({
  id: z.string().uuid(), // or just z.string() if not a UUID
});

export const getPrescriptionQueueListSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('10'),
  sort: z.enum(['asc', 'desc']).optional().default('desc'),
  status: z.enum(['PENDING', 'ON_HOLD', 'COMPLETED', 'REJECTED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});

export const getPrescriptionQueueDetailsSchema = z.object({
  id: z.string().uuid(),
});
