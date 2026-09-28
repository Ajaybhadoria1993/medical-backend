import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PrescriptionService } from '../services/prescription.service';
import { UpdatePrescriptionStatusInput } from '../schemas/prescription.schema';
import { PharmacySupplierService } from '../services/supplier.service';

export const getPrescriptionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const clinicId = req.clinicId;
    const query = req.validatedQuery || {};
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PrescriptionService.getPrescriptions(
      clinicId,
      pharmacyId,
      {
        pageNumber: (query as Record<string, unknown>).pageNumber as
          | number
          | undefined,
        pageSize: (query as Record<string, unknown>).pageSize as
          | number
          | undefined,
        status: (query as Record<string, unknown>).status as
          | 'PENDING'
          | 'ON_HOLD'
          | 'COMPLETED'
          | 'REJECTED'
          | undefined,
        doctorId: (query as Record<string, unknown>).doctorId as
          | string
          | undefined,
        patientId: (query as Record<string, unknown>).patientId as
          | string
          | undefined,
        search: (query as Record<string, unknown>).search as string | undefined,
        startDate: (query as Record<string, unknown>).startDate as
          | string
          | undefined,
        endDate: (query as Record<string, unknown>).endDate as
          | string
          | undefined,
      }
    );

    res.json({
      success: true,
      data: result.prescriptions,
      pagination: result.pagination,
    });
  }
);

export const getPrescriptionByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const clinicId = req.clinicId;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PrescriptionService.getPrescriptionById(
      id,
      clinicId,
      pharmacyId
    );

    res.json({ success: true, data: result });
  }
);

export const updatePrescriptionStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const { id } = req.params as { id: string };
    const { status } = req.validatedBody as UpdatePrescriptionStatusInput;
    const clinicId = req.clinicId;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PrescriptionService.updatePrescriptionStatus(
      id,
      clinicId,
      status,
      userId,
      pharmacyId
    );

    res.json({
      success: true,
      message: `Prescription ${status.toLowerCase()} successfully`,
      data: result,
    });
  }
);

export const checkMedicinesController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PrescriptionService.checkMedicinesExist(
      pharmacyId,
      req.body.medicineNames
    );

    res.json({
      success: true,
      data: result,
    });
  }
);

export const getPrescriptionStatsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PrescriptionService.getPrescriptionStats(pharmacyId);

    res.json({
      success: true,
      message: 'Prescription statistics retrieved successfully',
      data: result,
    });
  }
);
