import z from 'zod';

export const getMedicineDataQuerySchema = z.object({
  medicine_name: z.string().optional(),
  composition: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});
