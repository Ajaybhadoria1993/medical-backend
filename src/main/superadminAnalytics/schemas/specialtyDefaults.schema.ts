import { z } from 'zod';

export const specialtyParamSchema = z.object({
  speciality: z.string().trim().min(1).max(100),
});
