import { randomUUID } from 'crypto';
import {
  and,
  count,
  eq,
  ne,
  or,
  inArray,
  isNull,
  sql,
  desc,
  asc,
  isNotNull,
  gte,
  lte,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { CacheKeys } from '../../../utils/cache.util';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { PatientFamilyLinksModel } from '../models/patientFamilyLinks.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { APPOINTMENT_TEST_WORKFLOW_STATUS } from '../../test/constants/appointmentTest.constants';
import {
  LabOrderResultsModel,
  LabOrderResultValuesModel,
} from '../../lab/models/labResult.model';
import type {
  AddFamilyMemberDto,
  CompletePatientProfileDto,
  ListFamilyMembersQueryDto,
  UpdateFamilyMemberDto,
  PatientDirectorySearchDto,
  PatientBookingDto,
  PatientAppointmentsQueryDto,
  PatientLabReportsQueryDto,
  PatientPrescriptionsQueryDto,
  PatientAssociatedDocumentsQueryDto,
  PatientRescheduleDto,
} from '../schemas/patient.schemas';
import {
  ReportCardModel,
  PrescriptionModel,
} from '../../reports/models/reports.model';
import { doctorManualPrescriptionModel } from '../../appointments/models/doctorManualPrescription.model';
import { patientGallery } from '../../appointments/models/patientGallery.model';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentPaymentModel } from '../../appointments/models/appointment-payment.model';
import {
  normalizePaymentMode,
  isOnlinePaymentMode,
  isPayLaterMode,
} from '../../appointments/utils/paymentMode.constants';
import { verifyRazorpayPayment } from '../../../utils/razorpay';
import {
  PaymentService,
  ConfigurationResolver,
  DynamicSplitEngine,
} from '../../payment';
import { envConfig } from '../../../utils/envConfig';
import {
  VerifyAppointmentPaymentDto,
  ListFavoriteDoctorsQueryDto,
} from '../schemas/patient.schemas';
import {
  notifyPaymentReceived,
  getUserById,
  notifyAppointmentCreated,
  notifyTestReportUploaded,
} from '../../../utils/notificationHelpers';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import { deleteFromS3 } from '../../../configurations/s3';
import { signS3Url } from '../../files/services/fileUrl.service';
import { DOCUMENT_TTL_SECONDS } from '../../files/utils/s3Ref.utils';
import logger from '../../../utils/logger';
import { broadcastAppointmentChange } from '../../../utils/appointmentRealtime';
import { signalAppointmentChange } from '../../realtime';
import {
  ClinicModel,
  ClinicAssignModel,
  ClinicServiceModel,
  ClinicAvailability,
} from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { FinancialLedgerModel } from '../../appointments/models/financialLedger.model';
import {
  DoctorQualificationModel,
  DoctorFavoriteModel,
} from '../../doctor/models/doctor.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { AppointmentService } from '../../appointments/services/appointment.service';
import { PaymentReservationService } from '../../appointments/services/paymentReservation.service';
import {
  buildActiveAppointmentFilter,
  filterExpiredPendingAppointments,
} from '../../appointments/services/appointment.service';
import { DoctorServices } from '../../doctor/services/doctor.service';
import { toPublicTimings } from '../../doctor/utils/doctorPublicProfile.utils';
import {
  LimitationService,
  FEATURE_KEYS,
} from '../../subscription/services/limitation.service';

// ─── Shared column selection ──────────────────────────────────────────────────

/** Full profile columns joined from users + user_profiles */
const PROFILE_COLUMNS = {
  id: UserModel.id,
  name: UserModel.name,
  email: UserModel.email,
  mobile: UserModel.mobile,
  userType: UserModel.userType,
  userStatus: UserModel.userStatus,
  gender: UserProfileModel.gender,
  alternateMobile: UserProfileModel.alternateMobile,
  city: UserProfileModel.city,
  state: UserProfileModel.state,
  address: UserProfileModel.address,
  zipCode: UserProfileModel.zipCode,
  profileImage: UserProfileModel.profileImage,
  age: UserProfileModel.age,
  dob: UserProfileModel.dob,
  bloodGroup: UserProfileModel.bloodGroup,
  height: UserProfileModel.height,
  weight: UserProfileModel.weight,
  allergies: UserProfileModel.allergies,
  chronicConditions: UserProfileModel.chronicConditions,
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

export class PatientService {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET MY PROFILE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/patient/my-profile
   * Returns the full profile (users + user_profiles) of the authenticated patient.
   */
  static async getMyProfile(userId: string) {
    const cacheKey = `patient_profile:${userId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.error(
        `[Cache] Error reading patient profile cache for user ${userId}:`,
        err
      );
    }

    const [profile] = await database
      .select(PROFILE_COLUMNS)
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!profile) {
      throw new HttpError(404, 'Patient profile not found.');
    }

    try {
      await redisClient.setex(cacheKey, 3600, JSON.stringify(profile));
    } catch (err) {
      logger.error(
        `[Cache] Error writing patient profile cache for user ${userId}:`,
        err
      );
    }

    return profile;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. COMPLETE / UPDATE MY PROFILE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * PATCH /api/v1/patient/complete-profile
   * Updates users.name / users.email and upserts all profile fields.
   */
  static async completeProfile(
    userId: string,
    payload: CompletePatientProfileDto
  ) {
    const userFields: Record<string, unknown> = {};
    if (payload.name !== undefined) userFields.name = payload.name;
    if (payload.email !== undefined) userFields.email = payload.email;

    const profileFields: Record<string, unknown> = {};
    const profileKeys = [
      'gender',
      'alternateMobile',
      'address',
      'city',
      'state',
      'zipCode',
      'dob',
      'age',
      'bloodGroup',
      'height',
      'weight',
      'allergies',
      'chronicConditions',
    ] as const;
    for (const key of profileKeys) {
      if (payload[key] !== undefined) profileFields[key] = payload[key];
    }

    return await database.transaction(async (tx) => {
      if (Object.keys(userFields).length > 0) {
        // Guard: email must not be claimed by another account
        if (userFields.email) {
          const [conflict] = await tx
            .select({ id: UserModel.id })
            .from(UserModel)
            .where(
              and(
                eq(UserModel.email, userFields.email as string),
                ne(UserModel.id, userId)
              )
            )
            .limit(1);

          if (conflict) {
            throw new HttpError(
              400,
              'This email is already in use by another account.'
            );
          }
        }

        await tx
          .update(UserModel)
          .set({ ...userFields, updatedAt: new Date() })
          .where(eq(UserModel.id, userId));
      }

      if (Object.keys(profileFields).length > 0) {
        const [existing] = await tx
          .select({ id: UserProfileModel.id })
          .from(UserProfileModel)
          .where(eq(UserProfileModel.userId, userId))
          .limit(1);

        if (existing) {
          await tx
            .update(UserProfileModel)
            .set({ ...profileFields, updatedAt: new Date() })
            .where(eq(UserProfileModel.userId, userId));
        } else {
          await tx
            .insert(UserProfileModel)
            .values({ userId, ...profileFields });
        }
      }

      // Invalidate Redis cache
      await redisClient.del(`user:${userId}`);
      await redisClient.del(`patient_profile:${userId}`);
      await redisClient.del(`patient_account:${userId}`);
      await redisClient.del(`patient:${userId}`);
      await redisClient.del(`patient:${userId}:withFamily`);

      const [updated] = await tx
        .select(PROFILE_COLUMNS)
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(eq(UserModel.id, userId))
        .limit(1);

      return updated;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET ACCOUNT (primary + all family members)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/patient/account
   *
   * Single post-login call that returns:
   *  - primary: the authenticated patient's own full profile
   *  - members: all linked family members with their relationship and profile
   *
   * Frontend uses this to render the member selection screen and to decide
   * whether to show the profile completion modal (isProfileComplete flag).
   */
  static async getAccount(userId: string) {
    const cacheKey = `patient_account:${userId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.error(
        `[Cache] Error reading patient account cache for user ${userId}:`,
        err
      );
    }

    // 1️⃣ Fetch own profile
    const [primary] = await database
      .select({
        ...PROFILE_COLUMNS,
        // expose isProfileComplete so frontend can act on it here too
        createdAt: UserModel.createdAt,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, userId))
      .limit(1);

    if (!primary) {
      throw new HttpError(404, 'Patient account not found.');
    }

    // 2️⃣ Compute isProfileComplete (same rule as verifyOtp)
    const isProfileComplete =
      Boolean(primary.name?.trim()) &&
      Boolean(primary.gender) &&
      Boolean(primary.dob?.trim());

    // 3️⃣ Fetch all linked family members
    const members = await database
      .select({
        linkId: PatientFamilyLinksModel.id,
        relationship: PatientFamilyLinksModel.relationship,
        linkedAt: PatientFamilyLinksModel.createdAt,
        ...PROFILE_COLUMNS,
      })
      .from(PatientFamilyLinksModel)
      .innerJoin(
        UserModel,
        eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const result = {
      primary: {
        ...primary,
        isProfileComplete,
      },
      members,
    };

    try {
      await redisClient.setex(cacheKey, 3600, JSON.stringify(result));
    } catch (err) {
      logger.error(
        `[Cache] Error writing patient account cache for user ${userId}:`,
        err
      );
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. ADD FAMILY MEMBER
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/patient/family
   *
   * Creates a new dependent family member with mobile=NULL.
   * The member is accessible only through the primary patient account.
   * Duplicate links are blocked by DB unique constraint.
   */
  static async addFamilyMember(
    primaryPatientId: string,
    payload: AddFamilyMemberDto
  ) {
    const { name, relationship, ...profilePayload } = payload;

    return await database.transaction(async (tx) => {
      // Create dependent member with mobile=NULL
      const [newUser] = await tx
        .insert(UserModel)
        .values({
          name,
          mobile: null,
          userType: 'Patient',
          userStatus: 'Active',
        })
        .returning({ id: UserModel.id });

      await tx.insert(UserProfileModel).values({
        userId: newUser.id,
        ...profilePayload,
      });

      const linkedPatientId = newUser.id;

      // Create the family link (DB unique constraint prevents duplicates)
      try {
        await tx.insert(PatientFamilyLinksModel).values({
          primaryPatientId,
          linkedPatientId,
          relationship,
        });
      } catch (err: unknown) {
        // Postgres unique violation code
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          throw new HttpError(
            409,
            'This family member is already linked to your account.'
          );
        }
        throw err;
      }

      // Return the newly linked member's full profile
      const [member] = await tx
        .select({
          linkId: PatientFamilyLinksModel.id,
          relationship: PatientFamilyLinksModel.relationship,
          ...PROFILE_COLUMNS,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
        )
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
            eq(PatientFamilyLinksModel.linkedPatientId, linkedPatientId)
          )
        )
        .limit(1);

      try {
        await redisClient.del(`patient_account:${primaryPatientId}`);
        await redisClient.del(`patient:${primaryPatientId}:withFamily`);
      } catch (err) {
        logger.error(
          'Failed to invalidate patient caches on adding family member',
          err
        );
      }

      return member;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. LIST FAMILY MEMBERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/patient/family
   * Returns a paginated list of family members linked to the authenticated patient.
   */
  static async listFamilyMembers(
    primaryPatientId: string,
    query: ListFamilyMembersQueryDto
  ) {
    const { limit, offset } = pagination(query.pageNumber, query.pageSize);
    const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
    const pageSize = limit;

    const [members, [{ total }]] = await Promise.all([
      database
        .select({
          linkId: PatientFamilyLinksModel.id,
          relationship: PatientFamilyLinksModel.relationship,
          linkedAt: PatientFamilyLinksModel.createdAt,
          ...PROFILE_COLUMNS,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
        )
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId))
        .limit(limit)
        .offset(offset),

      database
        .select({ total: count() })
        .from(PatientFamilyLinksModel)
        .where(eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId)),
    ]);

    const totalRecords = Number(total);
    const totalPages =
      totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);

    return {
      data: members,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber,
        pageSize,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET ONE FAMILY MEMBER
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/patient/family/:familyMemberId
   * Returns a single family member's profile.
   * Verifies the link belongs to the authenticated patient before returning.
   */
  static async getFamilyMember(
    primaryPatientId: string,
    familyMemberId: string
  ) {
    const [member] = await database
      .select({
        linkId: PatientFamilyLinksModel.id,
        relationship: PatientFamilyLinksModel.relationship,
        linkedAt: PatientFamilyLinksModel.createdAt,
        ...PROFILE_COLUMNS,
      })
      .from(PatientFamilyLinksModel)
      .innerJoin(
        UserModel,
        eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(
        and(
          eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
          eq(PatientFamilyLinksModel.linkedPatientId, familyMemberId)
        )
      )
      .limit(1);

    if (!member) {
      throw new HttpError(
        404,
        'Family member not found or does not belong to your account.'
      );
    }

    return member;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. UPDATE FAMILY MEMBER
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * PATCH /api/v1/patient/family/:familyMemberId
   *
   * Only the primary account holder who owns the link may edit. A member who is
   * themselves a primary account holder owns their own identity, so edits from
   * any other account are rejected; otherwise the primary patient may edit
   * them freely.
   */
  static async updateFamilyMember(
    primaryPatientId: string,
    familyMemberId: string,
    payload: UpdateFamilyMemberDto
  ) {
    // 1️⃣ Verify the link exists and belongs to this primary patient
    const [link] = await database
      .select({
        id: PatientFamilyLinksModel.id,
        relationship: PatientFamilyLinksModel.relationship,
        userStatus: UserModel.userStatus,
      })
      .from(PatientFamilyLinksModel)
      .innerJoin(
        UserModel,
        eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
      )
      .where(
        and(
          eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
          eq(PatientFamilyLinksModel.linkedPatientId, familyMemberId)
        )
      )
      .limit(1);

    if (!link) {
      throw new HttpError(
        404,
        'Family member not found or does not belong to your account.'
      );
    }

    // 2️⃣ Block edit if the family member is themselves a primary account holder.
    //    A member who manages their own family group owns their identity —
    //    no other account can overwrite their details.
    const [memberAsPrimary] = await database
      .select({ id: PatientFamilyLinksModel.id })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, familyMemberId))
      .limit(1);

    if (memberAsPrimary) {
      throw new HttpError(
        403,
        'This family member has their own primary account and manages their own profile. You can view but not edit their details.'
      );
    }

    const { relationship, name, ...profilePayload } = payload;

    return await database.transaction(async (tx) => {
      // 3️⃣ Update link relationship if changed
      if (relationship !== undefined && relationship !== link.relationship) {
        await tx
          .update(PatientFamilyLinksModel)
          .set({ relationship, updatedAt: new Date() })
          .where(eq(PatientFamilyLinksModel.id, link.id));
      }

      // 4️⃣ Update users.name if provided
      if (name !== undefined) {
        await tx
          .update(UserModel)
          .set({ name, updatedAt: new Date() })
          .where(eq(UserModel.id, familyMemberId));
      }

      // 5️⃣ Upsert user_profiles fields
      const profileKeys = Object.keys(profilePayload) as Array<
        keyof typeof profilePayload
      >;

      if (profileKeys.length > 0) {
        const profileFields: Record<string, unknown> = {};
        for (const key of profileKeys) {
          if (profilePayload[key] !== undefined)
            profileFields[key] = profilePayload[key];
        }

        const [existingProfile] = await tx
          .select({ id: UserProfileModel.id })
          .from(UserProfileModel)
          .where(eq(UserProfileModel.userId, familyMemberId))
          .limit(1);

        if (existingProfile) {
          await tx
            .update(UserProfileModel)
            .set({ ...profileFields, updatedAt: new Date() })
            .where(eq(UserProfileModel.userId, familyMemberId));
        } else {
          await tx
            .insert(UserProfileModel)
            .values({ userId: familyMemberId, ...profileFields });
        }
      }

      // 6️⃣ Return updated profile
      const [updated] = await tx
        .select({
          linkId: PatientFamilyLinksModel.id,
          relationship: PatientFamilyLinksModel.relationship,
          ...PROFILE_COLUMNS,
        })
        .from(PatientFamilyLinksModel)
        .innerJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.linkedPatientId)
        )
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
            eq(PatientFamilyLinksModel.linkedPatientId, familyMemberId)
          )
        )
        .limit(1);

      try {
        await redisClient.del(`patient_account:${primaryPatientId}`);
        await redisClient.del(`patient_profile:${familyMemberId}`);
        await redisClient.del(`patient:${familyMemberId}`);
        await redisClient.del(`patient:${familyMemberId}:withFamily`);
        await redisClient.del(`patient:${primaryPatientId}:withFamily`);
      } catch (err) {
        logger.error(
          'Failed to invalidate patient caches on updating family member',
          err
        );
      }

      return updated;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. REMOVE FAMILY MEMBER LINK
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * DELETE /api/v1/patient/family/:familyMemberId
   *
   * Removes only the patient_family_links row.
   * Does NOT delete the linked patient's user record — they may have their
   * own mobile login or be linked from another primary patient.
   */
  static async removeFamilyMember(
    primaryPatientId: string,
    familyMemberId: string
  ) {
    const [link] = await database
      .select({ id: PatientFamilyLinksModel.id })
      .from(PatientFamilyLinksModel)
      .where(
        and(
          eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
          eq(PatientFamilyLinksModel.linkedPatientId, familyMemberId)
        )
      )
      .limit(1);

    if (!link) {
      throw new HttpError(
        404,
        'Family member not found or does not belong to your account.'
      );
    }

    // Fetch the member's mobile before touching anything
    const [memberUser] = await database
      .select({ mobile: UserModel.mobile })
      .from(UserModel)
      .where(eq(UserModel.id, familyMemberId))
      .limit(1);

    await database.transaction(async (tx) => {
      // 1️⃣ Remove the family link
      await tx
        .delete(PatientFamilyLinksModel)
        .where(eq(PatientFamilyLinksModel.id, link.id));

      // 2️⃣ Mark Inactive only for pure dependents (no independent mobile login)
      if (memberUser && !memberUser.mobile) {
        await tx
          .update(UserModel)
          .set({ userStatus: 'Inactive', updatedAt: new Date() })
          .where(eq(UserModel.id, familyMemberId));
      }
    });

    try {
      await redisClient.del(`patient_account:${primaryPatientId}`);
      await redisClient.del(`patient_profile:${familyMemberId}`);
      await redisClient.del(`patient:${familyMemberId}`);
      await redisClient.del(`patient:${familyMemberId}:withFamily`);
      await redisClient.del(`patient:${primaryPatientId}:withFamily`);
    } catch (err) {
      logger.error(
        'Failed to invalidate patient caches on removing family member',
        err
      );
    }

    return { message: 'Family member removed from your account.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. UPDATE PROFILE IMAGE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Updates the authenticated patient's own profile image.
   * If there is an existing profile image, it is deleted from S3.
   */
  public static async updateProfileImage(userId: string, profileImage: string) {
    const [existingProfile] = await database
      .select({ profileImage: UserProfileModel.profileImage })
      .from(UserProfileModel)
      .where(eq(UserProfileModel.userId, userId))
      .limit(1);

    const oldProfileImage = existingProfile?.profileImage;

    await database
      .insert(UserProfileModel)
      .values({
        userId,
        profileImage,
      })
      .onConflictDoUpdate({
        target: [UserProfileModel.userId],
        set: {
          profileImage,
          updatedAt: new Date(),
        },
      });

    try {
      await redisClient.del(`user:${userId}`);
      await redisClient.del(`patient_profile:${userId}`);
      await redisClient.del(`patient_account:${userId}`);
      await redisClient.del(`patient:${userId}`);
      await redisClient.del(`patient:${userId}:withFamily`);
    } catch (err) {
      logger.error(
        'Failed to invalidate patient caches on profile image update',
        err
      );
    }

    if (oldProfileImage) {
      try {
        await deleteFromS3(oldProfileImage);
      } catch (err) {
        logger.error('Failed to delete old profile image from S3', err);
      }
    }

    return { profileImage };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. UPDATE FAMILY MEMBER PROFILE IMAGE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Updates a linked family member's profile image.
   * Performs the same ownership and primary account checks as updateFamilyMember.
   * If there is an existing profile image, it is deleted from S3.
   */
  public static async updateFamilyMemberProfileImage(
    primaryPatientId: string,
    familyMemberId: string,
    profileImage: string
  ) {
    // 1️⃣ Verify the link exists and belongs to this primary patient
    const [link] = await database
      .select({ id: PatientFamilyLinksModel.id })
      .from(PatientFamilyLinksModel)
      .where(
        and(
          eq(PatientFamilyLinksModel.primaryPatientId, primaryPatientId),
          eq(PatientFamilyLinksModel.linkedPatientId, familyMemberId)
        )
      )
      .limit(1);

    if (!link) {
      throw new HttpError(
        404,
        'Family member not found or does not belong to your account.'
      );
    }

    // 2️⃣ Block edit if the family member is themselves a primary account holder.
    const [memberAsPrimary] = await database
      .select({ id: PatientFamilyLinksModel.id })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, familyMemberId))
      .limit(1);

    if (memberAsPrimary) {
      throw new HttpError(
        403,
        'This family member has their own primary account and manages their own profile. You can view but not edit their details.'
      );
    }

    // 3️⃣ Get the old profile image path to delete it from S3
    const [existingProfile] = await database
      .select({ profileImage: UserProfileModel.profileImage })
      .from(UserProfileModel)
      .where(eq(UserProfileModel.userId, familyMemberId))
      .limit(1);

    const oldProfileImage = existingProfile?.profileImage;

    // 4️⃣ Upsert the new profile image
    await database
      .insert(UserProfileModel)
      .values({
        userId: familyMemberId,
        profileImage,
      })
      .onConflictDoUpdate({
        target: [UserProfileModel.userId],
        set: {
          profileImage,
          updatedAt: new Date(),
        },
      });

    if (oldProfileImage) {
      try {
        await deleteFromS3(oldProfileImage);
      } catch (err) {
        logger.error(
          'Failed to delete old family member profile image from S3',
          err
        );
      }
    }

    return { profileImage };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. DIRECTORY SEARCH
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Helper function to fetch the next available slot for a doctor at a clinic.
   * Searches starting from startDateStr for up to lookaheadDays.
   */
  private static formatTime(isoOrTimeStr: string): string {
    const timePart = isoOrTimeStr.includes('T')
      ? isoOrTimeStr.split('T')[1]
      : isoOrTimeStr;
    if (!timePart) return '';
    const [hoursStr, minutesStr] = timePart.split(':');
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
    return '';
  }

  public static async getDoctorNextAvailableSlot(
    doctorId: string,
    clinicId: string,
    startDateStr: string,
    lookaheadDays: number = 7
  ): Promise<{
    date: string;
    time: string;
    endTime: string;
    start: string;
    end: string;
    availableTokens?: number | null;
    totalTokens?: number | null;
  } | null> {
    try {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/'); // [dd, mm, yyyy]
      const istTodayYMD = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      const start = new Date(`${startDateStr}T00:00:00Z`);
      for (let i = 0; i < lookaheadDays; i++) {
        const currentDay = new Date(start);
        currentDay.setUTCDate(currentDay.getUTCDate() + i);
        const dateStr = currentDay.toISOString().split('T')[0];

        if (dateStr < istTodayYMD) {
          continue;
        }

        let timeFilter: string | undefined;
        if (dateStr === istTodayYMD) {
          timeFilter = now.toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
          }); // "HH:MM"
        }

        const { slots } = await AppointmentService.getAvailableSlotsForDate(
          clinicId,
          {
            date: dateStr,
            time: timeFilter,
          },
          { doctorId }
        );

        const firstAvailable = slots.find((s) => {
          if (s.totalTokens !== undefined) {
            return (s.availableTokens ?? 0) > 0;
          }
          return s.status === 'available';
        });

        if (firstAvailable) {
          const formattedTime = PatientService.formatTime(firstAvailable.start);
          const formattedEndTime = PatientService.formatTime(
            firstAvailable.end
          );

          return {
            date: dateStr,
            time: formattedTime || 'Available',
            endTime: formattedEndTime || '',
            start: firstAvailable.start,
            end: firstAvailable.end,
            availableTokens:
              firstAvailable.totalTokens !== undefined
                ? firstAvailable.availableTokens
                : null,
            totalTokens:
              firstAvailable.totalTokens !== undefined
                ? firstAvailable.totalTokens
                : null,
          };
        }
      }
    } catch (err) {
      logger.error(
        `Error finding next available slot for doctor ${doctorId} at clinic ${clinicId} starting from ${startDateStr}`,
        err
      );
    }
    return null;
  }

  static async searchDirectory(query: PatientDirectorySearchDto) {
    const filters = [
      sql`${UserModel.userType} IN ('Admin', 'Doctor')`,
      eq(UserModel.userStatus, 'Active'),
      eq(ClinicModel.status, 'Active'),
      eq(ClinicAssignModel.onlineBookingEnabled, true),
      eq(ClinicSettingsModel.onlineBookingEnabled, true),
    ];

    let relevanceScoreField = sql<number>`0`;

    if (query.search) {
      const tokens = query.search.toLowerCase().split(/\s+/).filter(Boolean);
      const tokenScores: any[] = [];

      for (const token of tokens) {
        const searchPattern = `%${token}%`;
        const prefixPattern = `${token}%`;
        const wordPrefixPattern = `% ${token}%`;

        filters.push(
          or(
            sql`LOWER(${UserModel.name}) LIKE ${searchPattern}`,
            sql`LOWER(${ClinicModel.clinicName}) LIKE ${searchPattern}`,
            sql`similarity(LOWER(${UserModel.name}), ${token}) > 0.3`,
            sql`similarity(LOWER(${ClinicModel.clinicName}), ${token}) > 0.3`,
            sql`dmetaphone(LOWER(${UserModel.name})) = dmetaphone(${token})`,
            sql`soundex(LOWER(${UserModel.name})) = soundex(${token})`
          ) as any
        );

        tokenScores.push(sql<number>`
          (CASE WHEN LOWER(${UserModel.name}) = ${token} THEN 100 ELSE 0 END) +
          (CASE WHEN (LOWER(${UserModel.name}) LIKE ${prefixPattern} OR LOWER(${UserModel.name}) LIKE ${wordPrefixPattern}) THEN 80 ELSE 0 END) +
          (CASE WHEN LOWER(${UserModel.name}) LIKE ${searchPattern} THEN 50 ELSE 0 END) +
          (CASE WHEN similarity(LOWER(${UserModel.name}), ${token}) > 0.3 THEN 30 * similarity(LOWER(${UserModel.name}), ${token}) ELSE 0 END) +
          (CASE WHEN dmetaphone(LOWER(${UserModel.name})) = dmetaphone(${token}) THEN 20 ELSE 0 END) +
          (CASE WHEN soundex(LOWER(${UserModel.name})) = soundex(${token}) THEN 15 ELSE 0 END) +
          
          (CASE WHEN LOWER(${ClinicModel.clinicName}) = ${token} THEN 90 ELSE 0 END) +
          (CASE WHEN (LOWER(${ClinicModel.clinicName}) LIKE ${prefixPattern} OR LOWER(${ClinicModel.clinicName}) LIKE ${wordPrefixPattern}) THEN 70 ELSE 0 END) +
          (CASE WHEN LOWER(${ClinicModel.clinicName}) LIKE ${searchPattern} THEN 45 ELSE 0 END) +
          (CASE WHEN similarity(LOWER(${ClinicModel.clinicName}), ${token}) > 0.3 THEN 25 * similarity(LOWER(${ClinicModel.clinicName}), ${token}) ELSE 0 END)
        `);
      }

      if (tokenScores.length > 0) {
        relevanceScoreField = sql<number>`(${sql.join(tokenScores, sql` + `)})`;
      }
    }

    if (query.speciality) {
      const specPattern = `%${query.speciality.toLowerCase()}%`;
      filters.push(
        sql`LOWER(${UserProfessionalModel.speciality}) LIKE ${specPattern}`
      );
    }

    const likesCountField = sql<number>`(
      SELECT COALESCE(count(*)::int, 0)
      FROM ${DoctorFavoriteModel}
      WHERE ${DoctorFavoriteModel.doctorId} = ${UserModel.id}
    )`;

    const ratingScoreField = sql<number>`(
      coalesce(${UserProfessionalModel.averageRating}, '0.00')::numeric * 10 + 
      coalesce(${UserProfessionalModel.reviewCount}, 0) * 0.5
    )`;

    const selectFields: any = {
      doctor: {
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        gender: UserProfileModel.gender,
        qualification: UserProfessionalModel.qualification,
        yearsOfExperience: UserProfessionalModel.yearsOfExperience,
        speciality: UserProfessionalModel.speciality,
        profileImage: UserProfileModel.profileImage,
        createdAt: UserModel.createdAt,
        totalLikes: likesCountField,
        averageRating: UserProfessionalModel.averageRating,
        reviewCount: UserProfessionalModel.reviewCount,
      },
      clinic: {
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        clinicPhone: ClinicModel.clinicPhone,
        state: ClinicModel.State,
        city: ClinicModel.City,
        zipCode: ClinicModel.ZipCode,
        clinicLogo: ClinicModel.clinicLogo,
        latitude: ClinicModel.latitude,
        longitude: ClinicModel.longitude,
        onlineBookingEnabledAssign: ClinicAssignModel.onlineBookingEnabled,
        onlineBookingEnabledSettings: ClinicSettingsModel.onlineBookingEnabled,
        maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
        payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
        payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
        showClinicNumber: ClinicSettingsModel.showClinicNumberPublicly,
      },
    };

    let distanceField;
    if (query.latitude !== undefined && query.longitude !== undefined) {
      // Haversine formula in Kilometers (factor 6371)
      // Clamped between -1.0 and 1.0 to avoid floating point precision issues causing acos() to fail.
      distanceField = sql<number>`6371 * acos(
        LEAST(GREATEST(
          cos(radians(${query.latitude})) * cos(radians(${ClinicModel.latitude})) * 
          cos(radians(${ClinicModel.longitude}) - radians(${query.longitude})) + 
          sin(radians(${query.latitude})) * sin(radians(${ClinicModel.latitude})),
          -1.0
        ), 1.0)
      )`;
      selectFields.distance = distanceField;
    }

    if (query.city && distanceField !== undefined) {
      const cityPattern = `%${query.city.toLowerCase()}%`;
      filters.push(
        or(
          sql`LOWER(${ClinicModel.City}) LIKE ${cityPattern}`,
          and(
            sql`${ClinicModel.latitude} IS NOT NULL`,
            sql`${ClinicModel.longitude} IS NOT NULL`,
            sql`${distanceField} <= ${query.radius}`
          )
        ) as any
      );
    } else {
      if (query.city) {
        const cityPattern = `%${query.city.toLowerCase()}%`;
        filters.push(sql`LOWER(${ClinicModel.City}) LIKE ${cityPattern}`);
      }

      if (distanceField !== undefined) {
        filters.push(
          and(
            sql`${ClinicModel.latitude} IS NOT NULL`,
            sql`${ClinicModel.longitude} IS NOT NULL`,
            sql`${distanceField} <= ${query.radius}`
          ) as any
        );
      }
    }

    const queryBuilder = database
      .select(selectFields)
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .innerJoin(ClinicAssignModel, eq(ClinicAssignModel.userId, UserModel.id))
      .innerJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
      .innerJoin(
        ClinicSettingsModel,
        eq(ClinicSettingsModel.clinicId, ClinicModel.id)
      )
      .where(and(...filters))
      .$dynamic();

    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    const todayStr = new Date().toISOString().split('T')[0];
    const targetDateStr = (query as any).date || todayStr;
    const isAvailableOnly = (query as any).available === true;

    let paginatedData: any[] = [];
    let totalRecords = 0;

    const orderFields: any[] = [];
    if (query.search) {
      orderFields.push(desc(relevanceScoreField));
    }
    orderFields.push(desc(ratingScoreField));
    orderFields.push(desc(likesCountField));
    orderFields.push(distanceField ? distanceField : desc(UserModel.createdAt));

    if (isAvailableOnly) {
      // Fetch all matching records without limit/offset to filter in memory
      const allData = await queryBuilder.orderBy(...orderFields);

      // Verify availability for each in parallel
      const availabilityChecks = await Promise.all(
        allData.map(async (item: any) => {
          try {
            const { slots } = await AppointmentService.getAvailableSlotsForDate(
              item.clinic.id,
              { date: targetDateStr },
              { doctorId: item.doctor.id }
            );
            const isAvailable = slots.some((s) => {
              if (s.totalTokens !== undefined) {
                return (s.availableTokens ?? 0) > 0;
              }
              return s.status === 'available';
            });
            return { item, isAvailable };
          } catch (err) {
            logger.error(
              `Error checking availability for doctor ${item.doctor.id} at clinic ${item.clinic.id} on ${targetDateStr}`,
              err
            );
            return { item, isAvailable: false };
          }
        })
      );

      const filteredData = availabilityChecks
        .filter((res) => res.isAvailable)
        .map((res) => res.item);

      totalRecords = filteredData.length;
      paginatedData = filteredData.slice(offset, offset + limit);
    } else {
      // Traditional SQL-paginated fetch
      const data = await queryBuilder
        .orderBy(...orderFields)
        .limit(limit)
        .offset(offset);

      paginatedData = data;

      const [totalCount] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .innerJoin(
          ClinicAssignModel,
          eq(ClinicAssignModel.userId, UserModel.id)
        )
        .innerJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
        .innerJoin(
          ClinicSettingsModel,
          eq(ClinicSettingsModel.clinicId, ClinicModel.id)
        )
        .where(and(...filters));

      totalRecords = Number(totalCount?.count || 0);
    }

    // Attach next available slot and clinic services to the paginated list
    const dataWithSlotsAndServices = await Promise.all(
      paginatedData.map(async (item: any) => {
        const [nextAvailableSlot, services] = await Promise.all([
          PatientService.getDoctorNextAvailableSlot(
            item.doctor.id,
            item.clinic.id,
            targetDateStr
          ),
          database
            .select({
              id: ClinicServiceModel.id,
              clinicId: ClinicServiceModel.clinicId,
              serviceName: ClinicServiceModel.serviceName,
              price: ClinicServiceModel.price,
              currency: ClinicServiceModel.currency,
              additionalServices: ClinicServiceModel.additionalServices,
              durationDays: ClinicServiceModel.durationDays,
            })
            .from(ClinicServiceModel)
            .where(
              and(
                eq(ClinicServiceModel.doctorId, item.doctor.id),
                eq(ClinicServiceModel.clinicId, item.clinic.id),
                eq(ClinicServiceModel.isDeleted, false),
                eq(ClinicServiceModel.canBeBookedByPatient, true)
              )
            )
            .orderBy(asc(ClinicServiceModel.serviceName)),
        ]);

        const mappedClinic = {
          ...item.clinic,
          onlineBookingEnabled:
            item.clinic.onlineBookingEnabledAssign === true &&
            item.clinic.onlineBookingEnabledSettings === true,
          maxAdvanceBookingDays: item.clinic.maxAdvanceBookingDays ?? 7,
          payOnlineEnabled: item.clinic.payOnlineEnabled === true,
          payAtClinicEnabled: item.clinic.payAtClinicEnabled === true,
          showClinicNumber: item.clinic.showClinicNumber !== false,
          services,
        };
        delete (mappedClinic as any).onlineBookingEnabledAssign;
        delete (mappedClinic as any).onlineBookingEnabledSettings;

        return {
          ...item,
          clinic: mappedClinic,
          nextAvailableSlot,
        };
      })
    );

    const totalPages = Math.ceil(totalRecords / limit);

    return {
      data: dataWithSlotsAndServices,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11. GET DOCTOR PUBLIC PROFILE
  // ─────────────────────────────────────────────────────────────────────────
  static async getDoctorPublicProfile(
    doctorId: string,
    patientId?: string,
    options: { audience?: 'patient' | 'web' } = {}
  ) {
    // The patient app is a booking directory, so it only ever sees clinics that
    // accept online booking. The public web profile is a marketing page and
    // shows every active clinic, flagging bookability per clinic instead.
    const isWeb = options.audience === 'web';
    const cacheKey = isWeb
      ? CacheKeys.doctorPublicProfileWeb(doctorId)
      : CacheKeys.doctorPublicProfile(doctorId);
    let doctorData: any = null;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        doctorData = JSON.parse(cached);
      }
    } catch (err) {
      logger.error(
        `[Cache] Error reading doctor public profile cache for doctor ${doctorId}:`,
        err
      );
    }

    if (!doctorData) {
      const [profile] = await database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          gender: UserProfileModel.gender,
          profileImage: UserProfileModel.profileImage,
          qualification: UserProfessionalModel.qualification,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          speciality: UserProfessionalModel.speciality,
          specialization: UserProfessionalModel.specialization,
          registrationNumber: UserProfessionalModel.registrationNumber,
          about: UserProfessionalModel.about,
          isVerified: sql<boolean>`(${UserModel.userStatus} = 'Active')`,
          averageRating: UserProfessionalModel.averageRating,
          reviewCount: UserProfessionalModel.reviewCount,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(
          and(
            eq(UserModel.id, doctorId),
            sql`${UserModel.userType} IN ('Admin', 'Doctor')`,
            eq(UserModel.userStatus, 'Active')
          )
        )
        .limit(1);

      if (!profile) {
        throw new HttpError(404, 'Doctor profile not found or inactive');
      }

      const qualifications = await database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, doctorId));

      const clinics = await database
        .select({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          tagline: ClinicModel.Tagline,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          state: ClinicModel.State,
          city: ClinicModel.City,
          zipCode: ClinicModel.ZipCode,
          clinicLogo: ClinicModel.clinicLogo,
          latitude: ClinicModel.latitude,
          longitude: ClinicModel.longitude,
          onlineBookingEnabled: ClinicAssignModel.onlineBookingEnabled,
          clinicOnlineBookingEnabled: ClinicSettingsModel.onlineBookingEnabled,
          maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
          payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
          payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
          showClinicNumber: ClinicSettingsModel.showClinicNumberPublicly,
        })
        .from(ClinicAssignModel)
        .innerJoin(ClinicModel, eq(ClinicModel.id, ClinicAssignModel.clinicId))
        .innerJoin(
          ClinicSettingsModel,
          eq(ClinicSettingsModel.clinicId, ClinicModel.id)
        )
        .where(
          and(
            eq(ClinicAssignModel.userId, doctorId),
            eq(ClinicModel.status, 'Active'),
            ...(isWeb
              ? []
              : [
                  eq(ClinicAssignModel.onlineBookingEnabled, true),
                  eq(ClinicSettingsModel.onlineBookingEnabled, true),
                ])
          )
        );

      const services = await database
        .select({
          id: ClinicServiceModel.id,
          clinicId: ClinicServiceModel.clinicId,
          serviceName: ClinicServiceModel.serviceName,
          price: ClinicServiceModel.price,
          currency: ClinicServiceModel.currency,
          additionalServices: ClinicServiceModel.additionalServices,
          durationDays: ClinicServiceModel.durationDays,
        })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.doctorId, doctorId),
            eq(ClinicServiceModel.isDeleted, false),
            eq(ClinicServiceModel.canBeBookedByPatient, true)
          )
        )
        .orderBy(asc(ClinicServiceModel.serviceName));

      // When accessed from public web, filter clinics based on subscription public_booking_page feature
      let accessibleClinics = clinics;
      if (isWeb) {
        const checks = await Promise.all(
          clinics.map(async (clinic) => {
            const check = await LimitationService.isFeatureEnabled(
              clinic.id,
              FEATURE_KEYS.PUBLIC_BOOKING_PAGE
            );
            return { clinic, allowed: check.allowed };
          })
        );
        accessibleClinics = checks
          .filter((c) => c.allowed)
          .map((c) => c.clinic);

        if (accessibleClinics.length === 0) {
          throw new HttpError(404, 'Doctor profile not found or inactive');
        }
      }

      const clinicsWithServices = accessibleClinics.map((clinic) => ({
        ...clinic,
        onlineBookingEnabled:
          clinic.onlineBookingEnabled === true &&
          clinic.clinicOnlineBookingEnabled === true,
        maxAdvanceBookingDays: clinic.maxAdvanceBookingDays ?? 7,
        payOnlineEnabled: clinic.payOnlineEnabled === true,
        payAtClinicEnabled: clinic.payAtClinicEnabled === true,
        showClinicNumber: clinic.showClinicNumber !== false,
        services: services.filter((s) => s.clinicId === clinic.id),
      }));

      // Fetch clinic timings
      const clinicsWithTimings = await Promise.all(
        clinicsWithServices.map(async (clinic) => {
          const rawTimings = await DoctorServices.getDoctorAvailability(
            doctorId,
            clinic.id
          );
          return {
            ...clinic,
            timings: toPublicTimings(rawTimings),
          };
        })
      );

      // Fetch total patients (all unique patient IDs with appointments for this doctor)
      const [patientCountResult] = await database
        .select({
          count: sql<number>`count(distinct ${AppointmentModel.patientId})::int`,
        })
        .from(AppointmentModel)
        .where(eq(AppointmentModel.doctorId, doctorId));
      const totalPatients = patientCountResult?.count || 0;

      doctorData = {
        ...profile,
        qualifications,
        clinics: clinicsWithTimings,
        totalPatients,
      };

      try {
        await redisClient.setex(cacheKey, 7200, JSON.stringify(doctorData));
      } catch (err) {
        logger.error(
          `[Cache] Error writing doctor public profile cache for doctor ${doctorId}:`,
          err
        );
      }
    }

    // Check if favorited by the patient
    let isFavorite = false;
    if (patientId) {
      const [fav] = await database
        .select({ id: DoctorFavoriteModel.id })
        .from(DoctorFavoriteModel)
        .where(
          and(
            eq(DoctorFavoriteModel.patientId, patientId),
            eq(DoctorFavoriteModel.doctorId, doctorId)
          )
        )
        .limit(1);
      isFavorite = !!fav;
    }

    return {
      ...doctorData,
      isFavorite,
    };
  }

  static async toggleDoctorFavorite(patientId: string, doctorId: string) {
    // 1. Verify doctor exists first
    const [doctor] = await database
      .select({ id: UserModel.id })
      .from(UserModel)
      .where(
        and(
          eq(UserModel.id, doctorId),
          sql`${UserModel.userType} IN ('Admin', 'Doctor')`,
          eq(UserModel.userStatus, 'Active')
        )
      )
      .limit(1);

    if (!doctor) {
      throw new HttpError(404, 'Doctor not found or inactive');
    }

    // 2. Check if favorite link already exists
    const [existing] = await database
      .select({ id: DoctorFavoriteModel.id })
      .from(DoctorFavoriteModel)
      .where(
        and(
          eq(DoctorFavoriteModel.patientId, patientId),
          eq(DoctorFavoriteModel.doctorId, doctorId)
        )
      )
      .limit(1);

    if (existing) {
      // Remove it (unlike)
      await database
        .delete(DoctorFavoriteModel)
        .where(eq(DoctorFavoriteModel.id, existing.id));
      return { isFavorite: false };
    } else {
      // Insert it (like)
      await database.insert(DoctorFavoriteModel).values({
        patientId,
        doctorId,
      });
      return { isFavorite: true };
    }
  }

  static async listFavoriteDoctors(
    patientId: string,
    query: ListFavoriteDoctorsQueryDto
  ) {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    const filters = [
      eq(DoctorFavoriteModel.patientId, patientId),
      sql`${UserModel.userType} IN ('Admin', 'Doctor')`,
      eq(UserModel.userStatus, 'Active'),
    ];

    const data = await database
      .select({ doctorId: DoctorFavoriteModel.doctorId })
      .from(DoctorFavoriteModel)
      .innerJoin(UserModel, eq(UserModel.id, DoctorFavoriteModel.doctorId))
      .where(and(...filters))
      .limit(limit)
      .offset(offset);

    const [totalCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(DoctorFavoriteModel)
      .innerJoin(UserModel, eq(UserModel.id, DoctorFavoriteModel.doctorId))
      .where(and(...filters));

    const totalRecords = Number(totalCount?.count || 0);
    const totalPages = Math.ceil(totalRecords / limit);

    const todayStr = new Date().toISOString().split('T')[0];

    // Resolve the full public profile for each doctor and attach their next available slot
    const doctors = await Promise.all(
      data.map(async (item) => {
        const doctorProfile = await PatientService.getDoctorPublicProfile(
          item.doctorId,
          patientId
        );

        let earliestSlot: {
          date: string;
          time: string;
          endTime: string;
          start: string;
          end: string;
          availableTokens?: number | null;
          totalTokens?: number | null;
        } | null = null;

        if (doctorProfile.clinics && doctorProfile.clinics.length > 0) {
          const slots = await Promise.all(
            doctorProfile.clinics.map((clinic: any) =>
              PatientService.getDoctorNextAvailableSlot(
                item.doctorId,
                clinic.id,
                todayStr
              )
            )
          );

          for (const slot of slots) {
            if (!slot) continue;
            if (
              !earliestSlot ||
              new Date(slot.start).getTime() <
                new Date(earliestSlot.start).getTime()
            ) {
              earliestSlot = slot;
            }
          }
        }

        return {
          ...doctorProfile,
          nextAvailableSlot: earliestSlot,
        };
      })
    );

    return {
      data: doctors,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 12. GET DOCTOR PUBLIC SLOTS
  // ─────────────────────────────────────────────────────────────────────────
  static async getDoctorPublicSlots(
    doctorId: string,
    query: { date: string; clinicId: string }
  ) {
    const requestedDateStr = query.date;

    const now = new Date();
    const istDateParts = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/'); // [dd, mm, yyyy]

    const istTodayYMD = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

    // Block past dates by returning an empty slots list
    if (requestedDateStr < istTodayYMD) {
      return { slots: [] };
    }

    // Filter past slots for today's date
    let timeFilter: string | undefined;
    if (requestedDateStr === istTodayYMD) {
      timeFilter = now.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
      }); // "HH:MM"
    }

    return await AppointmentService.getAvailableSlotsForDate(
      query.clinicId,
      {
        date: query.date,
        time: timeFilter,
      },
      { doctorId }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 13. BOOK PATIENT APPOINTMENT
  // ─────────────────────────────────────────────────────────────────────────
  static async bookPatientAppointment(
    userId: string,
    payload: PatientBookingDto
  ) {
    if (payload.patientId !== userId) {
      const [link] = await database
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, userId),
            eq(PatientFamilyLinksModel.linkedPatientId, payload.patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(
          403,
          'Access denied. You can only book appointments for yourself or linked family members.'
        );
      }
    }

    const [onlineBookingClinicSettings] = await database
      .select({
        onlineBookingEnabled: ClinicSettingsModel.onlineBookingEnabled,
        payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
        payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
      })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, payload.clinicId))
      .limit(1);

    if (!onlineBookingClinicSettings?.onlineBookingEnabled) {
      throw new HttpError(
        400,
        'Online booking is not enabled for this clinic.'
      );
    }

    const [doctorClinicAssignment] = await database
      .select({
        onlineBookingEnabled: ClinicAssignModel.onlineBookingEnabled,
        maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
      })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, payload.doctorId),
          eq(ClinicAssignModel.clinicId, payload.clinicId)
        )
      )
      .limit(1);

    if (!doctorClinicAssignment?.onlineBookingEnabled) {
      throw new HttpError(400, 'This doctor is not accepting online bookings.');
    }

    const maxAdvanceDate = new Date();
    maxAdvanceDate.setDate(
      maxAdvanceDate.getDate() + doctorClinicAssignment.maxAdvanceBookingDays
    );
    if (new Date(payload.appointmentDate) > maxAdvanceDate) {
      throw new HttpError(
        400,
        `This doctor only accepts online bookings up to ${doctorClinicAssignment.maxAdvanceBookingDays} day(s) in advance.`
      );
    }

    const isOnlinePayment = isOnlinePaymentMode(payload.paymentMode);
    const rawProvider = (
      payload.paymentGateway ||
      payload.paymentMode ||
      ''
    ).toLowerCase();
    const requestedProvider = ['razorpay', 'cashfree'].includes(rawProvider)
      ? rawProvider
      : undefined;

    if (isOnlinePayment && !onlineBookingClinicSettings.payOnlineEnabled) {
      throw new HttpError(
        400,
        'Online payment is not available for this clinic.'
      );
    }
    if (!isOnlinePayment && !onlineBookingClinicSettings.payAtClinicEnabled) {
      throw new HttpError(
        400,
        'Pay at clinic is not available; please pay online.'
      );
    }

    if (isOnlinePayment) {
      const price = parseFloat(payload.price || '0');
      if (price <= 0) {
        throw new HttpError(400, 'Invalid price specified for online payment');
      }

      const [clinic] = await database
        .select({ id: ClinicModel.id })
        .from(ClinicModel)
        .where(eq(ClinicModel.id, payload.clinicId))
        .limit(1);

      if (!clinic) {
        throw new HttpError(404, 'Clinic not found');
      }
    }

    // Validate slot/token availability first
    const validationResult =
      await AppointmentService.validateAppointmentBooking(
        userId,
        payload.clinicId,
        {
          patientId: payload.patientId,
          doctorId: payload.doctorId,
          clinicServiceId: payload.clinicServiceId,
          appointmentDate: payload.appointmentDate,
          appointmentTime: payload.appointmentTime,
          appointmentType: 'Consultation',
          appointmentNotes: payload.notes,
          paymentMode: payload.paymentMode,
          price: payload.price,
          sessionIndex: payload.sessionIndex,
        },
        userId
      );

    if (isOnlinePayment) {
      const tempBookingId = randomUUID();
      const ttlSeconds = envConfig.PAYMENT_LOCK_TTL_SECONDS || 600;
      const slotOrToken =
        validationResult.finalTokenNo || validationResult.finalAppointmentTime!;

      // 1. Lock slot in Redis
      let lockAcquired = false;
      try {
        lockAcquired = await PaymentReservationService.createLock(
          tempBookingId,
          payload.doctorId,
          validationResult.apptDateObj,
          slotOrToken,
          ttlSeconds,
          { duration: validationResult.duration, patientId: payload.patientId },
          validationResult.finalSessionIndex ?? null
        );
      } catch (redisErr) {
        logger.error('Failed to create Redis slot lock', redisErr);
        throw new HttpError(500, 'Failed to lock slot. Please try again.');
      }

      // 2. Create the checkout session via generic PaymentService & Split Engine
      // Refused before any Razorpay order exists, so a losing race costs the
      // patient a retry rather than a payment that has to be refunded.
      if (!lockAcquired) {
        throw new HttpError(
          409,
          'This slot was just taken by another patient. Please choose another.'
        );
      }

      // 2. Create the Razorpay order (split/route or regular)
      try {
        const checkoutSession = await PaymentService.createCheckoutSession({
          sourceType: 'APPOINTMENT',
          checkoutReferenceId: tempBookingId,
          clinicId: payload.clinicId,
          patientId: payload.patientId,
          basePrice: parseFloat(payload.price!),
          requestedProvider,
        });

        const order = checkoutSession.order;
        const dynamicSplits = checkoutSession.splitDetails;

        // 3. Save the temporary booking details to Redis
        const tempBookingKey = `temp_booking:${tempBookingId}`;
        const tempBookingData = {
          userId,
          payload: {
            patientId: payload.patientId,
            doctorId: payload.doctorId,
            clinicId: payload.clinicId,
            clinicServiceId: payload.clinicServiceId,
            appointmentDate: payload.appointmentDate,
            appointmentTime: payload.appointmentTime,
            appointmentType: 'Consultation',
            appointmentNotes: payload.notes,
            paymentMode: payload.paymentMode,
            price: payload.price,
            paymentNotes: payload.paymentNotes,
          },
          tokenNo: validationResult.finalTokenNo || null,
          sessionIndex: validationResult.finalSessionIndex ?? null,
          duration: validationResult.duration,
          deducedBookingSource: validationResult.deducedBookingSource,
          gatewayOrderId: order.gatewayOrderId,
          paymentProvider: checkoutSession.paymentProvider,
          splitDetails: {
            basePrice: dynamicSplits.breakdown.basePrice,
            totalCheckoutPrice: dynamicSplits.patientTotal,
            clinicShareAmount: dynamicSplits.clinicAmount,
            platformCommission: dynamicSplits.platformAmount,
            pgFee: dynamicSplits.gatewayAmount,
            gstAmount: dynamicSplits.taxAmount,
            platformFee: dynamicSplits.patientPricingSummary.platformFee,
            platformFeeGst: dynamicSplits.patientPricingSummary.platformFeeGst,
            pricingSummary: dynamicSplits.patientPricingSummary,
            snapshot: dynamicSplits.breakdown,
          },
        };
        await redisClient.setex(
          tempBookingKey,
          3600,
          JSON.stringify(tempBookingData)
        );

        return {
          appointment: {
            id: tempBookingId,
            appointmentDate: payload.appointmentDate,
            appointmentTime: validationResult.finalAppointmentTime || null,
            tokenNo: validationResult.finalTokenNo || null,
            doctorId: payload.doctorId,
            patientId: payload.patientId,
            clinicId: payload.clinicId,
          },
          requiresPayment: true,
          paymentDetails: {
            orderId: order.gatewayOrderId,
            amount: Math.round(order.amount * 100),
            currency: order.currency,
            keyId: envConfig.RAZORPAY_KEY_ID,
            paymentProvider: checkoutSession.paymentProvider,
            clientPayload: order.clientSecretOrSdkPayload,
            pricingSummary: dynamicSplits.patientPricingSummary,
          },
        };
      } catch (err: any) {
        // Release Redis lock key on order creation failure
        try {
          await PaymentReservationService.releaseLock(
            payload.doctorId,
            validationResult.apptDateObj,
            slotOrToken,
            validationResult.finalSessionIndex ?? null
          );
        } catch (redisErr) {
          logger.error(
            'Failed to delete Redis slot lock in Razorpay failure fallback',
            redisErr
          );
        }

        logger.error('Failed to initialize Razorpay payment', {
          error: err?.error,
          message: err?.message,
          statusCode: err?.statusCode,
        });

        const description =
          err?.error?.description ||
          err?.message ||
          (err?.statusCode
            ? `Razorpay returned HTTP ${err.statusCode}`
            : 'Unknown error');

        throw new HttpError(
          500,
          `Failed to initialize online payment: ${description}`
        );
      }
    }

    // For non-online payment (e.g. Cash, Pay Later), we create the database record immediately
    const appointment = await AppointmentService.createAppointment(
      userId,
      payload.clinicId,
      {
        patientId: payload.patientId,
        doctorId: payload.doctorId,
        clinicServiceId: payload.clinicServiceId,
        appointmentDate: payload.appointmentDate,
        appointmentTime: payload.appointmentTime,
        appointmentType: 'Consultation',
        appointmentNotes: payload.notes,
        paymentMode: normalizePaymentMode(payload.paymentMode),
        paymentStatus:
          payload.paymentStatus ??
          (isPayLaterMode(payload.paymentMode) ? 'Pending' : 'Paid'),
        price: payload.price,
        paymentNotes: payload.paymentNotes,
        sessionIndex: payload.sessionIndex,
      },
      userId
    );

    return {
      appointment,
      requiresPayment: false,
    };
  }

  static async confirmPaymentAndAppoint(
    appointmentId: string,
    paymentId: string,
    performedByUserId: string
  ) {
    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const tempBookingKey = `temp_booking:${appointmentId}`;

    // 1. Check if already processed and mapped
    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    if (mappedApptId) {
      return { success: true, message: 'Already paid' };
    }

    // 2. Retrieve temporary booking payload
    const tempBookingStr = await redisClient.get(tempBookingKey);
    let tempBooking: any = null;
    if (tempBookingStr) {
      try {
        tempBooking = JSON.parse(tempBookingStr);
      } catch (err) {
        logger.error('Failed to parse temporary booking payload', err);
      }
    }

    let _realAppointmentId = appointmentId;
    let appointment: any = null;

    if (tempBooking) {
      // Create the appointment in the database since payment succeeded
      try {
        appointment = await AppointmentService.createAppointment(
          tempBooking.userId,
          tempBooking.payload.clinicId,
          {
            ...tempBooking.payload,
            tokenNo: tempBooking.tokenNo || undefined,
            sessionIndex: tempBooking.sessionIndex ?? undefined,
            paymentStatus: 'Paid',
            paymentNotes: `Paid via Razorpay. Ref: ${paymentId}`,
          },
          tempBooking.userId
        );
        _realAppointmentId = appointment.id;

        // Update generic PaymentIntent and PaymentTransaction
        await PaymentService.markPaymentSucceeded(
          appointmentId,
          paymentId,
          appointment.id
        );

        // Save mapping in Redis (TTL: 1 hour) to handle duplicate calls/webhooks gracefully
        await redisClient.setex(tempBookingMappedKey, 3600, appointment.id);

        // Fetch payment record ID
        const [paymentRecord] = await database
          .select({
            id: AppointmentPaymentModel.id,
            price: AppointmentPaymentModel.price,
          })
          .from(AppointmentPaymentModel)
          .where(eq(AppointmentPaymentModel.appointmentId, appointment.id))
          .limit(1);

        // Update the payment record with Razorpay gatewayOrderId, transactionId, and split details
        const updateData: any = {
          gatewayOrderId: tempBooking.gatewayOrderId || null,
          transactionId: paymentId || null,
        };

        if (tempBooking.splitDetails) {
          if (tempBooking.splitDetails.totalCheckoutPrice) {
            updateData.price = String(
              tempBooking.splitDetails.totalCheckoutPrice
            );
          }
          updateData.platformCommission = String(
            tempBooking.splitDetails.platformCommission
          );
          updateData.pgFee = String(tempBooking.splitDetails.pgFee);
          updateData.gstAmount = String(tempBooking.splitDetails.gstAmount);
          updateData.convenienceFee = String(
            tempBooking.splitDetails.platformFee ??
              tempBooking.splitDetails.convenienceFee ??
              '0'
          );
          updateData.transferredAmount = String(
            tempBooking.splitDetails.clinicShareAmount
          );
          updateData.financialSnapshot = tempBooking.splitDetails.snapshot;
        }

        await database
          .update(AppointmentPaymentModel)
          .set(updateData)
          .where(eq(AppointmentPaymentModel.appointmentId, appointment.id));

        // Insert ledger entries
        if (paymentRecord) {
          const split = tempBooking.splitDetails;
          const priceVal =
            split && split.totalCheckoutPrice
              ? parseFloat(String(split.totalCheckoutPrice))
              : parseFloat(paymentRecord.price || '0');
          const commVal = split
            ? parseFloat(split.platformCommission || '0')
            : 0;
          const gstVal = split ? parseFloat(split.gstAmount || '0') : 0;
          const pgVal = split ? parseFloat(split.pgFee || '0') : 0;
          const convVal = split
            ? parseFloat(split.platformFee ?? split.convenienceFee ?? '0')
            : 0;
          const txVal = split ? parseFloat(split.clinicShareAmount || '0') : 0;

          const ledgerValues: any[] = [
            {
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'PAYMENT_RECEIVED',
              amount: String(priceVal),
              description: 'Patient payment captured',
              gatewayReferenceId: paymentId,
            },
          ];

          if (commVal > 0) {
            ledgerValues.push({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'PLATFORM_COMMISSION',
              amount: String(-commVal),
              description: 'Platform commission retained',
              gatewayReferenceId: paymentId,
            });
          }

          if (gstVal > 0) {
            ledgerValues.push({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'GST',
              amount: String(-gstVal),
              description: 'GST on platform commission',
              gatewayReferenceId: paymentId,
            });
          }

          if (pgVal > 0) {
            ledgerValues.push({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'PG_FEE',
              amount: String(-pgVal),
              description: 'Razorpay PG processing fee',
              gatewayReferenceId: paymentId,
            });
          }

          if (convVal > 0) {
            ledgerValues.push({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'CONVENIENCE_FEE',
              amount: String(convVal),
              description: 'PG convenience fee markup charged to patient',
              gatewayReferenceId: paymentId,
            });
          }

          if (txVal > 0) {
            ledgerValues.push({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              paymentId: paymentRecord.id,
              entryType: 'TRANSFER_CREATED',
              amount: String(-txVal),
              description: 'Routed split transfer to clinic sub-account',
              gatewayReferenceId: paymentId,
            });
          }

          await database.insert(FinancialLedgerModel).values(ledgerValues);
        }

        // Delete the temporary booking and lock keys
        await redisClient.del(tempBookingKey);
        try {
          const apptDateObj = new Date(tempBooking.payload.appointmentDate);
          const slotOrToken =
            tempBooking.tokenNo || tempBooking.payload.appointmentTime;
          if (slotOrToken) {
            await PaymentReservationService.releaseLock(
              tempBooking.payload.doctorId,
              apptDateObj,
              slotOrToken,
              tempBooking.sessionIndex ?? null
            );
          }
        } catch (redisErr) {
          logger.error('Failed to release Redis slot lock', redisErr);
        }
      } catch (err: any) {
        // If it is a conflict (e.g. 409 slot taken), insert as Cancelled and Paid
        if (err instanceof HttpError && err.status === 409) {
          try {
            appointment = await AppointmentService.createAppointment(
              tempBooking.userId,
              tempBooking.payload.clinicId,
              {
                ...tempBooking.payload,
                tokenNo: tempBooking.tokenNo || undefined,
                sessionIndex: tempBooking.sessionIndex ?? undefined,
                paymentStatus: 'Paid',
                paymentNotes: `Paid via Razorpay (Late Payment). Ref: ${paymentId}`,
                appointmentStatus: 'Cancelled',
              },
              tempBooking.userId
            );
            _realAppointmentId = appointment.id;

            // Save mapping in Redis (TTL: 1 hour)
            await redisClient.setex(tempBookingMappedKey, 3600, appointment.id);

            // Fetch payment record ID
            const [paymentRecord] = await database
              .select({
                id: AppointmentPaymentModel.id,
                price: AppointmentPaymentModel.price,
              })
              .from(AppointmentPaymentModel)
              .where(eq(AppointmentPaymentModel.appointmentId, appointment.id))
              .limit(1);

            // Update the payment record with Razorpay gatewayOrderId, refund marker and split details
            const updateData: any = {
              gatewayOrderId: tempBooking.gatewayOrderId || null,
              refundNotes: 'Refund Required: Slot occupied by another booking',
            };

            if (tempBooking.splitDetails) {
              if (tempBooking.splitDetails.totalCheckoutPrice) {
                updateData.price = String(
                  tempBooking.splitDetails.totalCheckoutPrice
                );
              }
              updateData.platformCommission = String(
                tempBooking.splitDetails.platformCommission
              );
              updateData.pgFee = String(tempBooking.splitDetails.pgFee);
              updateData.gstAmount = String(tempBooking.splitDetails.gstAmount);
              updateData.convenienceFee = String(
                tempBooking.splitDetails.platformFee ??
                  tempBooking.splitDetails.convenienceFee ??
                  '0'
              );
              updateData.transferredAmount = String(
                tempBooking.splitDetails.clinicShareAmount
              );
              updateData.financialSnapshot = tempBooking.splitDetails.snapshot;
            }

            await database
              .update(AppointmentPaymentModel)
              .set(updateData)
              .where(eq(AppointmentPaymentModel.appointmentId, appointment.id));

            // Insert ledger entries
            if (paymentRecord) {
              const split = tempBooking.splitDetails;
              const priceVal =
                split && split.totalCheckoutPrice
                  ? parseFloat(String(split.totalCheckoutPrice))
                  : parseFloat(paymentRecord.price || '0');
              const commVal = split
                ? parseFloat(split.platformCommission || '0')
                : 0;
              const gstVal = split ? parseFloat(split.gstAmount || '0') : 0;
              const pgVal = split ? parseFloat(split.pgFee || '0') : 0;
              const convVal = split
                ? parseFloat(split.platformFee ?? split.convenienceFee ?? '0')
                : 0;
              const txVal = split
                ? parseFloat(split.clinicShareAmount || '0')
                : 0;

              const ledgerValues: any[] = [
                {
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'PAYMENT_RECEIVED',
                  amount: String(priceVal),
                  description: 'Patient payment captured',
                  gatewayReferenceId: paymentId,
                },
              ];

              if (commVal > 0) {
                ledgerValues.push({
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'PLATFORM_COMMISSION',
                  amount: String(-commVal),
                  description: 'Platform commission retained',
                  gatewayReferenceId: paymentId,
                });
              }

              if (gstVal > 0) {
                ledgerValues.push({
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'GST',
                  amount: String(-gstVal),
                  description: 'GST on platform commission',
                  gatewayReferenceId: paymentId,
                });
              }

              if (pgVal > 0) {
                ledgerValues.push({
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'PG_FEE',
                  amount: String(-pgVal),
                  description: 'Razorpay PG processing fee',
                  gatewayReferenceId: paymentId,
                });
              }

              if (convVal > 0) {
                ledgerValues.push({
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'CONVENIENCE_FEE',
                  amount: String(convVal),
                  description: 'PG convenience fee markup charged to patient',
                  gatewayReferenceId: paymentId,
                });
              }

              if (txVal > 0) {
                ledgerValues.push({
                  appointmentId: appointment.id,
                  clinicId: appointment.clinicId,
                  paymentId: paymentRecord.id,
                  entryType: 'TRANSFER_CREATED',
                  amount: String(-txVal),
                  description: 'Routed split transfer to clinic sub-account',
                  gatewayReferenceId: paymentId,
                });
              }

              await database.insert(FinancialLedgerModel).values(ledgerValues);
            }

            // Log activity history for the late conflict
            await AppointmentActivityHistoryService.logActivity({
              appointmentId: appointment.id,
              action: 'PAYMENT_STATUS',
              performedBy: performedByUserId,
              newState: {
                id: appointment.id,
                paymentStatus: 'Paid',
                refundNotes: 'Refund Required',
                appointmentStatus: 'Cancelled',
              },
              remarks: `Payment received late. Slot was already occupied. Refund required (Ref: ${paymentId})`,
            });

            // Delete the temporary booking and lock keys
            await redisClient.del(tempBookingKey);
            try {
              const apptDateObj = new Date(tempBooking.payload.appointmentDate);
              const slotOrToken =
                tempBooking.tokenNo || tempBooking.payload.appointmentTime;
              if (slotOrToken) {
                await PaymentReservationService.releaseLock(
                  tempBooking.payload.doctorId,
                  apptDateObj,
                  slotOrToken,
                  tempBooking.sessionIndex ?? null
                );
              }
            } catch (redisErr) {
              logger.error('Failed to release Redis slot lock', redisErr);
            }

            // Trigger broadcast
            broadcastAppointmentChange({
              appointmentId: appointment.id,
              clinicId: appointment.clinicId,
              doctorId: appointment.doctorId || undefined,
              patientId: appointment.patientId,
              action: 'payment_updated',
              performerUserId: performedByUserId,
            });
          } catch (createErr) {
            logger.error(
              'Failed to create cancelled appointment for late conflict',
              createErr
            );
          }
        }
        throw err;
      }
    } else {
      // Legacy path: Check if the appointment ID exists in the database
      const [existingAppt] = await database
        .select({
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
          doctorId: AppointmentModel.doctorId,
          clinicId: AppointmentModel.clinicId,
          appointmentStatus: AppointmentModel.appointmentStatus,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(eq(AppointmentModel.id, appointmentId))
        .limit(1);

      if (!existingAppt) {
        throw new HttpError(
          404,
          'Appointment booking details not found (expired checkout)'
        );
      }

      if (existingAppt.paymentStatus === 'Paid') {
        return { success: true, message: 'Already paid' };
      }

      // Run legacy verifyLatePayment conflict checks
      try {
        await PaymentReservationService.verifyLatePayment(
          appointmentId,
          paymentId,
          performedByUserId
        );
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          try {
            await AppointmentActivityHistoryService.logActivity({
              appointmentId,
              action: 'PAYMENT_STATUS',
              performedBy: performedByUserId,
              newState: {
                id: appointmentId,
                paymentStatus: 'Paid',
                refundNotes: 'Refund Required',
              },
              remarks: `Payment received late. Slot was already occupied. Refund required (Ref: ${paymentId})`,
            });
          } catch (logErr) {
            logger.error(
              'Failed to log late payment conflict activity',
              logErr
            );
          }

          try {
            broadcastAppointmentChange({
              appointmentId,
              clinicId: existingAppt.clinicId,
              doctorId: existingAppt.doctorId || undefined,
              patientId: existingAppt.patientId,
              action: 'payment_updated',
              performerUserId: performedByUserId,
            });
          } catch (broadErr) {
            logger.error('Failed to broadcast late payment conflict', broadErr);
          }
        }
        throw err;
      }

      // Legacy success flow
      const [appt] = await database
        .select({
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
          doctorId: AppointmentModel.doctorId,
          clinicId: AppointmentModel.clinicId,
          price: AppointmentPaymentModel.price,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(eq(AppointmentModel.id, appointmentId))
        .limit(1);

      appointment = appt;
    }

    // Common notification and logging block for successful/valid appointments
    if (appointment && appointment.appointmentStatus !== 'Cancelled') {
      try {
        await AppointmentActivityHistoryService.logActivity({
          appointmentId: appointment.id,
          action: 'PAYMENT_STATUS',
          performedBy: performedByUserId,
          newState: { id: appointment.id, paymentStatus: 'Paid' },
          remarks: `Payment received for this appointment via online transfer (Ref: ${paymentId})`,
        });
      } catch (logErr) {
        logger.error('Failed to log payment activity', logErr);
      }

      try {
        broadcastAppointmentChange({
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          doctorId: appointment.doctorId || undefined,
          patientId: appointment.patientId,
          action: 'payment_updated',
          performerUserId: performedByUserId,
        });
      } catch (broadErr) {
        logger.error('Error broadcasting payment update', broadErr);
      }

      try {
        notifyPaymentReceived(
          appointment.id,
          appointment.patientId,
          appointment.price || '0',
          appointment.clinicId
        ).catch((notifyErr: any) => {
          logger.error(
            'Failed to send payment success notification',
            notifyErr
          );
        });
      } catch (notifyErr) {
        logger.error('Error sending payment success notification', notifyErr);
      }

      try {
        getUserById(performedByUserId)
          .then(async (performer) => {
            const patientInfo = await getUserById(appointment.patientId);
            if (performer && patientInfo) {
              await notifyAppointmentCreated(
                appointment.clinicId,
                appointment.id,
                performer.id,
                patientInfo.name,
                performer.name,
                performer.userType,
                appointment.doctorId || '',
                appointment.patientId
              );
            }
          })
          .catch((err) => {
            logger.error(
              'Failed to notify clinic staff about paid appointment',
              err
            );
          });
      } catch (err) {
        logger.error(
          'Error triggering clinic staff notification for paid appointment',
          err
        );
      }
    }

    return {
      success: true,
      appointment,
      appointmentId: appointment?.id || _realAppointmentId,
    };
  }

  static async handlePaymentFailure(
    appointmentId: string,
    paymentId: string | null,
    performedByUserId: string
  ) {
    const tempBookingKey = `temp_booking:${appointmentId}`;
    const tempBookingStr = await redisClient.get(tempBookingKey);

    if (tempBookingStr) {
      try {
        const tempBooking = JSON.parse(tempBookingStr);
        // Release Redis lock key
        const apptDateObj = new Date(tempBooking.payload.appointmentDate);
        const slotOrToken =
          tempBooking.tokenNo || tempBooking.payload.appointmentTime;
        if (slotOrToken) {
          await PaymentReservationService.releaseLock(
            tempBooking.payload.doctorId,
            apptDateObj,
            slotOrToken,
            tempBooking.sessionIndex ?? null
          );
        }
      } catch (err) {
        logger.error(
          'Failed to release lock or parse temporary booking in handlePaymentFailure',
          err
        );
      }
      // Delete temporary booking key
      await redisClient.del(tempBookingKey);
      return { success: true, message: 'Temporary checkout cancelled' };
    }

    // Legacy path: Fetch appointment details from database
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        appointmentStatus: AppointmentModel.appointmentStatus,
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
        appointmentDate: AppointmentModel.appointmentDate,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      // Return success for idempotency
      return {
        success: true,
        message: 'Appointment already cancelled or expired',
      };
    }

    if (appointment.appointmentStatus === 'Cancelled') {
      return { success: true, message: 'Already cancelled' };
    }

    // 2. Update Database records (both Appointment status to Cancelled and Payment status to Failed)
    await database.transaction(async (tx) => {
      await tx
        .update(AppointmentModel)
        .set({
          appointmentStatus: 'Cancelled',
          updatedAt: new Date(),
        })
        .where(eq(AppointmentModel.id, appointmentId));

      await tx
        .update(AppointmentPaymentModel)
        .set({
          paymentStatus: 'Failed',
          paymentNotes: paymentId
            ? `Payment failed via Razorpay. Payment ID: ${paymentId}`
            : 'Payment failed/cancelled via Razorpay',
          updatedAt: new Date(),
        })
        .where(eq(AppointmentPaymentModel.appointmentId, appointmentId));

      // Log CANCELLED activity
      await AppointmentActivityHistoryService.logActivity({
        appointmentId,
        action: 'CANCELLED',
        performedBy: performedByUserId,
        newState: { id: appointmentId, appointmentStatus: 'Cancelled' },
        remarks:
          'Payment failed/cancelled. Appointment automatically cancelled.',
        tx,
      });

      // Log PAYMENT_STATUS activity (Failed)
      await AppointmentActivityHistoryService.logActivity({
        appointmentId,
        action: 'PAYMENT_STATUS',
        performedBy: performedByUserId,
        newState: { id: appointmentId, paymentStatus: 'Failed' },
        remarks: `Payment failed for this appointment.`,
        tx,
      });
    });

    // Post-commit: the slot freed up and the payment failed, which the queue,
    // board and dashboards never heard about.
    signalAppointmentChange(appointment, 'appointment.cancelled');

    return { success: true };
  }

  /**
   * Verifies Razorpay payment signature and confirms patient appointment
   */
  static async verifyAppointmentPayment(
    userId: string,
    payload: VerifyAppointmentPaymentDto
  ) {
    const { appointmentId, orderId, paymentId, signature } = payload;

    let patientId: string | null = null;
    let appointmentExists = false;

    // Try to resolve the mapped appointment ID (if webhook has already run)
    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    const resolvedId = mappedApptId || appointmentId;

    if (mappedApptId) {
      const [dbAppt] = await database
        .select({
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
        })
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, mappedApptId))
        .limit(1);

      if (dbAppt) {
        patientId = dbAppt.patientId;
        appointmentExists = true;
      }
    }

    // If not mapped, check if there is a temporary booking in Redis
    if (!appointmentExists) {
      const tempBookingKey = `temp_booking:${appointmentId}`;
      const tempBookingStr = await redisClient.get(tempBookingKey);
      if (tempBookingStr) {
        try {
          const tempBooking = JSON.parse(tempBookingStr);
          if (tempBooking && tempBooking.payload) {
            patientId = tempBooking.payload.patientId;
            appointmentExists = true;
          }
        } catch (err) {
          logger.error(
            'Failed to parse temporary booking payload in verifyAppointmentPayment',
            err
          );
        }
      }
    }

    // Fallback: Query the database directly (legacy flow / already saved)
    if (!appointmentExists) {
      const [dbAppt] = await database
        .select({
          id: AppointmentModel.id,
          patientId: AppointmentModel.patientId,
        })
        .from(AppointmentModel)
        .where(eq(AppointmentModel.id, resolvedId))
        .limit(1);

      if (dbAppt) {
        patientId = dbAppt.patientId;
        appointmentExists = true;
      }
    }

    if (!appointmentExists || !patientId) {
      throw new HttpError(404, 'Appointment not found');
    }

    // 2. Check ownership (belongs to userId or family member)
    if (patientId !== userId) {
      const [link] = await database
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, userId),
            eq(PatientFamilyLinksModel.linkedPatientId, patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(
          403,
          'Access denied. You can only verify payments for yourself or linked family members.'
        );
      }
    }

    // 3. Verify Razorpay Signature
    const isValid = verifyRazorpayPayment(orderId, paymentId, signature);
    if (!isValid) {
      throw new HttpError(400, 'Invalid payment signature');
    }

    // 4. Confirm Payment and Appointment
    const confirmResult = await PatientService.confirmPaymentAndAppoint(
      appointmentId,
      paymentId,
      userId
    );

    return {
      success: true,
      message: 'Payment verified and appointment confirmed successfully',
      data: {
        appointmentId: confirmResult?.appointmentId || appointmentId,
        appointment: confirmResult?.appointment,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 14. LIST PATIENT APPOINTMENTS
  // ─────────────────────────────────────────────────────────────────────────
  static async listPatientAppointments(
    userId: string,
    patientId: string | null,
    query: PatientAppointmentsQueryDto
  ) {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const familyMemberIds = familyMembers.map((m) => m.linkedPatientId);
    const allAuthorizedPatientIds = [userId, ...familyMemberIds];

    let filterPatientIds = allAuthorizedPatientIds;

    if (patientId) {
      if (!allAuthorizedPatientIds.includes(patientId)) {
        throw new HttpError(
          403,
          'Access denied. You can only view appointments for yourself or linked family members.'
        );
      }
      filterPatientIds = [patientId];
    }

    const filters = [
      inArray(AppointmentModel.patientId, filterPatientIds),
      buildActiveAppointmentFilter(),
    ];
    if (query.appointmentStatus && query.appointmentStatus.length > 0) {
      filters.push(
        inArray(AppointmentModel.appointmentStatus, query.appointmentStatus)
      );
    }

    if (query.startDate) {
      const start = new Date(`${query.startDate}T00:00:00.000Z`);
      filters.push(gte(AppointmentModel.appointmentDate, start));
    }
    if (query.endDate) {
      const end = new Date(`${query.endDate}T23:59:59.999Z`);
      filters.push(lte(AppointmentModel.appointmentDate, end));
    }

    if (query.upcomingOnly) {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/'); // [dd, mm, yyyy]
      const istTodayYMD = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      filters.push(
        sql`CAST(${AppointmentModel.appointmentDate} AS date) >= CAST(${istTodayYMD} AS date)`
      );
    }

    if (query.pastOnly) {
      const now = new Date();
      const istDateParts = now
        .toLocaleDateString('en-GB', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .split('/'); // [dd, mm, yyyy]
      const istTodayYMD = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

      filters.push(
        sql`CAST(${AppointmentModel.appointmentDate} AS date) < CAST(${istTodayYMD} AS date)`
      );
    }

    const sortOrder = query.sortOrder || 'desc';
    const sortBy = query.sortBy || 'appointmentDate';
    const orderClauses = [];

    if (sortBy === 'createdAt') {
      orderClauses.push(
        sortOrder === 'asc'
          ? asc(AppointmentModel.createdAt)
          : desc(AppointmentModel.createdAt)
      );
    } else {
      orderClauses.push(
        sortOrder === 'asc'
          ? asc(AppointmentModel.appointmentDate)
          : desc(AppointmentModel.appointmentDate)
      );
      orderClauses.push(
        sortOrder === 'asc'
          ? asc(AppointmentModel.appointmentTime)
          : desc(AppointmentModel.appointmentTime)
      );
    }

    const appointmentsList = await database
      .select({
        id: AppointmentModel.id,
        appointmentType: AppointmentModel.appointmentType,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        dayStartTime: ClinicAvailability.startTime,
        dayEndTime: ClinicAvailability.endTime,
        tokenNo: AppointmentModel.tokenNo,
        appointmentStatus: AppointmentModel.appointmentStatus,
        createdAt: AppointmentModel.createdAt,
        patient: {
          id: UserModel.id,
          name: UserModel.name,
          mobile: UserModel.mobile,
          profileImage: UserProfileModel.profileImage,
          relationship: sql<string>`COALESCE(${PatientFamilyLinksModel.relationship}, 'self')`,
        },
        doctor: {
          id: sql<string>`doctor_user.id`,
          name: sql<string>`doctor_user.name`,
          speciality: sql<
            string | null
          >`(SELECT speciality FROM user_professionals WHERE user_id = doctor_user.id LIMIT 1)`,
          profileImage: sql<
            string | null
          >`(SELECT profile_image FROM user_profiles WHERE user_id = doctor_user.id LIMIT 1)`,
        },
        clinic: {
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
        },
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.patientId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        PatientFamilyLinksModel,
        and(
          eq(
            PatientFamilyLinksModel.linkedPatientId,
            AppointmentModel.patientId
          ),
          eq(PatientFamilyLinksModel.primaryPatientId, userId)
        )
      )
      .innerJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .innerJoin(
        sql`${UserModel} as doctor_user`,
        eq(sql`doctor_user.id`, AppointmentModel.doctorId)
      )
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        ClinicAvailability,
        and(
          eq(ClinicAvailability.clinicId, AppointmentModel.clinicId),
          eq(ClinicAvailability.doctorId, AppointmentModel.doctorId),
          sql`trim(both from lower(${ClinicAvailability.dayOfWeek})) = trim(both from lower(to_char(${AppointmentModel.appointmentDate}, 'Day')))`
        )
      )
      .where(and(...filters))
      .orderBy(...orderClauses)
      .limit(limit)
      .offset(offset);

    const [totalCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(AppointmentModel)
      .leftJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .where(and(...filters));

    const totalRecords = Number(totalCount?.count || 0);
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      data: appointmentsList,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 15. GET PATIENT APPOINTMENT DETAIL
  // ─────────────────────────────────────────────────────────────────────────
  static async getPatientAppointmentDetail(
    userId: string,
    appointmentId: string
  ): Promise<any> {
    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const tempBookingKey = `temp_booking:${appointmentId}`;

    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    const resolvedId = mappedApptId || appointmentId;

    // 1️⃣ Fetch core appointment details to check existence and owner
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, resolvedId))
      .limit(1);

    if (appointment) {
      // 2️⃣ Check ownership (self or linked family member)
      if (appointment.patientId !== userId) {
        const [link] = await database
          .select({ id: PatientFamilyLinksModel.id })
          .from(PatientFamilyLinksModel)
          .where(
            and(
              eq(PatientFamilyLinksModel.primaryPatientId, userId),
              eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
            )
          )
          .limit(1);

        if (!link) {
          throw new HttpError(
            403,
            'Access denied. You can only view details of your own or linked family member appointments.'
          );
        }
      }

      // 3️⃣ Call AppointmentService.getAppointment by passing an authorized user block to bypass role check
      const requestingUser = {
        id: userId,
        userType: 'Admin', // Use Admin role to bypass doctor/receptionist ownership checks
        clinicId: appointment.clinicId,
      };

      const details = await AppointmentService.getAppointment(
        resolvedId,
        requestingUser
      );

      if (!details) {
        throw new HttpError(404, 'Appointment details not found.');
      }

      // 4️⃣ Fetch clinic and its booking/payment settings
      const [clinicInfo] = appointment.clinicId
        ? await database
            .select({
              id: ClinicModel.id,
              clinicName: ClinicModel.clinicName,
              clinicAddress: ClinicModel.clinicAddress,
              clinicLocation: ClinicModel.clinicLocation,
              clinicPhone: ClinicModel.clinicPhone,
              clinicLogo: ClinicModel.clinicLogo,
              latitude: ClinicModel.latitude,
              longitude: ClinicModel.longitude,
              onlineBookingEnabledAssign:
                ClinicAssignModel.onlineBookingEnabled,
              onlineBookingEnabledSettings:
                ClinicSettingsModel.onlineBookingEnabled,
              maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
              payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
              payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
              showClinicNumber: ClinicSettingsModel.showClinicNumberPublicly,
            })
            .from(ClinicModel)
            .leftJoin(
              ClinicSettingsModel,
              eq(ClinicSettingsModel.clinicId, ClinicModel.id)
            )
            .leftJoin(
              ClinicAssignModel,
              and(
                eq(ClinicAssignModel.clinicId, ClinicModel.id),
                eq(ClinicAssignModel.userId, appointment.doctorId ?? '')
              )
            )
            .where(eq(ClinicModel.id, appointment.clinicId))
            .limit(1)
        : [null];

      const clinic = clinicInfo
        ? {
            id: clinicInfo.id,
            clinicName: clinicInfo.clinicName,
            clinicAddress: clinicInfo.clinicAddress,
            clinicLocation: clinicInfo.clinicLocation,
            clinicPhone: clinicInfo.clinicPhone,
            clinicLogo: clinicInfo.clinicLogo,
            latitude: clinicInfo.latitude ?? null,
            longitude: clinicInfo.longitude ?? null,
            onlineBookingEnabled:
              clinicInfo.onlineBookingEnabledAssign === true &&
              clinicInfo.onlineBookingEnabledSettings === true,
            maxAdvanceBookingDays: clinicInfo.maxAdvanceBookingDays ?? 7,
            payOnlineEnabled: clinicInfo.payOnlineEnabled === true,
            payAtClinicEnabled: clinicInfo.payAtClinicEnabled === true,
            showClinicNumber: clinicInfo.showClinicNumber !== false,
          }
        : null;

      // 4b Fetch associated lab reports for this appointment
      const labReportsList = await database
        .select({
          id: LabOrderModel.id,
          uniqueTestId: LabOrderModel.uniqueTestId,
          reportStatus: LabOrderModel.reportStatus,
          paymentStatus: LabOrderModel.paymentStatus,
          price: LabOrderModel.price,
          reportPdf: LabOrderModel.reportPdf,
          workflowStatus: LabOrderModel.workflowStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          createdAt: LabOrderModel.createdAt,
          updatedAt: LabOrderModel.updatedAt,
          test: {
            id: TestCatalogModel.id,
            name: TestCatalogModel.name,
            category: TestCatalogModel.category,
          },
        })
        .from(LabOrderModel)
        .innerJoin(
          TestCatalogModel,
          eq(TestCatalogModel.id, LabOrderModel.testId)
        )
        .where(eq(LabOrderModel.appointmentId, resolvedId))
        .orderBy(desc(LabOrderModel.createdAt));

      // Fetch completed/verified results and values for these lab orders
      const appointmentTestIds = labReportsList.map((r) => r.id);
      let results: any[] = [];
      let resultValues: any[] = [];

      if (appointmentTestIds.length > 0) {
        results = await database
          .select({
            id: LabOrderResultsModel.id,
            appointmentTestId: LabOrderResultsModel.appointmentTestId,
            status: LabOrderResultsModel.status,
            remarks: LabOrderResultsModel.remarks,
            verifiedAt: LabOrderResultsModel.verifiedAt,
            createdAt: LabOrderResultsModel.createdAt,
          })
          .from(LabOrderResultsModel)
          .where(
            and(
              inArray(
                LabOrderResultsModel.appointmentTestId,
                appointmentTestIds
              ),
              inArray(LabOrderResultsModel.status, ['Completed', 'Verified'])
            )
          );

        const resultIds = Array.isArray(results)
          ? results.map((res) => res.id)
          : [];
        if (resultIds.length > 0) {
          resultValues = await database
            .select({
              id: LabOrderResultValuesModel.id,
              resultId: LabOrderResultValuesModel.resultId,
              parameterId: LabOrderResultValuesModel.parameterId,
              parameterName: sql<string>`COALESCE(${LabOrderResultValuesModel.displayNameSnapshot}, ${LabOrderResultValuesModel.parameterNameSnapshot})`,
              value: LabOrderResultValuesModel.value,
              unit: LabOrderResultValuesModel.unitSnapshot,
              referenceRange: LabOrderResultValuesModel.referenceRangeSnapshot,
              flag: LabOrderResultValuesModel.flag,
            })
            .from(LabOrderResultValuesModel)
            .where(inArray(LabOrderResultValuesModel.resultId, resultIds))
            .orderBy(
              asc(LabOrderResultValuesModel.sortOrderSnapshot),
              asc(LabOrderResultValuesModel.parameterNameSnapshot)
            );
        }
      }

      // Map results and values to lab orders
      const mappedReports = Array.isArray(labReportsList)
        ? labReportsList.map((report) => {
            const result = Array.isArray(results)
              ? results.find((res) => res.appointmentTestId === report.id)
              : null;
            let mappedResult = null;

            if (result) {
              const values = Array.isArray(resultValues)
                ? resultValues.filter((val) => val.resultId === result.id)
                : [];
              mappedResult = {
                id: result.id,
                status: result.status,
                remarks: result.remarks,
                verifiedAt: result.verifiedAt,
                createdAt: result.createdAt,
                values: values.map((v) => ({
                  id: v.id,
                  parameterId: v.parameterId,
                  parameterName: v.parameterName,
                  value: v.value,
                  unit: v.unit,
                  referenceRange: v.referenceRange,
                  flag: v.flag,
                })),
              };
            }

            return {
              ...report,
              result: mappedResult,
            };
          })
        : [];

      // Fetch primary user info if this patient is linked as a family member
      const [primaryLink] = await database
        .select({
          id: UserModel.id,
          name: UserModel.name,
        })
        .from(PatientFamilyLinksModel)
        .leftJoin(
          UserModel,
          eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
        )
        .where(
          eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
        )
        .limit(1);

      const primaryPatient = primaryLink
        ? {
            id: primaryLink.id,
            name: primaryLink.name,
          }
        : null;

      return {
        ...details,
        clinic,
        labReports: mappedReports,
        primaryPatient,
      };
    }

    // 5️⃣ Check if this is a temporary booking in Redis
    const tempBookingStr = await redisClient.get(tempBookingKey);
    if (!tempBookingStr) {
      throw new HttpError(404, 'Appointment not found.');
    }

    let tempBooking: any = null;
    try {
      tempBooking = JSON.parse(tempBookingStr);
    } catch (err) {
      logger.error('Failed to parse temporary booking payload', err);
      throw new HttpError(500, 'Invalid temporary booking payload');
    }

    if (!tempBooking || !tempBooking.payload) {
      throw new HttpError(404, 'Appointment not found.');
    }

    // Check ownership of temporary booking
    const patientId = tempBooking.payload.patientId;
    if (patientId !== userId) {
      const [link] = await database
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, userId),
            eq(PatientFamilyLinksModel.linkedPatientId, patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(
          403,
          'Access denied. You can only view details of your own or linked family member appointments.'
        );
      }
    }

    // Fetch patient profile details
    const [patientInfo] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
        mobile: UserModel.mobile,
        gender: UserProfileModel.gender,
        age: UserProfileModel.age,
        dob: UserProfileModel.dob,
        alternateMobile: UserProfileModel.alternateMobile,
        address: UserProfileModel.address,
        city: UserProfileModel.city,
        state: UserProfileModel.state,
        zipCode: UserProfileModel.zipCode,
        profileImage: UserProfileModel.profileImage,
        status: UserModel.userStatus,
        updatedAt: UserModel.updatedAt,
        createdAt: UserModel.createdAt,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, patientId))
      .limit(1);

    if (!patientInfo) {
      throw new HttpError(404, 'Patient profile not found.');
    }

    // Fetch doctor details
    const [doctorInfo] = tempBooking.payload.doctorId
      ? await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            mobile: UserModel.mobile,
            speciality: sql<string>`(SELECT speciality FROM user_professionals WHERE user_id = ${UserModel.id} LIMIT 1)`,
            profileImage: sql<string>`(SELECT profile_image FROM user_profiles WHERE user_id = ${UserModel.id} LIMIT 1)`,
          })
          .from(UserModel)
          .where(eq(UserModel.id, tempBooking.payload.doctorId))
          .limit(1)
      : [null];

    // Fetch clinic details
    const [clinicInfo] = tempBooking.payload.clinicId
      ? await database
          .select({
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
            clinicAddress: ClinicModel.clinicAddress,
            clinicLocation: ClinicModel.clinicLocation,
            clinicPhone: ClinicModel.clinicPhone,
            clinicLogo: ClinicModel.clinicLogo,
            latitude: ClinicModel.latitude,
            longitude: ClinicModel.longitude,
            onlineBookingEnabledAssign: ClinicAssignModel.onlineBookingEnabled,
            onlineBookingEnabledSettings:
              ClinicSettingsModel.onlineBookingEnabled,
            maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
            payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
            payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
            showClinicNumber: ClinicSettingsModel.showClinicNumberPublicly,
          })
          .from(ClinicModel)
          .leftJoin(
            ClinicSettingsModel,
            eq(ClinicSettingsModel.clinicId, ClinicModel.id)
          )
          .leftJoin(
            ClinicAssignModel,
            and(
              eq(ClinicAssignModel.clinicId, ClinicModel.id),
              eq(ClinicAssignModel.userId, tempBooking.payload.doctorId ?? '')
            )
          )
          .where(eq(ClinicModel.id, tempBooking.payload.clinicId))
          .limit(1)
      : [null];

    const clinic = clinicInfo
      ? {
          id: clinicInfo.id,
          clinicName: clinicInfo.clinicName,
          clinicAddress: clinicInfo.clinicAddress,
          clinicLocation: clinicInfo.clinicLocation,
          clinicPhone: clinicInfo.clinicPhone,
          clinicLogo: clinicInfo.clinicLogo,
          latitude: clinicInfo.latitude ?? null,
          longitude: clinicInfo.longitude ?? null,
          onlineBookingEnabled:
            clinicInfo.onlineBookingEnabledAssign === true &&
            clinicInfo.onlineBookingEnabledSettings === true,
          maxAdvanceBookingDays: clinicInfo.maxAdvanceBookingDays ?? 7,
          payOnlineEnabled: clinicInfo.payOnlineEnabled === true,
          payAtClinicEnabled: clinicInfo.payAtClinicEnabled === true,
          showClinicNumber: clinicInfo.showClinicNumber !== false,
        }
      : null;

    // Fetch primary user info if this patient is linked as a family member
    const [primaryLink] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
      })
      .from(PatientFamilyLinksModel)
      .innerJoin(
        UserModel,
        eq(UserModel.id, PatientFamilyLinksModel.primaryPatientId)
      )
      .where(eq(PatientFamilyLinksModel.linkedPatientId, patientId))
      .limit(1);

    const primaryPatient = primaryLink
      ? {
          id: primaryLink.id,
          name: primaryLink.name,
        }
      : null;

    return {
      ...patientInfo,
      appointment: {
        id: appointmentId,
        doctorId: tempBooking.payload.doctorId,
        clinicId: tempBooking.payload.clinicId,
        appointmentDate: tempBooking.payload.appointmentDate,
        appointmentTime: tempBooking.payload.appointmentTime,
        appointmentType: 'Consultation',
        appointmentNotes: tempBooking.payload.appointmentNotes,
        appointmentStatus: 'Pending',
        reReasonForCancellation: null,
        reasionForReSchedule: null,
        tokenNo: tempBooking.tokenNo,
        clinicServiceId: tempBooking.payload.clinicServiceId,
        vitals: null,
        referrals: null,
        paymentMode: tempBooking.payload.paymentMode,
        paymentStatus: 'Pending',
        price: tempBooking.splitDetails?.totalCheckoutPrice
          ? String(tempBooking.splitDetails.totalCheckoutPrice)
          : tempBooking.payload.price,
        primaryServicePrice: tempBooking.payload.price,
        platformFee: tempBooking.splitDetails?.platformFee
          ? String(tempBooking.splitDetails.platformFee)
          : null,
        platformFeeGst: tempBooking.splitDetails?.platformFeeGst
          ? String(tempBooking.splitDetails.platformFeeGst)
          : null,
        convenienceFee: tempBooking.splitDetails?.platformFee
          ? String(tempBooking.splitDetails.platformFee)
          : null,
        gstAmount: tempBooking.splitDetails?.gstAmount
          ? String(tempBooking.splitDetails.gstAmount)
          : null,
        paymentNotes: tempBooking.payload.paymentNotes,
        refundMode: null,
        refundedAmount: null,
        refundNotes: null,
        transactionId: null,
        gatewayOrderId: tempBooking.gatewayOrderId,
        gatewayResponse: null,
        consentNotes: null,
        consentFile: null,
        commonSymptoms: null,
        clinicSymptomIds: null,
        bookingSource: tempBooking.deducedBookingSource || 'Mobile',
      },
      doctor: doctorInfo
        ? {
            id: doctorInfo.id,
            name: doctorInfo.name,
            email: doctorInfo.email,
            mobile: doctorInfo.mobile,
            speciality: doctorInfo.speciality,
            profileImage: doctorInfo.profileImage,
          }
        : null,
      clinic,
      primaryPatient,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 15b. GET PATIENT APPOINTMENT INVOICE DATA FOR CLIENT-SIDE GENERATION
  // ─────────────────────────────────────────────────────────────────────────
  static async getPatientAppointmentInvoiceData(appointmentId: string) {
    const DoctorUser = alias(UserModel, 'doctor_user');
    const PatientUser = alias(UserModel, 'patient_user');

    // Resolve the mapped appointment ID (if temporary checkout was used)
    const tempBookingMappedKey = `temp_booking_mapped:${appointmentId}`;
    const mappedApptId = await redisClient.get(tempBookingMappedKey);
    const resolvedId = mappedApptId || appointmentId;

    const [record] = await database
      .select({
        appointment: {
          id: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
          appointmentType: AppointmentModel.appointmentType,
          tokenNo: AppointmentModel.tokenNo,
        },
        service: {
          id: ClinicServiceModel.id,
          serviceName: ClinicServiceModel.serviceName,
          price: ClinicServiceModel.price,
          currency: ClinicServiceModel.currency,
        },
        payment: {
          id: AppointmentPaymentModel.id,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          price: AppointmentPaymentModel.price,
          primaryServicePrice: AppointmentPaymentModel.primaryServicePrice,
          convenienceFee: AppointmentPaymentModel.convenienceFee,
          gstAmount: AppointmentPaymentModel.gstAmount,
          platformCommission: AppointmentPaymentModel.platformCommission,
          pgFee: AppointmentPaymentModel.pgFee,
          transactionId: AppointmentPaymentModel.transactionId,
          createdAt: AppointmentPaymentModel.createdAt,
        },
        clinic: {
          clinicName: ClinicModel.clinicName,
          Tagline: ClinicModel.Tagline,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          City: ClinicModel.City,
          State: ClinicModel.State,
          ZipCode: ClinicModel.ZipCode,
          clinicLogo: ClinicModel.clinicLogo,
        },
        patient: {
          name: PatientUser.name,
          mobile: PatientUser.mobile,
        },
        patientProfile: {
          gender: UserProfileModel.gender,
          age: UserProfileModel.age,
        },
        doctor: {
          name: DoctorUser.name,
        },
        doctorProfessional: {
          speciality: UserProfessionalModel.speciality,
          licenseNumber: UserProfessionalModel.licenseNumber,
        },
      })
      .from(AppointmentModel)
      .innerJoin(PatientUser, eq(PatientUser.id, AppointmentModel.patientId))
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, PatientUser.id))
      .innerJoin(DoctorUser, eq(DoctorUser.id, AppointmentModel.doctorId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, DoctorUser.id)
      )
      .innerJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .innerJoin(
        AppointmentPaymentModel,
        eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        ClinicServiceModel,
        eq(ClinicServiceModel.id, AppointmentModel.clinicServiceId)
      )
      .where(eq(AppointmentModel.id, resolvedId))
      .limit(1);

    if (!record) {
      throw new HttpError(404, 'Appointment billing details not found.');
    }

    if (record.payment.paymentStatus !== 'Paid') {
      throw new HttpError(
        400,
        'Invoice data is only available for paid appointments.'
      );
    }

    // Format invoice number and billing calculations
    const paymentDate = record.payment.createdAt;
    const year = paymentDate
      ? new Date(paymentDate).getFullYear()
      : new Date().getFullYear();
    const shortId = record.payment.id
      ? record.payment.id.replace(/-/g, '').substring(0, 6).toUpperCase()
      : '000000';
    const invoiceNumber = `INV-${year}-${shortId}`;

    const consultationFee = Number(
      record.payment.primaryServicePrice || record.payment.price || 0
    );
    const convenienceFee = Number(record.payment.convenienceFee || 0);
    const convenienceFeeGst = Number(record.payment.gstAmount || 0);
    const priceNum = Number(record.payment.price || 0);

    const calculatedTotal =
      priceNum > consultationFee
        ? priceNum
        : Number(
            (consultationFee + convenienceFee + convenienceFeeGst).toFixed(2)
          );

    const serviceBasePrice = record.service?.price
      ? Number(record.service.price)
      : consultationFee;
    const discountNum =
      serviceBasePrice > consultationFee
        ? serviceBasePrice - consultationFee
        : 0;

    return {
      invoiceNumber,
      paymentDate: record.payment.createdAt,
      paymentMethod: record.payment.paymentMode,
      transactionId: record.payment.transactionId,
      clinic: {
        name: record.clinic.clinicName,
        tagline: record.clinic.Tagline || null,
        address: record.clinic.clinicAddress || null,
        clinicLocation: record.clinic.clinicLocation || null,
        phone: record.clinic.clinicPhone || null,
        city: record.clinic.City || null,
        state: record.clinic.State || null,
        zipCode: record.clinic.ZipCode || null,
        logo: record.clinic.clinicLogo || null,
      },
      patient: {
        name: record.patient.name,
        mobile: record.patient.mobile,
        gender: record.patientProfile?.gender || null,
        age: record.patientProfile?.age || null,
      },
      doctor: {
        name: record.doctor.name,
        speciality: record.doctorProfessional?.speciality || null,
        licenseNumber: record.doctorProfessional?.licenseNumber || null,
      },
      appointment: {
        id: record.appointment.id,
        date: record.appointment.appointmentDate,
        time: record.appointment.appointmentTime,
        type: record.appointment.appointmentType,
        tokenNo: record.appointment.tokenNo,
        service: record.service?.id
          ? {
              id: record.service.id,
              name: record.service.serviceName,
              price: record.service.price ? Number(record.service.price) : null,
              currency: record.service.currency || 'INR',
            }
          : null,
      },
      billing: {
        currency: 'INR',
        consultationFee,
        platformFee: convenienceFee,
        platformFeeGst: convenienceFeeGst,
        subtotal: consultationFee,
        discount: discountNum,
        tax: convenienceFeeGst,
        totalAmount: calculatedTotal,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 16. GET ASSOCIATED DOCTORS (ANY STATUS) FOR PRIMARY OR FAMILY MEMBERS
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * GET /api/v1/patient/associated-doctors
   * Returns a distinct list of doctors who have appointments with the patient or linked family members.
   */
  static async getAssociatedDoctors(userId: string) {
    // 1. Fetch linked family members
    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const allAuthorizedPatientIds = [
      userId,
      ...familyMembers.map((m) => m.linkedPatientId),
    ];

    // 2. Query distinct doctors who have appointments with these patients
    const doctorsList = await database
      .selectDistinct({
        id: UserModel.id,
        name: UserModel.name,
        speciality: UserProfessionalModel.speciality,
        qualification: UserProfessionalModel.qualification,
        profileImage: UserProfileModel.profileImage,
        clinic: {
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          clinicLogo: ClinicModel.clinicLogo,
          onlineBookingEnabledAssign: ClinicAssignModel.onlineBookingEnabled,
          onlineBookingEnabledSettings:
            ClinicSettingsModel.onlineBookingEnabled,
          maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
          payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
          payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
          showClinicNumber: ClinicSettingsModel.showClinicNumberPublicly,
        },
      })
      .from(AppointmentModel)
      .innerJoin(UserModel, eq(UserModel.id, AppointmentModel.doctorId))
      .innerJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        ClinicAssignModel,
        and(
          eq(ClinicAssignModel.userId, UserModel.id),
          eq(ClinicAssignModel.clinicId, ClinicModel.id)
        )
      )
      .leftJoin(
        ClinicSettingsModel,
        eq(ClinicSettingsModel.clinicId, ClinicModel.id)
      )
      .where(
        and(
          inArray(AppointmentModel.patientId, allAuthorizedPatientIds),
          isNotNull(AppointmentModel.doctorId)
        )
      );

    return doctorsList.map((item: any) => {
      const mappedClinic = {
        ...item.clinic,
        onlineBookingEnabled:
          item.clinic.onlineBookingEnabledAssign === true &&
          item.clinic.onlineBookingEnabledSettings === true,
        maxAdvanceBookingDays: item.clinic.maxAdvanceBookingDays ?? 7,
        payOnlineEnabled: item.clinic.payOnlineEnabled === true,
        payAtClinicEnabled: item.clinic.payAtClinicEnabled === true,
        showClinicNumber: item.clinic.showClinicNumber !== false,
      };
      delete mappedClinic.onlineBookingEnabledAssign;
      delete mappedClinic.onlineBookingEnabledSettings;

      return {
        ...item,
        clinic: mappedClinic,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 17. GET PATIENT LAB REPORTS (WITH RESULT VALUES AND PDF/IMAGE)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * GET /api/v1/patient/lab-reports
   * Returns a paginated list of lab test reports for the primary patient & linked family members.
   */
  static async getPatientLabReports(
    userId: string,
    query: PatientLabReportsQueryDto
  ) {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    // 1. Fetch linked family members to check authorized patient IDs
    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const familyMemberIds = familyMembers.map((m) => m.linkedPatientId);
    const allAuthorizedPatientIds = [userId, ...familyMemberIds];

    let filterPatientIds = allAuthorizedPatientIds;

    if (query.patientId) {
      if (!allAuthorizedPatientIds.includes(query.patientId)) {
        throw new HttpError(
          403,
          'Access denied. You can only view lab reports for yourself or linked family members.'
        );
      }
      filterPatientIds = [query.patientId];
    }

    // 2. Build filters
    const filters = [inArray(LabOrderModel.patientId, filterPatientIds)];
    if (query.status) {
      filters.push(eq(LabOrderModel.reportStatus, query.status));
    }

    const patientUser = alias(UserModel, 'report_patient_user');
    const doctorUser = alias(UserModel, 'report_doctor_user');

    // 3. Query paginated test orders
    const labReportsList = await database
      .select({
        id: LabOrderModel.id,
        uniqueTestId: LabOrderModel.uniqueTestId,
        reportStatus: LabOrderModel.reportStatus,
        paymentStatus: LabOrderModel.paymentStatus,
        price: LabOrderModel.price,
        reportPdf: LabOrderModel.reportPdf,
        workflowStatus: LabOrderModel.workflowStatus,
        sampleStatus: LabOrderModel.sampleStatus,
        createdAt: LabOrderModel.createdAt,
        updatedAt: LabOrderModel.updatedAt,
        test: {
          id: TestCatalogModel.id,
          name: TestCatalogModel.name,
          category: TestCatalogModel.category,
        },
        appointment: {
          id: AppointmentModel.id,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
        },
        doctor: {
          id: doctorUser.id,
          name: doctorUser.name,
        },
        clinic: {
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
        },
        patient: {
          id: patientUser.id,
          name: patientUser.name,
        },
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(TestCatalogModel.id, LabOrderModel.testId)
      )
      .innerJoin(
        AppointmentModel,
        eq(AppointmentModel.id, LabOrderModel.appointmentId)
      )
      .innerJoin(ClinicModel, eq(ClinicModel.id, LabOrderModel.clinicId))
      .leftJoin(patientUser, eq(patientUser.id, LabOrderModel.patientId))
      .leftJoin(doctorUser, eq(doctorUser.id, LabOrderModel.doctorId))
      .where(and(...filters))
      .orderBy(desc(LabOrderModel.createdAt))
      .limit(limit)
      .offset(offset);

    // 4. Query total count
    const [totalCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(LabOrderModel)
      .where(and(...filters));

    const totalRecords = Number(totalCount?.count || 0);
    const totalPages = Math.ceil(totalRecords / limit);

    // 5. Query and map completed / verified lab report result values
    const appointmentTestIds = labReportsList.map((r) => r.id);
    let results: any[] = [];
    let resultValues: any[] = [];

    if (appointmentTestIds.length > 0) {
      results = await database
        .select({
          id: LabOrderResultsModel.id,
          appointmentTestId: LabOrderResultsModel.appointmentTestId,
          status: LabOrderResultsModel.status,
          remarks: LabOrderResultsModel.remarks,
          verifiedAt: LabOrderResultsModel.verifiedAt,
          createdAt: LabOrderResultsModel.createdAt,
        })
        .from(LabOrderResultsModel)
        .where(
          and(
            inArray(LabOrderResultsModel.appointmentTestId, appointmentTestIds),
            inArray(LabOrderResultsModel.status, ['Completed', 'Verified'])
          )
        );

      const resultIds = results.map((res) => res.id);
      if (resultIds.length > 0) {
        resultValues = await database
          .select({
            id: LabOrderResultValuesModel.id,
            resultId: LabOrderResultValuesModel.resultId,
            parameterId: LabOrderResultValuesModel.parameterId,
            parameterName: sql<string>`COALESCE(${LabOrderResultValuesModel.displayNameSnapshot}, ${LabOrderResultValuesModel.parameterNameSnapshot})`,
            value: LabOrderResultValuesModel.value,
            unit: LabOrderResultValuesModel.unitSnapshot,
            referenceRange: LabOrderResultValuesModel.referenceRangeSnapshot,
            flag: LabOrderResultValuesModel.flag,
            sortOrder: LabOrderResultValuesModel.sortOrderSnapshot,
          })
          .from(LabOrderResultValuesModel)
          .where(inArray(LabOrderResultValuesModel.resultId, resultIds))
          .orderBy(
            asc(LabOrderResultValuesModel.sortOrderSnapshot),
            asc(LabOrderResultValuesModel.parameterNameSnapshot)
          );
      }
    }

    // 6. Map results and values to correct test orders
    const mappedReports = labReportsList.map((report) => {
      const result = results.find((res) => res.appointmentTestId === report.id);
      let mappedResult = null;

      if (result) {
        const values = resultValues.filter((val) => val.resultId === result.id);
        mappedResult = {
          id: result.id,
          status: result.status,
          remarks: result.remarks,
          verifiedAt: result.verifiedAt,
          createdAt: result.createdAt,
          values: values.map((v) => ({
            id: v.id,
            parameterId: v.parameterId,
            parameterName: v.parameterName,
            value: v.value,
            unit: v.unit,
            referenceRange: v.referenceRange,
            flag: v.flag,
          })),
        };
      }

      return {
        ...report,
        result: mappedResult,
      };
    });

    return {
      data: mappedReports,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 17.5 UPLOAD PATIENT LAB REPORT (EXISTING ORDER)
  // ─────────────────────────────────────────────────────────────────────────
  static async uploadPatientLabReport(
    userId: string,
    appointmentTestId: string,
    reportFileUrl: string | undefined
  ) {
    if (!reportFileUrl) {
      throw new HttpError(400, 'Report file is required');
    }

    const {
      updatedOrder,
      patientUser,
      orderClinicId,
      orderPatientId,
      testName,
      doctorId,
    } = await database.transaction(async (trx) => {
      // 1. Fetch the lab order record
      const [order] = await trx
        .select({
          order: LabOrderModel,
          testName: TestCatalogModel.name,
        })
        .from(LabOrderModel)
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .where(eq(LabOrderModel.id, appointmentTestId))
        .limit(1);

      if (!order) {
        throw new HttpError(404, 'Lab order not found');
      }

      const orderPatientId = order.order.patientId;
      const orderAppointmentId = order.order.appointmentId;
      const orderClinicId = order.order.clinicId;

      if (!orderPatientId) {
        throw new HttpError(400, 'Lab order has no linked patient');
      }
      if (!orderAppointmentId) {
        throw new HttpError(400, 'Lab order has no linked appointment');
      }
      if (!orderClinicId) {
        throw new HttpError(400, 'Lab order has no linked clinic');
      }

      // 2. Verify ownership: orderPatientId must match userId or a linked family member
      if (orderPatientId !== userId) {
        const [link] = await trx
          .select({ id: PatientFamilyLinksModel.id })
          .from(PatientFamilyLinksModel)
          .where(
            and(
              eq(PatientFamilyLinksModel.primaryPatientId, userId),
              eq(PatientFamilyLinksModel.linkedPatientId, orderPatientId)
            )
          )
          .limit(1);

        if (!link) {
          throw new HttpError(
            403,
            'Access denied. You can only upload lab reports for yourself or linked family members.'
          );
        }
      }

      const oldPdfUrl = order.order.reportPdf;
      const now = new Date();

      // 3. Update the LabOrder record
      const [updatedOrder] = await trx
        .update(LabOrderModel)
        .set({
          reportPdf: reportFileUrl,
          reportStatus: 'Completed',
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
          isExternalLabReport: true, // Mark it as an external report uploaded by the patient
          updatedAt: now,
        })
        .where(eq(LabOrderModel.id, appointmentTestId))
        .returning();

      // 4. Delete old report PDF from S3 if it changed
      if (oldPdfUrl && oldPdfUrl !== reportFileUrl) {
        await deleteFromS3(oldPdfUrl).catch(() => {
          logger.error('Failed to delete old test PDF from S3');
        });
      }

      // 5. Log Activity
      await AppointmentActivityHistoryService.logActivity({
        appointmentId: orderAppointmentId,
        action: 'TEST_REPORT_UPLOADED',
        performedBy: userId,
        previousState: order.order,
        newState: updatedOrder,
        remarks: `${order.testName} - report uploaded by patient`,
        tx: trx,
      });

      // 6. Notification data — the send happens post-commit, below.
      const [patientUser] = await trx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          userType: UserModel.userType,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);

      return {
        updatedOrder,
        patientUser,
        orderClinicId,
        orderPatientId,
        testName: order.testName,
        doctorId: order.order.doctorId ?? undefined,
      };
    });

    // Post-commit: the row is visible on the connection the notification writes on.
    if (patientUser) {
      notifyTestReportUploaded(
        orderClinicId,
        updatedOrder.id,
        patientUser.id,
        patientUser.name || 'Patient',
        patientUser.userType,
        doctorId,
        orderPatientId,
        testName
      )?.catch((err) => {
        logger.error(
          `Error sending lab report upload notification: ${err.message}`
        );
      });
    }

    return updatedOrder;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 18. GET PATIENT PRESCRIPTIONS (WITH DETAILED DATA AND PDF/IMAGE URL)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * GET /api/v1/patient/prescriptions
   * Returns a paginated list of prescriptions (digital & manual) for the primary patient & linked family members.
   */
  static async getPatientPrescriptions(
    userId: string,
    query: PatientPrescriptionsQueryDto
  ) {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    // 1. Fetch linked family members to check authorized patient IDs
    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const familyMemberIds = familyMembers.map((m) => m.linkedPatientId);
    const allAuthorizedPatientIds = [userId, ...familyMemberIds];

    let filterPatientIds = allAuthorizedPatientIds;

    if (query.patientId) {
      if (!allAuthorizedPatientIds.includes(query.patientId)) {
        throw new HttpError(
          403,
          'Access denied. You can only view prescriptions for yourself or linked family members.'
        );
      }
      filterPatientIds = [query.patientId];
    }

    // 2. Build filters
    const filters = [
      inArray(AppointmentModel.patientId, filterPatientIds),
      or(
        isNotNull(ReportCardModel.prescriptionPdf),
        isNotNull(doctorManualPrescriptionModel.doctorManualPrescription)
      ),
    ];

    const doctorUser = alias(UserModel, 'prescription_doctor_user');
    const patientUser = alias(UserModel, 'prescription_patient_user');

    if (query.search) {
      const searchPattern = `%${query.search.toLowerCase()}%`;
      filters.push(
        or(
          sql`LOWER(${doctorUser.name}) LIKE ${searchPattern}`,
          sql`LOWER(${ClinicModel.clinicName}) LIKE ${searchPattern}`
        )
      );
    }

    // 3. Query paginated appointments with prescriptions
    const prescriptionsList = await database
      .select({
        appointmentId: AppointmentModel.id,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentType: AppointmentModel.appointmentType,
        appointmentStatus: AppointmentModel.appointmentStatus,
        reportCard: {
          id: ReportCardModel.id,
          prescriptionPdf: ReportCardModel.prescriptionPdf,
          advice: ReportCardModel.advice,
          finalDiagnosis: ReportCardModel.finalDiagnosis,
          provisionalDiagnosis: ReportCardModel.provisionalDiagnosis,
          followUpDate: ReportCardModel.followUpDate,
          createdAt: ReportCardModel.createdAt,
        },
        manualPrescription: {
          id: doctorManualPrescriptionModel.id,
          prescriptionPdf:
            doctorManualPrescriptionModel.doctorManualPrescription,
          createdAt: doctorManualPrescriptionModel.createdAt,
        },
        doctor: {
          id: doctorUser.id,
          name: doctorUser.name,
          speciality: UserProfessionalModel.speciality,
          qualification: UserProfessionalModel.qualification,
          profileImage: UserProfileModel.profileImage,
        },
        patient: {
          id: patientUser.id,
          name: patientUser.name,
        },
        clinic: {
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
        },
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, doctorUser.id)
      )
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, doctorUser.id))
      .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .where(and(...filters))
      .orderBy(desc(AppointmentModel.appointmentDate))
      .limit(limit)
      .offset(offset);

    // 4. Query total count
    const [totalCount] = await database
      .select({
        count: sql<number>`count(distinct ${AppointmentModel.id})::int`,
      })
      .from(AppointmentModel)
      .leftJoin(
        ReportCardModel,
        eq(ReportCardModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(
        doctorManualPrescriptionModel,
        eq(doctorManualPrescriptionModel.appointmentId, AppointmentModel.id)
      )
      .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
      .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
      .where(and(...filters));

    const totalRecords = Number(totalCount?.count || 0);
    const totalPages = Math.ceil(totalRecords / limit);

    // 5. Query detailed medicine rows if report cards exist
    const reportCardIds = prescriptionsList
      .map((p) => p.reportCard?.id)
      .filter((id): id is string => !!id);

    let medicinesList: any[] = [];
    if (reportCardIds.length > 0) {
      medicinesList = await database
        .select({
          id: PrescriptionModel.id,
          reportCardId: PrescriptionModel.reportCardId,
          medicineName: PrescriptionModel.medicineName,
          composition: PrescriptionModel.composition,
          strength: PrescriptionModel.strength,
          dosage: PrescriptionModel.dosage,
          frequency: PrescriptionModel.frequency,
          duration: PrescriptionModel.duration,
          notes: PrescriptionModel.notes,
          imageUrl: PrescriptionModel.imageUrl,
          uses: PrescriptionModel.uses,
        })
        .from(PrescriptionModel)
        .where(inArray(PrescriptionModel.reportCardId, reportCardIds));
    }

    // 6. Map and combine digital / manual prescriptions
    const mappedPrescriptions = prescriptionsList.map((item) => {
      const reportCardId = item.reportCard?.id;
      const medicines = reportCardId
        ? medicinesList.filter((m) => m.reportCardId === reportCardId)
        : [];

      let prescriptionPdf = null;
      let prescriptionType: 'digital' | 'manual' | null = null;
      let prescriptionCreatedAt = null;

      if (item.reportCard?.prescriptionPdf) {
        prescriptionPdf = item.reportCard.prescriptionPdf;
        prescriptionType = 'digital';
        prescriptionCreatedAt = item.reportCard.createdAt;
      } else if (item.manualPrescription?.prescriptionPdf) {
        prescriptionPdf = item.manualPrescription.prescriptionPdf;
        prescriptionType = 'manual';
        prescriptionCreatedAt = item.manualPrescription.createdAt;
      }

      return {
        appointmentId: item.appointmentId,
        appointmentDate: item.appointmentDate,
        appointmentTime: item.appointmentTime,
        appointmentType: item.appointmentType,
        appointmentStatus: item.appointmentStatus,
        prescriptionPdf,
        prescriptionType,
        createdAt: prescriptionCreatedAt || item.appointmentDate,
        doctor: item.doctor,
        patient: item.patient,
        clinic: item.clinic,
        reportCard: item.reportCard?.id
          ? {
              id: item.reportCard.id,
              advice: item.reportCard.advice,
              finalDiagnosis: item.reportCard.finalDiagnosis,
              provisionalDiagnosis: item.reportCard.provisionalDiagnosis,
              followUpDate: item.reportCard.followUpDate,
            }
          : null,
        medicines,
      };
    });

    return {
      data: mappedPrescriptions,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 19. GET PATIENT ASSOCIATED DOCUMENTS (GALLERY, MANUAL PRESCRIPTIONS, CONSENT FILES, ETC.)
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * GET /api/v1/patient/associated-documents
   * Returns a paginated list of consolidated documents for the primary patient & linked family members.
   */
  static async getPatientAssociatedDocuments(
    userId: string,
    query: PatientAssociatedDocumentsQueryDto
  ) {
    const page = Math.max(parseInt(query.pageNumber || '1', 10), 1);
    const limit = Math.max(parseInt(query.pageSize || '10', 10), 1);
    const offset = (page - 1) * limit;

    // 1. Fetch linked family members to check authorized patient IDs
    const familyMembers = await database
      .select({ linkedPatientId: PatientFamilyLinksModel.linkedPatientId })
      .from(PatientFamilyLinksModel)
      .where(eq(PatientFamilyLinksModel.primaryPatientId, userId));

    const familyMemberIds = familyMembers.map((m) => m.linkedPatientId);
    const allAuthorizedPatientIds = [userId, ...familyMemberIds];

    let filterPatientIds = allAuthorizedPatientIds;

    if (query.patientId) {
      if (!allAuthorizedPatientIds.includes(query.patientId)) {
        throw new HttpError(
          403,
          'Access denied. You can only view documents for yourself or linked family members.'
        );
      }
      filterPatientIds = [query.patientId];
    }

    const documentType = query.documentType;
    const patientUser = alias(UserModel, 'doc_patient_user');
    const doctorUser = alias(UserModel, 'doc_doctor_user');

    const allDocuments: any[] = [];

    // --- A. Query Patient Gallery Images ---
    if (!documentType || documentType === 'gallery') {
      const galleryItems = await database
        .select({
          id: patientGallery.id,
          fileUrl: patientGallery.imageUrl,
          description: patientGallery.description,
          createdAt: patientGallery.createdAt,
          appointmentId: patientGallery.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: UserProfessionalModel.speciality,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
          },
          clinic: {
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
          },
        })
        .from(patientGallery)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, patientGallery.appointmentId)
        )
        .leftJoin(doctorUser, eq(doctorUser.id, patientGallery.doctorId))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, doctorUser.id)
        )
        .leftJoin(patientUser, eq(patientUser.id, patientGallery.patientId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
        .where(inArray(patientGallery.patientId, filterPatientIds));

      galleryItems.forEach((item) => {
        allDocuments.push({
          ...item,
          documentType: 'gallery',
          fileName: item.description || 'Gallery Attachment',
        });
      });
    }

    // --- B. Query Manual Prescriptions ---
    if (!documentType || documentType === 'manual_prescription') {
      const manualPrescriptions = await database
        .select({
          id: doctorManualPrescriptionModel.id,
          fileUrl: doctorManualPrescriptionModel.doctorManualPrescription,
          createdAt: doctorManualPrescriptionModel.createdAt,
          appointmentId: doctorManualPrescriptionModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: UserProfessionalModel.speciality,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
          },
          clinic: {
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
          },
        })
        .from(doctorManualPrescriptionModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, doctorManualPrescriptionModel.appointmentId)
        )
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, doctorUser.id)
        )
        .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
        .where(
          and(
            inArray(AppointmentModel.patientId, filterPatientIds),
            isNotNull(doctorManualPrescriptionModel.doctorManualPrescription)
          )
        );

      manualPrescriptions.forEach((item) => {
        allDocuments.push({
          ...item,
          documentType: 'manual_prescription',
          fileName: 'Manual Prescription',
          description: 'Uploaded by Doctor',
        });
      });
    }

    // --- C. Query Consent Files ---
    if (!documentType || documentType === 'consent_file') {
      const consentFiles = await database
        .select({
          id: AppointmentClinicalModel.id,
          fileUrl: AppointmentClinicalModel.consentFile,
          description: AppointmentClinicalModel.consentNotes,
          createdAt: AppointmentClinicalModel.createdAt,
          appointmentId: AppointmentClinicalModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: UserProfessionalModel.speciality,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
          },
          clinic: {
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
          },
        })
        .from(AppointmentClinicalModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, doctorUser.id)
        )
        .leftJoin(patientUser, eq(patientUser.id, AppointmentModel.patientId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
        .where(
          and(
            inArray(AppointmentModel.patientId, filterPatientIds),
            isNotNull(AppointmentClinicalModel.consentFile)
          )
        );

      consentFiles.forEach((item) => {
        allDocuments.push({
          ...item,
          documentType: 'consent_file',
          fileName: 'Consent Form',
        });
      });
    }

    // --- D. Query Digital Prescriptions ---
    if (!documentType || documentType === 'digital_prescription') {
      const digitalPrescriptions = await database
        .select({
          id: ReportCardModel.id,
          fileUrl: ReportCardModel.prescriptionPdf,
          description: ReportCardModel.finalDiagnosis,
          createdAt: ReportCardModel.createdAt,
          appointmentId: ReportCardModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: UserProfessionalModel.speciality,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
          },
          clinic: {
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
          },
        })
        .from(ReportCardModel)
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, ReportCardModel.appointmentId)
        )
        .leftJoin(doctorUser, eq(doctorUser.id, AppointmentModel.doctorId))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, doctorUser.id)
        )
        .leftJoin(patientUser, eq(patientUser.id, ReportCardModel.petientId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, AppointmentModel.clinicId))
        .where(
          and(
            inArray(ReportCardModel.petientId, filterPatientIds),
            isNotNull(ReportCardModel.prescriptionPdf)
          )
        );

      digitalPrescriptions.forEach((item) => {
        allDocuments.push({
          ...item,
          documentType: 'digital_prescription',
          fileName: 'Digital Prescription',
        });
      });
    }

    // --- E. Query Lab Reports ---
    if (!documentType || documentType === 'lab_report') {
      const labReports = await database
        .select({
          id: LabOrderModel.id,
          fileUrl: LabOrderModel.reportPdf,
          description: TestCatalogModel.name,
          createdAt: LabOrderModel.createdAt,
          appointmentId: LabOrderModel.appointmentId,
          appointmentDate: AppointmentModel.appointmentDate,
          doctor: {
            id: doctorUser.id,
            name: doctorUser.name,
            speciality: UserProfessionalModel.speciality,
          },
          patient: {
            id: patientUser.id,
            name: patientUser.name,
          },
          clinic: {
            id: ClinicModel.id,
            clinicName: ClinicModel.clinicName,
          },
        })
        .from(LabOrderModel)
        .innerJoin(
          TestCatalogModel,
          eq(TestCatalogModel.id, LabOrderModel.testId)
        )
        .innerJoin(
          AppointmentModel,
          eq(AppointmentModel.id, LabOrderModel.appointmentId)
        )
        .leftJoin(doctorUser, eq(doctorUser.id, LabOrderModel.doctorId))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, doctorUser.id)
        )
        .leftJoin(patientUser, eq(patientUser.id, LabOrderModel.patientId))
        .leftJoin(ClinicModel, eq(ClinicModel.id, LabOrderModel.clinicId))
        .where(
          and(
            inArray(LabOrderModel.patientId, filterPatientIds),
            isNotNull(LabOrderModel.reportPdf)
          )
        );

      labReports.forEach((item) => {
        allDocuments.push({
          ...item,
          documentType: 'lab_report',
          fileName: `Lab Report - ${item.description || 'Test'}`,
        });
      });
    }

    // Apply Search Filter In-Memory
    let filteredDocs = allDocuments;
    if (query.search) {
      const searchPattern = query.search.toLowerCase();
      filteredDocs = filteredDocs.filter((doc) => {
        const doctorName = doc.doctor?.name?.toLowerCase() || '';
        const clinicName = doc.clinic?.clinicName?.toLowerCase() || '';
        const docName = doc.fileName?.toLowerCase() || '';
        const desc = doc.description?.toLowerCase() || '';
        return (
          doctorName.includes(searchPattern) ||
          clinicName.includes(searchPattern) ||
          docName.includes(searchPattern) ||
          desc.includes(searchPattern)
        );
      });
    }

    // Sort by createdAt descending
    filteredDocs.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    const totalRecords = filteredDocs.length;
    const paginatedDocs = filteredDocs.slice(offset, offset + limit);
    const totalPages = Math.ceil(totalRecords / limit);

    // Documents get the 5-minute document TTL here; the response signer would give them 12h.
    // Gallery images are left to it. Only this page is signed, so the cost stays per page.
    const signedDocs = await Promise.all(
      paginatedDocs.map(async (doc) =>
        doc.documentType === 'gallery' || !doc.fileUrl
          ? doc
          : {
              ...doc,
              fileUrl:
                (await signS3Url(doc.fileUrl, {
                  expiresIn: DOCUMENT_TTL_SECONDS,
                })) ?? doc.fileUrl,
            }
      )
    );

    return {
      data: signedDocs,
      pagination: {
        totalRecords,
        totalPages,
        pageNumber: page,
        pageSize: limit,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 21. PATIENT RESCHEDULE APPOINTMENT
  // ─────────────────────────────────────────────────────────────────────────
  static async rescheduleAppointment(
    userId: string,
    appointmentId: string,
    payload: PatientRescheduleDto
  ) {
    const { appointmentDate, appointmentTime, comments, sessionIndex } =
      payload;

    /** IST calendar day, the form session resolution reads dates in. */
    const dateOnlyStr = new Date(appointmentDate).toISOString().split('T')[0];

    // 1️⃣ Fetch core appointment details to check existence and owner
    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        patientId: AppointmentModel.patientId,
        clinicId: AppointmentModel.clinicId,
        doctorId: AppointmentModel.doctorId,
        appointmentStatus: AppointmentModel.appointmentStatus,
      })
      .from(AppointmentModel)
      .where(eq(AppointmentModel.id, appointmentId))
      .limit(1);

    if (!appointment) {
      throw new HttpError(404, 'Appointment not found.');
    }

    // 2️⃣ Check ownership (self or linked family member)
    if (appointment.patientId !== userId) {
      const [link] = await database
        .select({ id: PatientFamilyLinksModel.id })
        .from(PatientFamilyLinksModel)
        .where(
          and(
            eq(PatientFamilyLinksModel.primaryPatientId, userId),
            eq(PatientFamilyLinksModel.linkedPatientId, appointment.patientId)
          )
        )
        .limit(1);

      if (!link) {
        throw new HttpError(403, 'Access denied');
      }
    }

    // 3️⃣ Verify appointment is in a non-terminal status
    const blockedStatuses = ['Completed', 'Cancelled', 'NoShow'];
    if (blockedStatuses.includes(appointment.appointmentStatus)) {
      throw new HttpError(
        400,
        `Appointment in state '${appointment.appointmentStatus}' cannot be rescheduled`,
        'INVALID_APPOINTMENT_STATE'
      );
    }

    // 4️⃣ Run policy checks using PolicyEvaluationService
    const { PolicyEvaluationService } =
      await import('../../cancellation-policy/services/policyEvaluation.service');
    await PolicyEvaluationService.evaluateReschedule(appointmentId, userId);

    // 5️⃣ Check if clinic/doctor is in token mode on the rescheduled date
    let finalTokenNo: number | null = null;

    const getDayNameFromDate = (date: Date): string => {
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      return days[date.getDay()];
    };

    const newDateObj = new Date(appointmentDate);
    const dayName = getDayNameFromDate(newDateObj);

    const { ClinicAvailability } =
      await import('../../clinic/models/clinic.model');
    const [availability] = await database
      .select({
        noOfPatients: ClinicAvailability.noOfPatients,
      })
      .from(ClinicAvailability)
      .where(
        and(
          eq(ClinicAvailability.clinicId, appointment.clinicId),
          eq(ClinicAvailability.doctorId, appointment.doctorId!),
          sql`lower(${ClinicAvailability.dayOfWeek}) = ${dayName.toLowerCase()}`
        )
      )
      .limit(1);

    const isTokenMode =
      availability?.noOfPatients != null &&
      Number(availability.noOfPatients) > 0;

    // Which shift the rescheduled token lands in and its capacity, resolved as
    // booking does: numbering restarts per shift, so scanning the whole day
    // would hand an evening patient a number the morning already issued and
    // fail on `ux_appt_token_per_session` rather than give a readable error.
    const session = isTokenMode
      ? await TokenSessionService.resolve(
          database,
          appointment.clinicId,
          appointment.doctorId!,
          dateOnlyStr,
          sessionIndex
        )
      : null;

    const maxTokens = session?.capacity ?? null;

    if (isTokenMode) {
      const dateOnly = new Date(appointmentDate);
      dateOnly.setHours(0, 0, 0, 0);
      const nextDay = new Date(dateOnly);
      nextDay.setDate(nextDay.getDate() + 1);

      const apptStatuses = [
        'Upcoming',
        'Confirmed',
        'Patient Arrived',
        'Pending',
        'Rescheduled',
        'Completed',
      ] as const;

      const { lt, ne } = await import('drizzle-orm');

      const booked = await database
        .select({
          id: AppointmentModel.id,
          tokenNo: AppointmentModel.tokenNo,
          appointmentStatus: AppointmentModel.appointmentStatus,
          paymentMode: AppointmentPaymentModel.paymentMode,
          paymentStatus: AppointmentPaymentModel.paymentStatus,
          doctorId: AppointmentModel.doctorId,
          appointmentDate: AppointmentModel.appointmentDate,
          appointmentTime: AppointmentModel.appointmentTime,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentPaymentModel,
          eq(AppointmentPaymentModel.appointmentId, AppointmentModel.id)
        )
        .where(
          and(
            eq(AppointmentModel.clinicId, appointment.clinicId),
            eq(AppointmentModel.doctorId, appointment.doctorId!),
            ne(AppointmentModel.id, appointmentId),
            gte(AppointmentModel.appointmentDate, dateOnly),
            lt(AppointmentModel.appointmentDate, nextDay),
            // Only this shift's tokens compete for this shift's numbers. Rows
            // booked before shift-wise numbering carry a null session and are
            // read as session 1, where their numbers were issued.
            session!.sessionIndex === 1
              ? or(
                  eq(AppointmentModel.sessionIndex, 1),
                  isNull(AppointmentModel.sessionIndex)
                )
              : eq(AppointmentModel.sessionIndex, session!.sessionIndex),
            inArray(AppointmentModel.appointmentStatus, apptStatuses)
          )
        );

      const activeBooked = await filterExpiredPendingAppointments(booked);

      const bookedSet = new Set(
        activeBooked
          .map((b) => Number(b.tokenNo))
          .filter((n) => Number.isFinite(n))
      );

      // Numbering restarts at 1 in every shift.
      for (let t = 1; t <= maxTokens!; t++) {
        if (!bookedSet.has(t)) {
          finalTokenNo = t;
          break;
        }
      }

      if (!finalTokenNo) {
        throw new HttpError(
          400,
          session!.totalSessions > 1
            ? `No tokens available in this session (${session!.sessionStart})`
            : 'No tokens available for this date'
        );
      }
    }

    // 6️⃣ Execute updateAppointment logic (runs availability, slots, conflicts, broadcasts & audits)
    const updateResult = await AppointmentService.updateAppointment(
      appointmentId,
      {
        appointmentDate,
        appointmentTime,
        reasionForReSchedule: comments || undefined,
        appointmentStatus: 'Pending',
        tokenNo: finalTokenNo || undefined,
        sessionIndex: session?.sessionIndex,
      },
      userId,
      'Patient'
    );

    // 7️⃣ Log the reschedule request in the cancellation_requests table
    const { CancellationRequestModel } =
      await import('../../cancellation-policy/models/cancellationPolicy.model');
    await database.insert(CancellationRequestModel).values({
      appointmentId,
      clinicId: appointment.clinicId,
      userId,
      userRole: 'Patient',
      reasonCode: 'patient_reschedule',
      comments: comments || null,
      isRescheduleRequest: true,
      status: 'Approved',
    });

    return updateResult;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 28. GET APPOINTMENT PRICING PREVIEW
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * GET /api/v1/patient/appointments/pricing-preview
   * Returns calculated platform fee, GST, and total payable amount before payment.
   */
  static async getAppointmentPricingPreview(query: {
    clinicId: string;
    price?: string;
    clinicServiceId?: string;
    doctorId?: string;
  }) {
    const { clinicId, price, clinicServiceId, doctorId } = query;

    let basePrice: number | null = null;

    if (price !== undefined && price !== null && price.trim() !== '') {
      basePrice = parseFloat(price);
    } else if (clinicServiceId) {
      const [service] = await database
        .select({ price: ClinicServiceModel.price })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.id, clinicServiceId),
            eq(ClinicServiceModel.clinicId, clinicId),
            eq(ClinicServiceModel.isDeleted, false)
          )
        )
        .limit(1);

      if (!service || service.price === null || service.price === undefined) {
        throw new HttpError(
          404,
          'Clinic service not found or has no price configured.'
        );
      }
      basePrice = Number(service.price);
    } else if (doctorId) {
      const [service] = await database
        .select({ price: ClinicServiceModel.price })
        .from(ClinicServiceModel)
        .where(
          and(
            eq(ClinicServiceModel.doctorId, doctorId),
            eq(ClinicServiceModel.clinicId, clinicId),
            eq(ClinicServiceModel.isDeleted, false)
          )
        )
        .limit(1);

      if (!service || service.price === null || service.price === undefined) {
        throw new HttpError(
          404,
          'Doctor service not found or has no consultation price configured.'
        );
      }
      basePrice = Number(service.price);
    }

    if (basePrice === null || isNaN(basePrice) || basePrice < 0) {
      throw new HttpError(
        400,
        'Invalid consultation price for pricing calculation.'
      );
    }

    // 1. Resolve active dynamic fee rules (clinic-override with global fallback)
    const feeConfigs = await ConfigurationResolver.getMergedConfigs(clinicId);

    // 2. Compute dynamic split breakdown using integer Paise math
    const splitDetails = DynamicSplitEngine.calculate(basePrice, feeConfigs);

    return splitDetails.patientPricingSummary;
  }
}
