import {
  PublicClinic,
  PublicClinicTiming,
  PublicDoctorProfile,
  PublicDoctorReview,
} from '../types/doctorPublicProfile.types';

export function maskReviewerName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Anonymous';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toPublicTimings(availability: any[]): PublicClinicTiming[] {
  return (availability ?? []).map((slot: any) => ({
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime ?? null,
    endTime: slot.endTime ?? null,
    isAvailable: slot.isAvailable === true,
    breaks: (slot.breaks ?? []).map((b: any) => ({
      startTime: b.startTime ?? null,
      endTime: b.endTime ?? null,
    })),
  }));
}

function toPublicClinic(clinic: any, timings: PublicClinicTiming[]) {
  return {
    id: clinic.id,
    clinicName: clinic.clinicName,
    tagline: clinic.tagline ?? null,
    clinicAddress: clinic.clinicAddress ?? null,
    clinicLocation: clinic.clinicLocation ?? null,
    // Clinics can opt out of showing their number on public listings.
    clinicPhone: clinic.showClinicNumber ? (clinic.clinicPhone ?? null) : null,
    city: clinic.city ?? null,
    state: clinic.state ?? null,
    zipCode: clinic.zipCode ?? null,
    clinicLogo: clinic.clinicLogo ?? null,
    latitude: clinic.latitude ?? null,
    longitude: clinic.longitude ?? null,
    onlineBookingEnabled: clinic.onlineBookingEnabled === true,
    maxAdvanceBookingDays: clinic.maxAdvanceBookingDays ?? 7,
    payOnlineEnabled: clinic.payOnlineEnabled === true,
    payAtClinicEnabled: clinic.payAtClinicEnabled === true,
    services: (clinic.services ?? []).map((service: any) => ({
      id: service.id,
      serviceName: service.serviceName,
      price: service.price ?? null,
      currency: service.currency,
      durationDays: service.durationDays ?? null,
    })),
    timings,
  } satisfies PublicClinic;
}

export function toPublicReview(review: any): PublicDoctorReview {
  return {
    id: review.id,
    rating: review.rating,
    reviewText: review.reviewText ?? null,
    replyText: review.replyText ?? null,
    replyAt: review.replyAt ?? null,
    createdAt: review.createdAt,
    patientName: maskReviewerName(review.patient?.name ?? null),
  };
}

/**
 * Field-by-field allow-list. The upstream profile object carries
 * `registrationNumber` and the review rows carry patient identity — never
 * spread the source objects into a publicly served payload.
 */
export function toPublicDoctorProfile(
  profile: any,
  timingsByClinicId: Map<string, PublicClinicTiming[]>,
  reviews: { reviews: any[]; pagination: { totalItems: number } }
): PublicDoctorProfile {
  return {
    doctor: {
      id: profile.id,
      name: profile.name ?? null,
      gender: profile.gender ?? null,
      profileImage: profile.profileImage ?? null,
      speciality: profile.speciality ?? null,
      specialization: profile.specialization ?? [],
      qualification: profile.qualification ?? null,
      yearsOfExperience: profile.yearsOfExperience ?? null,
      about: profile.about ?? null,
      isVerified: profile.isVerified === true,
      // Council registration numbers are public record and are the standard
      // trust signal on doctor listings — unlike licenseNumber, which is not.
      registrationNumber: profile.registrationNumber ?? null,
      qualifications: (profile.qualifications ?? []).map((q: any) => ({
        qualificationType: q.qualificationType,
        qualificationTitle: q.qualificationTitle,
        specialization: q.specialization ?? null,
        boardOrUniversity: q.boardOrUniversity ?? null,
        yearOfCompletion: q.yearOfCompletion ?? null,
      })),
    },
    rating: {
      average: Number(profile.averageRating ?? 0),
      count: profile.reviewCount ?? 0,
    },
    totalPatients: profile.totalPatients ?? 0,
    clinics: (profile.clinics ?? []).map((clinic: any) =>
      toPublicClinic(clinic, timingsByClinicId.get(clinic.id) ?? [])
    ),
    reviews: {
      total: reviews.pagination.totalItems,
      items: reviews.reviews.map(toPublicReview),
    },
  };
}
