import { createUploader } from './client';

const BANNER_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif'];
const BANNER_MAX_BYTES = 5 * 1024 * 1024;

/** Full-size and thumbnail arrive on different form fields. */
function folderForField(fieldname: string): string {
  return fieldname === 'thumbnailUrl' ? 'banner_thumbnails' : 'banner_images';
}

export const uploadBannerImage = createUploader({
  folder: 'banner_images',
  formats: BANNER_IMAGE_FORMATS,
  maxBytes: BANNER_MAX_BYTES,
});

export const uploadBannerForm = createUploader({
  folder: folderForField,
  formats: BANNER_IMAGE_FORMATS,
  maxBytes: BANNER_MAX_BYTES,
});
