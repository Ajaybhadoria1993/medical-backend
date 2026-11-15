/** A file an email carries, named by reference so the job stays small and the file is read at send time. */
export interface EmailAttachmentRef {
  kind: 'invoice';
  /** The account the file belongs to; the provider checks it, so a ref can't reach another clinic's file. */
  ownerId: string;
  id: string;
}

export interface ResolvedAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/** Implemented by the feature that owns the files (invoices: subscription), registered at boot. */
export interface AttachmentPort {
  resolve(ref: EmailAttachmentRef): Promise<ResolvedAttachment | null>;
}
