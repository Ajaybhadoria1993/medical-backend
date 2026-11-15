import { z } from 'zod';
import {
  onboardRouteSchema,
  updateBankDetailsSchema,
} from '../../clinic/schemas/clinic.schemas';

/** The one setup form: multipart sends the details as a JSON string next to the document files. */
export const payoutAccountSubmitSchema = z.object({
  details: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, onboardRouteSchema),
});

const upiDestinationSchema = z.object({
  vpa: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,256}@[a-z]{2,64}$/, 'Enter a UPI ID like name@bank'),
  beneficiaryName: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters'),
});

/** Change where payouts go after setup: a UPI ID or a bank account. A bare bank body (old apps) means bank. */
export const payoutAccountBankSchema = z.preprocess(
  (body) =>
    body && typeof body === 'object' && !('method' in body)
      ? { method: 'bank', bank: body }
      : body,
  z.discriminatedUnion('method', [
    z.object({ method: z.literal('bank'), bank: updateBankDetailsSchema }),
    z.object({ method: z.literal('upi'), upi: upiDestinationSchema }),
  ])
);

export type PayoutDestinationDto = z.infer<typeof payoutAccountBankSchema>;

export type PayoutAccountSubmitDto = z.infer<typeof payoutAccountSubmitSchema>;
