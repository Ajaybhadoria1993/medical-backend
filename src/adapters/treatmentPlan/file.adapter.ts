import { deleteFromS3 } from '../../configurations/s3';
import { signS3Url } from '../../main/files/services/fileUrl.service';
import { DOCUMENT_TTL_SECONDS } from '../../main/files/utils/s3Ref.utils';
import type { FilePort } from '../../main/treatmentPlan';

export const fileAdapter: FilePort = {
  // Same rule as the files module: clinical documents get a 5-minute link, fetched on click.
  async signDocument(stored) {
    const url = await signS3Url(stored, { expiresIn: DOCUMENT_TTL_SECONDS });
    return url && url !== stored ? url : null;
  },

  deleteDocument: (stored) => deleteFromS3(stored),
};
