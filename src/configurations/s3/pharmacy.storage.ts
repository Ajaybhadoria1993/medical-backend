import multer from 'multer';
import { createUploader } from './client';

export const uploadPharmacySupplierInvoice = createUploader({
  folder: 'pharmacy_supplier_invoice',
  formats: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
});

// Spreadsheet imports are parsed in-process and never stored in S3.
const importUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const uploadMedicineImport = importUploader;
export const uploadSupplierImport = importUploader;
export const uploadStockImport = importUploader;
