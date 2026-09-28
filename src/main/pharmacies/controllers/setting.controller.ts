import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacySupplierService } from '../services/supplier.service';
import { SettingService } from '../services/setting.service';

export const noLossController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;

    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);

    const pharmacy = await SettingService.noLoss(userId, pharmacyId);

    res.status(200).json({
      success: true,
      message: `No Loss mode ${
        pharmacy.noLoss === 'true' ? 'enabled' : 'disabled'
      } successfully`,
      data: pharmacy,
    });
  }
);
