export interface PublicDoctorQualification {
  qualificationType: string;
  qualificationTitle: string;
  specialization: string | null;
  boardOrUniversity: string | null;
  yearOfCompletion: number | null;
  notes: string | null;
}

export interface PublicDoctorExperience {
  organisation: string;
  role: string;
  city: string | null;
  startMonth: number;
  startYear: number;
  endMonth: number | null;
  endYear: number | null;
  isCurrent: boolean;
}

export interface PublicClinicTimingBreak {
  startTime: string | null;
  endTime: string | null;
}

export interface PublicClinicTiming {
  dayOfWeek: string;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  breaks: PublicClinicTimingBreak[];
}

export interface PatientShift {
  startTime: string;
  endTime: string;
}

export interface PatientClinicTiming extends Omit<
  PublicClinicTiming,
  'breaks'
> {
  shifts: PatientShift[];
}

export interface PublicClinicService {
  id: string;
  serviceName: string;
  price: number | null;
  currency: string;
  durationDays: number | null;
}

export interface PublicClinic {
  id: string;
  clinicName: string;
  tagline: string | null;
  clinicAddress: string | null;
  clinicLocation: string | null;
  clinicPhone: string | null;
  city: string | null;
  state: string | null;
  zipCode: number | null;
  clinicLogo: string | null;
  latitude: number | null;
  longitude: number | null;
  onlineBookingEnabled: boolean;
  maxAdvanceBookingDays: number;
  payOnlineEnabled: boolean;
  payAtClinicEnabled: boolean;
  services: PublicClinicService[];
  timings: PublicClinicTiming[];
}

export interface PublicDoctorReview {
  id: string;
  rating: number;
  reviewText: string | null;
  replyText: string | null;
  replyAt: Date | null;
  createdAt: Date;
  patientName: string;
}

/** One row of the public Find-a-doctor list: a doctor at one bookable clinic. */
export interface PublicDoctorSearchItem {
  doctor: {
    id: string;
    userName: string | null;
    name: string | null;
    gender: string | null;
    profileImage: string | null;
    speciality: string | null;
    qualification: string | null;
    yearsOfExperience: number | null;
    averageRating: number;
    reviewCount: number;
  };
  clinic: {
    id: string;
    clinicName: string;
    clinicLocation: string | null;
    city: string | null;
    clinicPhone: string | null;
    onlineBookingEnabled: boolean;
    /** Lowest patient-bookable service price, if any. */
    consultationFee: number | null;
    /** True when the services carry more than one price, so the card says "From ₹X". */
    hasOtherFees: boolean;
    distanceKm: number | null;
  };
  nextAvailableDate: string | null;
}

export interface PublicDoctorProfile {
  doctor: {
    id: string;
    name: string | null;
    gender: string | null;
    profileImage: string | null;
    speciality: string | null;
    specialization: string[];
    subSpecialties: string[];
    alsoPractises: string[];
    qualification: string | null;
    /** Every degree, lowest level first: the line each screen shows (`doctorDegreeLine`). */
    degreeLine: string;
    yearsOfExperience: number | null;
    about: string | null;
    isVerified: boolean;
    registrationNumber: string | null;
    qualifications: PublicDoctorQualification[];
    languagesSpoken: string[];
    experiences: PublicDoctorExperience[];
  };
  rating: {
    average: number;
    count: number;
  };
  totalPatients: number;
  clinics: PublicClinic[];
  reviews: {
    total: number;
    items: PublicDoctorReview[];
  };
}
