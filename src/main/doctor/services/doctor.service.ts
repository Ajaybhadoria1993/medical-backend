import { PrescriptionPreviewService } from '../../reports/services/prescriptionPreview.service';
import {
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
  gte,
  lte,
  asc,
  SQL,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { DoctorWeeklyShiftCapacityModel } from '../../appointment-engine/models/doctorWeeklyShiftCapacity.model';
import redisClient from '../../../configurations/redisConfig';
import {
  CacheKeys,
  invalidateCache,
  invalidateCacheByPattern,
  invalidateCacheMany,
  withCacheInvalidation,
} from '../../../utils/cache.util';
import {
  ClinicAppointmentPlainModel,
  ClinicAssignModel,
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicModel,
  ClinicServiceModel,
  ClinicDateAvailability,
  ClinicDateAvailabilityTimeSlots,
} from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import {
  checkPlainsDto,
  CreateClinicAppointmentPlainDto,
  FulupdateDoctorScheamasDto,
  getDoctorDoctorIdDto,
  GetQueryParamsDto,
  PlainIdDto,
  UpdateClinicAppointmentPlainDto,
  GetSubscriptionsDto,
  getDoctorAvailabilityOnDateDto,
  getDoctorAvailabilityRangeDto,
  UpdateServiceByIdDto,
  ToggleServiceStatusDto,
  UpsertDoctorPreferencesInput,
} from '../schemas/doctor.schemas';
import {
  doctorPrescriptionTypeModel,
  DoctorExperienceModel,
  DoctorQualificationModel,
} from '../models/doctor.model';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { AuthUser } from '../../../middlewear/auth.middleware';
import { alias } from 'drizzle-orm/pg-core';
import { PrescriptionModel } from '../../reports/models/reports.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import { DoctorPreferenceModel } from '../models/doctorPreference.model';
import { mergeInstructionSuggestions } from '../utils/instructionSuggestions.utils';
import { INSTRUCTION_SUGGESTION_DEFAULTS } from '../utils/instructionSuggestionDefaults';
import { doctorTemplateModel } from '../models/doctorTemplate.model';
import {
  configSpecialty,
  MAX_OWN_SUGGESTIONS,
  resolvePreferenceLists,
  toKnownTools,
  type SuggestionListKey,
} from '../../../utils/doctorSpecialtyConfig';
import { doctorManualTemplateModel } from '../models/doctorManualTemplate.model';
import { deleteFromS3 } from '../../../configurations/s3';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';
import logger from '../../../utils/logger';
import { doctorDegreeLine } from '../../../utils/qualificationCatalog';
import { getISTDateString } from '../../../utils/istDateTime';
import { notifyDoctorProfileUpdateRequested } from '../../../utils/notificationHelpers';

export class DoctorServices {
  /** The doctor's degree line every screen shows ("BUMS, MD Anaesthesiology"); `max` keeps the highest ones. */
  static async degreeLine(doctorId: string, max?: number): Promise<string> {
    return (
      (await DoctorServices.degreeLines([doctorId], max)).get(doctorId) ?? ''
    );
  }

  /** Degree lines for many doctors in two queries, for lists (one call per page, never per row). */
  static async degreeLines(
    doctorIds: string[],
    max?: number
  ): Promise<Map<string, string>> {
    const ids = [...new Set(doctorIds)];
    if (!ids.length) return new Map();
    const [rows, professionals] = await Promise.all([
      database
        .select({
          userId: DoctorQualificationModel.userId,
          qualificationTitle: DoctorQualificationModel.qualificationTitle,
          qualificationType: DoctorQualificationModel.qualificationType,
          yearOfCompletion: DoctorQualificationModel.yearOfCompletion,
        })
        .from(DoctorQualificationModel)
        .where(inArray(DoctorQualificationModel.userId, ids)),
      database
        .select({
          userId: UserProfessionalModel.userId,
          qualification: UserProfessionalModel.qualification,
        })
        .from(UserProfessionalModel)
        .where(inArray(UserProfessionalModel.userId, ids)),
    ]);
    const legacy = new Map(
      professionals.map((p) => [p.userId, p.qualification])
    );
    return new Map(
      ids.map((id) => [
        id,
        doctorDegreeLine(
          rows.filter((r) => r.userId === id),
          legacy.get(id),
          max
        ),
      ])
    );
  }

  private static async assertDoctorInClinic(
    doctorId: string,
    clinicId: string
  ) {
    const isAssigned = await isDoctorAssignedToClinic(doctorId, clinicId);
    if (!isAssigned) {
      throw new HttpError(
        403,
        'Access denied. Doctor is not assigned to this clinic.'
      );
    }
  }

  public static async updateDoctorProfile(
    tx: any,
    payload: FulupdateDoctorScheamasDto,
    userId: string,
    _profileImage?: string
  ) {
    const doctorProfile = (payload as any).doctorProfile;
    if (doctorProfile && Object.keys(doctorProfile).length > 0) {
      const userSetObj: Record<string, any> = {};
      const profileSetObj: Record<string, any> = {};
      const professionalSetObj: Record<string, any> = {};

      const allowedUserFields = ['name', 'mobile'] as const;
      const allowedProfileFields = ['alternateMobile'] as const;
      const allowedProfessionalFields = [
        'speciality',
        'specialization',
        'registrationNumber',
        'licenseNumber',
        'yearsOfExperience',
        'qualification',
        'languagesSpoken',
      ] as const;

      for (const k of allowedUserFields) {
        const val = doctorProfile[k];
        if (typeof val !== 'undefined') userSetObj[k] = val;
      }
      for (const k of allowedProfileFields) {
        const val = doctorProfile[k];
        if (typeof val !== 'undefined') profileSetObj[k] = val;
      }
      for (const k of allowedProfessionalFields) {
        const val = doctorProfile[k];
        if (typeof val !== 'undefined') professionalSetObj[k] = val;
      }

      if (Object.keys(userSetObj).length > 0) {
        userSetObj.updatedAt = sql`NOW()`;
        await tx
          .update(UserModel)
          .set(userSetObj)
          .where(eq(UserModel.id, userId));
      }
      if (Object.keys(profileSetObj).length > 0) {
        profileSetObj.updatedAt = sql`NOW()`;
        await tx
          .insert(UserProfileModel)
          .values({ userId, ...profileSetObj })
          .onConflictDoUpdate({
            target: [UserProfileModel.userId],
            set: profileSetObj,
          });
      }
      if (Object.keys(professionalSetObj).length > 0) {
        professionalSetObj.updatedAt = sql`NOW()`;
        await tx
          .insert(UserProfessionalModel)
          .values({ userId, ...professionalSetObj })
          .onConflictDoUpdate({
            target: [UserProfessionalModel.userId],
            set: professionalSetObj,
          });
      }
    }

    const qualifications =
      (payload as any).doctorProfile?.qualifications ??
      (payload as any).adminProfile?.qualifications ??
      payload.qualifications;
    const about =
      (payload as any).about ?? (payload as any).doctorProfile?.about;

    if (about !== undefined) {
      await tx
        .update(UserProfessionalModel)
        .set({ about, updatedAt: new Date() })
        .where(eq(UserProfessionalModel.userId, userId));
    }

    if (Array.isArray(payload.experiences)) {
      await this.replaceExperiences(tx, userId, payload.experiences);
    }

    if (!Array.isArray(qualifications)) return;

    // 1️⃣ Fetch existing qualification IDs for this doctor
    const existingQualifications = await tx
      .select({ id: DoctorQualificationModel.id })
      .from(DoctorQualificationModel)
      .where(eq(DoctorQualificationModel.userId, userId));

    const existingIds = existingQualifications.map((q: any) => q.id);

    // 2️⃣ Extract incoming IDs (only valid ones)
    const incomingIds = qualifications
      .map((q) => q.id)
      .filter((id): id is string => Boolean(id));

    // 3️⃣ Identify IDs to delete (present in DB but NOT in payload)
    const idsToDelete = existingIds.filter(
      (id: string) => !incomingIds.includes(id)
    );

    if (idsToDelete.length > 0) {
      await tx
        .delete(DoctorQualificationModel)
        .where(
          and(
            eq(DoctorQualificationModel.userId, userId),
            inArray(DoctorQualificationModel.id, idsToDelete)
          )
        );
    }

    // 4️⃣ Separate update & insert data
    const updatePromises = qualifications
      .filter((q) => q.id)
      .map((q) =>
        tx
          .update(DoctorQualificationModel)
          .set({
            qualificationType: q.qualificationType,
            qualificationTitle: q.qualificationTitle,
            // specialization: q.specialization,
            boardOrUniversity: q.boardOrUniversity,
            yearOfCompletion: q.yearOfCompletion,
            // Omitted leaves the saved note alone; '' clears it.
            notes: q.notes === undefined ? undefined : q.notes || null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(DoctorQualificationModel.id, q.id!),
              eq(DoctorQualificationModel.userId, userId)
            )
          )
      );

    const insertData = qualifications
      .filter((q) => !q.id)
      .map((q) => ({
        userId,
        qualificationType: q.qualificationType,
        qualificationTitle: q.qualificationTitle,
        // specialization: q.specialization,
        boardOrUniversity: q.boardOrUniversity,
        yearOfCompletion: q.yearOfCompletion,
        notes: q.notes || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

    // 5️⃣ Execute updates in parallel
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }

    // 6️⃣ Bulk insert new ones
    if (insertData.length > 0) {
      await tx.insert(DoctorQualificationModel).values(insertData);
    }
  }

  // The list is small (max 15) and has no external references, so it is replaced whole.
  private static async replaceExperiences(
    tx: any,
    userId: string,
    experiences: NonNullable<FulupdateDoctorScheamasDto['experiences']>
  ) {
    await tx
      .delete(DoctorExperienceModel)
      .where(eq(DoctorExperienceModel.userId, userId));
    if (experiences.length === 0) return;
    await tx.insert(DoctorExperienceModel).values(
      experiences.map((e) => ({
        userId,
        organisation: e.organisation,
        role: e.role,
        city: e.city || null,
        startMonth: e.startMonth,
        startYear: e.startYear,
        endMonth: e.isCurrent ? null : (e.endMonth ?? null),
        endYear: e.isCurrent ? null : (e.endYear ?? null),
        isCurrent: e.isCurrent,
      }))
    );
  }

  public static async updateUser(
    currentUserId: string,
    clinicId: string,
    payload: FulupdateDoctorScheamasDto,
    profileImage?: string
  ) {
    const [existingUser] = await database
      .select({ profileImage: UserProfileModel.profileImage })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, currentUserId))
      .limit(1);

    const oldProfileImage = existingUser?.profileImage;

    const result = await database.transaction(async (tx) => {
      const qualifications =
        (payload as any).doctorProfile?.qualifications ??
        payload.qualifications;
      if (
        Array.isArray(qualifications) ||
        Array.isArray(payload.experiences) ||
        payload.doctorProfile ||
        profileImage ||
        typeof (payload as any).about !== 'undefined'
      ) {
        await this.updateDoctorProfile(
          tx,
          payload,
          currentUserId,
          profileImage
        );
      }
      if (
        Array.isArray(payload.clinicService) &&
        payload.clinicService.length > 0
      ) {
        // Batch: separate updates from inserts
        const toUpdate = payload.clinicService.filter((s: any) => s.id);
        const toInsert = payload.clinicService.filter((s: any) => !s.id);

        // Run all updates in parallel
        if (toUpdate.length > 0) {
          await Promise.all(
            toUpdate.map((clinicServices: any) =>
              tx
                .update(ClinicServiceModel)
                .set({
                  serviceName: clinicServices.serviceName,
                  price: clinicServices.price,
                  currency: clinicServices.currency,
                  additionalServices: clinicServices.additionalServices,
                  canBeBookedByPatient: clinicServices.canBeBookedByPatient,
                  durationDays: clinicServices.durationDays,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(ClinicServiceModel.id, clinicServices.id),
                    eq(ClinicServiceModel.doctorId, currentUserId),
                    eq(ClinicServiceModel.clinicId, clinicId)
                  )
                )
            )
          );
        }

        // Run all inserts in parallel (each with onConflictDoUpdate)
        if (toInsert.length > 0) {
          await Promise.all(
            toInsert.map((clinicServices: any) =>
              tx
                .insert(ClinicServiceModel)
                .values({
                  doctorId: currentUserId,
                  clinicId: clinicId,
                  serviceName: clinicServices.serviceName,
                  price: clinicServices.price,
                  currency: clinicServices.currency,
                  additionalServices: clinicServices.additionalServices,
                  canBeBookedByPatient: clinicServices.canBeBookedByPatient,
                  durationDays: clinicServices.durationDays,
                })
                .onConflictDoUpdate({
                  target: [
                    ClinicServiceModel.clinicId,
                    ClinicServiceModel.serviceName,
                    ClinicServiceModel.doctorId,
                  ],
                  set: {
                    durationDays: clinicServices.durationDays,
                    serviceName: clinicServices.serviceName,
                    price: clinicServices.price,
                    currency: clinicServices.currency,
                    additionalServices: clinicServices.additionalServices,
                    canBeBookedByPatient: clinicServices.canBeBookedByPatient,
                    updatedAt: new Date(),
                  },
                })
            )
          );
        }
      }
      if (Array.isArray(payload.aivblity) && payload.aivblity.length > 0) {
        // Process availability slots — each needs its returned ID for breaks,
        // but we can parallelize the break inserts within each slot
        for (const availability of payload.aivblity) {
          const [availabilityId] = await tx
            .insert(ClinicAvailability)
            .values({
              doctorId: currentUserId,
              clinicId: clinicId,
              dayOfWeek: availability?.dayOfWeek,
              startTime: availability?.startTime,
              endTime: availability?.endTime,
              isAvailable: availability?.isAvailable,
              notes: availability?.notes,
              slotMinutes: availability?.slotMinutes,
              stepMinutes: availability?.stepMinutes,
              noOfPatients: availability?.noOfPatients ?? null,
            })
            .onConflictDoUpdate({
              target: [
                ClinicAvailability.clinicId,
                ClinicAvailability.dayOfWeek,
                ClinicServiceModel.doctorId,
              ],
              set: {
                dayOfWeek: availability?.dayOfWeek,
                startTime: availability?.startTime,
                endTime: availability?.endTime,
                isAvailable: availability?.isAvailable,
                notes: availability?.notes,
                slotMinutes: availability?.slotMinutes,
                stepMinutes: availability?.stepMinutes,
                noOfPatients: availability?.noOfPatients ?? null,
                updatedAt: new Date(),
              },
            })
            .returning({
              id: ClinicAvailability.id,
            });

          await tx
            .delete(ClinicAvailabilityBreak)
            .where(
              eq(
                ClinicAvailabilityBreak.clinicAvailabilityId,
                availabilityId.id
              )
            );

          /*
           * Standing per-shift token capacity — "every Monday, 20 in the
           * morning and 30 in the evening".
           *
           * Replaced wholesale rather than merged, the same way the breaks
           * above are: the shifts are re-derived from those breaks on every
           * save, so a shift that was removed must not leave its capacity
           * behind to be picked up by whichever shift inherits its ordinal.
           */
          await tx
            .delete(DoctorWeeklyShiftCapacityModel)
            .where(
              and(
                eq(DoctorWeeklyShiftCapacityModel.clinicId, clinicId),
                eq(DoctorWeeklyShiftCapacityModel.doctorId, currentUserId),
                eq(
                  DoctorWeeklyShiftCapacityModel.dayOfWeek,
                  availability?.dayOfWeek
                )
              )
            );

          if (
            Array.isArray(availability.shiftCapacities) &&
            availability.shiftCapacities.length > 0
          ) {
            await tx.insert(DoctorWeeklyShiftCapacityModel).values(
              availability.shiftCapacities.map((shift: any) => ({
                clinicId,
                doctorId: currentUserId,
                dayOfWeek: availability?.dayOfWeek,
                sessionIndex: shift.sessionIndex,
                noOfPatients: shift.noOfPatients,
                updatedAt: new Date(),
              }))
            );
          }

          // Batch insert all breaks for this availability in parallel
          if (
            Array.isArray(availability.aivblityBreak) &&
            availability.aivblityBreak.length > 0
          ) {
            await Promise.all(
              availability.aivblityBreak.map((aivbBreak: any) =>
                tx
                  .insert(ClinicAvailabilityBreak)
                  .values({
                    clinicAvailabilityId: availabilityId.id,
                    breakType: aivbBreak.breakType,
                    startTime: aivbBreak.startTime,
                    endTime: aivbBreak.endTime,
                    status: aivbBreak.status,
                    notes: aivbBreak.notes,
                    updatedAt: new Date(),
                  })
                  .onConflictDoUpdate({
                    target: [
                      ClinicAvailabilityBreak.clinicAvailabilityId,
                      ClinicAvailabilityBreak.breakType,
                    ],
                    set: {
                      breakType: aivbBreak.breakType,
                      startTime: aivbBreak.startTime,
                      endTime: aivbBreak.endTime,
                      status: aivbBreak.status,
                      notes: aivbBreak.notes,
                      updatedAt: new Date(),
                    },
                  })
              )
            );
          }
        }
      }
      if (
        Array.isArray(payload.dateAvailability) &&
        payload.dateAvailability.length > 0
      ) {
        for (const dateAvailability of payload.dateAvailability) {
          const [dateAvailabilityId] = await tx
            .insert(ClinicDateAvailability)
            .values({
              doctorId: currentUserId,
              clinicId: clinicId,
              date: new Date(dateAvailability.date),
              isAvailable: dateAvailability.isAvailable,
              notes: dateAvailability.notes,
              slotMinutes: dateAvailability.slotMinutes,
              stepMinutes: dateAvailability.stepMinutes,
            })
            .onConflictDoUpdate({
              target: [
                ClinicDateAvailability.clinicId,
                ClinicDateAvailability.doctorId,
                ClinicDateAvailability.date,
              ],
              set: {
                isAvailable: dateAvailability.isAvailable,
                notes: dateAvailability.notes,
                slotMinutes: dateAvailability.slotMinutes,
                stepMinutes: dateAvailability.stepMinutes,
                updatedAt: new Date(),
              },
            })
            .returning({
              id: ClinicDateAvailability.id,
            });

          // Batch insert/update all time slots in parallel
          if (
            Array.isArray(dateAvailability.timeSlots) &&
            dateAvailability.timeSlots.length > 0
          ) {
            await Promise.all(
              dateAvailability.timeSlots.map((timeSlot: any) => {
                // `noOfPatients` is this shift's own token capacity — a doctor
                // running 20 in the morning and 30 in the evening. Written as
                // `?? null` rather than skipped when absent, so clearing it
                // actually falls back to the weekly number instead of leaving
                // a stale per-shift override in place.
                const noOfPatients = timeSlot.noOfPatients ?? null;

                if (timeSlot.id) {
                  return tx
                    .update(ClinicDateAvailabilityTimeSlots)
                    .set({
                      startTime: timeSlot.startTime,
                      endTime: timeSlot.endTime,
                      isAvailable: timeSlot.isAvailable,
                      notes: timeSlot.notes,
                      noOfPatients,
                      updatedAt: new Date(),
                    })
                    .where(eq(ClinicDateAvailabilityTimeSlots.id, timeSlot.id));
                } else {
                  return tx
                    .insert(ClinicDateAvailabilityTimeSlots)
                    .values({
                      clinicDateAvailabilityId: dateAvailabilityId.id,
                      startTime: timeSlot.startTime,
                      endTime: timeSlot.endTime,
                      isAvailable: timeSlot.isAvailable,
                      notes: timeSlot.notes,
                      noOfPatients,
                      updatedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                      target: [
                        ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
                        ClinicDateAvailabilityTimeSlots.startTime,
                        ClinicDateAvailabilityTimeSlots.endTime,
                      ],
                      set: {
                        isAvailable: timeSlot.isAvailable,
                        notes: timeSlot.notes,
                        noOfPatients,
                        updatedAt: new Date(),
                      },
                    });
                }
              })
            );
          }
        }
      }
      if (
        (payload.doctorProfile &&
          Object.keys(payload.doctorProfile).length > 0) ||
        profileImage
      ) {
        const userSetObj: Record<string, any> = {};
        const profileSetObj: Record<string, any> = {};
        const professionalSetObj: Record<string, any> = {};

        const allowedUserFields = ['name', 'email', 'mobile'] as const;
        const allowedProfileFields = [
          'alternateMobile',
          'profileImage',
        ] as const;
        const allowedProfessionalFields = [
          'qualification',
          'yearsOfExperience',
          'licenseNumber',
          'speciality',
          'specialization',
          'about',
          'registrationNumber',
        ] as const;

        if (payload.doctorProfile) {
          for (const k of allowedUserFields) {
            const val = (payload.doctorProfile as any)[k];
            if (typeof val !== 'undefined') userSetObj[k] = val;
          }
          for (const k of allowedProfileFields) {
            const val = (payload.doctorProfile as any)[k];
            if (typeof val !== 'undefined') profileSetObj[k] = val;
          }
          for (const k of allowedProfessionalFields) {
            const val = (payload.doctorProfile as any)[k];
            if (typeof val !== 'undefined') professionalSetObj[k] = val;
          }
        }

        if (typeof (payload as any).about !== 'undefined') {
          professionalSetObj.about = (payload as any).about;
        }

        // 🔥 IMAGE FORCE UPDATE
        if (profileImage) {
          profileSetObj.profileImage = profileImage;
        }

        if (Object.keys(userSetObj).length > 0) {
          userSetObj.updatedAt = sql`NOW()`;
          await tx
            .update(UserModel)
            .set(userSetObj)
            .where(eq(UserModel.id, currentUserId));
        }

        if (Object.keys(profileSetObj).length > 0) {
          profileSetObj.updatedAt = sql`NOW()`;
          await tx
            .insert(UserProfileModel)
            .values({ userId: currentUserId, ...profileSetObj })
            .onConflictDoUpdate({
              target: [UserProfileModel.userId],
              set: profileSetObj,
            });
        }

        if (Object.keys(professionalSetObj).length > 0) {
          professionalSetObj.updatedAt = sql`NOW()`;
          await tx
            .insert(UserProfessionalModel)
            .values({ userId: currentUserId, ...professionalSetObj })
            .onConflictDoUpdate({
              target: [UserProfessionalModel.userId],
              set: professionalSetObj,
            });
        }
      }

      return true;
    });

    // 4) Invalidate after commit (SCAN, not KEYS): inside the transaction a
    // concurrent read could re-cache the pre-commit profile.
    const scanAndDelete = async (pattern: string) => {
      const stream = redisClient.scanStream({ match: pattern, count: 100 });
      const keysToDelete: string[] = [];
      for await (const keys of stream) {
        keysToDelete.push(...keys);
      }
      if (keysToDelete.length > 0) {
        await redisClient.del(...keysToDelete);
      }
    };

    // The profile is committed; a Redis failure here must not fail the request.
    await Promise.all([
      scanAndDelete(`doctor_availability_range:${clinicId}:${currentUserId}:*`),
      scanAndDelete(`doctors_availability_on_date:${clinicId}:*`),
      invalidateCacheByPattern(
        CacheKeys.followUpDoctorDayPattern(clinicId, currentUserId)
      ),
      invalidateCacheMany(CacheKeys.doctorPublicProfileAll(currentUserId)),
      // GET /clinic serves the owner's profile from this; without it the Profile page shows old values.
      redisClient.del(CacheKeys.clinicDetails(clinicId)),
    ]).catch((err) => {
      logger.error(
        `[DoctorServices] Cache invalidation failed for doctor=${currentUserId}`,
        err
      );
    });

    if (profileImage && oldProfileImage && oldProfileImage !== profileImage) {
      await deleteFromS3(oldProfileImage).catch((error) => {
        console.error('Failed to delete old profile image:', error);
      });
    }

    // A weekly-availability edit reshapes every open day view: working hours,
    // which slots exist, where breaks fall. Without this the timeline kept the
    // old grid until a manual reload, unlike arrival and delay.
    if (
      (Array.isArray(payload.aivblity) && payload.aivblity.length > 0) ||
      (Array.isArray(payload.dateAvailability) &&
        payload.dateAvailability.length > 0)
    ) {
      const today = getISTDateString();

      // Imported here, not at module load: the engine's graph attaches the
      // realtime bus on import, which this module must not pull in to do so.
      const [{ ScheduleShiftService }, { AppointmentEngineOrchestrator }] =
        await Promise.all([
          import('../../appointment-engine/services/scheduleShift.service'),
          import('../../appointment-engine/services/orchestrator.service'),
        ]);

      // Every date whose grid just moved, today included: an open timeline is
      // showing it, and `day_config` holds the old hours for an hour.
      const touchedDates = new Set<string>([today]);
      for (const day of payload.dateAvailability ?? []) {
        const parsed = new Date(day.date);
        if (!isNaN(parsed.getTime())) {
          touchedDates.add(getISTDateString(parsed));
        }
      }

      // Before the recalculation below, which re-reads the config and would
      // otherwise put the old grid straight back in the cache.
      await Promise.all(
        Array.from(touchedDates).map((date) =>
          ScheduleShiftService.invalidateDayConfig(
            clinicId,
            currentUserId,
            date
          )
        )
      );

      // Rebuilds the snapshot, then signals open screens. It is the only signal,
      // so a refetch can never land before the new grid does.
      void new AppointmentEngineOrchestrator().onSessionOverride(
        clinicId,
        currentUserId,
        today
      );
    }

    // Services/availability CRUD in this update path feeds the v2 Clinic
    // Information aggregate.
    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      async () => result
    );
  }

  public static async updateProfileImage(
    currentUserId: string,
    profileImage: string
  ) {
    const [existingUser] = await database
      .select({ profileImage: UserProfileModel.profileImage })
      .from(UserProfileModel)
      .where(eq(UserProfileModel.userId, currentUserId))
      .limit(1);

    const oldProfileImage = existingUser?.profileImage;

    await database
      .insert(UserProfileModel)
      .values({
        userId: currentUserId,
        profileImage: profileImage,
        updatedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: [UserProfileModel.userId],
        set: {
          profileImage: profileImage,
          updatedAt: sql`NOW()`,
        },
      });

    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(currentUserId));

    if (oldProfileImage && oldProfileImage !== profileImage) {
      await deleteFromS3(oldProfileImage).catch(console.error);
    }

    return { success: true };
  }

  /**
   * Fire-and-forget: fetches the doctor/clinic names a pending profile update
   * request needs for its notification copy, then notifies super admins.
   */
  public static async notifyProfileUpdateRequested(request: {
    id: string;
    doctorId: string;
    clinicId: string | null;
  }) {
    try {
      const [doctor] = await database
        .select({ name: UserModel.name })
        .from(UserModel)
        .where(eq(UserModel.id, request.doctorId))
        .limit(1);

      let clinicName: string | null = null;
      if (request.clinicId) {
        const [clinic] = await database
          .select({ clinicName: ClinicModel.clinicName })
          .from(ClinicModel)
          .where(eq(ClinicModel.id, request.clinicId))
          .limit(1);
        clinicName = clinic?.clinicName ?? null;
      }

      await notifyDoctorProfileUpdateRequested(
        request.id,
        request.doctorId,
        doctor?.name || 'A doctor',
        request.clinicId,
        clinicName
      );
    } catch (err) {
      logger.error(
        '[Notification] Failed to notify super admins of profile update request:',
        err
      );
    }
  }

  public static async deleteService(serviceId: string, currentUserId: string) {
    const [existingService] = await database
      .select()
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.id, serviceId),
          eq(ClinicServiceModel.doctorId, currentUserId)
        )
      );

    if (!existingService) {
      throw new HttpError(404, 'Service not found');
    }

    await database.update(ClinicServiceModel).set({
      isDeleted: true,
      deletedAt: new Date(),
    });
    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(currentUserId));

    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(existingService.clinicId),
      async () => ({ message: 'Service deleted successfully' })
    );
  }

  public static async updateServiceById(
    serviceId: string,
    currentUserId: string,
    clinicId: string,
    payload: UpdateServiceByIdDto
  ) {
    const [existingService] = await database
      .select()
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.id, serviceId),
          eq(ClinicServiceModel.doctorId, currentUserId),
          eq(ClinicServiceModel.clinicId, clinicId),
          eq(ClinicServiceModel.isDeleted, false)
        )
      );

    if (!existingService) {
      throw new HttpError(404, 'Service not found');
    }

    const setObj: Record<string, any> = {};
    if (payload.serviceName !== undefined)
      setObj.serviceName = payload.serviceName;
    if (payload.price !== undefined) setObj.price = payload.price;
    if (payload.currency !== undefined) setObj.currency = payload.currency;
    if (payload.additionalServices !== undefined)
      setObj.additionalServices = payload.additionalServices;
    if (payload.canBeBookedByPatient !== undefined)
      setObj.canBeBookedByPatient = payload.canBeBookedByPatient;
    if (payload.durationDays !== undefined)
      setObj.durationDays = payload.durationDays;

    if (Object.keys(setObj).length === 0) {
      throw new HttpError(400, 'No fields to update');
    }

    setObj.updatedAt = new Date();

    const [updated] = await database
      .update(ClinicServiceModel)
      .set(setObj)
      .where(eq(ClinicServiceModel.id, serviceId))
      .returning();

    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(currentUserId));

    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      async () => updated
    );
  }

  public static async toggleServiceStatus(
    serviceId: string,
    currentUserId: string,
    clinicId: string,
    payload: ToggleServiceStatusDto
  ) {
    const [existingService] = await database
      .select()
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.id, serviceId),
          eq(ClinicServiceModel.doctorId, currentUserId),
          eq(ClinicServiceModel.clinicId, clinicId)
        )
      );

    if (!existingService) {
      throw new HttpError(404, 'Service not found');
    }

    const isDisabling = payload.action === 'disable';

    const [updated] = await database
      .update(ClinicServiceModel)
      .set({
        isDeleted: isDisabling,
        deletedAt: isDisabling ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(ClinicServiceModel.id, serviceId))
      .returning();

    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(currentUserId));

    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      async () => ({
        ...updated,
        message: isDisabling
          ? 'Service disabled successfully'
          : 'Service enabled successfully',
      })
    );
  }

  public static async getCurrentUser(currentUserId: string) {
    const [assigneUser] = await database
      .select()
      .from(ClinicAssignModel)
      .where(eq(ClinicAssignModel.userId, currentUserId))
      .limit(1);

    const [doctor] = await database
      .select()
      .from(UserModel)
      .where(eq(UserModel.id, currentUserId));

    const services = await database
      .select()
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.clinicId, assigneUser.clinicId),
          eq(ClinicServiceModel.doctorId, currentUserId)
          // eq(ClinicServiceModel.isDeleted, false)
        )
      );

    const availability = await database
      .select({
        id: ClinicAvailability.id,
        dayOfWeek: ClinicAvailability.dayOfWeek,
        startTime: ClinicAvailability.startTime,
        endTime: ClinicAvailability.endTime,
        isAvailable: ClinicAvailability.isAvailable,
        slotMinutes: ClinicAvailability.slotMinutes,
        stepMinutes: ClinicAvailability.stepMinutes,
        noOfPatients: ClinicAvailability.noOfPatients,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, assigneUser.clinicId),
          eq(ClinicAvailability.doctorId, currentUserId)
        )
      );

    const avIds = availability.map((a) => a.id);

    const availabilityBreaks = await database
      .select()
      .from(ClinicAvailabilityBreak)
      .where(inArray(ClinicAvailabilityBreak.clinicAvailabilityId, avIds));

    /*
     * Standing per-shift token capacity — "every Monday, 20 in the morning and
     * 30 in the evening".
     *
     * Returned alongside the availability it belongs to so the editor can show
     * what was saved. Without it the per-shift fields render empty on reopen
     * and the next save writes those blanks back, quietly destroying the
     * doctor's configuration.
     */
    const shiftCapacities = await database
      .select({
        dayOfWeek: DoctorWeeklyShiftCapacityModel.dayOfWeek,
        sessionIndex: DoctorWeeklyShiftCapacityModel.sessionIndex,
        noOfPatients: DoctorWeeklyShiftCapacityModel.noOfPatients,
      })
      .from(DoctorWeeklyShiftCapacityModel)
      .where(
        and(
          eq(DoctorWeeklyShiftCapacityModel.clinicId, assigneUser.clinicId),
          eq(DoctorWeeklyShiftCapacityModel.doctorId, currentUserId)
        )
      );

    const dateAvailability = await database
      .select({
        id: ClinicDateAvailability.id,
        date: ClinicDateAvailability.date,
        isAvailable: ClinicDateAvailability.isAvailable,
        slotMinutes: ClinicDateAvailability.slotMinutes,
        stepMinutes: ClinicDateAvailability.stepMinutes,
      })
      .from(ClinicDateAvailability)
      .where(
        and(
          eq(ClinicDateAvailability.clinicId, assigneUser.clinicId),
          eq(ClinicDateAvailability.doctorId, currentUserId)
        )
      );

    const dateAvIds = dateAvailability.map((da) => da.id);

    const dateAvailabilityTimeSlots = await database
      .select({
        id: ClinicDateAvailabilityTimeSlots.id,
        startTime: ClinicDateAvailabilityTimeSlots.startTime,
        endTime: ClinicDateAvailabilityTimeSlots.endTime,
        isAvailable: ClinicDateAvailabilityTimeSlots.isAvailable,
        clinicDateAvailabilityId:
          ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
      })
      .from(ClinicDateAvailabilityTimeSlots)
      .where(
        inArray(
          ClinicDateAvailabilityTimeSlots.clinicDateAvailabilityId,
          dateAvIds
        )
      );

    // ✅ Only fetch current user's qualifications
    const qualifications = await database
      .select()
      .from(DoctorQualificationModel)
      .where(eq(DoctorQualificationModel.userId, currentUserId));

    const experiences = await database
      .select()
      .from(DoctorExperienceModel)
      .where(eq(DoctorExperienceModel.userId, currentUserId))
      .orderBy(
        desc(DoctorExperienceModel.isCurrent),
        desc(DoctorExperienceModel.startYear),
        desc(DoctorExperienceModel.startMonth)
      );

    // Fetch professional details (speciality)
    const [professional] = await database
      .select()
      .from(UserProfessionalModel)
      .where(eq(UserProfessionalModel.userId, currentUserId));

    const doctorProfile = doctor
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { password, ...doctorWithoutPassword } = doctor;
          return {
            ...doctorWithoutPassword,
            speciality: professional?.speciality ?? null,
            yearsOfExperience: professional?.yearsOfExperience ?? null,
            specialization: professional?.specialization ?? [],
            about: professional?.about ?? null,
            registrationNumber: professional?.registrationNumber ?? null,
            languagesSpoken: professional?.languagesSpoken ?? [],
            qualifications,
            experiences,
          };
        })()
      : null;

    return {
      services,
      aivblity: availability.map((a) => ({
        ...a,
        aivblityBreak: availabilityBreaks.filter(
          (b) => b.clinicAvailabilityId === a.id
        ),
        // Matched case-insensitively: `day_of_week` is a free varchar holding
        // rows in both casings, and sorted so the caller can read the shifts
        // positionally rather than searching by ordinal.
        shiftCapacities: shiftCapacities
          .filter(
            (c) =>
              String(c.dayOfWeek).toLowerCase() ===
              String(a.dayOfWeek).toLowerCase()
          )
          .sort((x, y) => x.sessionIndex - y.sessionIndex),
      })),
      dateAvailability: dateAvailability.map((da) => ({
        ...da,
        timeSlots: dateAvailabilityTimeSlots.filter(
          (ts) => ts.clinicDateAvailabilityId === da.id
        ),
      })),
      doctorProfile: doctorProfile ?? null,
    };
  }
  static async getDoctorById(params: getDoctorDoctorIdDto, clinicId?: string) {
    const [row] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        userType: UserModel.userType,
        userStatus: UserModel.userStatus,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
        createdAt: UserModel.createdAt,
        alternateMobile: UserProfileModel.alternateMobile,
        gender: UserProfileModel.gender,
        address: UserProfileModel.address,
        city: UserProfileModel.city,
        state: UserProfileModel.state,
        zipCode: UserProfileModel.zipCode,
        profileImage: UserProfileModel.profileImage,
        qualification: UserProfessionalModel.qualification,
        yearsOfExperience: UserProfessionalModel.yearsOfExperience,
        licenseNumber: UserProfessionalModel.licenseNumber,
        speciality: UserProfessionalModel.speciality,
        specialization: UserProfessionalModel.specialization,
        registrationNumber: UserProfessionalModel.registrationNumber,
        about: UserProfessionalModel.about,
        averageRating: UserProfessionalModel.averageRating,
        reviewCount: UserProfessionalModel.reviewCount,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .where(eq(UserModel.id, params.doctorId));

    if (!row) {
      throw new HttpError(404, 'Doctor not found');
    }

    const [clinicAssign] = await database
      .select({ clinicId: ClinicModel.id, clinicName: ClinicModel.clinicName })
      .from(ClinicAssignModel)
      .leftJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
      .where(eq(ClinicAssignModel.userId, params.doctorId))
      .limit(1);

    const isDoctorLike =
      row.userType === 'Doctor' || row.isAdminDoctorAccess === true;

    let totalAppointments = 0;
    let totalPatients = 0;

    if (isDoctorLike) {
      const scopedClinicId = clinicId ?? clinicAssign?.clinicId;
      const conditions = [eq(AppointmentModel.doctorId, params.doctorId)];
      if (scopedClinicId) {
        conditions.push(eq(AppointmentModel.clinicId, scopedClinicId));
      }

      const [stats] = await database
        .select({
          totalAppointments: sql<number>`count(*)::int`,
          totalPatients: sql<number>`count(distinct ${AppointmentModel.patientId})::int`,
        })
        .from(AppointmentModel)
        .where(and(...conditions));

      totalAppointments = Number(stats?.totalAppointments) || 0;
      totalPatients = Number(stats?.totalPatients) || 0;
    }

    // Doctors can hold multiple qualifications (separate table)
    const qualifications = isDoctorLike
      ? await database
          .select({
            id: DoctorQualificationModel.id,
            qualificationType: DoctorQualificationModel.qualificationType,
            qualificationTitle: DoctorQualificationModel.qualificationTitle,
            specialization: DoctorQualificationModel.specialization,
            boardOrUniversity: DoctorQualificationModel.boardOrUniversity,
            yearOfCompletion: DoctorQualificationModel.yearOfCompletion,
            notes: DoctorQualificationModel.notes,
          })
          .from(DoctorQualificationModel)
          .where(eq(DoctorQualificationModel.userId, params.doctorId))
      : [];

    return {
      ...row,
      clinicName: clinicAssign?.clinicName ?? null,
      totalAppointments,
      totalPatients,
      qualifications,
    };
  }

  static async getDoctorServices(doctorId: string, clinicId: string) {
    return await database
      .select({
        id: ClinicServiceModel.id,
        serviceName: ClinicServiceModel.serviceName,
        price: ClinicServiceModel.price,
        currency: ClinicServiceModel.currency,
        durationDays: ClinicServiceModel.durationDays,
        canBeBookedByPatient: ClinicServiceModel.canBeBookedByPatient,
      })
      .from(ClinicServiceModel)
      .where(
        and(
          eq(ClinicServiceModel.doctorId, doctorId),
          eq(ClinicServiceModel.clinicId, clinicId),
          eq(ClinicServiceModel.isDeleted, false)
        )
      )
      .orderBy(desc(ClinicServiceModel.createdAt));
  }

  static async getDoctorActivity(doctorId: string, clinicId: string) {
    return await database
      .select({
        id: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentStatus: AppointmentModel.appointmentStatus,
        appointmentType: AppointmentModel.appointmentType,
        patientName: UserModel.name,
        serviceName: ClinicServiceModel.serviceName,
      })
      .from(AppointmentModel)
      .leftJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
      .leftJoin(
        ClinicServiceModel,
        eq(ClinicServiceModel.id, AppointmentModel.clinicServiceId)
      )
      .where(
        and(
          eq(AppointmentModel.doctorId, doctorId),
          eq(AppointmentModel.clinicId, clinicId)
        )
      )
      .orderBy(desc(AppointmentModel.appointmentDate))
      .limit(20);
  }

  static async getDoctorAvailability(doctorId: string, clinicId: string) {
    const availability = await database
      .select({
        id: ClinicAvailability.id,
        dayOfWeek: ClinicAvailability.dayOfWeek,
        startTime: ClinicAvailability.startTime,
        endTime: ClinicAvailability.endTime,
        isAvailable: ClinicAvailability.isAvailable,
        slotMinutes: ClinicAvailability.slotMinutes,
        stepMinutes: ClinicAvailability.stepMinutes,
        noOfPatients: ClinicAvailability.noOfPatients,
        breaksStart: ClinicAvailability.breaksStart,
        breaksEnd: ClinicAvailability.breaksEnd,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.doctorId, doctorId)
        )
      );

    const avIds = availability.map((a) => a.id);

    const breaks = avIds.length
      ? await database
          .select({
            id: ClinicAvailabilityBreak.id,
            clinicAvailabilityId: ClinicAvailabilityBreak.clinicAvailabilityId,
            breakType: ClinicAvailabilityBreak.breakType,
            startTime: ClinicAvailabilityBreak.startTime,
            endTime: ClinicAvailabilityBreak.endTime,
            status: ClinicAvailabilityBreak.status,
          })
          .from(ClinicAvailabilityBreak)
          .where(inArray(ClinicAvailabilityBreak.clinicAvailabilityId, avIds))
      : [];

    return availability.map((a) => ({
      ...a,
      breaks: breaks.filter((b) => b.clinicAvailabilityId === a.id),
    }));
  }

  static async createPlain(
    payload: CreateClinicAppointmentPlainDto,
    clinicId: string
  ) {
    return await database.transaction(async (tx) => {
      // validate incoming payload
      const { doctorSubscriptionId, ...rest } = payload;
      if (!doctorSubscriptionId) {
        throw new HttpError(400, 'Missing doctorSubscriptionId');
      }

      // fetch subscription duration (expected to be months or numeric)
      const rows = await tx
        .select({ durationDays: ClinicServiceModel.durationDays })
        .from(ClinicServiceModel)
        .where(eq(ClinicServiceModel.id, doctorSubscriptionId));

      const subscription = rows[0];

      if (!subscription || subscription.durationDays == null) {
        throw new HttpError(400, 'Invalid subscription or duration not set');
      }

      // ensure durationInMonths is a number (default to 0 if parse fails)
      // duration is sent from frontend in days
      const durationInDays = Number(subscription.durationDays) || 0;

      // calculate expiry date by adding days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationInDays);

      // build the insert payload explicitly and override/ensure correct fields

      const result = await tx
        .insert(ClinicAppointmentPlainModel)
        .values({
          clinicId,
          doctorSubscriptionId,
          expireAt: expiresAt,
          ...rest,
        })
        .returning();

      if (!result || result.length === 0) {
        throw new HttpError(500, 'Failed to create appointment');
      }

      return result[0];
    });
  }
  static async updatePlain(
    payload: UpdateClinicAppointmentPlainDto,
    params: PlainIdDto
  ) {
    return await database.transaction(async (tx) => {
      if (payload && Object.keys(payload).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const setObj: Record<string, any> = {};
        const allowedDocFields = [
          'status',
          'notes',
          'amount',
          'paymentStatus',
          'paymentMode',
        ] as const;
        for (const k of allowedDocFields) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const val = (payload as any)[k];
          if (typeof val !== 'undefined') setObj[k] = val;
        }
        setObj.updatedAt = sql`NOW()`;
        return await tx
          .update(ClinicAppointmentPlainModel)
          .set(setObj)
          .where(eq(ClinicAppointmentPlainModel.id, params.plainId))
          .returning();
      }
    });
  }
  static escapeLike(s: string) {
    return s.replace(/[%_\\]/g, (m) => `\\${m}`);
  }
  static async getPlain(params: PlainIdDto) {
    const patientUser = alias(UserModel, 'patientUser');
    const doctorUser = alias(UserModel, 'doctorUser');
    return await database
      .select({
        id: ClinicAppointmentPlainModel.id,
        expireAt: ClinicAppointmentPlainModel.expireAt,
        notes: ClinicAppointmentPlainModel.notes,
        status: ClinicAppointmentPlainModel.status,
        paymentStatus: ClinicAppointmentPlainModel.paymentStatus,
        paymentMode: ClinicAppointmentPlainModel.paymentMode,
        createdAt: ClinicAppointmentPlainModel.createdAt,
        updatedAt: ClinicAppointmentPlainModel.updatedAt,
        doctor: {
          id: doctorUser.id,
          name: doctorUser.name,
          email: doctorUser.email,
          mobile: doctorUser.mobile,
          speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          alternateMobile: sql<string>`(SELECT alternate_mobile FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
        },
        patient: {
          id: patientUser.id,
          name: patientUser.name,
          email: patientUser.email,
          mobile: patientUser.mobile,
          alternateMobile: sql<string>`(SELECT alternate_mobile FROM user_profiles WHERE user_id = ${patientUser.id} LIMIT 1)`,
        },
        subscription: {
          id: ClinicServiceModel.id,
          serviceName: ClinicServiceModel.serviceName,
          price: ClinicServiceModel.price,
          currency: ClinicServiceModel.currency,
          additionalServices: ClinicServiceModel.additionalServices,
          durationDays: ClinicServiceModel.durationDays,
        },
      })
      .from(ClinicAppointmentPlainModel)
      .leftJoin(
        patientUser,
        eq(ClinicAppointmentPlainModel.patientId, patientUser.id)
      )
      .leftJoin(
        doctorUser,
        eq(ClinicAppointmentPlainModel.doctorId, doctorUser.id)
      )
      .leftJoin(
        ClinicServiceModel,
        eq(
          ClinicServiceModel.id,
          ClinicAppointmentPlainModel.doctorSubscriptionId
        )
      )
      .where(eq(ClinicAppointmentPlainModel.id, params.plainId));
  }
  static async getAllPlain(
    query: GetQueryParamsDto,
    user: AuthUser,
    ClinicId: string
  ) {
    return await database.transaction(async (tx) => {
      const conditions = [];
      if (user.userType === 'Patient') {
        conditions.push(eq(ClinicAppointmentPlainModel.patientId, user.id));
      }
      if (user.userType === 'Doctor') {
        conditions.push(eq(ClinicAppointmentPlainModel.doctorId, user.id));
      }
      if (user.userType === 'Admin') {
        conditions.push(eq(ClinicAppointmentPlainModel.clinicId, ClinicId));
      }

      const patientUser = alias(UserModel, 'patientUser');
      const doctorUser = alias(UserModel, 'doctorUser');

      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      if (query?.searchBy) {
        const raw = String(query.searchBy).trim();
        if (raw.length > 0) {
          // split into terms, max 5 terms to avoid heavy queries
          const terms = raw.split(/\s+/).slice(0, 5);

          const termConditions = terms.map((term) => {
            const escaped = this.escapeLike(term);
            const pattern = `%${escaped}%`.toLowerCase();

            // Case-insensitive matching using lower(...) LIKE <param>
            // Using sql prevents depending on DB-specific ILIKE
            const byDoctorName = sql`lower(${doctorUser.name}) LIKE ${pattern}`;
            const byDoctorEmail = sql`lower(${doctorUser.email}) LIKE ${pattern}`;
            const byDoctorMobile = sql`lower(${doctorUser.mobile}) LIKE ${pattern}`;
            const byPatientsName = sql`lower(${patientUser.name}) LIKE ${pattern}`;
            const byPatientsEmail = sql`lower(${patientUser.email}) LIKE ${pattern}`;
            const byPatientsMobile = sql`lower(${patientUser.mobile}) LIKE ${pattern}`;

            return or(
              byDoctorName,
              byDoctorEmail,
              byDoctorMobile,
              byPatientsName,
              byPatientsEmail,
              byPatientsMobile
            );
          });

          // require all terms to match (each term can match any field)
          if (termConditions.length === 1) {
            conditions.push(termConditions[0]);
          } else {
            conditions.push(and(...termConditions));
          }
        }
      }
      const totalRecords = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicAppointmentPlainModel.id})`,
        })
        .from(ClinicAppointmentPlainModel)
        .where(and(...conditions));

      const totalCount = Number(totalRecords[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);
      const results = await tx
        .select({
          id: ClinicAppointmentPlainModel.id,
          expireAt: ClinicAppointmentPlainModel.expireAt,
          notes: ClinicAppointmentPlainModel.notes,
          status: ClinicAppointmentPlainModel.status,
          paymentStatus: ClinicAppointmentPlainModel.paymentStatus,
          paymentMode: ClinicAppointmentPlainModel.paymentMode,
          createdAt: ClinicAppointmentPlainModel.createdAt,
          updatedAt: ClinicAppointmentPlainModel.updatedAt,
          amount: ClinicAppointmentPlainModel.amount,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            email: doctorUser.email,
            mobile: doctorUser.mobile,
            speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            alternateMobile: sql<string>`(SELECT alternate_mobile FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
            email: patientUser.email,
            mobile: patientUser.mobile,
            alternateMobile: sql<string>`(SELECT alternate_mobile FROM user_profiles WHERE user_id = ${patientUser.id} LIMIT 1)`,
          },
          subscription: {
            id: ClinicServiceModel.id,
            serviceName: ClinicServiceModel.serviceName,
            price: ClinicServiceModel.price,
            currency: ClinicServiceModel.currency,
            additionalServices: ClinicServiceModel.additionalServices,
            durationDays: ClinicServiceModel.durationDays,
          },
        })
        .from(ClinicAppointmentPlainModel)
        .leftJoin(
          patientUser,
          eq(ClinicAppointmentPlainModel.patientId, patientUser.id)
        )
        .leftJoin(
          doctorUser,
          eq(ClinicAppointmentPlainModel.doctorId, doctorUser.id)
        )
        .leftJoin(
          ClinicServiceModel,
          eq(
            ClinicServiceModel.id,
            ClinicAppointmentPlainModel.doctorSubscriptionId
          )
        )
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(ClinicAppointmentPlainModel.updatedAt));
      return {
        results,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }
  static async getDoctorPlain(params: getDoctorDoctorIdDto) {
    return await database
      .select()
      .from(ClinicServiceModel)
      .where(eq(ClinicServiceModel.doctorId, params.doctorId));
  }
  static async checkPlain(query: checkPlainsDto) {
    return await database.transaction(async (tx) => {
      const { doctorId, patientId } = query;

      // 2) fetch active subscriptions/appointments for this doctor+patient
      const rows = await tx
        .select({
          id: ClinicAppointmentPlainModel.id,
          expireAt: ClinicAppointmentPlainModel.expireAt,
          status: ClinicAppointmentPlainModel.status,
        })
        .from(ClinicAppointmentPlainModel)
        .where(
          and(
            eq(ClinicAppointmentPlainModel.doctorId, doctorId),
            eq(ClinicAppointmentPlainModel.patientId, patientId),
            eq(ClinicAppointmentPlainModel.status, 'active')
          )
        );

      // 3) no active record found
      if (!rows || rows.length === 0) {
        throw new HttpError(
          404,
          'No active subscription found for this doctor and patient'
        );
      }

      const now = new Date();

      // 4) find first non-expired appointment
      const valid = rows.find((r) => {
        if (!r.expireAt) return false;
        const expDate =
          r.expireAt instanceof Date ? r.expireAt : new Date(r.expireAt);
        return expDate > now;
      });

      // 5a) if a valid (non-expired) appointment exists -> return it
      if (valid) {
        return valid;
      }

      // 5b) otherwise all found active rows are actually expired.
      // Mark them as expired in DB (update status -> "expired") and return error.
      for (const r of rows) {
        await tx
          .update(ClinicAppointmentPlainModel)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .set({ status: 'expired' as any })
          .where(eq(ClinicAppointmentPlainModel.id, r.id));
      }

      throw new HttpError(
        400,
        'Subscription expired. Please renew the plan to continue.'
      );
    });
  }

  static async getSubscriptions(
    query: GetSubscriptionsDto,
    user: AuthUser,
    clinicId: string
  ) {
    return await database.transaction(async (tx) => {
      if (user.userType !== 'Admin' && user.userType !== 'Doctor') {
        throw new HttpError(
          403,
          'Access denied. Only Admin and Doctor can access this resource.'
        );
      }
      const conditions = [];

      // Role-based filtering
      if (user.userType === 'Doctor') {
        conditions.push(eq(ClinicAppointmentPlainModel.doctorId, user.id));
      }
      // Admin sees all in clinic (implied by context, but explicit filter)
      conditions.push(eq(ClinicAppointmentPlainModel.clinicId, clinicId));

      // Date filtering (Default: Today)
      const now = new Date();
      let start = new Date(now.setHours(0, 0, 0, 0));
      let end = new Date(now.setHours(23, 59, 59, 999));

      if (query.startDate) {
        start = new Date(query.startDate);
        start.setHours(0, 0, 0, 0);

        // If endDate is not provided, default to the same day end
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
      }

      if (query.endDate) {
        end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
      }

      conditions.push(gte(ClinicAppointmentPlainModel.createdAt, start));
      conditions.push(lte(ClinicAppointmentPlainModel.createdAt, end));

      const planIds = Array.isArray(query.plan)
        ? query.plan
        : query.plan
          ? [query.plan]
          : [];
      const subIds = Array.isArray(query.subscriptionId)
        ? query.subscriptionId
        : query.subscriptionId
          ? [query.subscriptionId]
          : [];
      const filterIds = Array.from(new Set([...planIds, ...subIds]));
      if (filterIds.length > 0) {
        conditions.push(
          inArray(ClinicAppointmentPlainModel.doctorSubscriptionId, filterIds)
        );
      }

      if (query.paymentStatus) {
        const raw = Array.isArray(query.paymentStatus)
          ? query.paymentStatus
          : [query.paymentStatus];
        const normalized = raw
          .flatMap((s) => (typeof s === 'string' ? s.split(',') : s))
          .map((s) => s.trim().toLowerCase())
          .filter((s) => ['paid', 'pending', 'refunded'].includes(s));
        if (normalized.length > 0) {
          conditions.push(
            inArray(
              ClinicAppointmentPlainModel.paymentStatus,
              normalized as Array<'paid' | 'pending' | 'refunded'>
            )
          );
        }
      }
      const patientUser = alias(UserModel, 'patientUser');
      const doctorUser = alias(UserModel, 'doctorUser');

      // Search (Patient Name)
      if (query.search) {
        const pattern = `%${query.search.toLowerCase()}%`;
        conditions.push(sql`lower(${patientUser.name}) LIKE ${pattern}`);
      }

      // Pagination
      const pageSize = Math.max(Number(query.pageSize) || 100, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      // Count
      const totalRecords = await tx
        .select({
          count: sql`COUNT(DISTINCT ${ClinicAppointmentPlainModel.id})`,
        })
        .from(ClinicAppointmentPlainModel)
        .leftJoin(
          patientUser,
          eq(ClinicAppointmentPlainModel.patientId, patientUser.id)
        )
        .where(and(...conditions));

      const totalCount = Number(totalRecords[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      // Subscription sales totals, not visit money: subscriptions are not in money_entries.
      const statsResult = await tx
        .select({
          paymentMode: ClinicAppointmentPlainModel.paymentMode,
          totalAmount: sql`SUM(${ClinicAppointmentPlainModel.amount})::numeric`,
        })
        .from(ClinicAppointmentPlainModel)
        .leftJoin(
          patientUser,
          eq(ClinicAppointmentPlainModel.patientId, patientUser.id)
        )
        .where(and(...conditions))
        .groupBy(ClinicAppointmentPlainModel.paymentMode);

      const totalAmount = statsResult.reduce(
        (sum, item) => sum + Number(item.totalAmount || 0),
        0
      );
      const paymentModeTotals = statsResult.map((item) => ({
        paymentMode: item.paymentMode,
        amount: Number(item.totalAmount || 0),
      }));

      // Query
      const results = await tx
        .select({
          id: ClinicAppointmentPlainModel.id,
          paymentStatus: ClinicAppointmentPlainModel.paymentStatus,
          paymentMode: ClinicAppointmentPlainModel.paymentMode,
          createdAt: ClinicAppointmentPlainModel.createdAt,
          amount: ClinicAppointmentPlainModel.amount,

          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${doctorUser.id} LIMIT 1)`,
            profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${doctorUser.id} LIMIT 1)`,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
            mobile: patientUser.mobile,
          },
          subscription: {
            id: ClinicServiceModel.id,
            serviceName: ClinicServiceModel.serviceName,
          },
        })
        .from(ClinicAppointmentPlainModel)
        .leftJoin(
          patientUser,
          eq(ClinicAppointmentPlainModel.patientId, patientUser.id)
        )
        .leftJoin(
          doctorUser,
          eq(ClinicAppointmentPlainModel.doctorId, doctorUser.id)
        )
        .leftJoin(
          ClinicServiceModel,
          eq(
            ClinicServiceModel.id,
            ClinicAppointmentPlainModel.doctorSubscriptionId
          )
        )
        .where(and(...conditions))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(ClinicAppointmentPlainModel.createdAt));

      return {
        results: {
          data: results,
        },
        summary: {
          totalAmount,
          paymentModeTotals,
        },
        metadata: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }

  static async getSubscriptionsList(user: AuthUser, clinicId: string) {
    if (user.userType !== 'Admin' && user.userType !== 'Doctor') {
      throw new HttpError(
        403,
        'Access denied. Only Admin and Doctor can access this resource.'
      );
    }
    const CACHE_KEY = `subscriptions_list:${clinicId}:${user.id}`;

    // Check Cache
    const cached = await redisClient.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    const conditions = [];
    if (user.userType === 'Doctor') {
      conditions.push(eq(ClinicServiceModel.doctorId, user.id));
    }
    conditions.push(eq(ClinicServiceModel.clinicId, clinicId));
    conditions.push(eq(ClinicServiceModel.isDeleted, false));

    const results = await database
      .select({
        id: ClinicServiceModel.id,
        serviceName: ClinicServiceModel.serviceName,
      })
      .from(ClinicServiceModel)
      .where(and(...conditions));

    // Cache for 10 minutes (600s)
    await redisClient.set(CACHE_KEY, JSON.stringify(results), 'EX', 600);

    return results;
  }

  public static async getDoctorsAvailabilityOnDate(
    clinicId: string,
    query: getDoctorAvailabilityOnDateDto
  ) {
    const { date } = query;
    const CACHE_KEY = `doctors_availability_on_date:${clinicId}:${date}`;

    const cached = await redisClient.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });

    const doctorsWithAv = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        speciality: UserProfessionalModel.speciality,
        profileImage: UserProfileModel.profileImage,
        availabilityId: ClinicAvailability.id,
        startTime: ClinicAvailability.startTime,
        endTime: ClinicAvailability.endTime,
        isAvailable: ClinicAvailability.isAvailable,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .leftJoin(ClinicAssignModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(ClinicModel, eq(UserModel.id, ClinicModel.userId))
      .leftJoin(
        ClinicAvailability,
        and(
          eq(UserModel.id, ClinicAvailability.doctorId),
          eq(ClinicAvailability.clinicId, clinicId),
          eq(ClinicAvailability.dayOfWeek, weekday)
        )
      )
      .where(
        and(
          or(
            eq(ClinicAssignModel.clinicId, clinicId),
            eq(ClinicModel.id, clinicId)
          ),
          or(
            eq(UserModel.userType, 'Doctor'),
            eq(UserModel.isAdminDoctorAccess, true)
          )
        )
      );

    const avIds = doctorsWithAv
      .map((d) => d.availabilityId)
      .filter((id): id is string => !!id);

    const breaks =
      avIds.length > 0
        ? await database
            .select({
              clinicAvailabilityId:
                ClinicAvailabilityBreak.clinicAvailabilityId,
              startTime: ClinicAvailabilityBreak.startTime,
              endTime: ClinicAvailabilityBreak.endTime,
              breakType: ClinicAvailabilityBreak.breakType,
            })
            .from(ClinicAvailabilityBreak)
            .where(
              and(
                inArray(ClinicAvailabilityBreak.clinicAvailabilityId, avIds),
                eq(ClinicAvailabilityBreak.status, true)
              )
            )
        : [];

    const result = doctorsWithAv.map((r) => ({
      id: r.id,
      name: r.name,
      speciality: r.speciality,
      profileImage: r.profileImage,
      availability:
        r.isAvailable === true
          ? {
              startTime: r.startTime,
              endTime: r.endTime,
              breaks: breaks
                .filter((b) => b.clinicAvailabilityId === r.availabilityId)
                .map((b) => ({
                  startTime: b.startTime,
                  endTime: b.endTime,
                  breakType: b.breakType,
                })),
            }
          : null,
    }));

    await redisClient.set(CACHE_KEY, JSON.stringify(result), 'EX', 3600); // 1 hour

    return result;
  }

  public static async getDoctorAvailabilityInRange(
    clinicId: string,
    query: getDoctorAvailabilityRangeDto
  ) {
    const { doctorId, startDate, endDate } = query;
    const CACHE_KEY = `doctor_availability_range:${clinicId}:${doctorId}:${startDate}:${endDate}`;

    const cached = await redisClient.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    // 1) Verify doctor belongs to the clinic (either assigned or owner)
    const [isAssigned] = await database
      .select({ id: UserModel.id })
      .from(UserModel)
      .leftJoin(ClinicAssignModel, eq(UserModel.id, ClinicAssignModel.userId))
      .leftJoin(ClinicModel, eq(UserModel.id, ClinicModel.userId))
      .where(
        and(
          eq(UserModel.id, doctorId),
          or(
            eq(ClinicAssignModel.clinicId, clinicId),
            eq(ClinicModel.id, clinicId)
          ),
          or(
            eq(UserModel.userType, 'Doctor'),
            eq(UserModel.isAdminDoctorAccess, true)
          )
        )
      )
      .limit(1);

    if (!isAssigned) {
      throw new HttpError(403, 'Doctor is not assigned to this clinic');
    }

    // 2) Generate all dates in the range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dateList: { date: string; weekday: string }[] = [];

    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const weekday = current.toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'UTC',
      });
      dateList.push({ date: dateStr, weekday });
      current.setDate(current.getDate() + 1);
    }

    // 3) Fetch all availability settings for this doctor in this clinic
    const availabilitySettings = await database
      .select()
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.doctorId, doctorId),
          eq(ClinicAvailability.clinicId, clinicId)
        )
      );

    const avIds = availabilitySettings.map((a) => a.id);

    // 4) Fetch all breaks for these availability settings
    const allBreaks =
      avIds.length > 0
        ? await database
            .select()
            .from(ClinicAvailabilityBreak)
            .where(
              and(
                inArray(ClinicAvailabilityBreak.clinicAvailabilityId, avIds),
                eq(ClinicAvailabilityBreak.status, true)
              )
            )
        : [];

    // 5) Map each date to its availability
    const result = dateList.map((d) => {
      const setting = availabilitySettings.find(
        (s) => s.dayOfWeek === d.weekday
      );
      const isAvailable = setting ? setting.isAvailable : false;

      return {
        date: d.date,
        dayOfWeek: d.weekday,
        isAvailable,
        availability: isAvailable
          ? {
              startTime: setting?.startTime,
              endTime: setting?.endTime,
              breaks: allBreaks
                .filter((b) => b.clinicAvailabilityId === setting?.id)
                .map((b) => ({
                  startTime: b.startTime,
                  endTime: b.endTime,
                  breakType: b.breakType,
                })),
            }
          : null,
      };
    });

    await redisClient.set(CACHE_KEY, JSON.stringify(result), 'EX', 3600); // 1 hour

    return result;
  }

  static async getTopMedicines(
    doctorId: string,
    params: {
      page?: number;
      limit?: number;
      search?: string;
      sort?: 'usageCount' | 'lastUsed' | 'name';
      order?: 'asc' | 'desc';
      startDate?: string;
      endDate?: string;
      timeRange?: string;
      category?: string;
    }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 10;
    const offset = (page - 1) * limit;
    const conditions = [eq(PrescriptionModel.prescribedBy, doctorId)];

    // Time filter - priority to date range, then timeRange
    if (params.startDate) {
      conditions.push(
        gte(PrescriptionModel.createdAt, new Date(params.startDate))
      );
    }
    if (params.endDate) {
      conditions.push(
        lte(PrescriptionModel.createdAt, new Date(params.endDate))
      );
    } else if (params.timeRange && params.timeRange !== 'all') {
      let dateThreshold: Date | null = null;

      switch (params.timeRange) {
        case 'month':
          dateThreshold = new Date();
          dateThreshold.setMonth(dateThreshold.getMonth() - 1);
          break;
        case 'week':
          dateThreshold = new Date();
          dateThreshold.setDate(dateThreshold.getDate() - 7);
          break;
        case 'day':
          dateThreshold = new Date();
          dateThreshold.setDate(dateThreshold.getDate() - 1);
          break;
        default:
          break;
      }

      if (dateThreshold) {
        conditions.push(gte(PrescriptionModel.createdAt, dateThreshold));
      }
    }

    const joinCondition = and(
      eq(PrescriptionModel.medicineId, MedicineModel.id),
      ...conditions
    ) as SQL<unknown>;

    /**
     * Medicine-side filters. A row qualifies when the doctor has prescribed it
     * (the join matched) or when it is one of their own favourites.
     */
    const medicineConditions: SQL<unknown>[] = [
      eq(MedicineModel.isActive, true),
      or(
        sql<boolean>`${PrescriptionModel.id} IS NOT NULL`,
        and(
          eq(MedicineModel.isFavorite, true),
          eq(MedicineModel.createdByUserId, doctorId)
        )
      ) as SQL<unknown>,
    ];

    if (params.search) {
      const searchPattern = `%${params.search.toLowerCase()}%`;
      const searchCondition = or(
        sql<string>`LOWER(${MedicineModel.name}::text) LIKE ${searchPattern}`,
        sql<string>`LOWER(${MedicineModel.genericName}::text) LIKE ${searchPattern}`,
        sql<string>`LOWER(${MedicineModel.composition}::text) LIKE ${searchPattern}`
      ) as SQL<unknown>;

      medicineConditions.push(searchCondition);
    }

    // Category filter
    if (params.category) {
      medicineConditions.push(eq(MedicineModel.category, params.category));
    }

    // Get total count of unique medicines
    const [{ total }] = await database
      .select({
        total: sql<number>`COUNT(DISTINCT ${MedicineModel.id})`,
      })
      .from(MedicineModel)
      .leftJoin(PrescriptionModel, joinCondition)
      .where(and(...medicineConditions));

    const totalRecords = Number(total || 0);
    const totalPages = Math.ceil(totalRecords / limit);

    // Build the ORDER BY clause - FIXED VERSION
    let orderByClause: any;

    if (params.sort === 'name') {
      orderByClause =
        params.order === 'asc'
          ? asc(MedicineModel.name)
          : desc(MedicineModel.name);
    } else if (params.sort === 'lastUsed') {
      // NULLS LAST: never-prescribed favourites have no last-used date and must
      // not out-rank medicines that were actually used.
      orderByClause =
        params.order === 'asc'
          ? sql`MAX(${PrescriptionModel.createdAt}) ASC NULLS LAST`
          : sql`MAX(${PrescriptionModel.createdAt}) DESC NULLS LAST`;
    } else {
      // usageCount (default)
      orderByClause =
        params.order === 'asc'
          ? asc(sql`COUNT(${PrescriptionModel.id})`)
          : desc(sql`COUNT(${PrescriptionModel.id})`);
    }

    // Get medicines with usage stats
    const medicines = await database
      .select({
        medicineId: MedicineModel.id,
        medicineName: MedicineModel.name,
        // Only what the picker uses: strength/isFavorite match and star rows,
        // manufacturer is copied into the saved prescription.
        composition: MedicineModel.composition,
        form: MedicineModel.form,
        strength: MedicineModel.strength,
        manufacturer: MedicineModel.manufacturer,
        isFavorite: MedicineModel.isFavorite,
      })
      .from(MedicineModel)
      .leftJoin(PrescriptionModel, joinCondition)
      .where(and(...medicineConditions))
      .groupBy(
        MedicineModel.id,
        MedicineModel.name,
        MedicineModel.genericName,
        MedicineModel.composition,
        MedicineModel.form,
        MedicineModel.strength,
        MedicineModel.manufacturer,
        MedicineModel.category,
        MedicineModel.requiresPrescription,
        MedicineModel.isFavorite
      )
      .orderBy(
        // This doctor's own favourites first — `isFavorite` alone would also
        // float medicines another doctor flagged on a shared/global row.
        desc(
          sql`(${MedicineModel.isFavorite} AND ${MedicineModel.createdByUserId} = ${doctorId})`
        ),
        orderByClause, // Primary sort
        asc(MedicineModel.name) // Tie-breaker
      )
      .limit(limit)
      .offset(offset);

    return {
      data: medicines,
      pagination: {
        totalRecords,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    };
  }

  static async toggleFavorite(doctorId: string, medicineId: string) {
    const medicine = await database
      .select({ isFavorite: MedicineModel.isFavorite })
      .from(MedicineModel)
      .where(
        and(
          eq(MedicineModel.id, medicineId),
          eq(MedicineModel.createdByUserId, doctorId)
        )
      )
      .limit(1);

    if (!medicine || medicine.length === 0) {
      throw new Error('Medicine not found');
    }

    const currentStatus = medicine[0].isFavorite;
    const newStatus = !currentStatus;

    const [updated] = await database
      .update(MedicineModel)
      .set({
        isFavorite: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(MedicineModel.id, medicineId))
      .returning({
        id: MedicineModel.id,
        medicineName: MedicineModel.name,
        isFavorite: MedicineModel.isFavorite,
      });

    return updated;
  }

  static async getDoctorPreferences(doctorId: string, clinicId: string) {
    await DoctorServices.assertDoctorInClinic(doctorId, clinicId);

    // Independent reads, so they share one round trip.
    const [[prefs], [doctor]] = await Promise.all([
      database
        .select()
        .from(DoctorPreferenceModel)
        .where(eq(DoctorPreferenceModel.doctorId, doctorId)),
      database
        .select({
          speciality: UserProfessionalModel.speciality,
          specialization: UserProfessionalModel.specialization,
        })
        .from(UserModel)
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(eq(UserModel.id, doctorId)),
    ]);

    return {
      ...prefs,
      doctorId,
      ...resolvePreferenceLists(
        configSpecialty(doctor?.speciality, doctor?.specialization),
        prefs
      ),
      instructionSuggestions: prefs?.instructionSuggestions ?? {},
      instructionSuggestionDefaults: INSTRUCTION_SUGGESTION_DEFAULTS,
    };
  }

  // Add/Update doctor preferences (UPSERT)
  static async upsertDoctorPreferences(
    doctorId: string,
    clinicId: string,
    data: UpsertDoctorPreferencesInput
  ) {
    await DoctorServices.assertDoctorInClinic(doctorId, clinicId);

    // Store only the doctor's own entries (the Preference page sends defaults too), capped per list.
    const [doctor] = await database
      .select({
        speciality: UserProfessionalModel.speciality,
        specialization: UserProfessionalModel.specialization,
      })
      .from(UserProfessionalModel)
      .where(eq(UserProfessionalModel.userId, doctorId));
    const { customLists, defaultLists } = resolvePreferenceLists(
      configSpecialty(doctor?.speciality, doctor?.specialization),
      data
    );
    const ownLists: Partial<Record<SuggestionListKey, string[]>> = {};
    for (const key of Object.keys(customLists) as SuggestionListKey[]) {
      if (data[key] === undefined) continue;
      if (customLists[key].length > MAX_OWN_SUGGESTIONS) {
        throw new HttpError(
          400,
          `You can add up to ${MAX_OWN_SUGGESTIONS} of your own suggestions per list.`
        );
      }
      ownLists[key] = customLists[key];
    }

    return await database.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(DoctorPreferenceModel)
        .where(eq(DoctorPreferenceModel.doctorId, doctorId));

      // Merged per form, so saving one form's phrases never wipes the doctor's others.
      const values = {
        ...data,
        ...ownLists,
        hiddenOptions: DoctorServices.nextHiddenOptions(
          existing[0]?.hiddenOptions,
          data,
          defaultLists
        ),
        ...(data.specialtyTools !== undefined && {
          specialtyTools:
            data.specialtyTools && toKnownTools(data.specialtyTools),
        }),
        ...(data.instructionSuggestions && {
          instructionSuggestions: mergeInstructionSuggestions(
            existing[0]?.instructionSuggestions,
            data.instructionSuggestions
          ),
        }),
      };

      if (existing.length > 0) {
        // Update existing
        const [updated] = await tx
          .update(DoctorPreferenceModel)
          .set({
            ...values,
            updatedAt: new Date(),
          })
          .where(eq(DoctorPreferenceModel.doctorId, doctorId))
          .returning();
        return updated;
      } else {
        // Insert new
        const [inserted] = await tx
          .insert(DoctorPreferenceModel)
          .values({
            doctorId,
            ...values,
          })
          .returning();
        return inserted;
      }
    });
  }

  /** Hidden built-ins after a save: the sent set (or the stored one), minus anything the save lists again.
   *  Only real built-ins are kept; one re-added while prescribing shows again. */
  private static nextHiddenOptions(
    stored: Partial<Record<string, string[]>> | null | undefined,
    data: UpsertDoctorPreferencesInput,
    defaults: Record<SuggestionListKey, string[]>
  ) {
    const next: Partial<Record<SuggestionListKey, string[]>> = {};
    for (const key of Object.keys(defaults) as SuggestionListKey[]) {
      const builtIn = new Set(defaults[key].map((x) => x.toLowerCase()));
      const listed = new Set((data[key] ?? []).map((x) => x.toLowerCase()));
      const hidden = (data.hiddenOptions?.[key] ?? stored?.[key] ?? []).filter(
        (x) => builtIn.has(x.toLowerCase()) && !listed.has(x.toLowerCase())
      );
      if (hidden.length > 0) next[key] = [...new Set(hidden)];
    }
    return next;
  }

  static async getDoctorPrescriptionTemplate(
    doctorId: string,
    clinicId: string
  ) {
    await DoctorServices.assertDoctorInClinic(doctorId, clinicId);

    const templates = await database
      .select()
      .from(doctorTemplateModel)
      .where(eq(doctorTemplateModel.doctorId, doctorId));

    if (!templates || templates.length === 0) {
      return [];
    }

    const template = templates[0];

    if (!template.templateHtml) {
      return template;
    }

    // Same render as the printed PDF, filled with the shared sample visit.
    const finalHtml = PrescriptionPreviewService.renderCustomTemplate(
      template.templateHtml
    );

    // Return in same format as original
    return [
      {
        ...template,
        templateHtml: finalHtml,
      },
    ];
  }

  static async getDoctorManualTemplate(doctorId: string) {
    const templates = await database
      .select()
      .from(doctorManualTemplateModel)
      .where(eq(doctorManualTemplateModel.doctorId, doctorId))
      .limit(1);

    if (!templates || templates.length === 0) {
      return [];
    }

    const template = templates[0];

    if (!template.templateHtml) {
      return template;
    }

    // Same render as the printed PDF, filled with the shared sample visit.
    const finalHtml = PrescriptionPreviewService.renderCustomTemplate(
      template.templateHtml
    );

    return [
      {
        ...template,
        templateHtml: finalHtml,
        rawHtml: template.templateHtml,
      },
    ];
  }

  // Add/Update doctor prescription template (UPSERT)
  static async upsertDoctorPrescriptionTemplate(
    doctorId: string,
    clinicId: string,
    data: {
      templateHtml?: string;
    }
  ) {
    await DoctorServices.assertDoctorInClinic(doctorId, clinicId);

    return await database.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(doctorTemplateModel)
        .where(eq(doctorTemplateModel.doctorId, doctorId));

      if (existing.length > 0) {
        // Update existing
        const [updated] = await tx
          .update(doctorTemplateModel)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(doctorTemplateModel.doctorId, doctorId))
          .returning();
        return updated;
      } else {
        // Insert new
        const [inserted] = await tx
          .insert(doctorTemplateModel)
          .values({
            doctorId,
            ...data,
          })
          .returning();
        return inserted;
      }
    });
  }

  public static async deleteDoctorPrescriptionTemplate(
    doctorId: string,
    clinicId: string
  ) {
    await DoctorServices.assertDoctorInClinic(doctorId, clinicId);

    const [existingDoctorPrescriptionTemplate] = await database
      .select()
      .from(doctorTemplateModel)
      .where(eq(doctorTemplateModel.doctorId, doctorId));

    if (!existingDoctorPrescriptionTemplate) {
      throw new HttpError(404, 'Doctor prescription template not found');
    }

    await database
      .delete(doctorTemplateModel)
      .where(eq(doctorTemplateModel.doctorId, doctorId));

    return { message: 'Doctor prescription template deleted successfully' };
  }

  public static async deleteDoctorLeave(leaveId: string) {
    const [existingDoctorLeave] = await database
      .select()
      .from(ClinicDateAvailability)
      .where(eq(ClinicDateAvailability.id, leaveId));

    if (!existingDoctorLeave) {
      throw new HttpError(404, 'Doctor leave not found');
    }

    await database
      .delete(ClinicDateAvailability)
      .where(eq(ClinicDateAvailability.id, leaveId));
    await invalidateCache(
      CacheKeys.followUpDoctorDay(
        existingDoctorLeave.clinicId,
        existingDoctorLeave.doctorId,
        getISTDateString(existingDoctorLeave.date)
      )
    );

    return { message: 'Doctor leave deleted successfully' };
  }

  static async getTemplateByDoctorId(doctorId: string) {
    try {
      const [template] = await database
        .select()
        .from(doctorManualTemplateModel)
        .where(eq(doctorManualTemplateModel.doctorId, doctorId))
        .limit(1);

      return template || null;
    } catch {
      throw new HttpError(500, 'Failed to fetch template');
    }
  }

  static async upsertTemplate(
    doctorId: string,
    templateHtml?: string | null,
    templateImage?: string | null,
    printType?: string | null
  ) {
    try {
      // Check if template exists
      const existingTemplate = await database
        .select()
        .from(doctorManualTemplateModel)
        .where(eq(doctorManualTemplateModel.doctorId, doctorId))
        .limit(1);

      const now = new Date();

      if (existingTemplate.length > 0) {
        const oldTemplateImage = existingTemplate[0].templateImage;

        const updateData: any = {
          updatedAt: now,
        };

        if (templateHtml !== undefined) {
          updateData.templateHtml = templateHtml;
        }
        if (templateImage !== undefined) {
          updateData.templateImage = templateImage;
        }
        if (printType !== undefined) {
          updateData.printType = printType;
        }

        const [updatedTemplate] = await database
          .update(doctorManualTemplateModel)
          .set(updateData)
          .where(eq(doctorManualTemplateModel.doctorId, doctorId))
          .returning();

        if (
          templateImage &&
          oldTemplateImage &&
          oldTemplateImage !== templateImage
        ) {
          await deleteFromS3(oldTemplateImage).catch(() => {
            console.error('Unable to delete old template image');
          });
        }

        return updatedTemplate;
      } else {
        const [newTemplate] = await database
          .insert(doctorManualTemplateModel)
          .values({
            doctorId,
            templateHtml: templateHtml || null,
            templateImage: templateImage || null,
            printType: printType !== undefined ? printType : undefined,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return newTemplate;
      }
    } catch {
      throw new HttpError(500, 'Failed to save template');
    }
  }

  static async deleteTemplate(doctorId: string) {
    try {
      const [deletedTemplate] = await database
        .delete(doctorManualTemplateModel)
        .where(eq(doctorManualTemplateModel.doctorId, doctorId))
        .returning();

      if (!deletedTemplate) {
        throw new HttpError(404, 'Template not found for this doctor');
      }

      return deletedTemplate;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, 'Failed to delete template');
    }
  }

  static async updateDoctorPrescriptionType(doctorId: string) {
    return await database.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(doctorPrescriptionTypeModel)
        .where(eq(doctorPrescriptionTypeModel.doctorId, doctorId));

      if (existing.length > 0) {
        const currentType = existing[0].prescriptionType;
        const newType = currentType === 'Manual' ? 'Digital' : 'Manual';

        const [updated] = await tx
          .update(doctorPrescriptionTypeModel)
          .set({
            prescriptionType: newType,
          })
          .where(eq(doctorPrescriptionTypeModel.doctorId, doctorId))
          .returning();
        return { prescriptionType: updated.prescriptionType };
      } else {
        const [inserted] = await tx
          .insert(doctorPrescriptionTypeModel)
          .values({
            doctorId,
            prescriptionType: 'Manual',
          })
          .returning();
        return { prescriptionType: inserted.prescriptionType };
      }
    });
  }

  static async getDoctorPrescriptionType(doctorId: string) {
    try {
      const [prescriptionType] = await database
        .select()
        .from(doctorPrescriptionTypeModel)
        .where(eq(doctorPrescriptionTypeModel.doctorId, doctorId))
        .limit(1);

      if (!prescriptionType) {
        return { prescriptionType: 'Digital' };
      }

      return { prescriptionType: prescriptionType.prescriptionType };
    } catch {
      throw new HttpError(500, 'Failed to fetch prescription type');
    }
  }

  static async DoctorPrescriptionPrintType(doctorId: string) {
    return await database.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(doctorManualTemplateModel)
        .where(eq(doctorManualTemplateModel.doctorId, doctorId));

      const currentType = existing[0].printType;
      const newType =
        currentType === 'Without Background'
          ? 'With Background'
          : 'Without Background';

      const [updated] = await tx
        .update(doctorManualTemplateModel)
        .set({
          printType: newType,
        })
        .where(eq(doctorManualTemplateModel.doctorId, doctorId))
        .returning();
      return { printType: updated.printType };
    });
  }
}
