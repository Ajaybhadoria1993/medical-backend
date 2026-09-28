import { z } from 'zod';

export const createSaleItemSchema = z.object({
  pharmacyStockMedicineId: z.string().uuid(),
  quantity: z.number().int().min(1),
  discountPercent: z.number().min(0).max(100).default(0),
});

export const createSaleSchema = z.object({
  prescriptionId: z.string().uuid().optional(),
  subscriptionId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  patientName: z.string().max(50),
  patientMobile: z.string().min(10).max(10).optional(),
  paymentMethod: z.string().optional(),
  paymentNotes: z.string().max(100).optional(),
  items: z.array(createSaleItemSchema).min(1),
});

export const getSalesQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  paymentMethod: z.string().optional(),
  prescriptionId: z.string().uuid().optional(),
});

export const getSaleByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const sendInvoiceWhatsAppParamsSchema = z.object({
  saleId: z.string().uuid(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CreateSaleItemInput = z.infer<typeof createSaleItemSchema>;
