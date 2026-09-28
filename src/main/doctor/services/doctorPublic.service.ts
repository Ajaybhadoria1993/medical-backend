import { PatientService } from '../../patient/services/patient.service';
import { DoctorReviewService } from './doctorReview.service';
import { DoctorServices } from './doctor.service';
import { PublicDoctorProfile } from '../types/doctorPublicProfile.types';
import { CacheKeys, getOrSetCache } from '../../../utils/cache.util';
import {
  toPublicDoctorProfile,
  toPublicTimings,
} from '../utils/doctorPublicProfile.utils';

const PUBLIC_REVIEW_COUNT = 5;

/**
 * Short TTL on purpose: this key also covers reviews and timings, which are
 * expected to feel live. Profile/clinic/fee writes drop it immediately via
 * CacheKeys.doctorPublicProfileAll, so this only bounds review staleness.
 */
export const PUBLIC_PROFILE_TTL_SECONDS = 7200;

export class DoctorPublicService {
  static getPublicProfile(doctorId: string): Promise<PublicDoctorProfile> {
    return getOrSetCache(
      CacheKeys.doctorPublicProfileFull(doctorId),
      PUBLIC_PROFILE_TTL_SECONDS,
      () => DoctorPublicService.buildPublicProfile(doctorId)
    );
  }

  private static async buildPublicProfile(
    doctorId: string
  ): Promise<PublicDoctorProfile> {
    const profile = await PatientService.getDoctorPublicProfile(
      doctorId,
      undefined,
      { audience: 'web' }
    );

    const clinics = profile.clinics ?? [];

    const [timings, reviews] = await Promise.all([
      Promise.all(
        clinics.map(async (clinic: { id: string }) => ({
          clinicId: clinic.id,
          timings: toPublicTimings(
            await DoctorServices.getDoctorAvailability(doctorId, clinic.id)
          ),
        }))
      ),
      DoctorReviewService.getDoctorReviews(doctorId, {
        pageNumber: 1,
        pageSize: PUBLIC_REVIEW_COUNT,
      }),
    ]);

    const timingsByClinicId = new Map(
      timings.map((entry) => [entry.clinicId, entry.timings])
    );

    return toPublicDoctorProfile(profile, timingsByClinicId, reviews);
  }
}
