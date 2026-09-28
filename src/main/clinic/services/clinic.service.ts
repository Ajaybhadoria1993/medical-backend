/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  and,
  between,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  createRazorpayRouteAccount,
  fetchRazorpayRouteAccountProducts,
  createRazorpayStakeholder,
  requestRazorpayProductConfig,
  updateRazorpayProductSettlements,
  uploadRazorpayDocument,
  fetchRazorpayRouteAccountAllProducts,
} from '../../../utils/razorpay';
import {
  OnboardRouteDto,
  UpdateBankDetailsDto,
} from '../schemas/clinic.schemas';
import { database } from '../../../configurations/dbConnection';
import { notifyClinicCreated } from '../../../utils/notificationHelpers';
import redisClient from '../../../configurations/redisConfig';
import { deleteFromS3 } from '../../../configurations/s3';
import { HttpError } from '../../../middlewear/errorHandler';
import { doctorRutineDufet } from '../../../utils/avaliblity';
import logger from '../../../utils/logger';
import { NoShowPolicyModel } from '../../appointments/models/noShowPolicy.model';
import { DoctorQualificationModel } from '../../doctor/models/doctor.model';
import { DoctorServices } from '../../doctor/services/doctor.service';
import { ConsultationDurationService } from '../../appointment-engine/services/consultationDuration.service';
import { AppointmentEngineOrchestrator } from '../../appointment-engine/services/orchestrator.service';
import { getISTDateString, startOfDayIST } from '../../../utils/istDateTime';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { autoNoShowQueue } from '../../appointments/services/autoNoShow.service';
import { AppointmentActivityHistoryService } from '../../appointments/services/appointmentActivityHistory.service';
import { whatsAppReminderQueue } from '../../notifications/services/appointmentWhatsappReminder.service';
import { LabsModel } from '../../lab/models/lab.model';
import { PharmacyModel } from '../../pharmacy/models/pharmacy.model';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../../subscription/models/subscription.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { ClinicAssignRow, FullClinicResponse } from '../types/clinic.types';
import {
  ClinicAssignModel,
  ClinicAvailability,
  ClinicModel,
} from '../models/clinic.model';
import { LimitationService } from '../../subscription/services/limitation.service';
import { ClinicOnboardingResetModel } from '../models/clinicOnboardingReset.model';
import { ClinicPaymentAccountModel } from '../models/clinicPaymentAccount.model';
import { ClinicReminderModel } from '../models/clinicReminder.model';
import { ClinicSettingsModel } from '../models/clinicSettings.model';
import { ClinicBankHistoryModel } from '../models/clinicBankHistory.model';
import {
  FullDoctorClinicDto,
  FulUpdateClinicSchemaDto,
  ResetClinicOnboardingDto,
  DeleteClinicDto,
} from '../schemas/clinic.schemas';
import {
  CacheKeys,
  invalidateCacheMany,
  withCacheInvalidation,
} from '../../../utils/cache.util';
import { isSubscriptionValid } from '../../../utils/subscriptionExpiry';
import {
  comparePassword,
  generateOTP,
  hashToken,
} from '../../../utils/authUtils';
import { realtimeBus } from '../../realtime/services/realtimeBus.service';
import { sendSMS } from '../../../utils/smsClient';
import { envConfig } from '../../../utils/envConfig';

const CLINIC_OTP_RESEND_COOLDOWN_SECS = envConfig.OTP_RESEND_COOLDOWN_SECS;
const CLINIC_OTP_MAX_RESEND_COUNT = envConfig.OTP_MAX_RESEND_COUNT;
const CLINIC_OTP_RATE_WINDOW_SECS = envConfig.OTP_RATE_WINDOW_SECS;
const CLINIC_OTP_MAX_ATTEMPTS_PER_WINDOW =
  envConfig.OTP_MAX_ATTEMPTS_PER_WINDOW;

export class ClinicService {
  /**
   * Creates a new clinic + service + availability and updates doctor profile
   */
  static async createClinic(userId: string, payload: FullDoctorClinicDto) {
    const [existingClinic] = await database
      .select({
        id: ClinicModel.id,
        clinicPhone: ClinicModel.clinicPhone,
      })
      .from(ClinicModel)
      .where(eq(ClinicModel.userId, userId))
      .limit(1);

    const isNewClinic = !existingClinic;

    const result = await database.transaction(async (tx) => {
      const setValues: any = {
        clinicName: payload.clinicDetails.clinicName,
        clinicPhone: payload.clinicDetails.clinicPhone,
        Tagline: payload.clinicDetails.Tagline,
        clinicAddress: payload.clinicDetails.clinicAddress,
        clinicLocation: payload.clinicDetails.clinicLocation,
        State: payload.clinicDetails.State,
        City: payload.clinicDetails.City,
        ZipCode: payload.clinicDetails.ZipCode,
        clinicLogo: payload.clinicDetails.clinicLogo,
        latitude: payload.clinicDetails.latitude,
        longitude: payload.clinicDetails.longitude,
        updatedAt: new Date(),
      };

      if (
        existingClinic &&
        existingClinic.clinicPhone !== payload.clinicDetails.clinicPhone
      ) {
        setValues.isClinicPhoneVerified = false;
      }

      const [clinic] = await tx
        .insert(ClinicModel)
        .values({
          userId,
          clinicName: payload.clinicDetails.clinicName,
          clinicPhone: payload.clinicDetails.clinicPhone,
          Tagline: payload.clinicDetails.Tagline,
          clinicAddress: payload.clinicDetails.clinicAddress,
          clinicLocation: payload.clinicDetails.clinicLocation,
          State: payload.clinicDetails.State,
          City: payload.clinicDetails.City,
          ZipCode: payload.clinicDetails.ZipCode,
          clinicLogo: payload.clinicDetails.clinicLogo,
          latitude: payload.clinicDetails.latitude,
          longitude: payload.clinicDetails.longitude,
          // activated once a Super Admin approves the request
          status: 'Pending',
        })
        .onConflictDoUpdate({
          target: [ClinicModel.userId],
          set: setValues,
        })
        .returning({
          id: ClinicModel.id,
          userId: ClinicModel.userId,
          latitude: ClinicModel.latitude,
          longitude: ClinicModel.longitude,
        });
      if (
        payload.adminProfile &&
        Object.keys(payload.adminProfile).length > 0
      ) {
        const userSetObj: Record<string, any> = {};
        const profileSetObj: Record<string, any> = {};
        const professionalSetObj: Record<string, any> = {};

        const allowedUserFields = [
          'name',
          'mobile',
          'isAdminDoctorAccess',
        ] as const;
        const allowedProfileFields = [
          'alternateMobile',
          'profileImage',
        ] as const;
        const allowedProfessionalFields = [
          'speciality',
          'specialization',
          'registrationNumber',
          'qualification',
          'yearsOfExperience',
        ] as const;

        for (const k of allowedUserFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
          if (typeof val !== 'undefined') userSetObj[k] = val;
        }
        for (const k of allowedProfileFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
          if (typeof val !== 'undefined') profileSetObj[k] = val;
        }
        for (const k of allowedProfessionalFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
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

      await tx
        .insert(ClinicAssignModel)
        .values({
          userId: userId,
          clinicId: clinic.id,
        })
        .onConflictDoUpdate({
          target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
          set: {
            updatedAt: new Date(),
          },
        });
      return clinic;
    });

    // After commit: adminProfile may have renamed the doctor.
    await invalidateCacheMany(CacheKeys.doctorPublicProfileAll(userId));

    // Auto-assign free plan with default limits on clinic creation
    await ClinicService.assignDefaultFreePlan(result.id);

    if (isNewClinic) {
      // Find the performer's user info
      const [performer] = await database
        .select({
          name: UserModel.name,
          userType: UserModel.userType,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);

      if (performer) {
        notifyClinicCreated(
          result.id,
          payload.clinicDetails.clinicName,
          userId,
          performer.name || 'Admin/Doctor',
          performer.userType
        ).catch((err) => {
          logger.error(
            `[Notification] Failed to send clinic creation notification to super admins:`,
            err
          );
        });
      }
    }

    return result;
  }

  /**
   * Assigns the default free plan to a newly created clinic.
   * This ensures every clinic starts with the free tier limits.
   * If the free plan doesn't exist, it logs a warning and skips.
   */
  static async assignDefaultFreePlan(clinicId: string): Promise<void> {
    try {
      // 1. Find the free plan
      const [freePlan] = await database
        .select({
          id: SubscriptionPlanModel.id,
          slug: SubscriptionPlanModel.slug,
        })
        .from(SubscriptionPlanModel)
        .where(inArray(SubscriptionPlanModel.slug, ['solo', 'Free']))
        .limit(1);

      if (!freePlan) {
        logger.warn(
          `[ClinicService] Free plan not found in subscription_plans. Skipping default assignment for clinic ${clinicId}.`
        );
        return;
      }

      // 2. Check if clinic already has an active subscription (idempotent)
      const [existingSub] = await database
        .select({ id: ClinicSubscriptionModel.id })
        .from(ClinicSubscriptionModel)
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        )
        .limit(1);

      if (existingSub) {
        // Already has a subscription, skip
        return;
      }

      // 3. Create free subscription (no expiry)
      await database.insert(ClinicSubscriptionModel).values({
        clinicId,
        planId: freePlan.id,
        startsAt: new Date(),
        expiresAt: null, // Free plan never expires
        active: true,
        provider: 'system',
        providerSubscriptionId: 'default-free',
        paymentMode: 'free',
        transactionId: `free_${Date.now()}`,
        paymentStatus: 'success',
        price: '0.00',
      });

      // 4. Invalidate any cached subscription data
      await redisClient.del(`clinic_active_subscription:${clinicId}`);
      await redisClient.del(`clinic_plan:${clinicId}`);
      await redisClient.del(`clinic_details:${clinicId}`);

      logger.info(
        `[ClinicService] Default free plan assigned to clinic ${clinicId}`
      );
    } catch (error) {
      // Don't fail clinic creation if plan assignment fails
      logger.error(
        `[ClinicService] Failed to assign default free plan to clinic ${clinicId}:`,
        error
      );
    }
  }

  static async updateClinic(
    userId: string,
    payload: FulUpdateClinicSchemaDto
  ): Promise<any> {
    // find clinic
    const [existingClinic] = await database
      .select({ id: ClinicModel.id })
      .from(ClinicModel)
      .where(eq(ClinicModel.userId, userId));

    if (!existingClinic) throw new HttpError(404, 'Clinic not found');
    const clinicId = existingClinic.id;
    return this.updateClinicById(clinicId, payload);
  }

  static async updateClinicById(
    clinicId: string,
    payload: FulUpdateClinicSchemaDto,
    profileImage?: string
  ): Promise<any> {
    const [existingClinic] = await database
      .select({
        id: ClinicModel.id,
        userId: ClinicModel.userId,
        clinicLogo: ClinicModel.clinicLogo,
        clinicPhone: ClinicModel.clinicPhone,
      })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId));

    if (!existingClinic) throw new HttpError(404, 'Clinic not found');

    const [existingUser] = await database
      .select({
        profileImage: UserProfileModel.profileImage,
        isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .where(eq(UserModel.id, existingClinic.userId));

    await database.transaction(async (tx) => {
      // === 1) clinicDetails: update only if provided and only provided fields ===
      const adminQualifications =
        payload.adminProfile?.qualifications ?? payload.qualifications;
      if (Array.isArray(adminQualifications)) {
        await DoctorServices.updateDoctorProfile(
          tx,
          payload,
          existingClinic.userId
        );
      }
      if (profileImage) {
        {
          await tx
            .insert(UserProfileModel)
            .values({
              userId: existingClinic.userId,
              profileImage: profileImage,
            })
            .onConflictDoUpdate({
              target: [UserProfileModel.userId],
              set: {
                profileImage: profileImage,
                updatedAt: sql`NOW()`,
              },
            });
        }
      }
      if (
        payload.clinicDetails &&
        Object.keys(payload.clinicDetails).length > 0
      ) {
        const setObj: Record<string, any> = {};
        // copy only defined fields into setObj
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
          // 'status' omitted on purpose — see ClinicService.updateClinicStatus
          'latitude',
          'longitude',
        ] as const;
        for (const k of allowed) {
          const val = (payload.clinicDetails as any)[k];
          if (typeof val !== 'undefined') setObj[k] = val;
        }

        if (
          typeof payload.clinicDetails.clinicPhone !== 'undefined' &&
          payload.clinicDetails.clinicPhone !== existingClinic.clinicPhone
        ) {
          setObj.isClinicPhoneVerified = false;
        }

        if (Object.keys(setObj).length > 0) {
          setObj.updatedAt = sql`NOW()`;
          await tx
            .update(ClinicModel)
            .set(setObj)
            .where(eq(ClinicModel.id, clinicId))
            .returning({
              id: ClinicModel.id,
              clinicName: ClinicModel.clinicName,
              clinicPhone: ClinicModel.clinicPhone,
              Tagline: ClinicModel.Tagline,
              clinicAddress: ClinicModel.clinicAddress,
              clinicLocation: ClinicModel.clinicLocation,
              State: ClinicModel.State,
              City: ClinicModel.City,
              ZipCode: ClinicModel.ZipCode,
              clinicLogo: ClinicModel.clinicLogo,
              status: ClinicModel.status,
              latitude: ClinicModel.latitude,
              longitude: ClinicModel.longitude,
            });
        }
      }

      if (
        payload.adminProfile &&
        Object.keys(payload.adminProfile).length > 0
      ) {
        const [clinic] = await tx
          .select({ userId: ClinicModel.userId })
          .from(ClinicModel)
          .where(eq(ClinicModel.id, clinicId));

        if (!clinic) throw new HttpError(404, 'Clinic not found');

        const userSetObj: Record<string, any> = {};
        const profileSetObj: Record<string, any> = {};
        const professionalSetObj: Record<string, any> = {};

        const allowedUserFields = [
          'name',
          'mobile',
          'isAdminDoctorAccess',
        ] as const;
        const allowedProfileFields = [
          'alternateMobile',
          'profileImage',
          'upiIds',
        ] as const;
        const allowedProfessionalFields = [
          'speciality',
          'specialization',
          'registrationNumber',
          'qualification',
          'yearsOfExperience',
        ] as const;

        for (const k of allowedUserFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
          if (typeof val !== 'undefined') userSetObj[k] = val;
        }
        for (const k of allowedProfileFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
          if (typeof val !== 'undefined') profileSetObj[k] = val;
        }
        for (const k of allowedProfessionalFields) {
          let val = (payload.adminProfile as any)[k];
          if (typeof val === 'undefined' && (payload as any)[k]) {
            val = (payload as any)[k];
          }
          if (typeof val !== 'undefined') professionalSetObj[k] = val;
        }

        if (Object.keys(userSetObj).length > 0) {
          userSetObj.updatedAt = sql`NOW()`;
          await tx
            .update(UserModel)
            .set(userSetObj)
            .where(eq(UserModel.id, clinic.userId));
        }
        if (Object.keys(profileSetObj).length > 0) {
          profileSetObj.updatedAt = sql`NOW()`;
          await tx
            .insert(UserProfileModel)
            .values({ userId: clinic.userId, ...profileSetObj })
            .onConflictDoUpdate({
              target: [UserProfileModel.userId],
              set: profileSetObj,
            });
        }
        if (Object.keys(professionalSetObj).length > 0) {
          professionalSetObj.updatedAt = sql`NOW()`;
          await tx
            .insert(UserProfessionalModel)
            .values({ userId: clinic.userId, ...professionalSetObj })
            .onConflictDoUpdate({
              target: [UserProfessionalModel.userId],
              set: professionalSetObj,
            });
        }
      }
    }); // end transaction

    if (
      payload.clinicDetails?.clinicLogo &&
      existingClinic.clinicLogo &&
      existingClinic.clinicLogo !== payload.clinicDetails.clinicLogo
    ) {
      await deleteFromS3(existingClinic.clinicLogo).catch(console.error);
    }

    // Delete old profile image if it was updated
    const newProfileImage = profileImage || payload.adminProfile?.profileImage;
    if (
      newProfileImage &&
      existingUser?.profileImage &&
      existingUser.profileImage !== newProfileImage
    ) {
      await deleteFromS3(existingUser.profileImage).catch(console.error);
    }

    // Seed default doctor availability only when doctor access is first enabled.
    const isDoctorAccessNewlyEnabled =
      payload.adminProfile?.isAdminDoctorAccess === true &&
      existingUser?.isAdminDoctorAccess !== true;

    if (isDoctorAccessNewlyEnabled) {
      // We need the userId for the clinic admin
      const [clinic] = await database
        .select({ userId: ClinicModel.userId })
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId));

      if (clinic) {
        await DoctorServices.updateUser(
          clinic.userId,
          clinicId,
          doctorRutineDufet as any
        );
      }
    }

    try {
      await redisClient.del(`clinic_details:${clinicId}`);
      await invalidateCacheMany(
        CacheKeys.doctorPublicProfileAll(existingClinic.userId)
      );
      await redisClient.del(`clinic_geo:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic/doctor cache in updateClinicById for clinic ${clinicId}:`,
        err
      );
    }

    // Keep the v2 aggregated Clinic Information page cache in sync — this
    // v1 path writes the same ClinicModel row the v2 read endpoint reads.
    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      () => this.getClinicById(clinicId)
    );
  }
  /**
   * Get full nested clinic by userId
   */
  static async getClinicByUserId(
    userId: string,
    clinicId: string
  ): Promise<FullClinicResponse | null> {
    // find clinic
    return await database.transaction(async (tx) => {
      const [clinic] = await tx
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId));
      const [policy] = await tx
        .select({
          isActive: NoShowPolicyModel.isActive,
        })
        .from(NoShowPolicyModel)
        .where(eq(NoShowPolicyModel.clinicId, clinicId));
      const [profile] = await tx
        .select({
          id: UserModel.id,
          name: UserModel.name,
          userName: UserModel.userName,
          email: UserModel.email,
          mobile: UserModel.mobile,
          socialProvider: UserModel.socialProvider,
          socialProviderId: UserModel.socialProviderId,
          userType: UserModel.userType,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          isUserBlocked: UserModel.isUserBlocked,
          isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
          isArchive: UserModel.isArchive,
          paymentVisible: UserModel.paymentVisible,
          createdAt: UserModel.createdAt,
          updatedAt: UserModel.updatedAt,
          // Onboarding fields from clinic (not user)
          onboardingStatus: ClinicModel.onboardingStatus,
          approvalRequestSent: ClinicModel.approvalRequestSent,
          currentStep: ClinicModel.currentStep,
          // Profile fields
          alternateMobile: UserProfileModel.alternateMobile,
          gender: UserProfileModel.gender,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          upiIds: UserProfileModel.upiIds,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          // Professional fields
          qualification: UserProfessionalModel.qualification,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          licenseNumber: UserProfessionalModel.licenseNumber,
          speciality: UserProfessionalModel.speciality,
          specialization: UserProfessionalModel.specialization,
          registrationNumber: UserProfessionalModel.registrationNumber,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .leftJoin(ClinicModel, eq(ClinicModel.userId, UserModel.id))
        .where(eq(UserModel.id, userId));

      if (!profile) {
        return null;
      }

      let subscriptionDetails: any = {
        planName: 'Solo',
        price: '0.00',
        slug: 'solo',
        providerSubscriptionId: null,
        expiresAt: null,
        active: true,
      };

      if (
        profile.userType === 'Admin' ||
        profile.userType === 'Doctor' ||
        profile.userType === 'Receptionist'
      ) {
        const [subscription] = await tx
          .select({
            expiresAt: ClinicSubscriptionModel.expiresAt,
            paymentStatus: ClinicSubscriptionModel.paymentStatus,
            active: ClinicSubscriptionModel.active,
            slug: SubscriptionPlanModel.slug,
            planName: SubscriptionPlanModel.name,
            price: SubscriptionPlanModel.price,
            providerSubscriptionId:
              ClinicSubscriptionModel.providerSubscriptionId,
          })
          .from(ClinicSubscriptionModel)
          .leftJoin(
            SubscriptionPlanModel,
            eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
          )
          .where(
            and(
              eq(ClinicSubscriptionModel.clinicId, clinicId),
              eq(ClinicSubscriptionModel.active, true)
            )
          )
          .orderBy(desc(ClinicSubscriptionModel.createdAt))
          .limit(1);
        // 4️⃣ If subscription exists → override FREE plan
        if (
          subscription &&
          subscription.paymentStatus === 'success' &&
          subscription.active
        ) {
          // Expiry rule (end of the expiry day, IST) is shared with the
          // subscription middleware and the billing endpoint so the three
          // cannot disagree about when a plan lapses.
          const isValid = isSubscriptionValid(subscription.expiresAt);

          if (isValid) {
            subscriptionDetails = {
              planName: subscription.planName ?? 'Solo',
              price:
                subscription.providerSubscriptionId === 'pro-yearly'
                  ? Number(subscription.price ?? 0) * 12 * 0.9
                  : (subscription.price ?? '0.00'),
              slug: subscription.slug ?? 'solo',
              expiresAt: subscription.expiresAt ?? null,
              active: subscription.active,
              providerSubscriptionId:
                subscription.providerSubscriptionId ?? null,
            };
          }
        }
      }
      const qualifications = await database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, userId));
      return {
        clinic,
        profile,
        subscription: subscriptionDetails,
        qualifications,
        noShowPolicyActive: policy?.isActive ?? false,
      };
    });
  }

  static async getClinicDetailsByUserId(
    userId: string,
    clinicId: string
  ): Promise<FullClinicResponse | null> {
    return this.getClinicDetailsById(clinicId);
  }

  /**
   * Get full nested clinic by clinicId
   */
  static async getClinicById(
    clinicId: string
  ): Promise<FullClinicResponse | null> {
    return await database.transaction(async (tx) => {
      const [clinic] = await tx
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId));

      const [profile] = await database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          userName: UserModel.userName,
          email: UserModel.email,
          mobile: UserModel.mobile,
          socialProvider: UserModel.socialProvider,
          socialProviderId: UserModel.socialProviderId,
          userType: UserModel.userType,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          isUserBlocked: UserModel.isUserBlocked,
          isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
          isArchive: UserModel.isArchive,
          paymentVisible: UserModel.paymentVisible,
          createdAt: UserModel.createdAt,
          updatedAt: UserModel.updatedAt,
          // Onboarding fields from clinic (not user)
          onboardingStatus: ClinicModel.onboardingStatus,
          approvalRequestSent: ClinicModel.approvalRequestSent,
          currentStep: ClinicModel.currentStep,
          alternateMobile: UserProfileModel.alternateMobile,
          gender: UserProfileModel.gender,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          upiIds: UserProfileModel.upiIds,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          qualification: UserProfessionalModel.qualification,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          licenseNumber: UserProfessionalModel.licenseNumber,
          speciality: UserProfessionalModel.speciality,
          specialization: UserProfessionalModel.specialization,
          registrationNumber: UserProfessionalModel.registrationNumber,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .leftJoin(ClinicModel, eq(ClinicModel.userId, UserModel.id))
        .where(eq(UserModel.id, clinic.userId));

      return {
        clinic,
        profile,
      };
    });
  }
  static async getClinicDetailsById(
    clinicId: string
  ): Promise<FullClinicResponse | null> {
    const cacheKey = `clinic_details:${clinicId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.error(
        `[Cache] Error reading clinic details cache for clinic ${clinicId}:`,
        err
      );
    }

    const result = await database.transaction(async (tx) => {
      const [clinic] = await tx
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId));

      if (!clinic) return null;

      const [profile] = await database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          userName: UserModel.userName,
          email: UserModel.email,
          mobile: UserModel.mobile,
          socialProvider: UserModel.socialProvider,
          socialProviderId: UserModel.socialProviderId,
          userType: UserModel.userType,
          userStatus: UserModel.userStatus,
          emailVerifiedAt: UserModel.emailVerifiedAt,
          isUserBlocked: UserModel.isUserBlocked,
          isAdminDoctorAccess: UserModel.isAdminDoctorAccess,
          isArchive: UserModel.isArchive,
          paymentVisible: UserModel.paymentVisible,
          createdAt: UserModel.createdAt,
          updatedAt: UserModel.updatedAt,
          // Onboarding fields from clinic (not user)
          onboardingStatus: ClinicModel.onboardingStatus,
          approvalRequestSent: ClinicModel.approvalRequestSent,
          currentStep: ClinicModel.currentStep,
          alternateMobile: UserProfileModel.alternateMobile,
          gender: UserProfileModel.gender,
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
          zipCode: UserProfileModel.zipCode,
          profileImage: UserProfileModel.profileImage,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          qualification: UserProfessionalModel.qualification,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          licenseNumber: UserProfessionalModel.licenseNumber,
          speciality: UserProfessionalModel.speciality,
          specialization: UserProfessionalModel.specialization,
          registrationNumber: UserProfessionalModel.registrationNumber,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .leftJoin(ClinicModel, eq(ClinicModel.userId, UserModel.id))
        .where(eq(UserModel.id, clinic.userId));

      // Fetch subscription details
      const [subscription] = await tx
        .select({
          planName: SubscriptionPlanModel.name,
          price: SubscriptionPlanModel.price,
          slug: SubscriptionPlanModel.slug,
          expiresAt: ClinicSubscriptionModel.expiresAt,
          active: ClinicSubscriptionModel.active,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        )
        .limit(1);

      // Fetch subscription history
      const subscriptionHistory = await tx
        .select({
          planName: SubscriptionPlanModel.name,
          price: SubscriptionPlanModel.price,
          slug: SubscriptionPlanModel.slug,
          expiresAt: ClinicSubscriptionModel.expiresAt,
          active: ClinicSubscriptionModel.active,
          startsAt: ClinicSubscriptionModel.startsAt,
        })
        .from(ClinicSubscriptionModel)
        .innerJoin(
          SubscriptionPlanModel,
          eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
        )
        .where(eq(ClinicSubscriptionModel.clinicId, clinicId))
        .orderBy(desc(ClinicSubscriptionModel.startsAt));

      // Fetch counts, users, pharmacies, labs in parallel (with limits)
      const [
        [userCount],
        [pharmacyCount],
        [labCount],
        usersData,
        pharmacies,
        labs,
      ] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.clinicId, clinicId)),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(PharmacyModel)
          .where(
            and(
              eq(PharmacyModel.clinicId, clinicId),
              eq(PharmacyModel.isDeleted, false)
            )
          ),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(LabsModel)
          .where(eq(LabsModel.clinicId, clinicId)),
        tx
          .select({ user: UserModel })
          .from(UserModel)
          .innerJoin(
            ClinicAssignModel,
            eq(UserModel.id, ClinicAssignModel.userId)
          )
          // .where(eq(ClinicAssignModel.clinicId, clinicId))
          .where(
            and(
              eq(ClinicAssignModel.clinicId, clinicId),
              ne(UserModel.userType, 'Patient') // Exclude patients
            )
          )
          .limit(100),
        tx
          .select()
          .from(PharmacyModel)
          .where(
            and(
              eq(PharmacyModel.clinicId, clinicId),
              eq(PharmacyModel.isDeleted, false)
            )
          )
          .limit(50),
        tx
          .select()
          .from(LabsModel)
          .where(eq(LabsModel.clinicId, clinicId))
          .limit(50),
      ]);

      const users = usersData.map((row) => row.user);

      const sortedUsers = users.sort((a, b) => {
        const priorityOrder: { [key: string]: number } = {
          Admin: 1,
          Doctor: 2,
          Receptionist: 3,
        };

        const priorityA = priorityOrder[a.userType] || 999;
        const priorityB = priorityOrder[b.userType] || 999;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        // If same priority or both are other types, sort alphabetically by userType
        return a.userType.localeCompare(b.userType);
      });

      return {
        clinic,
        profile,
        subscription: subscription || undefined,
        subscriptionHistory,
        counts: {
          totalUsers: Number(userCount?.count || 0),
          totalPharmacies: Number(pharmacyCount?.count || 0),
          totalLabs: Number(labCount?.count || 0),
        },
        users: sortedUsers,
        pharmacies,
        labs,
        payments: subscriptionHistory, // Using subscription history as payment details
      };
    });

    if (result) {
      try {
        await redisClient.setex(cacheKey, 43200, JSON.stringify(result));
      } catch (err) {
        logger.error(
          `[Cache] Error writing clinic details cache for clinic ${clinicId}:`,
          err
        );
      }
    }

    return result;
  }

  /**
   * Get all clinics
   */
  static async assignClinicToUser(
    clinicId: string,
    userId: string
  ): Promise<ClinicAssignRow[]> {
    return await database
      .insert(ClinicAssignModel)
      .values({
        userId,
        clinicId,
      })
      .onConflictDoUpdate({
        target: [ClinicAssignModel.userId, ClinicAssignModel.clinicId],
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  /**
   * Get all available clinics with pagination and search
   */
  /**
   * Change a clinic's lifecycle status (Super Admin only). `clinics.status`
   * and the owner's `users.user_status` are kept in sync — the same invariant
   * `UserService.updateUserStatus` maintains from the other direction.
   */
  static async updateClinicStatus(
    clinicId: string,
    status: 'Active' | 'Inactive' | 'Blocked'
  ) {
    const [clinic] = await database
      .select({ id: ClinicModel.id, userId: ClinicModel.userId })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');

    const [updatedClinic] = await database
      .update(ClinicModel)
      .set({ status, updatedAt: new Date() })
      .where(eq(ClinicModel.id, clinicId))
      .returning({
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        status: ClinicModel.status,
      });

    await database
      .update(UserModel)
      .set({ userStatus: status, updatedAt: new Date() })
      .where(eq(UserModel.id, clinic.userId));

    await ClinicService.clearClinicAccessCaches(clinicId, clinic.userId);

    return updatedClinic;
  }

  /** Re-checks the super admin's own password before a destructive clinic action. */
  private static async confirmSuperAdminPassword(
    superAdminId: string,
    password: string
  ) {
    const [superAdmin] = await database
      .select({ password: UserModel.password })
      .from(UserModel)
      .where(eq(UserModel.id, superAdminId))
      .limit(1);

    // One message for both branches: a distinct "no password set" reply would
    // tell a caller which super-admin accounts are worth guessing against.
    const confirmed =
      !!superAdmin?.password &&
      (await comparePassword(password, superAdmin.password));

    if (!confirmed) {
      throw new HttpError(401, 'Password confirmation failed');
    }
  }

  /**
   * Sends a clinic back through the onboarding wizard. Flags only — nothing is
   * deleted or blanked; the wizard decides what to prefill from these flags.
   */
  static async resetClinicOnboarding(
    clinicId: string,
    superAdminId: string,
    payload: ResetClinicOnboardingDto
  ) {
    await ClinicService.confirmSuperAdminPassword(
      superAdminId,
      payload.password
    );

    const [clinic] = await database
      .select({ id: ClinicModel.id, userId: ClinicModel.userId })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');

    const updatedClinic = await database.transaction(async (tx) => {
      // The wizard redirect needs all three gates open: onboarding unfinished,
      // no approval pending, owner not Active. A partial reset does nothing.
      const [updated] = await tx
        .update(ClinicModel)
        .set({
          onboardingStatus: 'NOT_STARTED',
          currentStep: 0,
          approvalRequestSent: false,
          status: 'Pending',
          updatedAt: new Date(),
        })
        .where(eq(ClinicModel.id, clinicId))
        .returning({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          status: ClinicModel.status,
          onboardingStatus: ClinicModel.onboardingStatus,
          currentStep: ClinicModel.currentStep,
        });

      // 'New' is the signup state and the only one the wizard survives:
      // 'Pending' is allowed on just two routes and 'Inactive' is blocked
      // outright, so either would 403 the owner mid-setup.
      await tx
        .update(UserModel)
        .set({ userStatus: 'New', updatedAt: new Date() })
        .where(eq(UserModel.id, clinic.userId));

      // End the current plan so the owner chooses one again. The row is kept:
      // the "first subscription" offer reads history, so deactivating alone
      // can never hand out a second free month.
      await tx
        .update(ClinicSubscriptionModel)
        .set({
          active: false,
          autoRenew: false,
          cancelAtPeriodEnd: true,
          cancelledAt: new Date(),
          cancellationReason: 'Onboarding reset by super admin',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        );

      // resetAt is set here, not left to the column default: defaultNow() writes
      // the DB's IST wall clock, 5h30m off the updatedAt values written above.
      await tx.insert(ClinicOnboardingResetModel).values({
        clinicId,
        performedBy: superAdminId,
        reason: payload.reason ?? null,
        resetAt: new Date(),
      });

      return updated;
    });

    // Hands the clinic back the free tier a new signup starts on, and clears
    // the subscription/plan caches. Idempotent, and only assigns anything
    // because the deactivation above left no active plan.
    await ClinicService.assignDefaultFreePlan(clinicId);
    await ClinicService.clearClinicAccessCaches(clinicId, clinic.userId);

    // Without this the owner's open tab keeps its cached "Active" profile and
    // never reaches the wizard. Staff sessions are left alone — their data is
    // untouched and the clinic stays usable while the owner redoes setup.
    realtimeBus.notifySessionInvalidated(clinic.userId, 'ONBOARDING_RESET');

    logger.info(
      `Clinic ${clinicId} onboarding reset by super admin ${superAdminId}`
    );

    return updatedClinic;
  }

  /**
   * Soft-deletes a clinic: Inactive + hidden from Clinic Management, plan ended.
   * No rows are removed; clearing deleted_at and the status restores it.
   */
  static async deleteClinic(
    clinicId: string,
    superAdminId: string,
    payload: DeleteClinicDto
  ) {
    await ClinicService.confirmSuperAdminPassword(
      superAdminId,
      payload.password
    );

    const [clinic] = await database
      .select({ id: ClinicModel.id, userId: ClinicModel.userId })
      .from(ClinicModel)
      .where(and(eq(ClinicModel.id, clinicId), isNull(ClinicModel.deletedAt)))
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');

    const deleted = await database.transaction(async (tx) => {
      // 'Inactive' already blocks the owner at login, staff in requireClinic
      // and the clinic in patient search, so no new checks are needed.
      const [updated] = await tx
        .update(ClinicModel)
        .set({
          status: 'Inactive',
          deletedAt: new Date(),
          deletedBy: superAdminId,
          deleteReason: payload.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(ClinicModel.id, clinicId))
        .returning({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          deletedAt: ClinicModel.deletedAt,
        });

      await tx
        .update(UserModel)
        .set({ userStatus: 'Inactive', updatedAt: new Date() })
        .where(eq(UserModel.id, clinic.userId));

      // Stops renewals from charging a deleted clinic; the row stays as history.
      await tx
        .update(ClinicSubscriptionModel)
        .set({
          active: false,
          autoRenew: false,
          cancelAtPeriodEnd: true,
          cancelledAt: new Date(),
          cancellationReason: 'Clinic deleted by super admin',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicSubscriptionModel.clinicId, clinicId),
            eq(ClinicSubscriptionModel.active, true)
          )
        );

      // Open bookings from today on are cancelled; past and in-progress visits stay as history.
      const cancelled = await tx
        .update(AppointmentModel)
        .set({
          appointmentStatus: 'Cancelled',
          reReasonForCancellation: 'Clinic closed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(AppointmentModel.clinicId, clinicId),
            gte(
              AppointmentModel.appointmentDate,
              startOfDayIST(getISTDateString())
            ),
            inArray(AppointmentModel.appointmentStatus, [
              'Upcoming',
              'Pending',
              'Confirmed',
              'Rescheduled',
            ])
          )
        )
        .returning({ id: AppointmentModel.id });

      // Same audit entry every other cancellation path writes.
      for (const { id } of cancelled) {
        await AppointmentActivityHistoryService.logActivity({
          appointmentId: id,
          action: 'CANCELLED',
          performedBy: superAdminId,
          newState: { appointmentStatus: 'Cancelled' },
          remarks: 'Cancelled because the clinic was deleted by a super admin',
          tx,
        });
      }

      return {
        ...updated,
        cancelledAppointmentIds: cancelled.map((a) => a.id),
      };
    });

    // Queued reminders and auto no-show jobs would still fire for cancelled visits.
    await Promise.allSettled(
      deleted.cancelledAppointmentIds.flatMap((id) => [
        whatsAppReminderQueue.removeWhatsAppReminders(id, clinicId),
        autoNoShowQueue.removeAutoNoShow(id),
      ])
    );

    const memberIds = await ClinicService.clearClinicAccessCaches(
      clinicId,
      clinic.userId
    );

    // Everyone on the clinic is signed out now rather than on their next 403.
    new Set([clinic.userId, ...memberIds]).forEach((id) =>
      realtimeBus.notifySessionInvalidated(id, 'CLINIC_DELETED')
    );

    logger.info(
      `Clinic ${clinicId} deleted by super admin ${superAdminId}; ` +
        `${deleted.cancelledAppointmentIds.length} appointments cancelled`
    );

    const { cancelledAppointmentIds, ...clinicRow } = deleted;
    return {
      ...clinicRow,
      cancelledAppointments: cancelledAppointmentIds.length,
    };
  }

  /**
   * Undoes deleteClinic: clinic and owner back as Inactive on the free plan.
   * Appointments cancelled by the delete stay cancelled.
   */
  static async restoreClinic(
    clinicId: string,
    superAdminId: string,
    payload: DeleteClinicDto
  ) {
    await ClinicService.confirmSuperAdminPassword(
      superAdminId,
      payload.password
    );

    const [clinic] = await database
      .select({ id: ClinicModel.id, userId: ClinicModel.userId })
      .from(ClinicModel)
      .where(
        and(eq(ClinicModel.id, clinicId), isNotNull(ClinicModel.deletedAt))
      )
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Deleted clinic not found');

    // Always back as Inactive: the admin activates it via Update Status, so a
    // clinic that was Blocked before the delete can't come back unblocked.
    const status = 'Inactive';

    const restored = await database.transaction(async (tx) => {
      const [updated] = await tx
        .update(ClinicModel)
        .set({
          status,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          updatedAt: new Date(),
        })
        .where(eq(ClinicModel.id, clinicId))
        .returning({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          status: ClinicModel.status,
        });

      // Owner mirrors the clinic, the invariant updateClinicStatus keeps.
      await tx
        .update(UserModel)
        .set({ userStatus: status, updatedAt: new Date() })
        .where(eq(UserModel.id, clinic.userId));

      return updated;
    });

    // The delete ended the paid plan; the free tier lets the owner pick again.
    await ClinicService.assignDefaultFreePlan(clinicId);
    await ClinicService.clearClinicAccessCaches(clinicId, clinic.userId);

    logger.info(
      `Clinic ${clinicId} restored by super admin ${superAdminId}` +
        (payload.reason ? `: ${payload.reason}` : '')
    );

    return restored;
  }

  /** Clears the plan, profile and per-member access caches; returns member ids. */
  private static async clearClinicAccessCaches(
    clinicId: string,
    ownerId: string
  ) {
    await LimitationService.invalidateClinicCache(clinicId);

    const members = await database
      .select({ userId: ClinicAssignModel.userId })
      .from(ClinicAssignModel)
      .where(eq(ClinicAssignModel.clinicId, clinicId));

    // requireClinic caches "<clinicId>:status:<status>" per member, not just the owner.
    await invalidateCacheMany([
      `clinic_details:${clinicId}`,
      `user:${ownerId}`,
      `user_clinic:${ownerId}`,
      CacheKeys.clinicProfileOverview(clinicId),
      ...members.map((m) => `user_clinic:${m.userId}`),
    ]);

    return members.map((m) => m.userId);
  }

  static async getAvailableClinics(opts: {
    page: number;
    limit: number;
    search?: string;
    status?: 'Active' | 'Inactive' | 'Blocked' | 'Deleted';
  }) {
    const offset = (opts.page - 1) * opts.limit;
    const isDeletedTab = opts.status === 'Deleted';

    // Clinic Management covers approved clinics only; 'Pending'/'Rejected'
    // belong to the Clinic Requests board.
    const managedStatuses = sql`${ClinicModel.status} IN ('Active', 'Inactive', 'Blocked')`;

    // Owners who never completed signup ('New') are skipped; every other owner
    // state is kept, since clinic status is the thing being filtered on.
    const ownerIsListable = sql`${UserModel.userStatus} <> 'New'`;

    // Soft-deleted clinics appear only under the 'Deleted' filter, where they can be restored.
    const filters = [
      managedStatuses,
      isDeletedTab
        ? isNotNull(ClinicModel.deletedAt)
        : isNull(ClinicModel.deletedAt),
    ];
    if (opts.search) {
      filters.push(
        sql`LOWER(${ClinicModel.clinicName}) LIKE LOWER(${'%' + opts.search + '%'})`
      );
    }
    // `clinics.status` is the single source of truth (kept in sync by
    // UserService.updateUserStatus), so no read-time remapping is needed.
    if (opts.status && !isDeletedTab) {
      filters.push(sql`${ClinicModel.status} = ${opts.status}`);
    }

    const whereClause = and(...filters);

    const results = await database
      .select({
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicPhone: ClinicModel.clinicPhone,
        Tagline: ClinicModel.Tagline,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        State: ClinicModel.State,
        City: ClinicModel.City,
        clinicLogo: ClinicModel.clinicLogo,
        createdAt: ClinicModel.createdAt,
        status: ClinicModel.status,
        latitude: ClinicModel.latitude,
        longitude: ClinicModel.longitude,
        planName: SubscriptionPlanModel.name,
        userStatus: UserModel.userStatus,
      })
      .from(ClinicModel)
      .innerJoin(
        UserModel,
        and(eq(UserModel.id, ClinicModel.userId), ownerIsListable)
      )
      .leftJoin(
        ClinicSubscriptionModel,
        and(
          eq(ClinicModel.id, ClinicSubscriptionModel.clinicId),
          eq(ClinicSubscriptionModel.active, true),
          or(
            isNull(ClinicSubscriptionModel.expiresAt),
            gt(ClinicSubscriptionModel.expiresAt, new Date())
          )
        )
      )
      .leftJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .where(whereClause)
      .limit(opts.limit)
      .offset(offset);

    const clinics = results.map((row) => ({
      id: row.id,
      clinicName: row.clinicName,
      clinicPhone: row.clinicPhone,
      Tagline: row.Tagline,
      clinicAddress: row.clinicAddress,
      clinicLocation: row.clinicLocation,
      State: row.State,
      City: row.City,
      clinicLogo: row.clinicLogo,
      createdAt: row.createdAt,
      status: row.status,
      latitude: row.latitude,
      longitude: row.longitude,
      planName: row.planName || 'Solo',
    }));

    const [totalCount] = await database
      .select({ count: sql`count(*)::int` })
      .from(ClinicModel)
      .innerJoin(
        UserModel,
        and(eq(UserModel.id, ClinicModel.userId), ownerIsListable)
      )
      .where(whereClause);

    // Group by the clinic's own status — the single source of truth.
    // A deleted clinic is also 'Inactive'; bucket it separately so it isn't counted twice.
    const statusExpression = sql<string>`CASE WHEN ${ClinicModel.deletedAt} IS NOT NULL THEN 'Deleted' ELSE ${ClinicModel.status}::text END`;

    const statsResults = await database
      .select({
        status: statusExpression,
        count: sql`count(*)::int`,
      })
      .from(ClinicModel)
      .innerJoin(
        UserModel,
        and(eq(UserModel.id, ClinicModel.userId), ownerIsListable)
      )
      // Stats describe the whole managed set, so they ignore the search/status
      // filters but keep the same Pending/Rejected exclusion as the list.
      .where(managedStatuses)
      .groupBy(statusExpression);

    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      blocked: 0,
      deleted: 0,
    };

    for (const row of statsResults) {
      const count = row.count as number;
      if (row.status === 'Deleted') {
        stats.deleted = count;
        continue;
      }
      stats.total += count;
      if (row.status === 'Active') {
        stats.active = count;
      } else if (row.status === 'Inactive') {
        stats.inactive = count;
      } else if (row.status === 'Blocked') {
        stats.blocked = count;
      }
    }

    return {
      stats,
      data: clinics,
      pagination: {
        total: totalCount.count,
        page: opts.page,
        limit: opts.limit,
        totalPages: Math.ceil((totalCount.count as number) / opts.limit),
      },
    };
  }

  /**
   * Get clinic detail by ID with full data for superadmin
   */
  static async getClinicDetailById(clinicId: string) {
    const result = await this.getClinicDetailsById(clinicId);
    if (!result) throw new HttpError(404, 'Clinic not found');
    return result;
  }

  static async clinicSettingUpsert(clinicId: string, payload: any) {
    const result = await database.transaction(async (tx) => {
      const { settings, reminders } = payload;

      // 1️⃣ Upsert clinic settings
      const [existingSettings] = await tx
        .select()
        .from(ClinicSettingsModel)
        .where(eq(ClinicSettingsModel.clinicId, clinicId))
        .limit(1);

      let clinicSettings;

      if (existingSettings) {
        [clinicSettings] = await tx
          .update(ClinicSettingsModel)
          .set({
            ...settings,
            updatedAt: new Date(),
          })
          .where(eq(ClinicSettingsModel.clinicId, clinicId))
          .returning();
      } else {
        [clinicSettings] = await tx
          .insert(ClinicSettingsModel)
          .values({
            clinicId,
            ...settings,
          })
          .returning();
      }

      // 2️⃣ Handle reminders
      if (Array.isArray(reminders)) {
        const incomingIds = reminders
          .filter((r: any) => r.id)
          .map((r: any) => r.id);

        // Soft delete removed reminders
        if (incomingIds.length) {
          await tx
            .update(ClinicReminderModel)
            .set({
              isActive: false,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(ClinicReminderModel.clinicId, clinicId),
                notInArray(ClinicReminderModel.id, incomingIds)
              )
            );
        }

        for (const reminder of reminders) {
          if (reminder.id) {
            // ✏️ Update
            await tx
              .update(ClinicReminderModel)
              .set({
                timeValue: reminder.timeValue,
                timeUnit: reminder.timeUnit,
                reminderType: reminder.reminderType,
                isActive: reminder.isActive ?? true,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(ClinicReminderModel.id, reminder.id),
                  eq(ClinicReminderModel.clinicId, clinicId)
                )
              );
          } else {
            // ➕ Create
            await tx.insert(ClinicReminderModel).values({
              clinicId,
              timeValue: reminder.timeValue,
              timeUnit: reminder.timeUnit,
              reminderType: reminder.reminderType,
            });
          }
        }
      }

      return {
        settings: clinicSettings,
        reminders,
      };
    });

    try {
      await redisClient.del(`clinic_settings:${clinicId}`);
      await redisClient.del(`clinic_autologout:${clinicId}`);
      // Invalidate appointment engine threshold cache so running-late
      // notifications use the updated value immediately
      await redisClient.del(`appointment_engine:threshold:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Failed to invalidate settings cache for clinic ${clinicId}:`,
        err
      );
    }

    // Settings (onlineBookingEnabled/payOnlineEnabled/payAtClinicEnabled/
    // whatsappEnabled) feed the v2 Clinic Information aggregate.
    return withCacheInvalidation(
      CacheKeys.clinicProfileOverview(clinicId),
      async () => result
    );
  }

  /**
   * Does any doctor in this clinic run a token-based day?
   *
   * Read fresh on every call and deliberately kept **out** of the settings
   * cache below, which lives for 24 hours. A clinic that switches a doctor to
   * token booking would otherwise keep seeing the old answer until tomorrow —
   * and this flag decides whether a setting is visible at all, so a stale
   * `false` hides a control the clinic just made relevant.
   */
  private static async usesTokenBooking(clinicId: string): Promise<boolean> {
    try {
      const [row] = await database
        .select({ id: ClinicAvailability.id })
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.clinicId, clinicId),
            gt(ClinicAvailability.noOfPatients, 0)
          )
        )
        .limit(1);

      return Boolean(row);
    } catch (error) {
      // Failing open: the setting stays visible rather than vanishing because
      // of a query error, which is the safer of the two wrong answers.
      logger.warn(
        `[Clinic] Token-booking check failed for clinic=${clinicId}`,
        { error }
      );
      return true;
    }
  }

  static async getSetting(clinicId: string) {
    const cacheKey = `clinic_settings:${clinicId}`;
    const usesTokenBooking = await this.usesTokenBooking(clinicId);

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return { ...JSON.parse(cached), usesTokenBooking };
      }
    } catch (err) {
      logger.error(
        `[Cache] Error reading settings cache for clinic ${clinicId}:`,
        err
      );
    }

    const [settings] = await database
      .select({
        id: ClinicSettingsModel.id,
        clinicId: ClinicSettingsModel.clinicId,
        voiceCallEnabled: ClinicSettingsModel.voiceCallEnabled,
        smsEnabled: ClinicSettingsModel.smsEnabled,
        whatsappEnabled: ClinicSettingsModel.whatsappEnabled,
        loginAlertsEnabled: ClinicSettingsModel.loginAlertsEnabled,
        autoLogoutMinutes: ClinicSettingsModel.autoLogoutMinutes,
        runningLateThresholdMinutes:
          ClinicSettingsModel.runningLateThresholdMinutes,
        onlineBookingEnabled: ClinicSettingsModel.onlineBookingEnabled,
        payOnlineEnabled: ClinicSettingsModel.payOnlineEnabled,
        payAtClinicEnabled: ClinicSettingsModel.payAtClinicEnabled,
      })
      .from(ClinicSettingsModel)
      .where(eq(ClinicSettingsModel.clinicId, clinicId))
      .limit(1);

    const reminders = await database
      .select({
        id: ClinicReminderModel.id,
        clinicId: ClinicReminderModel.clinicId,
        timeValue: ClinicReminderModel.timeValue,
        timeUnit: ClinicReminderModel.timeUnit,
        reminderType: ClinicReminderModel.reminderType,
        isActive: ClinicReminderModel.isActive,
      })
      .from(ClinicReminderModel)
      .where(
        and(
          eq(ClinicReminderModel.clinicId, clinicId),
          isNull(ClinicReminderModel.deletedAt)
        )
      )
      .orderBy(ClinicReminderModel.createdAt);

    const result = { settings, reminders };

    try {
      // The token flag is intentionally not part of the cached blob.
      await redisClient.setex(cacheKey, 86400, JSON.stringify(result));
    } catch (err) {
      logger.error(
        `[Cache] Error writing settings cache for clinic ${clinicId}:`,
        err
      );
    }

    return result;
  }

  static async getDoctorOnlineBooking(clinicId: string, doctorId: string) {
    const [assignment] = await database
      .select({
        onlineBookingEnabled: ClinicAssignModel.onlineBookingEnabled,
        maxAdvanceBookingDays: ClinicAssignModel.maxAdvanceBookingDays,
      })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, doctorId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(404, 'Doctor not found in this clinic.');
    }

    return assignment;
  }

  static async setDoctorOnlineBooking(
    actingUser: { id: string; userType: string },
    clinicId: string,
    doctorId: string,
    updates: { enabled?: boolean; maxAdvanceBookingDays?: number }
  ) {
    if (actingUser.userType === 'Doctor' && actingUser.id !== doctorId) {
      throw new HttpError(
        403,
        'Doctors can only manage their own online booking setting.'
      );
    }
    if (actingUser.userType !== 'Admin' && actingUser.userType !== 'Doctor') {
      throw new HttpError(403, 'You are not allowed to change this setting.');
    }

    const [assignment] = await database
      .select({ id: ClinicAssignModel.id })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, doctorId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(404, 'Doctor not found in this clinic.');
    }

    const setPayload: Partial<typeof ClinicAssignModel.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (updates.enabled !== undefined) {
      setPayload.onlineBookingEnabled = updates.enabled;
    }
    if (updates.maxAdvanceBookingDays !== undefined) {
      setPayload.maxAdvanceBookingDays = updates.maxAdvanceBookingDays;
    }

    const [updated] = await database
      .update(ClinicAssignModel)
      .set(setPayload)
      .where(eq(ClinicAssignModel.id, assignment.id))
      .returning();

    return updated;
  }

  static async getDoctorConsultationDuration(
    clinicId: string,
    doctorId: string
  ) {
    const [assignment] = await database
      .select({
        defaultConsultationMinutes:
          ClinicAssignModel.defaultConsultationMinutes,
      })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, doctorId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(404, 'Doctor not found in this clinic.');
    }

    return assignment;
  }

  /**
   * This doctor's consultation length at this clinic. Only consulted until the
   * engine has learned their real pace, so it is a starting point, not a cap.
   */
  static async setDoctorConsultationDuration(
    actingUser: { id: string; userType: string },
    clinicId: string,
    doctorId: string,
    defaultConsultationMinutes: number | null
  ) {
    if (actingUser.userType === 'Doctor' && actingUser.id !== doctorId) {
      throw new HttpError(
        403,
        'Doctors can only manage their own consultation length.'
      );
    }
    if (actingUser.userType !== 'Admin' && actingUser.userType !== 'Doctor') {
      throw new HttpError(403, 'You are not allowed to change this setting.');
    }

    const [assignment] = await database
      .select({ id: ClinicAssignModel.id })
      .from(ClinicAssignModel)
      .where(
        and(
          eq(ClinicAssignModel.userId, doctorId),
          eq(ClinicAssignModel.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(404, 'Doctor not found in this clinic.');
    }

    const [updated] = await database
      .update(ClinicAssignModel)
      .set({ defaultConsultationMinutes, updatedAt: new Date() })
      .where(eq(ClinicAssignModel.id, assignment.id))
      .returning({
        defaultConsultationMinutes:
          ClinicAssignModel.defaultConsultationMinutes,
      });

    // Before the recalculation below, which re-reads this figure: the other
    // order would simply cache the stale answer again.
    await ConsultationDurationService.invalidate(doctorId);

    // The queue's spacing was computed from the old length, so it is stale;
    // this recomputes and signals it, exactly as a session override does.
    void new AppointmentEngineOrchestrator().onSessionOverride(
      clinicId,
      doctorId,
      getISTDateString()
    );

    return updated;
  }

  static async deleteReminder(clinicId: string, reminderId: string) {
    const [updated] = await database
      .update(ClinicReminderModel)
      .set({
        deletedAt: new Date(),
        isActive: false,
      })
      .where(
        and(
          eq(ClinicReminderModel.id, reminderId),
          eq(ClinicReminderModel.clinicId, clinicId)
        )
      )
      .returning();

    if (!updated) {
      throw new HttpError(404, 'Reminder not found');
    }

    try {
      await redisClient.del(`clinic_settings:${clinicId}`);
      await redisClient.del(`clinic_autologout:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Failed to invalidate settings cache for clinic ${clinicId}:`,
        err
      );
    }

    return updated;
  }

  static async getClinicsWithDoctors(filters?: {
    startDate?: string;
    endDate?: string;
  }) {
    const { startDate, endDate } = filters || {};

    const clinicConditions: ReturnType<typeof eq>[] = [];
    const userConditions = [sql`${UserModel.userType} IN ('Admin')`];

    if (startDate && endDate) {
      userConditions.push(
        between(UserModel.createdAt, new Date(startDate), new Date(endDate))
      );
    } else if (startDate) {
      userConditions.push(gte(UserModel.createdAt, new Date(startDate)));
    } else if (endDate) {
      userConditions.push(lte(UserModel.createdAt, new Date(endDate)));
    }

    const doctorsWithClinics = await database
      .select({
        doctor: {
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          gender: UserProfileModel.gender,
          qualification: UserProfessionalModel.qualification,
          yearsOfExperience: UserProfessionalModel.yearsOfExperience,
          licenseNumber: UserProfessionalModel.licenseNumber,
          speciality: UserProfessionalModel.speciality,
          registrationNumber: UserProfessionalModel.registrationNumber,
          profileImage: UserProfileModel.profileImage,
          userStatus: UserModel.userStatus,
          isArchive: UserModel.isArchive,
          userType: UserModel.userType,
          createdAt: UserModel.createdAt,
        },
        clinic: {
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
          status: ClinicModel.status,
          latitude: ClinicModel.latitude,
          longitude: ClinicModel.longitude,
        },
      })
      .from(UserModel)
      .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
      .leftJoin(
        UserProfessionalModel,
        eq(UserProfessionalModel.userId, UserModel.id)
      )
      .innerJoin(ClinicAssignModel, eq(ClinicAssignModel.userId, UserModel.id))
      .innerJoin(
        ClinicModel,
        clinicConditions.length > 0
          ? and(
              eq(ClinicModel.id, ClinicAssignModel.clinicId),
              ...clinicConditions
            )
          : eq(ClinicModel.id, ClinicAssignModel.clinicId)
      )
      .where(and(...userConditions))
      .orderBy(desc(UserModel.createdAt));

    const result = doctorsWithClinics.map((item) => ({
      id: item.doctor.id,
      name: item.doctor.name,
      email: item.doctor.email,
      mobile: item.doctor.mobile,
      gender: item.doctor.gender,
      qualification: item.doctor.qualification,
      yearsOfExperience: item.doctor.yearsOfExperience,
      licenseNumber: item.doctor.licenseNumber,
      speciality: item.doctor.speciality,
      registrationNumber: item.doctor.registrationNumber,
      profileImage: item.doctor.profileImage,
      userStatus: item.doctor.userStatus,
      userType: item.doctor.userType,
      isArchive: item.doctor.isArchive,
      createdAt: item.doctor.createdAt,
      clinic: item.clinic,
    }));

    return result;
  }

  static async onboardRouteAccount(
    clinicId: string,
    data: OnboardRouteDto,
    _clientIp: string
  ) {
    const [clinic] = await database
      .select({
        id: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        userId: ClinicModel.userId,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        razorpayStakeholderId: ClinicPaymentAccountModel.gatewayStakeholderId,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
      })
      .from(ClinicModel)
      .leftJoin(
        ClinicPaymentAccountModel,
        and(
          eq(ClinicModel.id, ClinicPaymentAccountModel.clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');
    if (clinic.razorpayAccountId && clinic.routeStatus === 'ACTIVE') {
      throw new HttpError(400, 'Clinic is already active on Razorpay Route');
    }

    let accountId = clinic.razorpayAccountId;
    let stakeholderId = clinic.razorpayStakeholderId;

    // 1. Create Base Account if not already created
    if (!accountId) {
      const razorpayAccount = await createRazorpayRouteAccount({
        email: data.stakeholder.email,
        phone: data.stakeholder.phone,
        name: data.legalBusinessName,
        referenceId: clinic.id,
        contactName: data.stakeholder.name,
        address: {
          street: data.address.street,
          city: data.address.city,
          state: data.address.state,
          postalCode: data.address.postalCode,
          country: 'IN',
        },
      });
      accountId = razorpayAccount.id;
    }

    // 2. Create Stakeholder if not already created
    if (accountId && !stakeholderId) {
      const stakeholder = await createRazorpayStakeholder(accountId, {
        name: data.stakeholder.name,
        email: data.stakeholder.email,
        phone: data.stakeholder.phone,
        pan: data.stakeholder.pan,
        dob: data.stakeholder.dob,
        address: {
          street: data.address.street,
          city: data.address.city,
          state: data.address.state,
          postalCode: data.address.postalCode,
          country: 'IN',
        },
      });
      stakeholderId = stakeholder.id;
    }

    if (!accountId || !stakeholderId) {
      throw new HttpError(
        500,
        'Razorpay account or stakeholder configuration failed'
      );
    }

    // 3. Update/Upsert the ClinicPaymentAccountModel
    const [existingAccount] = await database
      .select({ id: ClinicPaymentAccountModel.id })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (existingAccount) {
      await database
        .update(ClinicPaymentAccountModel)
        .set({
          gatewayAccountId: accountId,
          gatewayStakeholderId: stakeholderId,
          routeStatus: 'DRAFT',
          routeOnboardingRejectionReason: null,
          onboardingDraftData: JSON.stringify(data),
          updatedAt: new Date(),
        })
        .where(eq(ClinicPaymentAccountModel.id, existingAccount.id));
    } else {
      await database.insert(ClinicPaymentAccountModel).values({
        clinicId,
        paymentProvider: 'razorpay',
        gatewayAccountId: accountId,
        gatewayStakeholderId: stakeholderId,
        routeStatus: 'DRAFT',
        routeOnboardingRejectionReason: null,
        onboardingDraftData: JSON.stringify(data),
      });
    }

    try {
      await redisClient.del(`clinic_details:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in onboardRouteAccount for clinic ${clinicId}:`,
        err
      );
    }

    return {
      ...clinic,
      razorpayAccountId: accountId,
      razorpayStakeholderId: stakeholderId,
      routeStatus: 'DRAFT',
    };
  }

  /**
   * Activates the Razorpay Route product configuration and updates settlements for a clinic.
   * This is typically called at the end of the onboarding flow after documents are uploaded.
   */
  static async activateRouteAccount(clinicId: string, clientIp: string) {
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        onboardingDraftData: ClinicPaymentAccountModel.onboardingDraftData,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) {
      throw new HttpError(
        404,
        'Clinic has not initiated Route onboarding details'
      );
    }
    if (!clinic.razorpayAccountId) {
      throw new HttpError(400, 'Razorpay account has not been created yet');
    }
    if (clinic.routeStatus === 'ACTIVE') {
      throw new HttpError(400, 'Clinic is already active on Razorpay Route');
    }
    if (!clinic.onboardingDraftData) {
      throw new HttpError(400, 'No onboarding details found to activate');
    }

    let parsedDraft: any;
    try {
      parsedDraft = JSON.parse(clinic.onboardingDraftData);
    } catch {
      throw new HttpError(400, 'Invalid onboarding details data');
    }

    if (!parsedDraft.bankDetails) {
      throw new HttpError(
        400,
        'Bank details are required to activate Route onboarding'
      );
    }

    const accountId = clinic.razorpayAccountId;

    // 1. Request Route product config
    const productsRes = await fetchRazorpayRouteAccountAllProducts(accountId);
    const products = productsRes?.items || [];
    const routeProduct = products.find((p: any) => p.product_name === 'route');
    let productId = routeProduct?.id;

    if (!productId) {
      const productConfig = await requestRazorpayProductConfig(
        accountId,
        clientIp
      );
      productId = productConfig.id;
    }

    if (!productId) {
      throw new HttpError(
        500,
        'Razorpay product activation configuration failed'
      );
    }

    // 2. Update product settlements configuration with bank details
    await updateRazorpayProductSettlements(accountId, productId, {
      beneficiaryName: parsedDraft.bankDetails.beneficiaryName,
      accountNumber: parsedDraft.bankDetails.accountNumber,
      ifscCode: parsedDraft.bankDetails.ifscCode,
      accountType: parsedDraft.bankDetails.accountType,
    });

    // 3. Transition status to PENDING
    await database
      .update(ClinicPaymentAccountModel)
      .set({
        routeStatus: 'PENDING',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      );

    try {
      await redisClient.del(`clinic_details:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in activateRouteAccount for clinic ${clinicId}:`,
        err
      );
    }

    return {
      accountId,
      routeStatus: 'PENDING',
    };
  }

  /**
   * Uploads KYC verification documents for sub-merchant onboarding.
   */
  static async uploadKYCDocuments(
    clinicId: string,
    documentType: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string
  ) {
    const [clinic] = await database
      .select({
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        razorpayStakeholderId: ClinicPaymentAccountModel.gatewayStakeholderId,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic not found');
    if (!clinic.razorpayAccountId) {
      throw new HttpError(
        400,
        'Clinic has not initiated Razorpay Route onboarding'
      );
    }

    // personal documents (e.g. pan, passport, aadhaar) need stakeholder association
    const isStakeholderDoc = [
      'pan',
      'passport',
      'aadhaar_front',
      'aadhaar_back',
    ].includes(documentType);
    const stakeholderId = isStakeholderDoc
      ? clinic.razorpayStakeholderId
      : null;

    const docUploadRes = await uploadRazorpayDocument(
      clinic.razorpayAccountId,
      stakeholderId,
      documentType,
      fileBuffer,
      fileName,
      mimeType
    );

    return docUploadRes;
  }

  /**
   * Updates settlement bank details on active or pending accounts.
   */
  static async updateSettlementBank(
    clinicId: string,
    bankDetails: UpdateBankDetailsDto,
    _clientIp: string
  ) {
    const [clinic] = await database
      .select({
        id: ClinicPaymentAccountModel.id,
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        onboardingDraftData: ClinicPaymentAccountModel.onboardingDraftData,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) throw new HttpError(404, 'Clinic payment profile not found');
    if (!clinic.razorpayAccountId) {
      throw new HttpError(
        400,
        'Clinic has not initiated Razorpay Route onboarding'
      );
    }

    const accountId = clinic.razorpayAccountId;

    // Resolve target Route product ID dynamically
    const productsRes = await fetchRazorpayRouteAccountAllProducts(accountId);
    const products = productsRes?.items || [];
    const routeProduct = products.find((p: any) => p.product_name === 'route');

    if (!routeProduct) {
      throw new HttpError(
        400,
        'Route product configuration not found on Razorpay sub-account'
      );
    }

    const productId = routeProduct.id;

    // PATCH product configuration Settlements with updated details
    await updateRazorpayProductSettlements(accountId, productId, bankDetails);

    // Save updated details into the local onboarding draft store
    let updatedDraft = '';
    if (clinic.onboardingDraftData) {
      try {
        const parsed = JSON.parse(clinic.onboardingDraftData);
        parsed.bankDetails = bankDetails;
        updatedDraft = JSON.stringify(parsed);
      } catch {
        // Fallback if parsing failed
        updatedDraft = JSON.stringify({ bankDetails });
      }
    } else {
      updatedDraft = JSON.stringify({ bankDetails });
    }

    // Set local routeStatus back to PENDING while Razorpay runs penny verification
    const [updatedClinic] = await database
      .update(ClinicPaymentAccountModel)
      .set({
        routeStatus: 'PENDING',
        routeOnboardingRejectionReason: null,
        onboardingDraftData: updatedDraft,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .returning();

    try {
      await redisClient.del(`clinic_details:${clinicId}`);
    } catch (err) {
      logger.error(
        `[Cache] Error invalidating clinic details cache in updateSettlementBank for clinic ${clinicId}:`,
        err
      );
    }

    return updatedClinic;
  }

  /**
   * Retrieves current onboarding status and parsed draft submission details.
   */
  static async getOnboardingStatus(clinicId: string) {
    const [clinic] = await database
      .select({
        razorpayAccountId: ClinicPaymentAccountModel.gatewayAccountId,
        routeStatus: ClinicPaymentAccountModel.routeStatus,
        routeOnboardingRejectionReason:
          ClinicPaymentAccountModel.routeOnboardingRejectionReason,
        onboardingDraftData: ClinicPaymentAccountModel.onboardingDraftData,
      })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.clinicId, clinicId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!clinic) {
      return {
        accountId: null,
        routeStatus: 'INACTIVE',
        rejectionReason: null,
        submittedDetails: null,
      };
    }

    let submittedDetails = null;
    if (clinic.onboardingDraftData) {
      try {
        submittedDetails = JSON.parse(clinic.onboardingDraftData);
      } catch {
        // Safe fallback
      }
    }

    return {
      accountId: clinic.razorpayAccountId,
      routeStatus: clinic.routeStatus,
      rejectionReason: clinic.routeOnboardingRejectionReason,
      submittedDetails,
    };
  }

  /**
   * Syncs and snapshots the current active bank details config from Razorpay to local database history.
   */
  static async syncClinicBankHistory(accountId: string, productId: string) {
    // 1. Fetch clinic matching the razorpayAccountId
    const [account] = await database
      .select({ clinicId: ClinicPaymentAccountModel.clinicId })
      .from(ClinicPaymentAccountModel)
      .where(
        and(
          eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
          eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
        )
      )
      .limit(1);

    if (!account) {
      logger.warn(`No clinic found matching Razorpay account ID: ${accountId}`);
      return;
    }
    const clinic = { id: account.clinicId };

    // 2. Fetch configurations from Razorpay
    const products = await fetchRazorpayRouteAccountProducts(
      accountId,
      productId
    );

    // Safely extract settlements active configuration
    const settlements =
      products?.requested_configuration?.settlements ||
      products?.active_configuration?.settlements;
    if (!settlements) {
      logger.warn(
        `No settlement configuration found for account: ${accountId}`
      );
      return;
    }

    const newAccNum = settlements.account_number;
    const newIfsc = settlements.ifsc_code;
    const newName = settlements.beneficiary_name;
    const newBankName = settlements.bank_name || null;

    // 3. Query the current active snapshot in the DB
    const [currentActive] = await database
      .select()
      .from(ClinicBankHistoryModel)
      .where(
        and(
          eq(ClinicBankHistoryModel.clinicId, clinic.id),
          eq(ClinicBankHistoryModel.isActive, true)
        )
      )
      .limit(1);

    // 4. Compare and update versions if they differ
    const hasChanged =
      !currentActive ||
      currentActive.maskedAccountNumber !== newAccNum ||
      currentActive.ifscCode !== newIfsc ||
      currentActive.beneficiaryName !== newName ||
      currentActive.bankName !== newBankName;

    if (hasChanged) {
      const now = new Date();

      if (currentActive) {
        // Mark the old snapshot as inactive and set ending date
        await database
          .update(ClinicBankHistoryModel)
          .set({
            isActive: false,
            effectiveTo: now,
            updatedAt: now,
          })
          .where(eq(ClinicBankHistoryModel.id, currentActive.id));
      }

      // Insert the new active snapshot
      await database.insert(ClinicBankHistoryModel).values({
        clinicId: clinic.id,
        linkedAccountId: null,
        providerLinkedAccountId: accountId,
        beneficiaryName: newName,
        bankName: newBankName,
        maskedAccountNumber: newAccNum,
        ifscCode: newIfsc,
        effectiveFrom: now,
        isActive: true,
      });

      logger.info(`Recorded new bank history version for clinic ${clinic.id}`);
    }
  }

  /**
   * Fetches the currently active verified bank configuration snapshot for a clinic.
   */
  static async getActiveBankDetails(clinicId: string) {
    const [bankDetails] = await database
      .select({
        beneficiaryName: ClinicBankHistoryModel.beneficiaryName,
        bankName: ClinicBankHistoryModel.bankName,
        maskedAccountNumber: ClinicBankHistoryModel.maskedAccountNumber,
        ifscCode: ClinicBankHistoryModel.ifscCode,
        isActive: ClinicBankHistoryModel.isActive,
      })
      .from(ClinicBankHistoryModel)
      .where(
        and(
          eq(ClinicBankHistoryModel.clinicId, clinicId),
          eq(ClinicBankHistoryModel.isActive, true)
        )
      )
      .limit(1);

    return bankDetails || null;
  }

  /**
   * Processes onboarding webhooks from Razorpay (account.activated, account.updated, product.activated).
   */
  static async handleRazorpayAccountWebhook(event: string, payload: any) {
    if (event === 'account.activated') {
      const account = payload.account.entity;
      const accountId = account.id;

      await database
        .update(ClinicPaymentAccountModel)
        .set({
          routeStatus: 'ACTIVE',
          routeOnboardedAt: new Date(),
          routeOnboardingRejectionReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
            eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
          )
        );

      try {
        const productsRes =
          await fetchRazorpayRouteAccountAllProducts(accountId);
        const products = productsRes?.items || [];
        const routeProduct = products.find(
          (p: any) => p.product_name === 'route'
        );
        if (routeProduct) {
          await this.syncClinicBankHistory(accountId, routeProduct.id);
        }
      } catch (err) {
        logger.error(
          `[Webhook] Error syncing bank history on account.activated:`,
          err
        );
      }
    } else if (event === 'account.updated') {
      const account = payload.account.entity;
      const accountId = account.id;
      const status = account.status;
      const requirements = account.requirements || [];

      if (status === 'needs_clarification') {
        const rejectionRemarks =
          requirements
            .map(
              (r: any) =>
                `${r.field || 'Field'}: ${r.description || r.reason || 'Verification failed'}`
            )
            .join('; ') || 'KYC verification requires clarification.';

        await database
          .update(ClinicPaymentAccountModel)
          .set({
            routeStatus: 'NEEDS_CLARIFICATION',
            routeOnboardingRejectionReason: rejectionRemarks,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );
      } else if (status === 'suspended') {
        await database
          .update(ClinicPaymentAccountModel)
          .set({
            routeStatus: 'SUSPENDED',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );
      } else if (status === 'activated') {
        await database
          .update(ClinicPaymentAccountModel)
          .set({
            routeStatus: 'ACTIVE',
            routeOnboardedAt: new Date(),
            routeOnboardingRejectionReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );

        try {
          const productsRes =
            await fetchRazorpayRouteAccountAllProducts(accountId);
          const products = productsRes?.items || [];
          const routeProduct = products.find(
            (p: any) => p.product_name === 'route'
          );
          if (routeProduct) {
            await this.syncClinicBankHistory(accountId, routeProduct.id);
          }
        } catch (err) {
          logger.error(
            `[Webhook] Error syncing bank history on account.updated activated:`,
            err
          );
        }
      }
    } else if (event === 'product.activated') {
      const product = payload.product.entity;
      const accountId = product.account_id;
      const productName = product.product_name;

      if (productName === 'route') {
        await database
          .update(ClinicPaymentAccountModel)
          .set({
            routeStatus: 'ACTIVE',
            routeOnboardedAt: new Date(),
            routeOnboardingRejectionReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ClinicPaymentAccountModel.gatewayAccountId, accountId),
              eq(ClinicPaymentAccountModel.paymentProvider, 'razorpay')
            )
          );

        try {
          await this.syncClinicBankHistory(accountId, product.id);
        } catch (err) {
          logger.error(
            `[Webhook] Error syncing bank history on product.activated:`,
            err
          );
        }
      }
    }
  }

  static async requestClinicPhoneUpdate(
    clinicId: string,
    phone: string
  ): Promise<any> {
    const [clinic] = await database
      .select({
        id: ClinicModel.id,
        clinicPhone: ClinicModel.clinicPhone,
        isClinicPhoneVerified: ClinicModel.isClinicPhoneVerified,
      })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);

    if (!clinic) {
      throw new HttpError(404, 'Clinic not found');
    }

    if (clinic.clinicPhone === phone && clinic.isClinicPhoneVerified) {
      throw new HttpError(400, 'This phone number is already verified.');
    }

    const otp = generateOTP(6);
    const redisKey = `clinic:phone_otp:${clinicId}`;

    await redisClient.set(
      redisKey,
      JSON.stringify({
        phone,
        otpHash: hashToken(otp),
        resendCount: 0,
        lastSentAt: Date.now(),
      }),
      'EX',
      600 // 10 minutes
    );

    // Must match the DLT-registered "admin verification code" template
    // exactly — smsClient.sendSMS() routes on this substring to pick
    // DLT_TEMPLATE_ADMIN_MOBILE_VERIFICATION, and carriers reject content
    // that doesn't match the template ID's registered text.
    const messageBody = `INFINITYGENESIS TECHSO PRIVATE LIMITED: Your Infinity MediSetu verification code is ${otp}. It is valid for 10 minutes. Do not share this code with anyone.`;

    try {
      await sendSMS(`+91${phone}`, messageBody);
    } catch (error) {
      await redisClient.del(redisKey);
      logger.error(
        `Failed to send clinic phone verification SMS to ${phone}: ${(error as Error).message}`
      );
      throw new HttpError(
        502,
        'Failed to send verification code. Please try again.'
      );
    }

    return {
      message: 'Verification OTP sent to the mobile number successfully.',
    };
  }

  /**
   * Resend a fresh OTP for an in-progress clinic phone verification session.
   * Enforces the same per-request cooldown and max resend cap as the patient
   * OTP flow, keyed by clinicId since the session itself is stored per-clinic.
   */
  static async resendClinicPhoneOtp(
    clinicId: string,
    phone: string
  ): Promise<any> {
    const rateKey = `clinic:phone_otp_rate:${clinicId}`;
    const sendCount = await redisClient.incr(rateKey);
    if (sendCount === 1) {
      await redisClient.expire(rateKey, CLINIC_OTP_RATE_WINDOW_SECS);
    }
    if (sendCount > CLINIC_OTP_MAX_ATTEMPTS_PER_WINDOW) {
      throw new HttpError(
        429,
        'Too many OTP requests. Please try again later.'
      );
    }

    const redisKey = `clinic:phone_otp:${clinicId}`;
    const storedData = await redisClient.get(redisKey);

    if (!storedData) {
      throw new HttpError(
        400,
        'No active verification session found. Please request a new OTP.'
      );
    }

    const existing = JSON.parse(storedData);

    if (existing.phone !== phone) {
      throw new HttpError(
        400,
        'Invalid mobile number for this verification session.'
      );
    }

    const resendCount = existing.resendCount ?? 0;
    if (resendCount >= CLINIC_OTP_MAX_RESEND_COUNT) {
      throw new HttpError(
        429,
        'Maximum resend limit reached. Please request a new OTP after 10 minutes.'
      );
    }

    const lastSentAt = existing.lastSentAt ?? 0;
    const secondsSinceLast = (Date.now() - lastSentAt) / 1000;
    if (secondsSinceLast < CLINIC_OTP_RESEND_COOLDOWN_SECS) {
      const waitSeconds = Math.ceil(
        CLINIC_OTP_RESEND_COOLDOWN_SECS - secondsSinceLast
      );
      throw new HttpError(
        429,
        `Please wait ${waitSeconds} seconds before requesting another OTP.`
      );
    }

    const otp = generateOTP(6);
    const newResendCount = resendCount + 1;

    await redisClient.set(
      redisKey,
      JSON.stringify({
        phone,
        otpHash: hashToken(otp),
        resendCount: newResendCount,
        lastSentAt: Date.now(),
      }),
      'EX',
      600
    );

    const messageBody = `INFINITYGENESIS TECHSO PRIVATE LIMITED: Your Infinity MediSetu verification code is ${otp}. It is valid for 10 minutes. Do not share this code with anyone.`;

    try {
      await sendSMS(`+91${phone}`, messageBody);
    } catch (error) {
      // Roll back to the prior session so the clinic isn't locked out by a failed send.
      await redisClient.set(redisKey, storedData, 'EX', 600);
      logger.error(
        `Failed to resend clinic phone verification SMS to ${phone}: ${(error as Error).message}`
      );
      throw new HttpError(
        502,
        'Failed to resend verification code. Please try again.'
      );
    }

    return {
      message: 'Verification OTP resent successfully.',
      resendCount: newResendCount,
    };
  }

  static async verifyClinicPhone(
    clinicId: string,
    phone: string,
    otp: string
  ): Promise<any> {
    const redisKey = `clinic:phone_otp:${clinicId}`;
    const storedData = await redisClient.get(redisKey);

    if (!storedData) {
      throw new HttpError(
        400,
        'Verification session has expired or does not exist.'
      );
    }

    const { phone: storedPhone, otpHash: storedOtpHash } =
      JSON.parse(storedData);

    if (storedPhone !== phone) {
      throw new HttpError(
        400,
        'Invalid mobile number for this verification session.'
      );
    }

    if (storedOtpHash !== hashToken(otp)) {
      throw new HttpError(400, 'Invalid verification code.');
    }

    await database
      .update(ClinicModel)
      .set({
        clinicPhone: phone,
        isClinicPhoneVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(ClinicModel.id, clinicId));

    await redisClient.del(redisKey);
    await redisClient.del(`clinic_details:${clinicId}`);

    return {
      message: 'Clinic phone number updated and verified successfully.',
    };
  }
}
