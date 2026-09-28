import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import {
  DoctorPublicService,
  PUBLIC_PROFILE_TTL_SECONDS,
} from '../services/doctorPublic.service';

export const getDoctorPublicProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const result = await DoctorPublicService.getPublicProfile(doctorId);

    // Unauthenticated and identical for every visitor, so it is safe for
    // shared caches (CDN/proxy) as well as the browser.
    res.set(
      'Cache-Control',
      `public, max-age=${PUBLIC_PROFILE_TTL_SECONDS}, stale-while-revalidate=60`
    );

    return sendOk(res, 'Doctor public profile fetched successfully', result);
  }
);
