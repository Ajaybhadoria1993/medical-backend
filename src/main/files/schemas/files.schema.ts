import { z } from 'zod';

/** Document kinds signable on demand. Each is keyed by a record, never a key. */
export const SIGNABLE_DOCUMENT_TYPES = [
  'labReport',
  'prescription',
  // Prescription history is keyed by appointment and may hold either the
  // generated report card PDF or a doctor's manually uploaded one.
  'appointmentPrescription',
  // The doctor's scanned upload specifically, not whichever the history prefers.
  'manualPrescription',
  // A supplier's purchase invoice, reached through the pharmacy's clinic.
  'stockInvoice',
  'consent',
] as const;

export const signDocumentQuerySchema = z.object({
  type: z.enum(SIGNABLE_DOCUMENT_TYPES),
  id: z.string().uuid('id must be a UUID'),
});

export type SignDocumentQuery = z.infer<typeof signDocumentQuerySchema>;

export const downloadDocumentQuerySchema = signDocumentQuerySchema.extend({
  // Saved under this name; the stored file's own extension is appended.
  downloadAs: z.string().trim().min(1).max(120),
});

export type DownloadDocumentQuery = z.infer<typeof downloadDocumentQuerySchema>;

/** Patients own records across clinics, so their lookup is scoped differently. */
export const PATIENT_DOCUMENT_TYPES = [
  'prescription',
  'appointmentPrescription',
  'manualPrescription',
  'consent',
  'labReport',
] as const;

export const signPatientDocumentQuerySchema = z.object({
  type: z.enum(PATIENT_DOCUMENT_TYPES),
  id: z.string().uuid('id must be a UUID'),
});

export type SignPatientDocumentQuery = z.infer<
  typeof signPatientDocumentQuerySchema
>;
