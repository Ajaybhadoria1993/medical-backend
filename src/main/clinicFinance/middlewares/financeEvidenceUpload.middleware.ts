import multer from 'multer';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const uploadFinanceEvidence = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new Error('Only PDF, JPEG, PNG, and WebP evidence files are allowed')
      );
      return;
    }
    callback(null, true);
  },
});
