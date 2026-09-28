import path from 'path';
import { createUploader } from './client';

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];

// PDF is allowed because multi-page phone scans arrive as one PDF.
const MANUAL_PRESCRIPTION_TYPES: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
};
export const MAX_MANUAL_PRESCRIPTION_BYTES = 10 * 1024 * 1024;

// Extension and MIME type must agree, so a renamed executable can't pass as a PDF.
export const isAllowedManualPrescriptionFile = (
  originalName: string,
  mimeType: string
) => {
  const ext = path.extname(originalName).toLowerCase().replace('.', '');
  return (
    MANUAL_PRESCRIPTION_TYPES[ext]?.includes(mimeType.toLowerCase()) ?? false
  );
};

export const uploadDoctorGallery = createUploader({
  folder: 'doctor_gallery',
  formats: [...IMAGE_FORMATS, 'gif'],
});

export const uploadDoctorManualTemplate = createUploader({
  folder: 'doctor_manual_templates',
  formats: IMAGE_FORMATS,
});

export const uploadDoctorManualPrescription = createUploader({
  folder: 'doctor_manual_prescriptions',
  formats: Object.keys(MANUAL_PRESCRIPTION_TYPES),
  mimeTypes: MANUAL_PRESCRIPTION_TYPES,
  maxBytes: MAX_MANUAL_PRESCRIPTION_BYTES,
  maxFiles: 1,
  rejectionMessage: 'Upload a JPG, PNG, WebP or PDF file.',
});
