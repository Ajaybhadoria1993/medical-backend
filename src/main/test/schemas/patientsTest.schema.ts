import z from 'zod';

export const createTestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().min(1, 'Category is required'),
  price: z.number().optional(),
  status: z.enum(['active', 'deactive']).optional().default('active'),
});

export const updateTestSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  price: z.number().optional(),
  status: z.enum(['active', 'deactive']).optional(),
});

export const testIdParamSchema = z.object({
  id: z.string().uuid('Invalid Test ID'),
});
