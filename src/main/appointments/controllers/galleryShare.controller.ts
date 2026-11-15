import { Request, Response } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { sendCreated, sendOk } from '../../../utils/response.utils';
import { GalleryShareService } from '../services/galleryShare.service';

export const shareGalleryImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await GalleryShareService.share(
      req.validatedParams.appointmentId,
      req.user.id,
      req.clinicId,
      req.validatedBody
    );
    return sendCreated(res, 'Image shared with patient', result);
  }
);

export const getSharedImagesController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await GalleryShareService.listForDoctor(
      req.validatedParams.appointmentId,
      req.user.id,
      req.clinicId
    );
    return sendOk(res, 'Shared images fetched successfully', result);
  }
);

export const unshareGalleryImageController = asyncHandler(
  async (req: Request, res: Response) => {
    const { appointmentId, shareId } = req.validatedParams;
    const result = await GalleryShareService.unshare(
      appointmentId,
      shareId,
      req.user.id,
      req.clinicId
    );
    return sendOk(res, 'Image unshared', result);
  }
);
