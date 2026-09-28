import { NextFunction, Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { StaffScopeService } from '../services/staffScope.service';

type RequestSource = 'body' | 'params' | 'query';

const readField = (
  req: Request,
  source: RequestSource,
  field: string
): string | undefined => {
  const validated =
    source === 'body'
      ? req.validatedBody
      : source === 'params'
        ? req.validatedParams
        : req.validatedQuery;

  const raw = validated?.[field] ?? (req[source] as never)?.[field];
  return typeof raw === 'string' && raw.length ? raw : undefined;
};

export const requireDoctorScope = (
  field = 'doctorId',
  source: RequestSource = 'body'
) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const doctorId = readField(req, source, field);
    if (!doctorId) return next();

    if (!req.clinicId) throw new HttpError(401, 'Clinic context required.');

    await StaffScopeService.assertDoctorAllowed(
      req.user,
      req.clinicId,
      doctorId
    );
    return next();
  });

export const requireAppointmentScope = (
  field = 'appointmentId',
  source: RequestSource = 'body'
) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const appointmentId = readField(req, source, field);
    if (!appointmentId) return next();

    if (!req.clinicId) throw new HttpError(401, 'Clinic context required.');

    await StaffScopeService.assertAppointmentAllowed(
      req.user,
      req.clinicId,
      appointmentId
    );
    return next();
  });
