import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { labTestsService } from '../services/labTests.service';

export const createLabTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.validatedBody;
    const clinicId = req.clinicId;
    const labId = req.labId;
    const userId = req.user.id;

    const labTestsData = {
      ...body,
      clinicId: clinicId,
      labId: labId,
    };

    const result = await labTestsService.createLabTests(
      labTestsData,
      clinicId,
      labId,
      userId
    );

    res.status(201).json({ success: true, result });
  }
);

export const updateLabTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const labId = req.labId;
    const userId = req.user.id;
    const body = req.validatedBody;
    const result = await labTestsService.updateLabTests(
      id,
      body,
      labId,
      userId
    );
    res.status(200).json({ success: true, result });
  }
);

export const deleteLabTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const labId = req.labId;
    const result = await labTestsService.deleteLabTests(id, labId);
    res.status(200).json({
      success: true,
      message: 'Lab test deleted successfully',
      result,
    });
  }
);

export const getLabTestsByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const labId = req.labId;

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: 'lab id is required',
      });
    }

    const result = await labTestsService.getLabTests(id, labId);
    res.status(200).json({ success: true, result });
  }
);

export const getAllLabTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const labId = req.labId;

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: 'lab id is required',
      });
    }

    const { tests, pagination } = await labTestsService.getAllLabTests(
      labId,
      req.query
    );
    res.status(200).json({ success: true, result: tests, pagination });
  }
);

export const getMatchingTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const labId = req.labId;
    const labAssistantId = req.user.id;

    if (!labId) {
      return res.status(400).json({
        success: false,
        message: 'lab id is required',
      });
    }

    const query = {
      pageNumber: req.query.pageNumber ? Number(req.query.pageNumber) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 10,
      reportStatus: req.query.reportStatus as string,
      paymentStatus: req.query.paymentStatus as string,
      search: req.query.search as string,
      sortBy: (req.query.sortBy as string) || 'createdAt',
      sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
    };

    const result = await labTestsService.getMatchingTestsService(
      clinicId,
      labId,
      labAssistantId,
      query
    );

    res.status(200).json({
      success: true,
      data: result.tests,
      pagination: result.pagination,
    });
  }
);
