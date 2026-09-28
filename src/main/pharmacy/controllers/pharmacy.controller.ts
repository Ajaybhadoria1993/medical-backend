import { Request, Response } from 'express';
import { PharmacyService } from '../services/pharmacy.service';
import { asyncHandler } from '../../../middlewear/errorHandler';

export const createPharmacyController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const clinicId = req.clinicId;
    const adminUserId = (req.user as { id: string }).id;

    const result = await PharmacyService.createPharmacy(
      payload,
      clinicId,
      adminUserId
    );

    res.json({ success: true, result });
  }
);

export const updatePharmacyController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;
    const pharmacyId = req.params.pharmacyId as string;
    const clinicId = req.clinicId;

    const result = await PharmacyService.updatePharmacy(
      pharmacyId,
      clinicId,
      payload
    );

    res.json({
      success: true,
      result,
    });
  }
);

export const assignPharmacyUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId, userId, userRole } = req.validatedBody;
    const clinicId = req.clinicId;

    const result = await PharmacyService.assignUserToPharmacy(
      pharmacyId,
      userId,
      clinicId,
      userRole
    );
    res.json({ success: true, result });
  }
);

export const createPharmacyUserController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId, user } = req.validatedBody;
    const clinicId = req.clinicId;

    const result = await PharmacyService.createPharmacyUser(
      user,
      clinicId,
      pharmacyId
    );
    res.json({ success: true, result });
  }
);

export const createPharmacyMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };
    const clinicId = req.clinicId;
    const body = req.validatedBody as {
      name: string;
      contactNumber: string;
      email: string;
    };

    const result = await PharmacyService.createPharmacyUser(
      { name: body.name, email: body.email, mobile: body.contactNumber },
      clinicId,
      pharmacyId
    );

    res.json({
      success: true,
      message: "Password setup link sent to user's email successfully",
      result,
    });
  }
);

export const getPharmacyByIdWithUsersController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };
    const clinicId = req.clinicId;
    const query = req.validatedQuery || {};

    const result = await PharmacyService.getPharmacyByIdWithUsers(
      pharmacyId,
      clinicId,
      {
        pageNumber: (query as Record<string, unknown>).pageNumber as
          | number
          | undefined,
        pageSize: (query as Record<string, unknown>).pageSize as
          | number
          | undefined,
      }
    );

    res.json({ success: true, result });
  }
);

export const getAllPharmaciesController = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId;
    const query = req.validatedQuery || {};

    const result = await PharmacyService.getAllPharmacies(clinicId, {
      pageNumber: (query as Record<string, unknown>).pageNumber as
        | number
        | undefined,
      pageSize: (query as Record<string, unknown>).pageSize as
        | number
        | undefined,
    });

    res.json({ success: true, result });
  }
);

export const updatePharmacyStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };
    const { status } = req.validatedBody as { status: 'active' | 'deactive' };
    const clinicId = req.clinicId;

    const result = await PharmacyService.updatePharmacyStatus(
      pharmacyId,
      clinicId,
      status
    );

    res.json({ success: true, result });
  }
);

export const deletePharmacyController = asyncHandler(
  async (req: Request, res: Response) => {
    const { pharmacyId } = req.validatedParams as { pharmacyId: string };
    const clinicId = req.clinicId;

    const result = await PharmacyService.softDeletePharmacy(
      pharmacyId,
      clinicId
    );
    res.json({ success: true, result });
  }
);
