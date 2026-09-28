import { asyncHandler } from '../../../middlewear/errorHandler';
import { Request, Response } from 'express';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { DashboardService } from '../services/dashboard.service';
import { sendOk } from '../../../utils/response.utils';
import type { TodayOverviewQueryDto } from '../schemas/dashboard.schemas';

export const getDashboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const opts = req.query as {
      startDate?: string;
      endDate?: string;
    };
    const result = await DashboardService.getClinicDashboardData(
      clinicId,
      opts
    );
    res.json({ success: true, result });
  }
);

export const getDoctorDashboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    // Casting query to expected shape as validated by schema/middleware
    const opts = req.query as {
      startDate?: string;
      endDate?: string;
      doctorId?: string;
    };

    // Determine which doctor's data to fetch
    let targetDoctorId = user.id;

    if (opts.doctorId) {
      // Only Admin (or Super_Admin) can query another doctor's data
      const isAdmin =
        user.userType === 'Admin' || user.userType === 'Super_Admin';
      if (!isAdmin && opts.doctorId !== user.id) {
        res.status(403).json({
          success: false,
          message: "You are not authorized to view another doctor's dashboard",
        });
        return;
      }
      targetDoctorId = opts.doctorId;
    }

    const result = await DashboardService.getDoctorDashboardData(
      clinicId,
      targetDoctorId,
      { startDate: opts.startDate, endDate: opts.endDate }
    );
    res.json({ success: true, result });
  }
);

export const getDoctorDashboardV2Controller = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    const opts = req.validatedQuery as {
      startDate?: string;
      endDate?: string;
      doctorId?: string;
    };

    let targetDoctorId = user.id;

    if (opts.doctorId) {
      const isAdmin =
        user.userType === 'Admin' || user.userType === 'Super_Admin';
      if (!isAdmin && opts.doctorId !== user.id) {
        res.status(403).json({
          success: false,
          message: "You are not authorized to view another doctor's dashboard",
        });
        return;
      }
      targetDoctorId = opts.doctorId;
    }

    const result = await DashboardService.getDoctorDashboardDataV2(
      clinicId,
      targetDoctorId,
      { startDate: opts.startDate, endDate: opts.endDate }
    );
    return sendOk(res, 'Doctor dashboard fetched successfully', result);
  }
);

export const getDoctorDashboardProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    const opts = req.validatedQuery as { doctorId?: string } | undefined;
    let targetDoctorId = user.id;

    if (opts?.doctorId) {
      const isAdmin =
        user.userType === 'Admin' || user.userType === 'Super_Admin';
      if (!isAdmin && opts.doctorId !== user.id) {
        res.status(403).json({
          success: false,
          message: "You are not authorized to view another doctor's dashboard",
        });
        return;
      }
      targetDoctorId = opts.doctorId;
    }

    const result = await DashboardService.getDoctorDashboardProfile(
      clinicId,
      targetDoctorId
    );
    return sendOk(res, 'Doctor dashboard profile fetched successfully', result);
  }
);

export const getSuperAdminDashboardController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as {
      startDate: string;
      endDate: string;
    };

    const result = await DashboardService.getSuperAdminDashboardData(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminRevenueOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as { period?: string } | undefined;
    const result = await DashboardService.getSuperAdminRevenueOverview(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminRevenueByPlanController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as { period?: string } | undefined;
    const result = await DashboardService.getSuperAdminRevenueByPlan(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminRevenueAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as { period?: string } | undefined;
    const result = await DashboardService.getSuperAdminRevenueAnalytics(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminTopPerformingClinicsController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as { period?: string } | undefined;
    const result =
      await DashboardService.getSuperAdminTopPerformingClinics(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminRegistrationTrendsController = asyncHandler(
  async (req: Request, res: Response) => {
    const opts = req.validatedQuery as { period?: string } | undefined;
    const result = await DashboardService.getSuperAdminRegistrationTrends(opts);
    res.json({ success: true, result });
  }
);

export const getSuperAdminUsersSubscriptionsSummaryController = asyncHandler(
  async (req: Request, res: Response) => {
    const result =
      await DashboardService.getSuperAdminUsersSubscriptionsSummary();
    res.json({ success: true, result });
  }
);

export const getRevenueOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    const opts = req.validatedQuery as
      | {
          doctorId?: string;
          startDate?: string;
          endDate?: string;
        }
      | undefined;

    // Doctors can only see their own revenue
    if (
      user.userType === 'Doctor' &&
      opts?.doctorId &&
      opts.doctorId !== user.id
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to view another doctor's revenue",
      });
      return;
    }

    const result = await DashboardService.getRevenueOverview(
      clinicId,
      user,
      opts
    );
    return sendOk(res, 'Revenue overview fetched successfully', result);
  }
);

export const getTodayOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const user = req.user;

    const opts = req.validatedQuery as TodayOverviewQueryDto | undefined;

    // Doctors can only see their own data
    if (
      user.userType === 'Doctor' &&
      opts?.doctorId &&
      opts.doctorId !== user.id
    ) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to view another doctor's overview",
      });
      return;
    }

    const result = await DashboardService.getTodayOverview(
      clinicId,
      user,
      opts
    );
    return sendOk(res, 'Today overview fetched successfully', result);
  }
);

export const getReceptionOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const opts = req.validatedQuery as { doctorId?: string } | undefined;

    if (opts?.doctorId) {
      await StaffScopeService.assertDoctorAllowed(
        req.user,
        clinicId,
        opts.doctorId
      );
    }

    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      req.user,
      clinicId
    );

    const result = await DashboardService.getReceptionOverview(clinicId, {
      ...opts,
      allowedDoctorIds,
    });
    return sendOk(res, 'Reception overview fetched successfully', result);
  }
);

export const getReceptionTodayStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;

    const allowedDoctorIds = await StaffScopeService.getAccessibleDoctorIds(
      req.user,
      clinicId
    );

    const result = await DashboardService.getReceptionTodayStats(
      clinicId,
      allowedDoctorIds
    );
    return sendOk(res, "Today's reception stats fetched successfully", result);
  }
);
