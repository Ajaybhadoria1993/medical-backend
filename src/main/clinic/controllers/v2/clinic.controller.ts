import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewear/errorHandler';
import { sendOk } from '../../../../utils/response.utils';
import { CacheKeys, getOrSetCache } from '../../../../utils/cache.util';
import { ClinicServiceV2 } from '../../services/v2/clinic.service';

const PROFILE_OVERVIEW_TTL_SECONDS = 60;

export const getClinicProfileOverviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const clinicId = req.clinicId as string;

    const result = await getOrSetCache(
      CacheKeys.clinicProfileOverview(clinicId),
      PROFILE_OVERVIEW_TTL_SECONDS,
      () => ClinicServiceV2.getClinicProfileOverview(userId, clinicId)
    );

    return sendOk(
      res,
      'Clinic profile overview retrieved successfully',
      result
    );
  }
);

export const updateClinicProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const clinicId = req.clinicId as string;
    const payload = req.validatedBody as {
      clinicDetails?: Record<string, unknown>;
    };
    const clinicLogo = (req.body as { clinicLogo?: string }).clinicLogo;

    const result = await ClinicServiceV2.updateClinicProfile(
      userId,
      clinicId,
      payload,
      clinicLogo
    );

    return sendOk(res, 'Clinic profile updated successfully', result);
  }
);
