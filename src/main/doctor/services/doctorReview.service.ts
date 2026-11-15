import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { DoctorReviewsModel } from '../models/doctorReview.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  CreateDoctorReviewInput,
  DoctorMyReviewsQueryInput,
  PatientReviewsQueryInput,
  UpdateDoctorReviewInput,
} from '../schemas/doctorReview.schemas';
import { PatientFamilyLinksModel } from '../../patient/models/patientFamilyLinks.model';
import type { ReviewRating } from '../types/doctorReview.types';
import {
  buildPagination,
  buildReviewsSummary,
} from '../utils/doctorReview.utils';
import { CacheKeys, invalidateCacheMany } from '../../../utils/cache.util';

export class DoctorReviewService {
  // Cached profiles embed rating and reviews; clear only after the commit, or
  // a concurrent read can re-cache the old values.
  private static async invalidateProfile(doctorId: string) {
    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(doctorId));
  }

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
    const created = await database.transaction(async (tx) => {
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
    await this.invalidateProfile(payload.doctorId);
    return created;
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

    const updated = await database.transaction(async (tx) => {
      const [updatedReview] = await tx
        .update(DoctorReviewsModel)
        .set(setObj)
        .where(eq(DoctorReviewsModel.id, reviewId))
        .returning();

      await this.recalculateDoctorStats(review.doctorId, tx);

      return updatedReview;
    });
    await this.invalidateProfile(review.doctorId);
    return updated;
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

    await database.transaction(async (tx) => {
      await tx
        .delete(DoctorReviewsModel)
        .where(eq(DoctorReviewsModel.id, reviewId));

      await this.recalculateDoctorStats(review.doctorId, tx);
    });
    await this.invalidateProfile(review.doctorId);
    return { success: true };
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

    // The full public profile embeds recent reviews with their replyText.
    await this.invalidateProfile(doctorId);

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

  private static readonly myReviewColumns = {
    id: DoctorReviewsModel.id,
    appointmentId: DoctorReviewsModel.appointmentId,
    rating: DoctorReviewsModel.rating,
    reviewText: DoctorReviewsModel.reviewText,
    replyText: DoctorReviewsModel.replyText,
    replyAt: DoctorReviewsModel.replyAt,
    createdAt: DoctorReviewsModel.createdAt,
    appointmentDate: AppointmentModel.appointmentDate,
    patient: {
      id: UserModel.id,
      name: UserModel.name,
      profileImage: UserProfileModel.profileImage,
    },
  };

  private static readonly reviewerJoinsSelect = () =>
    database
      .select(this.myReviewColumns)
      .from(DoctorReviewsModel)
      .innerJoin(UserModel, eq(DoctorReviewsModel.patientId, UserModel.id))
      .innerJoin(
        AppointmentModel,
        eq(DoctorReviewsModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(UserProfileModel, eq(UserModel.id, UserProfileModel.userId));

  // Summary always covers every approved review; only the list honours `rating`.
  static async getMyReviews(
    doctorId: string,
    query: DoctorMyReviewsQueryInput
  ) {
    const approved = and(
      eq(DoctorReviewsModel.doctorId, doctorId),
      eq(DoctorReviewsModel.status, 'approved')
    );
    const listFilter = query.rating
      ? and(approved, eq(DoctorReviewsModel.rating, query.rating))
      : approved;

    const [ratingRows, reviews] = await Promise.all([
      database
        .select({
          rating: DoctorReviewsModel.rating,
          count: sql<number>`count(*)::integer`,
        })
        .from(DoctorReviewsModel)
        .where(approved)
        .groupBy(DoctorReviewsModel.rating),
      this.reviewerJoinsSelect()
        .where(listFilter)
        .orderBy(desc(DoctorReviewsModel.createdAt))
        .limit(query.pageSize)
        .offset((query.pageNumber - 1) * query.pageSize),
    ]);

    const summary = buildReviewsSummary(ratingRows);
    const totalItems = query.rating
      ? summary.breakdown[query.rating as ReviewRating]
      : summary.totalReviews;

    return {
      summary,
      reviews,
      pagination: buildPagination(totalItems, query.pageNumber, query.pageSize),
    };
  }

  // Null (not 404) when unreviewed, so the appointment screen can probe cheaply.
  static async getMyReviewForAppointment(
    doctorId: string,
    appointmentId: string
  ) {
    const [review] = await this.reviewerJoinsSelect()
      .where(
        and(
          eq(DoctorReviewsModel.appointmentId, appointmentId),
          eq(DoctorReviewsModel.doctorId, doctorId),
          eq(DoctorReviewsModel.status, 'approved')
        )
      )
      .limit(1);

    return review ?? null;
  }

  // No status filter: the patient can still edit or delete a moderated review.
  static async getPatientReviews(
    patientId: string,
    query: PatientReviewsQueryInput
  ) {
    const doctorUser = alias(UserModel, 'review_doctor');
    const doctorProfile = alias(UserProfileModel, 'review_doctor_profile');
    const owned = eq(DoctorReviewsModel.patientId, patientId);

    const [reviews, [countRow]] = await Promise.all([
      database
        .select({
          id: DoctorReviewsModel.id,
          appointmentId: DoctorReviewsModel.appointmentId,
          rating: DoctorReviewsModel.rating,
          reviewText: DoctorReviewsModel.reviewText,
          replyText: DoctorReviewsModel.replyText,
          replyAt: DoctorReviewsModel.replyAt,
          createdAt: DoctorReviewsModel.createdAt,
          appointmentDate: AppointmentModel.appointmentDate,
          clinicImage: ClinicModel.clinicLogo,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            profileImage: doctorProfile.profileImage,
          },
        })
        .from(DoctorReviewsModel)
        .innerJoin(doctorUser, eq(DoctorReviewsModel.doctorId, doctorUser.id))
        .innerJoin(
          AppointmentModel,
          eq(DoctorReviewsModel.appointmentId, AppointmentModel.id)
        )
        .leftJoin(doctorProfile, eq(doctorUser.id, doctorProfile.userId))
        .leftJoin(ClinicModel, eq(AppointmentModel.clinicId, ClinicModel.id))
        .where(owned)
        .orderBy(desc(DoctorReviewsModel.createdAt))
        .limit(query.pageSize)
        .offset((query.pageNumber - 1) * query.pageSize),
      database
        .select({ count: sql<number>`count(*)::integer` })
        .from(DoctorReviewsModel)
        .where(owned),
    ]);

    const totalItems = countRow?.count ?? 0;
    return {
      reviews,
      pagination: buildPagination(totalItems, query.pageNumber, query.pageSize),
    };
  }
}
