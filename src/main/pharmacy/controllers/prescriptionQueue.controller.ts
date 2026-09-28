import { Request, Response } from 'express';
import { PrescriptionQueueService } from '../services/prescriptionQueue.service';
import { asyncHandler } from '../../../middlewear/errorHandler';
// import * as invoiceService from '../services/invoice.service';

export const updatePrescriptionStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams as { id: string };
    const { status } = req.validatedBody as {
      status: 'PENDING' | 'ON_HOLD' | 'COMPLETED' | 'REJECTED';
    };
    // Assuming requireAuth sets req.user.id as pharmacyId
    const pharmacyUserId = req.user.id;
    const result = await PrescriptionQueueService.updateStatus(
      id,
      status,
      pharmacyUserId
    );

    res.json({
      success: true,
      message: 'Prescription status updated successfully',
      result,
    });
  }
);

export const getPrescriptionQueueListController = asyncHandler(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = req.validatedQuery as any;
    const clinicId = req.clinicId;

    // If clinicId is not in req (e.g. admin or missing middleware), check query
    const targetClinicId = clinicId || query.clinicId;

    if (!targetClinicId) {
      res
        .status(400)
        .json({ success: false, message: 'Clinic ID is required' });
      return;
    }

    const result = await PrescriptionQueueService.getList({
      ...query,
      clinicId: targetClinicId,
    });

    res.json({
      success: true,
      result,
    });
  }
);

//     // Resolve pharmacyId for the current user
//     const pharmacyId = clinicId
//       ? await invoiceService.resolvePharmacyIdForUser(clinicId, userId)
//       : null;
