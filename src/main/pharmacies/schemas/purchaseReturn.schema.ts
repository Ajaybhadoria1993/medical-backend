import { z } from 'zod';

export const createPurchaseReturnItemSchema = z.object({
  stockMedicineId: z.string().uuid(),
  returnedQuantity: z.number().int().min(1),
  refundAmount: z.number().min(0).optional(),
});

export const createPurchaseReturnSchema = z.object({
  stockId: z.string().uuid(),
  refundMethod: z.string().optional(),
  returnReason: z.string().min(1).max(255).optional().nullable(),
  refundNotes: z.string().max(500).optional().nullable(),
  items: z.array(createPurchaseReturnItemSchema).min(1),
});

export const getPurchaseReturnsQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  stockId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  refundMethod: z.string().optional(),
});

export type CreatePurchaseReturnInput = z.infer<
  typeof createPurchaseReturnSchema
>;
