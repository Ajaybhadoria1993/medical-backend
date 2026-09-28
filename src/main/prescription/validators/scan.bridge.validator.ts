import { z } from 'zod';
import { scanPrescriptionSchema } from './prescription.validator';

const OTP_REGEX = /^[A-Z0-9]{6}$/;

export const MAX_BRIDGE_UPLOAD_BYTES = 5 * 1024 * 1024;

// The phone sends raw base64 with no MIME type, so the file type is read from its leading bytes.
const BRIDGE_FILE_SIGNATURES = [
  { type: 'JPEG', base64Prefix: '/9j/' },
  { type: 'PNG', base64Prefix: 'iVBORw0KGgo' },
  { type: 'PDF', base64Prefix: 'JVBER' },
] as const;

export const decodedBase64Bytes = (base64: string): number => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

export const detectBridgeFileType = (base64: string) =>
  BRIDGE_FILE_SIGNATURES.find((s) => base64.startsWith(s.base64Prefix))?.type ??
  null;

export const scanBridgeOtpQuerySchema = z.object({
  otp: z.string().trim().toUpperCase().regex(OTP_REGEX, 'Invalid OTP format'),
});

export const scanBridgeUploadSchema = scanPrescriptionSchema.superRefine(
  (value, context) => {
    if (!value.imageBase64) return;

    if (!detectBridgeFileType(value.imageBase64)) {
      context.addIssue({
        code: 'custom',
        message: 'Upload a JPG, PNG or PDF file.',
        path: ['imageBase64'],
      });
      return;
    }

    if (decodedBase64Bytes(value.imageBase64) > MAX_BRIDGE_UPLOAD_BYTES) {
      context.addIssue({
        code: 'custom',
        message:
          'File is larger than 5 MB. Remove some pages or retake them, then upload again.',
        path: ['imageBase64'],
      });
    }
  }
);

export type ScanBridgeOtpQuery = z.infer<typeof scanBridgeOtpQuerySchema>;
export type ScanBridgeUploadPayload = z.infer<typeof scanBridgeUploadSchema>;
