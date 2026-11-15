import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const page = {
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const myReferralsQuerySchema = z.object(page);

export const superadminReferralsQuerySchema = z.object({
  ...page,
  status: z.enum(['signed_up', 'joined', 'paid']).optional(),
  /** IST day the signup happened, inclusive. */
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
});

export type MyReferralsQuery = z.infer<typeof myReferralsQuerySchema>;
export type SuperadminReferralsQuery = z.infer<
  typeof superadminReferralsQuerySchema
>;
