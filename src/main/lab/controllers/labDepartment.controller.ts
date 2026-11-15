import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabDepartmentService } from '../services/labDepartment.service';
import { getLabControllerContext } from './labControllerContext';

export const getLabDefaultDepartmentsController = asyncHandler(
  async (_req: Request, res: Response) => {
    const departments = LabDepartmentService.getDefaultDepartments();

    sendOk(res, 'Lab departments fetched successfully', departments);
  }
);

export const createLabDepartmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const department = await LabDepartmentService.createDepartment(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(res, 'Lab department created successfully', department);
  }
);

export const getLabDepartmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabDepartmentService.getDepartments(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab departments fetched successfully', result);
  }
);

export const getLabDepartmentByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const department = await LabDepartmentService.getDepartmentById(
      req.validatedParams.departmentId,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab department fetched successfully', department);
  }
);

export const updateLabDepartmentController = asyncHandler(
  async (req: Request, res: Response) => {
    const department = await LabDepartmentService.updateDepartment(
      req.validatedParams.departmentId,
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab department updated successfully', department);
  }
);
