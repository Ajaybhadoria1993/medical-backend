import { z } from 'zod';

export const validateUpiSchema = z.object({
  upiId: z
    .string()
    .trim()
    .min(3, 'UPI ID is required')
    .regex(/^[^@\s]+@[^@\s]+$/, 'Invalid UPI ID format'),
});

export type ValidateUpiDto = z.infer<typeof validateUpiSchema>;
