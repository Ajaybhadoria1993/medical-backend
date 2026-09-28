/** A signable object, resolved from whatever a column happens to store. */
export interface S3Ref {
  bucket: string;
  key: string;
}

export interface SignOptions {
  /** Defaults to the inline-imagery lifetime. */
  expiresIn?: number;
  /** Filename the browser saves as, for click-to-download documents. */
  downloadAs?: string;
}

/** A stored file read back from S3; `key` carries the original extension. */
export interface StoredFile {
  bytes: Buffer;
  contentType: string;
  key: string;
}

/** A document ready to send as an attachment. */
export interface DownloadableDocument {
  bytes: Buffer;
  contentType: string;
  fileName: string;
}
