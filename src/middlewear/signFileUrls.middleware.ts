import { RequestHandler, Response } from 'express';
import logger from '../utils/logger';
import { stripS3SignaturesDeep } from '../main/files/utils/s3Ref.utils';
import {
  hasStoredFile,
  signStoredFilesDeep,
} from '../main/files/services/fileUrl.service';

/**
 * Signs every stored file value on its way out, so no service has to
 * remember to. Anything not ours is returned untouched.
 */
/**
 * The inverse on the way in: a form that echoes a signed URL back must store the
 * plain one, or the saved link expires and is never re-signed.
 */
export const stripSignedFileUrlsInRequests: RequestHandler = (
  req,
  _res,
  next
) => {
  // Only writes can store a value; reads skip the walk.
  const isWrite = ['POST', 'PUT', 'PATCH'].includes(req.method);
  if (
    isWrite &&
    req.body &&
    typeof req.body === 'object' &&
    !Buffer.isBuffer(req.body)
  ) {
    req.body = stripS3SignaturesDeep(req.body);
  }
  next();
};

/**
 * Route-level, for rows saved before stripping existed: drops the stale signature
 * so the global signer (wrapped earlier, so it runs after this) signs afresh.
 */
export const stripSignedFileUrlsInResponses: RequestHandler = (
  _req,
  res,
  next
) => {
  const nextJson = res.json.bind(res);
  res.json = function strippedJson(this: Response, body: unknown) {
    return nextJson(stripS3SignaturesDeep(body));
  };
  next();
};

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
