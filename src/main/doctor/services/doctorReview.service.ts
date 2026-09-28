import { eq, and, sql, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { DoctorReviewsModel } from '../models/doctorReview.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  CreateDoctorReviewInput,
  UpdateDoctorReviewInput,
} from '../schemas/doctorReview.schemas';
import { PatientFamilyLinksModel } from '../../patient/models/patientFamilyLinks.model';

export class DoctorReviewService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static async recalculateDoctorStats(doctorId: string, tx?: any) {
    const db = tx || database;

    const [result] = await db
      .select({
        averageRating: sql<string>`coalesce(avg(${DoctorReviewsModel.rating}), 0)`,
        reviewCount: sql<number>`count(${DoctorReviewsModel.id})::integer`,
      })
      .from(DoctorReviewsModel)
      .where(
        and(
          eq(DoctorReviewsModel.doctorId, doctorId),
          eq(DoctorReviewsModel.status, 'approved')
        )
      );

    await db
      .update(UserProfessionalModel)
      .set({
        averageRating: parseFloat(result.averageRating).toFixed(2),
        reviewCount: result.reviewCount,
      })
      .where(eq(UserProfessionalModel.userId, doctorId));
  }

  static async createReview(
    patientId: string,
    payload: CreateDoctorReviewInput
  ) {
    // 1. Verify that appointment exists, is completed or cancelled, and belongs to the doctor
    const [appointment] = await database
      .select()
      .from(AppointmentModel)
      .where(
        and(
          eq(AppointmentModel.id, payload.appointmentId),
          eq(AppointmentModel.doctorId, payload.doctorId),
          inArray(AppointmentModel.appointmentStatus, [
            'Completed',
            'Cancelled',
          ])
        )
      )
      .limit(1);

    if (!appointment) {
      throw new HttpError(
        400,
        'Only completed or cancelled appointments can be rated and reviewed'
      );
    }

    // Check if the appointment belongs to the logged-in patient or one of their family members
    let belongsToPatient = appointment.patientId === patientId;
    if (!belongsToPatient) {
      const [familyLink] = await database
        .select()
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, patientId),
            eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
          )
        )
        .limit(1);

      if (familyLink) {
        belongsToPatient = true;
      }
    }

    if (!belongsToPatient) {
      throw new HttpError(
        400,
        'Only completed or cancelled appointments can be rated and reviewed'
      );
    }

    // 2. Check for duplicate review
    const [existing] = await database
      .select({ id: DoctorReviewsModel.id })
      .from(DoctorReviewsModel)
      .where(eq(DoctorReviewsModel.appointmentId, payload.appointmentId))
      .limit(1);

    if (existing) {
      throw new HttpError(400, 'This appointment has already been reviewed');
    }

    // 3. Insert and recalculate stats inside transaction
    return await database.transaction(async (tx) => {
      const [review] = await tx
        .insert(DoctorReviewsModel)
        .values({
          doctorId: payload.doctorId,
          patientId,
          appointmentId: payload.appointmentId,
          rating: payload.rating,
          reviewText: payload.reviewText || null,
          status: 'approved',
        })
        .returning();

      await this.recalculateDoctorStats(payload.doctorId, tx);

      return review;
    });
  }

  static async updateReview(
    reviewId: string,
    patientId: string,
    payload: UpdateDoctorReviewInput
  ) {
    const [review] = await database
      .select()
      .from(DoctorReviewsModel)
      .where(eq(DoctorReviewsModel.id, reviewId))
      .limit(1);

    if (!review) {
      throw new HttpError(404, 'Review not found');
    }

    if (review.patientId !== patientId) {
      throw new HttpError(403, 'You are not authorized to update this review');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setObj: Record<string, any> = {};
    if (payload.rating !== undefined) setObj.rating = payload.rating;
    if (payload.reviewText !== undefined)
      setObj.reviewText = payload.reviewText;
    setObj.updatedAt = sql`NOW()`;

    return await database.transaction(async (tx) => {
      const [updatedReview] = await tx
        .update(DoctorReviewsModel)
        .set(setObj)
        .where(eq(DoctorReviewsModel.id, reviewId))
        .returning();

      await this.recalculateDoctorStats(review.doctorId, tx);

      return updatedReview;
    });
  }

  static async deleteReview(reviewId: string, patientId: string) {
    const [review] = await database
      .select()
      .from(DoctorReviewsModel)
      .where(eq(DoctorReviewsModel.id, reviewId))
      .limit(1);

    if (!review) {
      throw new HttpError(404, 'Review not found');
    }

    if (review.patientId !== patientId) {
      throw new HttpError(403, 'You are not authorized to delete this review');
    }

    return await database.transaction(async (tx) => {
      await tx
        .delete(DoctorReviewsModel)
        .where(eq(DoctorReviewsModel.id, reviewId));

      await this.recalculateDoctorStats(review.doctorId, tx);
      return { success: true };
    });
  }

  static async replyToReview(
    reviewId: string,
    doctorId: string,
    replyText: string
  ) {
    const [review] = await database
      .select()
      .from(DoctorReviewsModel)
      .where(eq(DoctorReviewsModel.id, reviewId))
      .limit(1);

    if (!review) {
      throw new HttpError(404, 'Review not found');
    }

    if (review.doctorId !== doctorId) {
      throw new HttpError(
        403,
        'You are not authorized to reply to this review'
      );
    }

    const [updatedReview] = await database
      .update(DoctorReviewsModel)
      .set({
        replyText,
        replyAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(DoctorReviewsModel.id, reviewId))
      .returning();

    return updatedReview;
  }

  static async getDoctorReviews(
    doctorId: string,
    query: { pageNumber: number; pageSize: number }
  ) {
    const offset = (query.pageNumber - 1) * query.pageSize;

    const reviews = await database
      .select({
        id: DoctorReviewsModel.id,
        rating: DoctorReviewsModel.rating,
        reviewText: DoctorReviewsModel.reviewText,
        replyText: DoctorReviewsModel.replyText,
        replyAt: DoctorReviewsModel.replyAt,
        createdAt: DoctorReviewsModel.createdAt,
        updatedAt: DoctorReviewsModel.updatedAt,
        patient: {
          id: UserModel.id,
          name: UserModel.name,
          profileImage: UserProfileModel.profileImage,
        },
      })
      .from(DoctorReviewsModel)
      .innerJoin(UserModel, eq(DoctorReviewsModel.patientId, UserModel.id))
      .leftJoin(UserProfileModel, eq(UserModel.id, UserProfileModel.userId))
      .where(
        and(
          eq(DoctorReviewsModel.doctorId, doctorId),
          eq(DoctorReviewsModel.status, 'approved')
        )
      )
      .orderBy(sql`${DoctorReviewsModel.createdAt} DESC`)
      .limit(query.pageSize)
      .offset(offset);

    const [countResult] = await database
      .select({
        count: sql<number>`count(${DoctorReviewsModel.id})::integer`,
      })
      .from(DoctorReviewsModel)
      .where(
        and(
          eq(DoctorReviewsModel.doctorId, doctorId),
          eq(DoctorReviewsModel.status, 'approved')
        )
      );

    return {
      reviews,
      pagination: {
        totalItems: countResult?.count || 0,
        pageNumber: query.pageNumber,
        pageSize: query.pageSize,
        totalPages: Math.ceil((countResult?.count || 0) / query.pageSize),
      },
    };
  }
}
