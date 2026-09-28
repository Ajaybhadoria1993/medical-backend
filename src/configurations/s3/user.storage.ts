import { createUploader } from './client';

export const uploadProfilePicture = createUploader({
  folder: 'profile_pictures',
  formats: ['jpg', 'jpeg', 'png', 'svg', 'webp'],
  maxBytes: 2 * 1024 * 1024,
});
