import { z } from 'zod';

import { usernameFieldSchema } from '../../users/schemas/auth.schemas';

/**
 * The public link uses the doctor's username when they have one, else their id.
 * The two never overlap: a username is 5–15 chars, a UUID is 36.
 */
export const doctorPublicProfileParamsSchema = z.object({
  doctorId: z.union([z.string().uuid(), usernameFieldSchema], {
    error: 'Invalid doctor id or username',
  }),
});

/** Public directory search: the patient search minus `available`/`date`
 *  (they scan every row) and with a hard page cap, since anyone can call it. */
export const doctorPublicSearchQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  speciality: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(1).max(50).optional().default(10),
  minExperience: z.coerce.number().int().min(0).max(60).optional(),
  sortBy: z.enum(['relevance', 'experience', 'rating']).optional(),
  pageNumber: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(20).optional().default(10),
});

export type DoctorPublicSearchQueryDto = z.infer<
  typeof doctorPublicSearchQuerySchema
>;

export type DoctorPublicProfileParamsDto = z.infer<
  typeof doctorPublicProfileParamsSchema
>;
