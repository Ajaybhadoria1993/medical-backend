import { z } from 'zod';

export const addStockMedicineSchema = z.object({
  pharmacyMedicineId: z.string().uuid(),
  batch: z.string().max(50).optional(),
  expiry: z.string().date(),
  quantity: z.number().int().min(1),
  mrp: z.number().min(0),
  cost: z.number().min(0),
});

export const updateStockMedicineSchema = z.object({
  id: z.string().uuid().optional(), // For existing medicines
  pharmacyMedicineId: z.string().uuid(),
  batch: z.string().max(50).optional(),
  expiry: z.string().date(),
  quantity: z.number().int().min(1),
  mrp: z.number().min(0),
  cost: z.number().min(0),
});

export const addStockSchema = z.object({
  supplierId: z.string().uuid().optional(),
  purchaseDate: z.string().date(),
  invoice: z.string().optional(),
  pharmacyStockPaymentStatus: z.enum(['paid', 'unpaid', 'partial']),
  paymentNotes: z.string().max(100).optional(),
  medicines: z.array(addStockMedicineSchema).min(1),
});

export const updateStockSchema = z
  .object({
    supplierId: z.string().uuid().optional().nullable(),
    purchaseDate: z.string().date().optional(),
    invoice: z.string().optional().nullable(),
    pharmacyStockPaymentStatus: z
      .enum(['paid', 'unpaid', 'partial'])
      .optional(),
    paymentNotes: z.string().max(100).optional().nullable(),
    medicines: z.array(updateStockMedicineSchema).optional(), // Full medicines array for update
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const updateSingleStockMedicineSchema = z
  .object({
    batch: z.string().max(50).optional(),
    expiry: z.string().date().optional(),
    quantity: z.number().int().min(1).optional(),
    mrp: z.number().min(0).optional(),
    cost: z.number().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be updated',
  });

export const getStockQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  search: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  pharmacyStockPaymentStatus: z.enum(['paid', 'unpaid', 'partial']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  medicineName: z.string().optional(),
  batch: z.string().optional(),
});

export const getExpiryStockQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),

  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),

  medicineName: z.string().optional(),

  expiryDays: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(0).optional()
  ),
});

export const getStockByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateStockParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateStockMedicineParamsSchema = z.object({
  stockMedicineId: z.string().uuid(),
});

export const updateStockInvoiceParamsSchema = z.object({
  stockId: z.string().uuid(),
});

export const getAvailableStockQuerySchema = z.object({
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
  medicineName: z.string().optional(),
});

export type AddStockInput = z.infer<typeof addStockSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type UpdateStockMedicineInput = z.infer<
  typeof updateSingleStockMedicineSchema
>;
export type GetAvailableStockQuery = z.infer<
  typeof getAvailableStockQuerySchema
>;
