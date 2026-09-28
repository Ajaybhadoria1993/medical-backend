import { z } from 'zod';

export const createSalesReturnItemSchema = z.object({
  salesItemId: z.string().uuid(),
  returnedQuantity: z.number().int().min(1),
  refundAmount: z.number().min(0).optional(),
});

export const createSalesReturnSchema = z.object({
  saleId: z.string().uuid(),
  refundMethod: z.string().optional(),
  returnReason: z.string().min(1).max(255).optional().nullable(),
  refundNotes: z.string().max(500).optional().nullable(),
  items: z.array(createSalesReturnItemSchema).min(1),
});

export const getSalesReturnsQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  saleId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  refundMethod: z.string().optional(),
});

export type CreateSalesReturnInput = z.infer<typeof createSalesReturnSchema>;
