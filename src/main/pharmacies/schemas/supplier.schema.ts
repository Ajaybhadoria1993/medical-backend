import { z } from 'zod';

export const createSupplierSchema = z.object({
  supplierName: z.string().min(1).max(100),
  contactPerson: z.string().min(1).max(50),
  phone: z.string().min(1).max(20),
  email: z.string().email().min(10).max(80).optional(),
  address: z.string().optional(),
  gstNumber: z.string().max(30).optional(),
  panNumber: z.string().max(20).optional(),
  creditDays: z.number().int().min(0).default(0),
});

export const updateSupplierSchema = z
  .object({
    supplierName: z.string().min(1).max(100).optional(),
    contactPerson: z.string().min(1).max(50).optional(),
    phone: z.string().min(1).max(20).optional(),
    email: z.string().email().min(10).max(80).optional().nullable(),
    address: z.string().optional().nullable(),
    gstNumber: z.string().max(30).optional().nullable(),
    panNumber: z.string().max(20).optional().nullable(),
    creditDays: z.number().int().min(0).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const getSuppliersQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const getSupplierByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateSupplierParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
