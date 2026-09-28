import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PatientsTestService } from '../services/patientsTest.service';

export const createTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.validatedBody;
    const clinicId = req.clinicId; // From requireClinic middleware
    const doctorId = req.user.id; // From requireAuth middleware
    const performerUserId = req.user.id;
    const performerRole = req.user.userType;

    // Add clinicId and doctorId from middleware to the body
    const testData = {
      ...body,
      clinicId: clinicId,
      doctorId: doctorId,
    };

    const result = await PatientsTestService.createTest(
      testData, // Pass the combined data
      clinicId,
      doctorId,
      performerUserId,
      performerRole
    );

    res.status(201).json({ success: true, result });
  }
);

export const updateTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const body = req.validatedBody;
    const doctorId = req.user.id;
    const result = await PatientsTestService.updateTest(id, body, doctorId);
    res.status(200).json({ success: true, result });
  }
);

export const deleteTestController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const result = await PatientsTestService.deleteTest(id);
    res
      .status(200)
      .json({ success: true, message: 'Test deleted successfully', result });
  }
);

export const getTestByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const result = await PatientsTestService.getTest(id);
    res.status(200).json({ success: true, result });
  }
);

export const getAllTestsController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.query.clinicId as string;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: 'clinicId is required',
      });
    }

    const { tests, pagination } = await PatientsTestService.getAllTests(
      clinicId,
      req.query
    );
    res.status(200).json({ success: true, result: tests, pagination });
  }
);
