/** Stored documents the module shows; implemented outside so it never imports the files module. */
export interface FilePort {
  /** A short-lived link (minutes) to a clinical document, or null when the stored value isn't ours. */
  signDocument(stored: string): Promise<string | null>;
  /** Removes a file uploaded for a save that then failed, so no patient document is left orphaned. */
  deleteDocument(stored: string): Promise<void>;
}
