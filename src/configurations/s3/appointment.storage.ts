import { createUploader } from './client';

const MEDICAL_IMAGE_FORMATS = ['pdf', 'jpg', 'jpeg', 'png'];

export const upload = createUploader({
  folder: 'medical_reports',
  formats: MEDICAL_IMAGE_FORMATS,
});

export const uploadConsentFile = createUploader({
  folder: 'consent_files',
  formats: MEDICAL_IMAGE_FORMATS,
});

export const uploadPrescription = createUploader({
  folder: 'prescriptions',
  formats: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'],
});
