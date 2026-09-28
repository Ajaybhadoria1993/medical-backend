import z from 'zod';

const labTestStatusSchema = z.enum(['active', 'deactive', 'inactive']);

export const createLabTestsSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    testName: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    departmentId: z.string().uuid('Invalid department id').optional(),
    sampleType: z.string().trim().min(1).max(100).optional(),
    price: z.coerce.number().min(0, 'price cannot be negative').optional(),
    status: labTestStatusSchema.optional().default('active'),
  })
  .refine((data) => Boolean(data.name ?? data.testName), {
    path: ['name'],
    message: 'Name is required',
  })
  .refine((data) => Boolean(data.category ?? data.departmentId), {
    path: ['category'],
    message: 'Category or departmentId is required',
  });

export const updateLabTestsSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    testName: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    departmentId: z.string().uuid('Invalid department id').optional(),
    sampleType: z.string().trim().min(1).max(100).optional(),
    price: z.coerce.number().min(0, 'price cannot be negative').optional(),
    status: labTestStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const labTestsIdParamSchema = z.object({
  id: z.string().uuid('Invalid Test ID'),
});

export const matchingTestsQuerySchema = z.object({
  pageNumber: z
    .string()
    .optional()
    .default('1')
    .transform((val) => parseInt(val))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'pageNumber must be a positive number',
    }),

  pageSize: z
    .string()
    .optional()
    .default('10')
    .transform((val) => parseInt(val))
    .refine((val) => !isNaN(val) && val > 0 && val <= 100, {
      message: 'pageSize must be between 1 and 100',
    }),

  reportStatus: z.enum(['Initiated', 'InProgress', 'Completed']).optional(),

  paymentStatus: z.enum(['pending', 'paid', 'failed']).optional(),

  search: z.string().optional(),

  sortBy: z
    .enum(['createdAt', 'patientName', 'testName', 'matchScore'])
    .optional()
    .default('createdAt'),

  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});
