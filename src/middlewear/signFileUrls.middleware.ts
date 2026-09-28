import { RequestHandler, Response } from 'express';
import logger from '../utils/logger';
import {
  hasStoredFile,
  signStoredFilesDeep,
} from '../main/files/services/fileUrl.service';

/**
 * Signs every stored file value on its way out, so no service has to
 * remember to. Anything not ours is returned untouched.
 */
export const signFileUrlsInResponses: RequestHandler = (_req, res, next) => {
  const sendJson = res.json.bind(res);

  res.json = function patchedJson(this: Response, body: unknown) {
    // Most endpoints return no file at all. Those keep the original synchronous
    // path untouched, so this middleware cannot change their behaviour.
    if (!hasStoredFile(body)) return sendJson(body);

    signStoredFilesDeep(body)
      .then((signed) => sendJson(signed))
      .catch((err) => {
        // Never fail a response over signing; a broken image beats a 500.
        logger.warn('[s3] response signing failed', { message: err?.message });
        sendJson(body);
      });
    return this;
  };

  next();
};
