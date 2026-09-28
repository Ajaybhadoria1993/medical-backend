import { NextFunction, Request, Response } from 'express';
import { requireClinic } from '../../../middlewear/auth.middleware';

/** Translation memory is per doctor within a clinic, so only a translated preview needs one; English previews stay as they were. */
export const requireClinicForLanguage = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const language = req.body?.language;
  if (!language || language === 'en') return next();
  return requireClinic(req, res, next);
};
