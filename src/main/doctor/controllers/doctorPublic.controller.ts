import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { DoctorPublicService } from '../services/doctorPublic.service';
import { DoctorPublicSearchQueryDto } from '../schemas/doctorPublic.schemas';

export const getDoctorPublicProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams;
    const result = await DoctorPublicService.getPublicProfile(doctorId);

    // no-cache: revalidate every load (cheap 304 via ETag), since Redis is cleared
    // on writes but a browser max-age would keep showing a switched-off "Book".
    res.set('Cache-Control', 'public, no-cache');

    return sendOk(res, 'Doctor public profile fetched successfully', result);
  }
);

export const getPublicSearchCitiesController = asyncHandler(
  async (_req: Request, res: Response) => {
    const result = await DoctorPublicService.getSearchCities();
    return sendOk(res, 'Cities fetched successfully', result);
  }
);

export const searchPublicDoctorsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await DoctorPublicService.searchDoctors(
      req.validatedQuery as DoctorPublicSearchQueryDto
    );
    return sendOk(res, 'Doctors fetched successfully', result);
  }
);
