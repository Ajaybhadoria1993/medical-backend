import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacySupplierService } from '../services/supplier.service';
import { CreatePurchaseReturnInput } from '../schemas/purchaseReturn.schema';
import { PharmacyPurchaseReturnService } from '../services/purchaseReturn.service';

export const createPurchaseReturnController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody as CreatePurchaseReturnInput;
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const result = await PharmacyPurchaseReturnService.createPurchaseReturn(
      payload,
      pharmacyId,
      userId
    );

    res.json({
      success: true,
      message: 'Purchase return created successfully',
      data: result,
    });
  }
);

export const getPurchaseReturnsController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const query = req.validatedQuery || {};

    const result = await PharmacyPurchaseReturnService.getPurchaseReturns(
      pharmacyId,
      {
        pageNumber: (query as Record<string, unknown>).pageNumber as
          number | undefined,
        pageSize: (query as Record<string, unknown>).pageSize as
          number | undefined,
        stockId: (query as Record<string, unknown>).stockId as
          string | undefined,
        startDate: (query as Record<string, unknown>).startDate as
          string | undefined,
        endDate: (query as Record<string, unknown>).endDate as
          string | undefined,
        search: (query as Record<string, unknown>).search as string | undefined,
        refundMethod: (query as Record<string, unknown>).refundMethod as
          string | undefined,
      }
    );

    res.json({
      success: true,
      data: result.purchaseReturns,
      pagination: result.pagination,
    });
  }
);
