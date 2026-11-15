import { z } from 'zod';
import { isFullCatalogOrder } from '../utils/specialtyOrder.utils';

export const specialtyOrderBodySchema = z.object({
  order: z.array(z.string().trim().min(1).max(100)).refine(isFullCatalogOrder, {
    message: 'Order must list every main speciality exactly once',
  }),
});

export type SpecialtyOrderBody = z.infer<typeof specialtyOrderBodySchema>;
