import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { LabTestPackagesService } from '../services/labTestPackages.service';
import { getLabControllerContext } from './labControllerContext';

export const createLabTestPackageController = asyncHandler(
  async (req: Request, res: Response) => {
    const labPackage = await LabTestPackagesService.createPackage(
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendCreated(res, 'Lab test package created successfully', labPackage);
  }
);

export const getLabTestPackagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await LabTestPackagesService.getPackages(
      getLabControllerContext(req),
      req.validatedQuery
    );

    sendOk(res, 'Lab test packages fetched successfully', result);
  }
);

export const getLabTestPackageByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const labPackage = await LabTestPackagesService.getPackageById(
      req.validatedParams.packageId,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test package fetched successfully', labPackage);
  }
);

export const updateLabTestPackageController = asyncHandler(
  async (req: Request, res: Response) => {
    const labPackage = await LabTestPackagesService.updatePackage(
      req.validatedParams.packageId,
      req.validatedBody,
      getLabControllerContext(req)
    );

    sendOk(res, 'Lab test package updated successfully', labPackage);
  }
);
