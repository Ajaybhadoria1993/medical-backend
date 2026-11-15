import type {
  DoctorPreferenceLists,
  SpecialtySection,
} from '../../../utils/doctorSpecialtyConfig';

/** `own`: the speciality has its own prescription defaults; `generic`: it uses the shared set. */
export type SpecialtyDefaultsSource = 'own' | 'generic';

export interface SpecialtyDefaults {
  mainSpecialty: string;
  specialties: readonly string[];
  alsoPractises: readonly string[];
  source: SpecialtyDefaultsSource;
  /** Specializations with their own defaults; a doctor who picks one gets those instead. */
  borrowableFrom: string[];
  defaults: DoctorPreferenceLists & { sections: SpecialtySection[] };
}
