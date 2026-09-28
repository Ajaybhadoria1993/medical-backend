import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { StaffAssignmentService } from '../services/staffAssignment.service';
import { StaffScopeService } from '../services/staffScope.service';

export const listStaffAssignmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const assignments = await StaffAssignmentService.listAssignments(
      req.clinicId
    );
    return sendOk(res, 'Staff assignments fetched successfully', {
      assignments,
    });
  }
);

export const getStaffAssignmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.validatedParams;
    const assignment = await StaffAssignmentService.getAssignment(
      userId,
      req.clinicId
    );
    return sendOk(res, 'Staff assignment fetched successfully', assignment);
  }
);

export const updateStaffAssignmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.validatedParams;
    const assignment = await StaffAssignmentService.updateAssignment({
      userId,
      clinicId: req.clinicId,
      performedBy: req.user.id,
      payload: req.validatedBody,
    });
    return sendOk(res, 'Staff assignment updated', assignment);
  }
);

export const getDoctorStaffController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const staff = await StaffAssignmentService.listDoctorStaff(
      doctorId,
      req.clinicId
    );
    return sendOk(res, 'Doctor staff fetched successfully', {
      doctorId,
      staff,
    });
  }
);

export const getMyScopeController = asyncHandler(
  async (req: Request, res: Response) => {
    const scope = await StaffScopeService.getScope(req.user.id, req.clinicId);
    const doctors = await StaffScopeService.getScopedDoctors(
      req.user,
      req.clinicId
    );

    return sendOk(res, 'Scope fetched successfully', {
      accessScope: scope.accessScope,
      location: scope.location,
      responsibility: scope.responsibility,
      isDefault: scope.isDefault,
      doctors,
    });
  }
);
