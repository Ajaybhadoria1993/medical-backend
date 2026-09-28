import { z } from 'zod';

const MAX_IMAGE_BASE64_LENGTH = 8_000_000;

export const scanPrescriptionSchema = z
  .object({
    imageBase64: z.string().min(1).optional(),
    imageUrl: z.url().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.imageBase64 &&
      value.imageBase64.length > MAX_IMAGE_BASE64_LENGTH
    ) {
      context.addIssue({
        code: 'custom',
        message: 'imageBase64 payload too large',
        path: ['imageBase64'],
      });
    }
  })
  .refine(
    (value) => Boolean(value.imageBase64 || value.imageUrl),
    'Provide at least one of imageBase64 or imageUrl'
  );

export type ScanPrescriptionPayload = z.infer<typeof scanPrescriptionSchema>;
