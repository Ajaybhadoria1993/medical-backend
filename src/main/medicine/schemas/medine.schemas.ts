import z from 'zod';

// ============ Medicine Schemas ============

/**
 * Tidy a user-supplied dosage form without restricting what it may be.
 *
 * Deliberately not an enum: clinics stock forms no fixed list predicts, and
 * rejecting an unrecognised one blocks a legitimate import. What actually
 * hurts the data is the same form arriving as "tablet", "TABLET" and
 * " Tablet ", which then read as three different forms in the picker and in
 * duplicate checks. Collapsing whitespace and title-casing fixes that while
 * still accepting anything.
 */
export const normaliseMedicineForm = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(
      /(^|[\s/-])([a-z])/g,
      (_match, boundary, letter) => boundary + letter.toUpperCase()
    );

export const createMedicineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Medicine name is required')
    .max(255, 'Medicine name must be 255 characters or fewer'),
  genericName: z.string().max(255).optional(),
  manufacturer: z.string().max(255).optional(),
  composition: z.string().trim().max(1000).optional(),
  // Required: a medicine without a form cannot be prescribed safely — the
  // dose and timing UI both key off it. Free text for now; the picker offers
  // a suggested list without restricting to it.
  form: z
    .string()
    .trim()
    .min(1, 'Medicine form is required')
    .max(50)
    .transform(normaliseMedicineForm),
  strength: z.string().max(50).optional(), // e.g., "500mg"
  category: z.string().max(100).optional(),
  requiresPrescription: z.boolean().optional().default(false),
});

export const updateMedicineSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  genericName: z.string().max(255).optional(),
  manufacturer: z.string().max(255).optional(),
  composition: z.string().trim().max(1000).optional(),
  form: z.string().trim().max(50).transform(normaliseMedicineForm).optional(),
  strength: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  requiresPrescription: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const searchMedicineQuerySchema = z.object({
  q: z.string().min(1).optional(), // search query
  category: z.string().optional(),
  requiresPrescription: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  isFavorite: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  isActive: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  pageNumber: z.string().optional(),
  pageSize: z.string().optional(),
});

export const medicineParamsSchema = z.object({
  medicineId: z.string().uuid('Invalid medicine ID'),
});

export const locationsQuerySchema = z.object({}).passthrough();

export const searchAllQuerySchema = z
  .object({
    q: z.string().optional(),
    page: z.string().optional(),
    per_page: z.string().optional(),
  })
  .passthrough();

export const searchAutoCompleteQuerySchema = z
  .object({
    q: z.string().optional(),
  })
  .passthrough();

export const drugstaticParamsSchemas = z.object({
  drug_sku_id: z.string().min(1),
});

export const drugstaticQuerySchemas = z.object({}).passthrough();

export const addStockSchema = z
  .object({
    medicineId: z.string().uuid().optional(),
    pharmacyId: z.string().uuid().optional(),
    clinicId: z.string().uuid().optional(),
    batchNo: z.string().min(1).optional(),
    expiryDate: z.coerce.date().optional(),
    quantity: z.coerce.number().int().positive(),
    purchasePrice: z.coerce.number().nonnegative().optional(),
    sellingPrice: z.coerce.number().nonnegative().optional(),
  })
  .passthrough();

export const updateStockSchema = z
  .object({
    batchNo: z.string().min(1).optional(),
    expiryDate: z.coerce.date().optional(),
    quantity: z.coerce.number().int().positive().optional(),
    purchasePrice: z.coerce.number().nonnegative().optional(),
    sellingPrice: z.coerce.number().nonnegative().optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .passthrough();

export const stockQuerySchema = z
  .object({
    medicineId: z.string().uuid().optional(),
    q: z.string().optional(),
    pageNumber: z.string().optional(),
    pageSize: z.string().optional(),
    lowStockOnly: z.coerce.boolean().optional(),
    expiringBefore: z.coerce.date().optional(),
  })
  .passthrough();

export const stockParamsSchema = z.object({
  stockId: z.string().uuid(),
});

export const stockPricingSchema = z
  .object({
    mrp: z.coerce.number().nonnegative().optional(),
    sellingPrice: z.coerce.number().nonnegative().optional(),
    purchasePrice: z.coerce.number().nonnegative().optional(),
    effectiveFrom: z.coerce.date().optional(),
  })
  .passthrough();

export const pricingHistoryQuerySchema = z
  .object({
    pageNumber: z.string().optional(),
    pageSize: z.string().optional(),
  })
  .passthrough();
