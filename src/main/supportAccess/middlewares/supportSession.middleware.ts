import { NextFunction, Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { maskSensitive } from '../../../utils/sensitiveMask.utils';
import { getFilePort } from '../ports';
import { SupportSessionService } from '../services/supportSession.service';
import {
  isClinicalRead,
  isFileRoute,
  isReadMethod,
  SUPPORT_EXIT_PATH,
} from '../utils/supportAccess.utils';

/** Route guard: passes only a request made with a "View as" token. Run after requireAuth. */
export const requireSupportSession = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.supportSession) {
      throw new HttpError(403, 'Only a support view can be ended here.');
    }
    return next();
  }
);

/** Called by requireAuth for a "View as" token: read-only, no files, every body masked. */
export function enforceSupportSession(
  req: Request,
  res: Response,
  sessionId: string
): void {
  const path = req.originalUrl.split('?')[0];
  if (path === SUPPORT_EXIT_PATH) return;

  if (!isReadMethod(req.method)) {
    throw new HttpError(
      403,
      "This is a read-only support view. Changes can't be saved here."
    );
  }
  if (isClinicalRead(req.originalUrl)) {
    throw new HttpError(403, 'Clinical details are hidden in a support view.');
  }
  if (isFileRoute(req.originalUrl)) {
    throw new HttpError(
      403,
      'Files, prints and exports are turned off in a support view.'
    );
  }

  const isFile = getFilePort().isStoredFile;
  const nextJson = res.json.bind(res);
  res.json = function maskedJson(this: Response, body: unknown) {
    return nextJson(maskSensitive(body, { isFile }));
  };

  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode < 300) {
      void SupportSessionService.recordView(sessionId, path);
    }
  });
}
