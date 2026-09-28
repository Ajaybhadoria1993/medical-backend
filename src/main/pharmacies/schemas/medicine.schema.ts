import { z } from 'zod';

export const createMedicineSchema = z.object({
  medicineName: z.string().min(1).max(200),
  brandName: z.string().max(50).optional(),
  composition: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  hsnId: z.string().uuid(),
  form: z.string().max(50).optional(),
  shelf: z.string().max(100).optional(),
  reorder: z.number().int().min(0).optional(),
  packOf: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
});

export const updateMedicineSchema = z
  .object({
    medicineName: z.string().min(1).max(200).optional(),
    brandName: z.string().max(50).optional().nullable(),
    composition: z.string().max(200).optional().nullable(),
    category: z.string().max(100).optional().nullable(),
    hsnId: z.string().uuid().optional(),
    form: z.string().max(50).optional().nullable(),
    shelf: z.string().max(100).optional().nullable(),
    reorder: z.number().int().min(0).optional().nullable(),
    packOf: z.number().int().min(0).optional().nullable(),
    status: z.enum(['active', 'inactive']).optional(),
    tags: z.array(z.string().min(1).max(50)).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const getMedicinesQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  search: z.string().optional(),
  category: z.string().optional(),
  form: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  hsnId: z.string().uuid().optional(),
  stockStatus: z.enum(['empty', 'low', 'medium', 'good']).optional(),
  tag: z.string().optional(),
});

export const getMedicineCategoriesQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),

  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),

  search: z.string().optional(),
});

export const getMedicineBrandsQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),

  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),

  search: z.string().optional(),
});

export const getMedicineByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateMedicineParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminPharmacyIdParamsSchema = z.object({
  pharmacyId: z.string().uuid(),
});

export const adminMedicineParamsSchema = z.object({
  pharmacyId: z.string().uuid(),
  id: z.string().uuid(),
});

export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
