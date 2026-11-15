import { z } from 'zod';

/** One page of clinic payouts; state and search are applied in SQL (BE §7). */
export const payoutAccountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  state: z
    .enum([
      'not_set_up',
      'setting_up',
      'verifying',
      'action_needed',
      'ready',
      'suspended',
    ])
    .optional(),
  q: z.string().trim().max(100).optional(),
  /** One clinic's payout status (Clinic Details → Overview). */
  clinicId: z.string().uuid().optional(),
});

export type PayoutAccountsQueryDto = z.infer<typeof payoutAccountsQuerySchema>;
