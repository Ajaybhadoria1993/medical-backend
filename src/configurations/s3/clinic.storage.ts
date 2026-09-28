import { createUploader } from './client';

const CLINIC_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'svg', 'webp'];

// Matches the 2MB client-side cap enforced in ClinicEdit.tsx.
const CLINIC_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Routes an upload to its category by form field name. */
function folderForField(fieldname: string): string {
  if (fieldname === 'clinicLogo') return 'clinic_logos';
  if (fieldname === 'profileImage') return 'profile_pictures';
  return 'clinic_uploads';
}

export const uploadClinicLogo = createUploader({
  folder: 'clinic_logos',
  formats: CLINIC_IMAGE_FORMATS,
  maxBytes: CLINIC_UPLOAD_MAX_BYTES,
});

export const uploadClinicForm = createUploader({
  folder: folderForField,
  formats: CLINIC_IMAGE_FORMATS,
  maxBytes: CLINIC_UPLOAD_MAX_BYTES,
});

// The v2 profile route wires this explicitly; identical to uploadClinicForm.
export const uploadClinicFormV2 = uploadClinicForm;
