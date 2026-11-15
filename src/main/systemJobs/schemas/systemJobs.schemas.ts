import { z } from 'zod';

export const jobKeyParamsSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,80}$/, 'Unknown job'),
});
