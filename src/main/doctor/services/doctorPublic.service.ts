import { and, eq, sql } from 'drizzle-orm';
import {
  ClinicModel,
  ClinicAssignModel,
} from '../../clinic/models/clinic.model';
import { ClinicSettingsModel } from '../../clinic/models/clinicSettings.model';

import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { UserModel } from '../../users/models/user.model';
import { PatientService } from '../../patient/services/patient.service';
import { DoctorReviewService } from './doctorReview.service';
import {
  PublicClinicTiming,
  PublicDoctorProfile,
  PublicDoctorSearchItem,
} from '../types/doctorPublicProfile.types';
import { DoctorPublicSearchQueryDto } from '../schemas/doctorPublic.schemas';
import { LimitationService, FEATURE_KEYS } from '../../subscription';
import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import { toPublicDoctorProfile } from '../utils/doctorPublicProfile.utils';

const PUBLIC_REVIEW_COUNT = 5;

/**
 * Short TTL on purpose: this key also covers reviews and timings, which are
 * expected to feel live. Profile/clinic/fee writes drop it immediately via
 * CacheKeys.doctorPublicProfileAll, so this only bounds review staleness.
 */
export const PUBLIC_PROFILE_TTL_SECONDS = 7200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DoctorPublicService {
  /** `idOrUsername` is whatever the public link carries; the cache stays keyed by id. */
  static async getPublicProfile(
    idOrUsername: string
  ): Promise<PublicDoctorProfile> {
    const doctorId = await DoctorPublicService.resolveDoctorId(idOrUsername);
    return getOrSetCache(
      CacheKeys.doctorPublicProfileFull(doctorId),
      PUBLIC_PROFILE_TTL_SECONDS,
      () => DoctorPublicService.buildPublicProfile(doctorId)
    );
  }

  /**
   * Usernames are stored lowercased (usernameFieldSchema), and the schema has
   * already lowercased the param. Not cached: one indexed lookup, and caching it
   * would need invalidating on every username change.
   */
  private static async resolveDoctorId(idOrUsername: string) {
    if (UUID_PATTERN.test(idOrUsername)) return idOrUsername;

    const [user] = await database
      .select({ id: UserModel.id })
      .from(UserModel)
      .where(eq(UserModel.userName, idOrUsername))
      .limit(1);

    if (!user) throw new HttpError(404, 'Doctor profile not found');
    return user.id;
  }

  private static async buildPublicProfile(
    doctorId: string
  ): Promise<PublicDoctorProfile> {
    const profile = await PatientService.getDoctorPublicProfile(
      doctorId,
      undefined,
      { audience: 'web' }
    );

    const reviews = await DoctorReviewService.getDoctorReviews(doctorId, {
      pageNumber: 1,
      pageSize: PUBLIC_REVIEW_COUNT,
    });

    // The 'web' profile already carries each clinic's timings, breaks included.
    const timingsByClinicId = new Map<string, PublicClinicTiming[]>(
      (profile.clinics ?? []).map(
        (clinic: { id: string; timings: PublicClinicTiming[] }) => [
          clinic.id,
          clinic.timings,
        ]
      )
    );

    return toPublicDoctorProfile(profile, timingsByClinicId, reviews);
  }

  /** Cities with at least one active clinic taking online bookings: the
   *  Find-a-doctor city suggestions. Title-cased and merged case-insensitively. */
  static async getSearchCities(): Promise<string[]> {
    const rows = await database
      .selectDistinct({ city: sql<string>`INITCAP(TRIM(${ClinicModel.City}))` })
      .from(ClinicModel)
      .innerJoin(
        ClinicAssignModel,
        eq(ClinicAssignModel.clinicId, ClinicModel.id)
      )
      .innerJoin(
        ClinicSettingsModel,
        eq(ClinicSettingsModel.clinicId, ClinicModel.id)
      )
      // Same doctor checks as searchDirectory, so every suggested city returns doctors.
      .innerJoin(UserModel, eq(UserModel.id, ClinicAssignModel.userId))
      .where(
        and(
          sql`${UserModel.userType} IN ('Admin', 'Doctor')`,
          eq(UserModel.userStatus, 'Active'),
          eq(ClinicModel.status, 'Active'),
          eq(ClinicAssignModel.onlineBookingEnabled, true),
          eq(ClinicSettingsModel.onlineBookingEnabled, true),
          sql`TRIM(${ClinicModel.City}) <> ''`
        )
      )
      .orderBy(sql`1`)
      .limit(500);
    return rows.map((r) => r.city);
  }

  /** Public Find-a-doctor list. Reuses the patient directory search, then strips
   *  private fields and re-applies the web profile's public-booking plan gate. */
  static async searchDoctors(query: DoctorPublicSearchQueryDto) {
    const { data, pagination } = await PatientService.searchDirectory({
      ...query,
      pageNumber: String(query.pageNumber),
      pageSize: String(query.pageSize),
    });

    const clinicIds = [
      ...new Set(data.map((row: any) => row.clinic.id as string)),
    ];
    const bookable = new Set<string>();
    await Promise.all(
      clinicIds.map(async (clinicId) => {
        const check = await LimitationService.isFeatureEnabled(
          clinicId,
          FEATURE_KEYS.PUBLIC_BOOKING_PAGE
        );
        if (check.allowed) bookable.add(clinicId);
      })
    );

    const items: PublicDoctorSearchItem[] = data.map((row: any) => {
      const prices = (row.clinic.services ?? [])
        .map((s: { price: number | null }) => s.price)
        .filter((p: number | null): p is number => p != null);
      return {
        doctor: {
          id: row.doctor.id,
          userName: row.doctor.userName ?? null,
          name: row.doctor.name ?? null,
          gender: row.doctor.gender ?? null,
          profileImage: row.doctor.profileImage ?? null,
          speciality: row.doctor.speciality ?? null,
          qualification: row.doctor.qualification ?? null,
          yearsOfExperience: row.doctor.yearsOfExperience ?? null,
          averageRating: Number(row.doctor.averageRating ?? 0),
          reviewCount: Number(row.doctor.reviewCount ?? 0),
        },
        clinic: {
          id: row.clinic.id,
          clinicName: row.clinic.clinicName,
          clinicLocation: row.clinic.clinicLocation ?? null,
          city: row.clinic.city ?? null,
          clinicPhone: row.clinic.showClinicNumber
            ? (row.clinic.clinicPhone ?? null)
            : null,
          onlineBookingEnabled:
            row.clinic.onlineBookingEnabled === true &&
            bookable.has(row.clinic.id),
          consultationFee: prices.length ? Math.min(...prices) : null,
          hasOtherFees: new Set(prices).size > 1,
          distanceKm:
            row.distance != null
              ? Math.round(Number(row.distance) * 10) / 10
              : null,
        },
        nextAvailableDate: row.nextAvailableSlot?.date ?? null,
      };
    });

    return { items, pagination };
  }
}
