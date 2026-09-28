import { createUploader } from './client';

export const uploadPatientGallery = createUploader({
  folder: 'patient_gallery',
  formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
});

export const uploadPatientTest = createUploader({
  folder: 'patient_tests',
  formats: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'],
});
