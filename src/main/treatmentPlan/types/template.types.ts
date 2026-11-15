import type {
  TreatmentTemplate,
  TreatmentTemplateStep,
} from '../models/treatmentTemplate.model';

/** Who is acting; isDoctor includes an Admin with doctor access. */
export interface Actor {
  id: string;
  isDoctor: boolean;
  /** The role from the token; staff scope reads it (Receptionist sees assigned doctors only). */
  userType: string;
}

/** clinicId null = the ready-made library (Super Admin routes only). */
export interface TemplateScope {
  clinicId: string | null;
}

export type TemplateStepView = Pick<
  TreatmentTemplateStep,
  | 'id'
  | 'seq'
  | 'name'
  | 'gapDays'
  | 'maxGapDays'
  | 'durationMinutes'
  | 'fee'
  | 'options'
>;

export type TemplateDetail = Omit<TreatmentTemplate, 'clinicId'> & {
  steps: TemplateStepView[];
  /** Copied from the library, and the library row changed since (DEV_PLAN §3.2). */
  newerLibraryVersion: boolean;
};

export interface TemplateListItem {
  id: string;
  name: string;
  specialty: string;
  planType: TreatmentTemplate['planType'];
  status: TreatmentTemplate['status'];
  pricingMode: TreatmentTemplate['pricingMode'];
  packagePrice: string | null;
  sessionCount: number | null;
  intervalDays: number | null;
  stepCount: number;
  /** Steps still without a fee. */
  stepsUnpriced: number;
  /** Sum of step fees; null while any step has no fee. */
  stepsFeeTotal: string | null;
  isOwnVersion: boolean;
  checked: boolean;
  sourceTemplateId: string | null;
  updatedAt: Date;
}

/** Cached per clinic; the doctor rule filters it per request. */
export interface ActiveTemplate {
  id: string;
  name: string;
  specialty: string;
  planType: TreatmentTemplate['planType'];
  pricingMode: TreatmentTemplate['pricingMode'];
  packagePrice: string | null;
  sessionCount: number | null;
  ownerDoctorId: string | null;
  sourceTemplateId: string | null;
  diagnosisKeywords: string[];
  stepCount: number;
  stepsFeeTotal: string | null;
}

export interface TemplatePreview {
  dates: { seq: number; name: string | null; date: string }[];
  /** Sum of the prices entered so far; null when none is entered. */
  totalAmount: string | null;
  /** Steps (or the package price) still without a price. */
  feesMissing: number;
  durationDays: number;
}
