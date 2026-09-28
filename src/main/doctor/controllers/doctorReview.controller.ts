import { Response, Request } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { DoctorReviewService } from '../services/doctorReview.service';

export const createDoctorReviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedBody: payload, user } = req;
    const result = await DoctorReviewService.createReview(user.id, payload);

    res.json({
      success: true,
      message: 'Review submitted successfully',
      result,
    });
  }
);

export const updateDoctorReviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { reviewId },
      validatedBody: payload,
      user,
    } = req;
    const result = await DoctorReviewService.updateReview(
      reviewId,
      user.id,
      payload
    );

    res.json({
      success: true,
      message: 'Review updated successfully',
      result,
    });
  }
);

export const deleteDoctorReviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { reviewId },
      user,
    } = req;
    const result = await DoctorReviewService.deleteReview(reviewId, user.id);

    res.json({
      success: true,
      message: 'Review deleted successfully',
      result,
    });
  }
);

export const replyDoctorReviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { reviewId },
      validatedBody: { replyText },
      user,
    } = req;
    const result = await DoctorReviewService.replyToReview(
      reviewId,
      user.id,
      replyText
    );

    res.json({
      success: true,
      message: 'Reply posted successfully',
      result,
    });
  }
);

export const getDoctorReviewsController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { doctorId },
      validatedQuery: query,
    } = req;
    const result = await DoctorReviewService.getDoctorReviews(doctorId, query);

    res.json({
      success: true,
      message: 'Reviews fetched successfully',
      result,
    });
  }
);
