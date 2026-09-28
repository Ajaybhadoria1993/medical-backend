import { z } from 'zod';

export const createSubscriptionMedicineSchema = z.object({
  pharmacyMedicineId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

export const createSubscriptionSchema = z.object({
  customerName: z.string().max(50).optional(),
  customerMobile: z.string().max(15).optional(),
  customerAddress: z.string().max(100).optional(),
  frequencyDays: z.number().int().min(1),
  nextDeliveryDate: z.string().datetime(),
  remarks: z.string().max(255).optional(),
  medicines: z.array(createSubscriptionMedicineSchema).min(1),
});

export const updateSubscriptionSchema = z.object({
  customerName: z.string().max(50).optional(),
  customerMobile: z.string().max(15).optional(),
  customerAddress: z.string().max(100).optional(),
  frequencyDays: z.number().int().min(1).optional(),
  nextDeliveryDate: z.string().datetime().optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  remarks: z.string().max(255).optional(),
  medicines: z.array(createSubscriptionMedicineSchema).optional(),
});

export const getSubscriptionsQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
  search: z.string().optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const getSubscriptionByIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const getSubscriptionsNotificationQuerySchema = z.object({
  pageNumber: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).optional()
  ),
  pageSize: z.preprocess(
    (v) => (v === undefined ? undefined : Number(v)),
    z.number().int().min(1).max(100).optional()
  ),
});

export const updateNextDeliveryDateSchema = z.object({
  nextDeliveryDate: z.string().datetime(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type GetSubscriptionsQuery = z.infer<typeof getSubscriptionsQuerySchema>;
export type GetSubscriptionsNotificationQuery = z.infer<
  typeof getSubscriptionsNotificationQuerySchema
>;
