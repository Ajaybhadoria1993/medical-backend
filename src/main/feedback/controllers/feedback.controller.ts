import { Response, Request } from 'express';
import { asyncHandler } from '../../../middlewear/errorHandler';
import { FeedbackService } from '../services/feedback.service';

export const createFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedBody: payload, user, clinicId } = req;
    const result = await FeedbackService.createFeedback(
      clinicId,
      user.id,
      payload
    );

    res.json({
      success: true,
      message: 'feedback created successfully',
      result,
    });
  }
);
export const updateFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { feedbackId },
      validatedBody: payload,
    } = req;
    const result = await FeedbackService.updateFeedback(feedbackId, payload);

    res.json({
      success: true,
      message: 'feedback updated successfully',
      result,
    });
  }
);

export const responseFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { feedbackId: feedbackId },
      validatedBody: payload,
      user: { id: userId },
    } = req;
    const result = await FeedbackService.responseFeedback(
      feedbackId,
      payload,
      userId
    );

    res.json({
      success: true,
      message: 'feedback updated successfully',
      result,
    });
  }
);

export const deleteFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { feedbackId },
    } = req;
    const result = await FeedbackService.deleteFeedback(feedbackId);
    res.json({
      success: true,
      message: 'feedback deleted successfully',
      result,
    });
  }
);

export const getFeedBackByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      validatedParams: { feedbackId },
    } = req;
    const result = await FeedbackService.getFeedback(feedbackId);
    res.json({
      success: true,
      message: 'feedback fetched  successfully',
      result,
    });
  }
);

export const getAllClinicFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const { clinicId } = req;
    const result = await FeedbackService.getAllByClinicFeedbacks(clinicId);
    res.json({
      success: true,
      message: 'feedback fetched all successfully',
      result,
    });
  }
);

export const getAllUserFeedBackController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      user: { id: patientId },
    } = req;
    const result = await FeedbackService.getFeedbacksByPatient(patientId);
    res.json({
      success: true,
      message: 'feedback fetched all successfully',
      result,
    });
  }
);
