import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { AuditLogService } from '../services/auditLog.service';

export const getClinicAuditLogController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req.validatedParams;
    const page = await AuditLogService.listForClinic(
      clinicId,
      req.validatedQuery ?? {}
    );
    return sendOk(res, 'Audit log fetched successfully', page);
  }
);
