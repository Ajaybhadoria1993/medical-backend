import { z } from 'zod';

export const startSupportSessionSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
  targetUserId: z.string().uuid('Invalid staff member ID'),
  reason: z
    .string()
    .trim()
    .min(10, 'Give a reason of at least 10 characters, e.g. a ticket number')
    .max(255),
});

export const clinicParamSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
});

export const sessionsQuerySchema = z.object({
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type StartSupportSessionDto = z.infer<typeof startSupportSessionSchema>;
