import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { PharmacySupplierService } from '../services/supplier.service';
import { SettingService } from '../services/setting.service';
import { sendOk } from '../../../utils/response.utils';

// Same pharmacy resolution as the toggle, so an Admin reads their clinic's pharmacy.
export const getNoLossController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req.user as { id: string }).id;
    const pharmacyId = await PharmacySupplierService.getUserPharmacyId(userId);
    const pharmacy = await SettingService.getNoLoss(pharmacyId);

    return sendOk(res, 'No Loss setting fetched successfully', pharmacy);
  }
);

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
