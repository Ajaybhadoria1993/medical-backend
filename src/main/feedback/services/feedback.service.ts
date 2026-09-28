import { eq, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { FeedbackModel } from '../models/feedback.model';
import {
  CreateFeedbackInput,
  UpdateFeedbackInput,
} from '../schemas/feedback.schemas';

export class FeedbackService {
  static async createFeedback(
    clinicId: string,
    patientId: string,
    payload: CreateFeedbackInput
  ) {
    const [feedback] = await database
      .insert(FeedbackModel)
      .values({
        clinicId,
        patientId,
        ...payload,
      })
      .returning({
        id: FeedbackModel.id,
      });
    return feedback;
  }

  static async updateFeedback(
    feedBackId: string,
    payload: UpdateFeedbackInput
  ) {
    let feedback;
    if (payload && Object.keys(payload).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setObj: Record<string, any> = {};
      const allowedDocFields = [
        'rating',
        'comments',
        'attachments',
        'isAnonymous',
        'tags',
      ] as const;
      for (const k of allowedDocFields) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (payload as any)[k];
        if (typeof val !== 'undefined') setObj[k] = val;
      }
      if (Object.keys(setObj).length > 0) {
        setObj.updatedAt = sql`NOW()`;
        feedback = await database
          .update(FeedbackModel)
          .set(setObj)
          .where(eq(FeedbackModel.id, feedBackId))
          .returning({
            id: FeedbackModel.id,
          });
      }
    }
    return feedback;
  }

  static async responseFeedback(
    feedBackId: string,
    payload: UpdateFeedbackInput,
    userId: string
  ) {
    const [feedback] = await database
      .update(FeedbackModel)
      .set({
        updatedAt: new Date(),
        responseBy: userId,
        responseAt: new Date(),
        ...payload,
      })
      .where(eq(FeedbackModel.id, feedBackId))
      .returning({
        id: FeedbackModel.id,
      });
    return feedback;
  }

  static async deleteFeedback(feedBackId: string) {
    const [feedback] = await database
      .delete(FeedbackModel)
      .where(eq(FeedbackModel.id, feedBackId))
      .returning({
        id: FeedbackModel.id,
      });
    return feedback;
  }
  static async getFeedback(feedBackId: string) {
    const [feedback] = await database
      .select()
      .from(FeedbackModel)
      .where(eq(FeedbackModel.id, feedBackId))
      .limit(1);
    return feedback;
  }
  static async getAllByClinicFeedbacks(clinicId: string) {
    const feedbacks = await database
      .select()
      .from(FeedbackModel)
      .where(eq(FeedbackModel.clinicId, clinicId));
    return feedbacks;
  }
  static async getFeedbacksByPatient(patientId: string) {
    const feedbacks = await database
      .select()
      .from(FeedbackModel)
      .where(eq(FeedbackModel.patientId, patientId));
    return feedbacks;
  }
}
