export type HourInterval = {
  startTime: string;
  endTime: string;
};

export type DayHours = {
  dayOfWeek: string;
  /**
   * Non-overlapping open windows for the day, ascending. Doctors keep separate
   * availability rows, so a day can legitimately have gaps (e.g. a morning and
   * an evening shift) — collapsing these to one start/end would report the
   * clinic open during a midday gap when nobody is working.
   */
  intervals: HourInterval[];
  isAvailable: boolean;
};

export type DoctorPreview = {
  id: string;
  name: string | null;
  profileImage: string | null;
  speciality: string | null;
  yearsOfExperience: number | null;
};

export type ClinicProfileOverview = {
  clinic: {
    id: string;
    name: string;
    logo: string | null;
    tagline: string | null;
    phone: string | null;
    whatsapp: boolean;
    email: string | null;
    address: string | null;
    clinicLocation: string | null;
    city: string | null;
    state: string | null;
    zipCode: number | null;
    latitude: number | null;
    longitude: number | null;
    status: string;
    registrationNumber: string | null;
    onboardingStatus: string;
  };
  admin: {
    name: string | null;
    speciality: string | null;
    qualification: string | null;
    yearsOfExperience: number | null;
  };
  subscription: unknown;
  stats: {
    rating: number | null;
    reviewCount: number;
    doctorCount: number;
    departmentCount: number;
    yearsOfExperience: number | null;
    isOpenNow: boolean;
  };
  contact: {
    phone: string | null;
    whatsapp: boolean;
    email: string | null;
  };
  workingHours: {
    today: { intervals: HourInterval[]; isAvailable: boolean };
    week: DayHours[];
    isOpenNow: boolean;
  };
  services: Array<{
    serviceName: string;
    price: number | null;
    currency: string;
    durationDays: number | null;
    canBeBookedByPatient: boolean;
  }>;
  doctorsPreview: DoctorPreview[];
  doctorCount: number;
  facilities: null;
  insurance: null;
  gallery: null;
  reviews: {
    averageRating: number;
    reviewCount: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  } | null;
  socialLinks: null;
  profileCompletion: number;
};
