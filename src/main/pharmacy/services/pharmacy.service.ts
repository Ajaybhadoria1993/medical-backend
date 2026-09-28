import { and, eq, sql, or, ne, inArray, desc, isNull } from 'drizzle-orm';
import {
  ClinicAssignModel,
  ClinicModel,
} from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { database } from '../../../configurations/dbConnection';
import { PharmacyAssignModel, PharmacyModel } from '../models/pharmacy.model';
import { PrescriptionQueueModel } from '../models/prescriptionQueue.model';
import { HttpError } from '../../../middlewear/errorHandler';
import { pagination } from '../../../utils/utils';
import { UpdatePharmacyInput } from '../schemas/pharmacy.schemas';
import logger from '../../../utils/logger';
import { LimitationService } from '../../subscription/services/limitation.service';
type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

export type CreatePharmacyPayload = {
  name: string;
  contactNumber: string;
  address: string;
  registrationNumber?: string;
  gstNumber?: string;
  panNumber?: string;
  licenseNumber?: string;
  fssaiNumber?: string;
};
function mapPharmacyStatusToUserStatus(
  status: 'active' | 'deactive'
): 'Active' | 'Inactive' {
  return status === 'deactive' ? 'Inactive' : 'Active';
}

export type CreatePharmacyUserPayload = {
  name: string;
  email: string;
  mobile?: string;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
};

export class PharmacyService {
  static async createPharmacy(
    payload: CreatePharmacyPayload,
    clinicId: string,
    adminUserId: string
  ) {
    logger.info('createPharmacy', { payload, clinicId, adminUserId });
    const pharmacy = await database.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: PharmacyModel.id,
          contactNumber: PharmacyModel.contactNumber,
        })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.name, payload.name),
            eq(PharmacyModel.contactNumber, payload.contactNumber),
            eq(PharmacyModel.isDeleted, false),
            isNull(PharmacyModel.deletedAt)
          )
        )
        .limit(1);
      if (existing) {
        if (existing.contactNumber === payload.contactNumber) {
          throw new HttpError(
            400,
            'Pharmacy with this phone number already exists in clinic'
          );
        }
        throw new HttpError(
          400,
          'Pharmacy with this name already exists in clinic'
        );
      }

      const [created] = await tx
        .insert(PharmacyModel)
        .values({
          clinicId,
          name: payload.name,
          address: payload.address,
          contactNumber: payload.contactNumber,
          registrationNumber: payload.registrationNumber,
          gstNumber: payload.gstNumber,
          panNumber: payload.panNumber,
          licenseNumber: payload.licenseNumber,
          fssaiNumber: payload.fssaiNumber,
          status: 'active',
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning();

      return created;
    });

    // The limits overview counts pharmacies; cleared after commit so it can't re-cache the old count.
    await LimitationService.invalidateClinicCache(clinicId);

    if (pharmacy && adminUserId) {
      setImmediate(async () => {
        try {
          const { ClinicModel } =
            await import('../../clinic/models/clinic.model');
          const { UserModel } = await import('../../users/models/user.model');
          const { sendEmail } = await import('../../../utils/email');
          const { pharmacyCreationNotificationTemplate } =
            await import('../../../htmltamplates/pharmacyCreationNotification');

          const [clinic] = await database
            .select()
            .from(ClinicModel)
            .where(eq(ClinicModel.id, clinicId))
            .limit(1);

          const [adminUser] = await database
            .select()
            .from(UserModel)
            .where(eq(UserModel.id, adminUserId))
            .limit(1);

          if (adminUser && adminUser.email) {
            await sendEmail(
              adminUser.email,
              `Infinity Medisetu - Pharmacy Created: ${pharmacy.name} at ${clinic?.clinicName || 'Clinic'}`,
              pharmacyCreationNotificationTemplate({
                adminName: adminUser.name ?? '',
                pharmacyName: pharmacy.name,
                clinicName: clinic?.clinicName || 'Clinic',
                address: pharmacy.address,
                contactNumber: pharmacy.contactNumber,
              })
            );
          }
        } catch (error) {
          logger.error(
            'Error sending welcome email to pharmacy creator:',
            error
          );
        }
      });
    }

    return {
      id: pharmacy.id,
      name: pharmacy.name,
      address: pharmacy.address,
      contactNumber: pharmacy.contactNumber,
      registrationNumber: pharmacy.registrationNumber,
      gstNumber: pharmacy.gstNumber,
      panNumber: pharmacy.panNumber,
      licenseNumber: pharmacy.licenseNumber,
      fssaiNumber: pharmacy.fssaiNumber,
      clinicId: pharmacy.clinicId,
    };
  }

  static async updatePharmacy(
    pharmacyId: string,
    clinicId: string,
    payload: UpdatePharmacyInput
  ) {
    return await database.transaction(async (tx) => {
      // 1️⃣ Check pharmacy exists
      const [existingPharmacy] = await tx
        .select({
          id: PharmacyModel.id,
          status: PharmacyModel.status,
        })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false),
            isNull(PharmacyModel.deletedAt)
          )
        )
        .limit(1);

      if (!existingPharmacy) {
        throw new HttpError(404, 'Pharmacy not found');
      }
      // 4️⃣ 🔥 If pharmacy status changed → update assigned users
      if (payload.status && payload.status !== existingPharmacy.status) {
        const newUserStatus = mapPharmacyStatusToUserStatus(payload.status);

        // Get all users assigned to this pharmacy
        const pharmacyUsers = await tx
          .select({ userId: PharmacyAssignModel.userId })
          .from(PharmacyAssignModel)
          .where(eq(PharmacyAssignModel.pharmacyId, pharmacyId));

        if (pharmacyUsers.length > 0) {
          const userIds = pharmacyUsers.map((u) => u.userId);

          await tx
            .update(UserModel)
            .set({
              userStatus: newUserStatus,
              updatedAt: new Date(),
            })
            .where(inArray(UserModel.id, userIds));
        }
      }
      // 2️⃣ Duplicate name / contact check (exclude self)
      const conditions = [];

      if (payload.name) {
        conditions.push(eq(PharmacyModel.name, payload.name));
      }

      if (payload.contactNumber) {
        conditions.push(eq(PharmacyModel.contactNumber, payload.contactNumber));
      }

      if (conditions.length) {
        const [duplicate] = await tx
          .select({
            id: PharmacyModel.id,
            name: PharmacyModel.name,
            contactNumber: PharmacyModel.contactNumber,
          })
          .from(PharmacyModel)
          .where(
            and(
              eq(PharmacyModel.clinicId, clinicId),
              eq(PharmacyModel.isDeleted, false),
              isNull(PharmacyModel.deletedAt),
              ne(PharmacyModel.id, pharmacyId),
              or(...conditions)
            )
          )
          .limit(1);

        if (duplicate) {
          if (
            payload.contactNumber &&
            duplicate.contactNumber === payload.contactNumber
          ) {
            throw new HttpError(
              400,
              'Pharmacy with this phone number already exists in clinic'
            );
          }

          if (payload.name && duplicate.name === payload.name) {
            throw new HttpError(
              400,
              'Pharmacy with this name already exists in clinic'
            );
          }
        }
      }

      // 3️⃣ Update pharmacy
      const [updated] = await tx
        .update(PharmacyModel)
        .set({
          ...payload,
          updatedAt: new Date(),
        })
        .where(eq(PharmacyModel.id, pharmacyId))
        .returning({
          id: PharmacyModel.id,
          name: PharmacyModel.name,
          address: PharmacyModel.address,
          contactNumber: PharmacyModel.contactNumber,
          registrationNumber: PharmacyModel.registrationNumber,
          gstNumber: PharmacyModel.gstNumber,
          panNumber: PharmacyModel.panNumber,
          licenseNumber: PharmacyModel.licenseNumber,
          fssaiNumber: PharmacyModel.fssaiNumber,
          status: PharmacyModel.status,
          clinicId: PharmacyModel.clinicId,
        });

      // 4️⃣ 🔥 If pharmacy status changed → update assigned users
      if (payload.status && payload.status !== existingPharmacy.status) {
        const newUserStatus = mapPharmacyStatusToUserStatus(payload.status);

        // get users assigned to this pharmacy
        const pharmacyUsers = await tx
          .select({ userId: PharmacyAssignModel.userId })
          .from(PharmacyAssignModel)
          .where(eq(PharmacyAssignModel.pharmacyId, pharmacyId));

        if (pharmacyUsers.length) {
          const userIds = pharmacyUsers.map((u) => u.userId);

          await tx
            .update(UserModel)
            .set({
              userStatus: newUserStatus,
              updatedAt: new Date(),
            })
            .where(inArray(UserModel.id, userIds));
        }
      }

      return updated;
    });
  }

  static async assignUserToPharmacy(
    pharmacyId: string,
    userId: string,
    clinicId: string,
    userRole?: string
  ) {
    return await database.transaction(async (tx) => {
      const [pharm] = await tx
        .select({
          clinicId: PharmacyModel.clinicId,
          status: PharmacyModel.status, // 👈 include status
        })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.isDeleted, false),
            isNull(PharmacyModel.deletedAt)
          )
        )
        .limit(1);

      if (!pharm) throw new HttpError(404, 'Pharmacy not found');

      if (pharm.clinicId !== clinicId) {
        throw new HttpError(
          400,
          'Pharmacy does not belong to the current clinic'
        );
      }

      // 🔥 NEW CHECK: Prevent assignment if pharmacy is inactive
      if (pharm.status !== 'active') {
        throw new HttpError(
          400,
          `Cannot assign user. Pharmacy is ${pharm.status}`
        );
      }

      const [clinicAssignment] = await tx
        .select({ id: ClinicAssignModel.id })
        .from(ClinicAssignModel)
        .where(
          and(
            eq(ClinicAssignModel.userId, userId),
            eq(ClinicAssignModel.clinicId, clinicId)
          )
        )
        .limit(1);
      if (!clinicAssignment) {
        throw new HttpError(403, 'User is not assigned to this clinic');
      }

      const [dupe] = await tx
        .select({ id: PharmacyAssignModel.id })
        .from(PharmacyAssignModel)
        .where(
          and(
            eq(PharmacyAssignModel.userId, userId),
            eq(PharmacyAssignModel.pharmacyId, pharmacyId)
          )
        )
        .limit(1);
      if (dupe) {
        return { alreadyAssigned: true };
      }

      const [created] = await tx
        .insert(PharmacyAssignModel)
        .values({
          userId,
          pharmacyId,
          clinicId,
          userRole,
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .returning({ id: PharmacyAssignModel.id });

      return { id: created.id };
    });
  }

  static async createPharmacyUser(
    payload: CreatePharmacyUserPayload,
    clinicId: string,
    pharmacyId: string
  ) {
    return await database
      .transaction(async (tx) => {
        const [pharm] = await tx
          .select({ clinicId: PharmacyModel.clinicId })
          .from(PharmacyModel)
          .where(
            and(
              eq(PharmacyModel.id, pharmacyId),
              eq(PharmacyModel.isDeleted, false)
            )
          )
          .limit(1);
        if (!pharm) throw new HttpError(404, 'Pharmacy not found');
        if (pharm.clinicId !== clinicId) {
          throw new HttpError(
            400,
            'Pharmacy does not belong to the current clinic'
          );
        }

        if (payload.email) {
          const [existingEmail] = await tx
            .select({ id: UserModel.id })
            .from(UserModel)
            .where(eq(UserModel.email, payload.email))
            .limit(1);
          if (existingEmail) {
            throw new HttpError(400, 'Email already exists');
          }
        }

        // Create user WITHOUT password (will be generated after email verification)
        const [newUser] = await tx
          .insert(UserModel)
          .values({
            name: payload.name,
            email: payload.email,
            mobile: payload.mobile,
            emailVerifiedAt: new Date(),
            userStatus: 'New',
            userType: 'Pharmacist',
            createdAt: sql`NOW()`,
            updatedAt: sql`NOW()`,
          })
          .returning({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
          });

        // Create profile for the pharmacist
        await tx.insert(UserProfileModel).values({
          userId: newUser.id,
          gender: payload.gender,
          address: payload.address,
          city: payload.city,
          state: payload.state,
          zipCode: payload.zipCode,
        });

        await tx.insert(PharmacyAssignModel).values({
          userId: newUser.id,
          pharmacyId,
          clinicId,
          userRole: 'Pharmacist',
          createdAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        });

        // Create email verification token (similar to user service)
        const { generateTokenString, hashToken } =
          await import('../../../utils/authUtils');
        const { TokenModel } = await import('../../users/models/token.model');

        const rawToken = generateTokenString();
        const tokenHash = hashToken(rawToken);
        const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

        await tx
          .insert(TokenModel)
          .values({
            userId: newUser.id,
            tokenHash,
            type: 'set_initial_password',
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [TokenModel.tokenHash, TokenModel.type, TokenModel.userId],
            set: {
              userId: newUser.id,
              tokenHash,
              type: 'set_initial_password',
              expiresAt,
              used: false,
              updatedAt: new Date(),
            },
          });

        // Get clinic details for email template
        const [clinic] = await tx
          .select()
          .from(ClinicModel)
          .where(eq(ClinicModel.id, clinicId))
          .limit(1);

        const [pharmacy] = await tx
          .select({
            name: PharmacyModel.name,
            address: PharmacyModel.address,
          })
          .from(PharmacyModel)
          .where(eq(PharmacyModel.id, pharmacyId))
          .limit(1);

        return { user: newUser, rawToken, clinic, pharmacy };
      })
      .then(async (result) => {
        // 📧 Send DIRECT password setup email (same as user service)
        // Import the same template used in user service
        const { sendEmail } = await import('../../../utils/email');
        const { welcomeSetPasswordTemplate } =
          await import('../../../htmltamplates/welcome-set-password');

        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/invite?token=${result.rawToken}&userId=${result.user.id}&name=${encodeURIComponent(result.user.name ?? '')}&email=${encodeURIComponent(result.user.email ?? '')}`;

        // Use the same template as user service
        await sendEmail(
          result.user.email ?? '',
          `Infinity Medisetu - Welcome to ${result.pharmacy?.name || 'Pharmacy'} at ${result.clinic?.clinicName || 'Clinic'}`,
          welcomeSetPasswordTemplate({
            name: result.user.name ?? '',
            clinicName: `${result.pharmacy?.name || 'Pharmacy'} - ${result.clinic?.clinicName || 'Clinic'}`,
            resetUrl,
          })
        ).catch(console.error);

        return { id: result.user.id };
      });
  }

  // Prescription counts are scoped by clinicId (PrescriptionQueueModel has no
  // pharmacyId column). Mirrors LabService.getLabById's analytics block.
  private static async getPharmacyAnalytics(
    clinicId: string,
    tx: DbTransaction
  ) {
    const [prescriptionStats] = await tx
      .select({
        total: sql<number>`COUNT(*)::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${PrescriptionQueueModel.status} = 'PENDING')::int`,
        completed: sql<number>`COUNT(*) FILTER (WHERE ${PrescriptionQueueModel.status} = 'COMPLETED')::int`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE ${PrescriptionQueueModel.status} = 'REJECTED')::int`,
      })
      .from(PrescriptionQueueModel)
      .where(eq(PrescriptionQueueModel.clinicId, clinicId));

    return {
      prescriptionsTotal: prescriptionStats?.total ?? 0,
      prescriptionsCompleted: prescriptionStats?.completed ?? 0,
      prescriptionsPending: prescriptionStats?.pending ?? 0,
      prescriptionsRejected: prescriptionStats?.rejected ?? 0,
    };
  }

  static async getPharmacyByIdWithUsers(
    pharmacyId: string,
    clinicId: string,
    query: { pageNumber?: number; pageSize?: number }
  ) {
    return await database.transaction(async (tx) => {
      const [pharmacy] = await tx
        .select({
          id: PharmacyModel.id,
          name: PharmacyModel.name,
          address: PharmacyModel.address,
          contactNumber: PharmacyModel.contactNumber,
          registrationNumber: PharmacyModel.registrationNumber,
          gstNumber: PharmacyModel.gstNumber,
          panNumber: PharmacyModel.panNumber,
          licenseNumber: PharmacyModel.licenseNumber,
          fssaiNumber: PharmacyModel.fssaiNumber,
          clinicId: PharmacyModel.clinicId,
          status: PharmacyModel.status,
          deletedAt: PharmacyModel.deletedAt,
          createdAt: PharmacyModel.createdAt,
          updatedAt: PharmacyModel.updatedAt,
        })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false)
          )
        )
        .limit(1);

      if (!pharmacy)
        throw new HttpError(404, 'Pharmacy not found in this clinic');

      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      // Total assigned users to the pharmacy, paginated user details, and analytics — in parallel
      const [totalRecordsRow, users, analytics] = await Promise.all([
        tx
          .select({ count: sql`COUNT(DISTINCT ${PharmacyAssignModel.userId})` })
          .from(PharmacyAssignModel)
          .where(
            and(
              eq(PharmacyAssignModel.pharmacyId, pharmacyId),
              eq(PharmacyAssignModel.clinicId, clinicId)
            )
          ),
        tx
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
            mobile: UserModel.mobile,
            userType: UserModel.userType,
            userStatus: UserModel.userStatus,
            createdAt: UserModel.createdAt,
          })
          .from(PharmacyAssignModel)
          .leftJoin(UserModel, eq(UserModel.id, PharmacyAssignModel.userId))
          .where(
            and(
              eq(PharmacyAssignModel.pharmacyId, pharmacyId),
              eq(PharmacyAssignModel.clinicId, clinicId),
              eq(UserModel.userType, 'Pharmacist')
            )
          )
          .orderBy(desc(PharmacyAssignModel.createdAt))
          .limit(limit)
          .offset(offset),
        this.getPharmacyAnalytics(clinicId, tx),
      ]);

      const totalCount = Number(totalRecordsRow[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      return {
        pharmacy: { ...pharmacy, analytics },
        users,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }

  static async getAllPharmacies(
    clinicId: string,
    query: { pageNumber?: number; pageSize?: number }
  ) {
    return await database.transaction(async (tx) => {
      const pageSize = Math.max(Number(query.pageSize) || 10, 1);
      const pageNumber = Math.max(Number(query.pageNumber) || 1, 1);
      const { limit, offset } = pagination(pageNumber, pageSize);

      const totalRows = await tx
        .select({ count: sql`COUNT(${PharmacyModel.id})` })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false)
          )
        );
      const totalCount = Number(totalRows[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      const pharmacies = await tx
        .select({
          id: PharmacyModel.id,
          name: PharmacyModel.name,
          address: PharmacyModel.address,
          contactNumber: PharmacyModel.contactNumber,
          registrationNumber: PharmacyModel.registrationNumber,
          gstNumber: PharmacyModel.gstNumber,
          panNumber: PharmacyModel.panNumber,
          licenseNumber: PharmacyModel.licenseNumber,
          fssaiNumber: PharmacyModel.fssaiNumber,
          clinicId: PharmacyModel.clinicId,
          status: PharmacyModel.status,
          createdAt: PharmacyModel.createdAt,
          updatedAt: PharmacyModel.updatedAt,
        })
        .from(PharmacyModel)
        .where(
          and(
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false)
          )
        )
        .orderBy(desc(PharmacyModel.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        pharmacies,
        pagination: {
          totalRecords: totalCount,
          totalPages,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }

  static async updatePharmacyStatus(
    pharmacyId: string,
    clinicId: string,
    status: 'active' | 'deactive'
  ) {
    return await database.transaction(async (tx) => {
      const [updated] = await tx
        .update(PharmacyModel)
        .set({ status, updatedAt: sql`NOW()` })
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false),
            isNull(PharmacyModel.deletedAt)
          )
        )
        .returning({
          id: PharmacyModel.id,
          name: PharmacyModel.name,
          status: PharmacyModel.status,
          clinicId: PharmacyModel.clinicId,
        });
      if (!updated) throw new HttpError(404, 'Pharmacy not found');
      return updated;
    });
  }

  static async softDeletePharmacy(pharmacyId: string, clinicId: string) {
    const result = await database.transaction(async (tx) => {
      const [deleted] = await tx
        .update(PharmacyModel)
        .set({ isDeleted: true, deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
        .where(
          and(
            eq(PharmacyModel.id, pharmacyId),
            eq(PharmacyModel.clinicId, clinicId),
            eq(PharmacyModel.isDeleted, false),
            isNull(PharmacyModel.deletedAt)
          )
        )
        .returning({ id: PharmacyModel.id });
      if (!deleted) throw new HttpError(404, 'Pharmacy not found');
      return deleted;
    });

    await LimitationService.invalidateClinicCache(clinicId);
    return result;
  }
}
