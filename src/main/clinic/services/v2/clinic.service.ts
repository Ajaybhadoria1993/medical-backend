// Independent v2 service; does not wrap/extend v1's service class (v1 is
// left untouched). Caching (get-or-set) is applied by the controller, not
// here — this file's methods are plain composers with no caching logic.

import { and, eq, sql } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { HttpError } from '../../../../middlewear/errorHandler';
import { deleteFromS3 } from '../../../../configurations/s3';
import { UserModel } from '../../../users/models/user.model';
import { UserProfileModel } from '../../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../../users/models/userProfessional.model';
import {
  ClinicAssignModel,
  ClinicAvailability,
  ClinicModel,
  ClinicServiceModel,
} from '../../models/clinic.model';
import { ClinicSettingsModel } from '../../models/clinicSettings.model';
import { FeedbackModel } from '../../../feedback/models/feedback.model';
import { ClinicService } from '../clinic.service';
import {
  CacheKeys,
  invalidateCacheMany,
  withCacheInvalidation,
} from '../../../../utils/cache.util';
import {
  buildWeeklyHours,
  isOpenNow as computeIsOpenNow,
  resolveTodayHours,
} from '../../utils/workingHours.utils';
import type {
  ClinicProfileOverview,
  DoctorPreview,
} from '../../types/clinicProfileOverview.types';

const DOCTORS_PREVIEW_LIMIT = 5;

export class ClinicServiceV2 {
  static async getClinicProfileOverview(
    userId: string,
    clinicId: string
  ): Promise<ClinicProfileOverview> {
    const [
      fullClinic,
      settingsRow,
      services,
      doctorsWithAssignment,
      availabilityRows,
      feedbackAgg,
    ] = await Promise.all([
      ClinicService.getClinicByUserId(userId, clinicId),
      database
        .select({
          onlineBookingEnabled: ClinicSettingsModel.onlineBookingEnabled,
          payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
          payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
          whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
        })
        .from(ClinicSettingsModel)
        .where(eq(ClinicSettingsModel.clinicId, clinicId))
        .limit(1),
      database
        .select({
          serviceName: ClinicServiceModel.serviceName,
          price: ClinicServiceModel.price,
          currency: ClinicServiceModel.currency,
          durationDays: ClinicServiceModel.durationDays,
          canBeBookedByPatient: ClinicServiceModel.canBeBookedByPatient,
        })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.clinicId, clinicId),
            eq(ClinicServiceModel.isDeleted, false)
          )
        ),
      database
        .selectDistinct({
          id: UserModel.id,
          name: UserModel.name,
          profileImage: UserProfileModel.profileImage,
          speciality: UserProfessionalModel.speciality,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .leftJoin(ClinicAssignModel, eq(ClinicAssignModel.userId, UserModel.id))
        .leftJoin(ClinicModel, eq(ClinicModel.userId, UserModel.id))
        .where(
          and(
            sql`(${ClinicAssignModel.clinicId} = ${clinicId} OR ${ClinicModel.id} = ${clinicId})`,
            sql`(${UserModel.userType} = 'Doctor' OR ${UserModel.isAdminDoctorAccess} = true)`
          )
        ),
      // No clinic-level (doctorId IS NULL) row exists in clinic_availability
      // — availability is always per-doctor — so clinic hours are derived by
      // aggregating across the clinic's doctors per weekday instead.
      database
        .select({
          dayOfWeek: ClinicAvailability.dayOfWeek,
          startTime: ClinicAvailability.startTime,
          endTime: ClinicAvailability.endTime,
          isAvailable: ClinicAvailability.isAvailable,
        })
        .from(ClinicAvailability)
        .where(eq(ClinicAvailability.clinicId, clinicId)),
      database
        .select({
          rating: FeedbackModel.rating,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(FeedbackModel)
        .where(eq(FeedbackModel.clinicId, clinicId))
        .groupBy(FeedbackModel.rating),
    ]);

    if (!fullClinic) {
      throw new HttpError(404, 'Clinic not found');
    }

    const { clinic, profile, subscription } = fullClinic;

    const settings = settingsRow[0] ?? {
      onlineBookingEnabled: true,
      payOnlineEnabled: false,
      payAtClinicEnabled: false,
      whatsappEnabled: false,
    };

    const doctorCount = doctorsWithAssignment.length;
    const doctorsPreview: DoctorPreview[] = doctorsWithAssignment
      .slice(0, DOCTORS_PREVIEW_LIMIT)
      .map((d) => ({
        id: d.id,
        name: d.name,
        profileImage: d.profileImage,
        speciality: d.speciality,
        yearsOfExperience: d.yearsOfExperience,
      }));

    const departmentCount = new Set(
      doctorsWithAssignment
        .map((d) => d.speciality)
        .filter((s): s is string => !!s)
    ).size;

    const week = buildWeeklyHours(availabilityRows);
    const todayHours = resolveTodayHours(week);
    const isOpenNow = computeIsOpenNow(todayHours);

    const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    let reviewCount = 0;
    let ratingSum = 0;
    for (const row of feedbackAgg) {
      const star = String(row.rating) as '1' | '2' | '3' | '4' | '5';
      const count = Number(row.count) || 0;
      if (star in distribution) {
        distribution[star] = count;
      }
      reviewCount += count;
      ratingSum += row.rating * count;
    }
    const reviews =
      reviewCount > 0
        ? {
            averageRating: Math.round((ratingSum / reviewCount) * 10) / 10,
            reviewCount,
            distribution,
          }
        : null;

    const completionChecks = [
      !!clinic.Tagline,
      !!clinic.clinicLogo,
      !!clinic.clinicAddress,
      services.length > 0,
      doctorCount > 0,
      week.some((day) => day.isAvailable),
    ];
    const profileCompletion = Math.round(
      (completionChecks.filter(Boolean).length / completionChecks.length) * 100
    );

    return {
      clinic: {
        id: clinic.id,
        name: clinic.clinicName,
        logo: clinic.clinicLogo,
        tagline: clinic.Tagline,
        phone: clinic.clinicPhone,
        whatsapp: settings.whatsappEnabled,
        email: profile?.email ?? null,
        address: clinic.clinicAddress,
        clinicLocation: clinic.clinicLocation,
        city: clinic.City,
        state: clinic.State,
        zipCode: clinic.ZipCode,
        latitude: clinic.latitude,
        longitude: clinic.longitude,
        status: clinic.status,
        registrationNumber: profile?.registrationNumber ?? null,
        onboardingStatus: clinic.onboardingStatus,
      },
      admin: {
        name: profile?.name ?? null,
        speciality: profile?.speciality ?? null,
        qualification: profile?.qualification ?? null,
        yearsOfExperience: profile?.yearsOfExperience ?? null,
      },
      subscription,
      stats: {
        rating: reviews?.averageRating ?? null,
        reviewCount,
        doctorCount,
        departmentCount,
        yearsOfExperience: profile?.yearsOfExperience ?? null,
        isOpenNow,
      },
      contact: {
        phone: clinic.clinicPhone,
        whatsapp: settings.whatsappEnabled,
        email: profile?.email ?? null,
      },
      workingHours: {
        today: {
          intervals: todayHours.intervals,
          isAvailable: todayHours.isAvailable,
        },
        week,
        isOpenNow,
      },
      services: services.map((s) => ({
        serviceName: s.serviceName,
        price: s.price,
        currency: s.currency,
        durationDays: s.durationDays,
        canBeBookedByPatient: s.canBeBookedByPatient,
      })),
      doctorsPreview,
      doctorCount,
      facilities: null,
      insurance: null,
      gallery: null,
      reviews,
      socialLinks: null,
      profileCompletion,
    };
  }

  static async updateClinicProfile(
    userId: string,
    clinicId: string,
    payload: {
      clinicDetails?: Record<string, unknown>;
    },
    clinicLogo?: string
  ) {
    const [existingClinic] = await database
      .select({
        id: ClinicModel.id,
        userId: ClinicModel.userId,
        clinicLogo: ClinicModel.clinicLogo,
      })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId));

    if (!existingClinic) {
      throw new HttpError(404, 'Clinic not found');
    }

    const allowed = [
      'clinicName',
      'clinicPhone',
      'Tagline',
      'clinicAddress',
      'clinicLocation',
      'State',
      'City',
      'ZipCode',
      'clinicLogo',
      'status',
      'latitude',
      'longitude',
    ] as const;

    const setObj: Record<string, unknown> = {};
    const clinicDetails = {
      ...(payload.clinicDetails ?? {}),
      ...(clinicLogo ? { clinicLogo } : {}),
    };

    for (const key of allowed) {
      const value = (clinicDetails as Record<string, unknown>)[key];
      if (typeof value !== 'undefined') {
        setObj[key] = value;
      }
    }

    if (Object.keys(setObj).length > 0) {
      setObj.updatedAt = sql`NOW()`;
      await database
        .update(ClinicModel)
        .set(setObj)
        .where(eq(ClinicModel.id, clinicId));
    }

    if (
      clinicDetails.clinicLogo &&
      existingClinic.clinicLogo &&
      existingClinic.clinicLogo !== clinicDetails.clinicLogo
    ) {
      await deleteFromS3(existingClinic.clinicLogo).catch(() => {});
    }

    const assignedDoctors = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .where(eq(ClinicAssignModel.clinicId, clinicId));

    await invalidateCacheMany(
      assignedDoctors.flatMap((doctor) =>
        CacheKeys.doctorPublicProfileAll(doctor.userId)
      )
    );

    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      () => ClinicService.getClinicByUserId(userId, clinicId)
    );
  }
}
