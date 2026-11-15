import type { FilePort } from '../../main/supportAccess';
import { looksLikeStoredFile } from '../../main/files/utils/s3Ref.utils';

export const fileAdapter: FilePort = {
  // A live signed URL is also a file; looksLikeStoredFile leaves those alone for re-signing.
  isStoredFile: (value) =>
    /[?&]X-Amz-Signature=/i.test(value) || looksLikeStoredFile(value),
};
