import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabTestPackageService } from '../services/labTestPackage.service';

export const createLabTestPackageController = asyncHandler(
  async (req: Request, res: Response) => {
    const labPackage = await LabTestPackageService.createPackage(
      req.validatedBody,
      {
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendCreated(res, 'Lab test package created successfully', labPackage);
  }
);

export const getLabTestPackagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabTestPackageService.getPackages(
      {
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      },
      req.validatedQuery
    );

    res.status(200).json({
      success: true,
      message: 'Lab test packages fetched successfully',
      data: result.packages,
      pagination: result.pagination,
      statsCounts: result.statsCounts,
    });
  }
);

export const getLabTestPackageByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { packageId } = req.validatedParams;
    const labPackage = await LabTestPackageService.getPackageById(packageId, {
      labId: req.labId,
      userId: req.user.id,
      userRole: req.user.userType,
    });

    sendOk(res, 'Lab test package fetched successfully', labPackage);
  }
);

export const updateLabTestPackageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { packageId } = req.validatedParams;
    const labPackage = await LabTestPackageService.updatePackage(
      packageId,
      req.validatedBody,
      {
        labId: req.labId,
        userId: req.user.id,
        userRole: req.user.userType,
      }
    );

    sendOk(res, 'Lab test package updated successfully', labPackage);
  }
);
