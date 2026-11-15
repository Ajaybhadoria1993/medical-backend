/** Recognises stored files, so a "View as" response can drop them. */
export interface FilePort {
  isStoredFile(value: string): boolean;
}
