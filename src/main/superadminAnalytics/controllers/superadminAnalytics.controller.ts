import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { ClinicsService } from '../services/clinics.service';
import { GrowthService } from '../services/growth.service';
import { OverviewService } from '../services/overview.service';
import { RevenueService } from '../services/revenue.service';
import { TimelineService } from '../services/timeline.service';
import { UsageService } from '../services/usage.service';
import { AccessService } from '../services/access.service';
import { PatientAppService } from '../services/patientApp.service';

export const getRevenueController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await RevenueService.getRevenue(req.validatedQuery ?? {});
    return sendOk(res, 'Revenue fetched successfully', data);
  }
);

export const getPatientAppController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await PatientAppService.getPatientApp(
      req.validatedQuery ?? {}
    );
    return sendOk(res, 'Patient app figures fetched successfully', data);
  }
);

export const listAuditController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AccessService.audit(req.validatedQuery);
    return sendOk(res, 'Audit log fetched successfully', data);
  }
);

export const signOutUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AccessService.signOut(
      req.validatedParams.userId,
      req.user!.id
    );
    return sendOk(res, 'Signed out from all devices', data);
  }
);

export const listSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await AccessService.sessions(req.validatedQuery);
    return sendOk(res, 'Sessions fetched successfully', data);
  }
);

export const getUsageController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await UsageService.getUsage(req.validatedQuery ?? {});
    return sendOk(res, 'Usage fetched successfully', data);
  }
);

export const getGrowthController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await GrowthService.getGrowth(req.validatedQuery ?? {});
    return sendOk(res, 'Growth fetched successfully', data);
  }
);

export const getOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await OverviewService.getOverview(req.validatedQuery ?? {});
    return sendOk(res, 'Overview fetched successfully', data);
  }
);

export const listClinicsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ClinicsService.list(req.validatedQuery);
    return sendOk(res, 'Clinics fetched successfully', data);
  }
);

export const getClinicTimelineController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await TimelineService.forClinic(req.validatedParams.clinicId);
    return sendOk(res, 'Clinic timeline fetched successfully', data);
  }
);

export const getClinicSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await ClinicsService.summary(req.validatedParams.clinicId);
    return sendOk(res, 'Clinic fetched successfully', data);
  }
);
