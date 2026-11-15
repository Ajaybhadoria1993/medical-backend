import type {
  TreatmentPlan,
  TreatmentPlanStep,
} from '../models/treatmentPlan.model';
import type { PlanAppointment } from '../ports/appointment.port';

/** A priced choice on a step, e.g. crown material. Money is a decimal string ("1500.00"). */
export interface StepOption {
  label: string;
  extraFee: string;
}

export interface SnapshotStep {
  seq: number;
  name: string;
  gapDays: number;
  durationMinutes: number | null;
  fee: string;
  selectedOption: StepOption | null;
}

/** The accepted plan as it stood at one version. */
export interface PlanSnapshot {
  steps: SnapshotStep[];
  totalAmount: string;
  discountAmount: string;
  advanceAmount: string;
  packageExpiresOn: string | null;
}

export type PlanStepView = Pick<
  TreatmentPlanStep,
  | 'id'
  | 'seq'
  | 'name'
  | 'gapDays'
  | 'durationMinutes'
  | 'fee'
  | 'selectedOption'
  | 'specialtyData'
  | 'status'
  | 'earliestDate'
  | 'gapOverrideReason'
  | 'notes'
  | 'doneAt'
> & {
  /** The live visit booked or linked for this step; null when not booked. */
  booking: {
    appointmentId: string;
    date: string;
    time: string | null;
    tokenNo: number | null;
    status: string;
  } | null;
  /** Booked, but an earlier step lost its visit or moved so this one is now too early (§5). */
  needsRebooking: boolean;
  /** Paid status, money covering steps oldest first; null before the plan is accepted. */
  payment: PlanStepPayment | null;
  /** The template's "late after" days, copied on create; null = no limit. */
  maxGapDays: number | null;
  /** Last on-time day (IST); null when there's no limit or the step before has no day yet. */
  lateAfterDate: string | null;
  /** late = its visit is past lateAfterDate; overdue = no visit and that day has passed. */
  lateness: 'late' | 'overdue' | null;
};

/** One step's paid status (rupee strings): paid = done and covered; due = done, not (fully) covered;
 *  paid_ahead / part_ahead = still to come, money paid early covers all / part of it; unpaid = nothing paid for it. */
export interface PlanStepPayment {
  status: 'paid' | 'due' | 'paid_ahead' | 'part_ahead' | 'unpaid';
  paid: string;
  due: string;
}

/** A visit the "Book all" preview proposes for one step (4.3). */
export interface BookAllPick {
  stepId: string;
  seq: number;
  name: string;
  gapDays: number;
  /** The earliest day for this step if the visit above stays where it is (today at the soonest). */
  earliestDate: string;
  date: string;
  time: string | null;
  sessionIndex: number | null;
  /** Token clinics: the exact free number; null for a timed slot. */
  tokenNo: number | null;
  label: string;
  /** The patient's own visit that day, used instead of a second booking; null = book new. */
  appointmentId: string | null;
}

/** A plan step linked to one appointment, for the consultation's "This visit" card (4.8). */
export interface VisitStep {
  planId: string;
  planTitle: string;
  stepId: string;
  seq: number;
  name: string;
  status: TreatmentPlanStep['status'];
  isPlanDoctor: boolean;
  /** The plan's money now (rupee strings), so the visit shows it without loading the plan. */
  planDue: string;
  planLeftToPay: string;
  planTotal: string;
  stepFee: string;
  stepsTotal: number;
  billingMode: string | null;
  /** Pay-at-each-visit plans, before the visit is done: what to collect today (rupees). */
  todayFee?: string;
  /** What this step costs (rupees): its charge once done, else its share of the plan; a package step's fee is 0. */
  stepPrice?: string;
  /** Normal paid visit, not done yet: money already taken on it (rupees), moved to the plan on completion. */
  paidOnVisit?: string;
}

/** The step a cancelled or missed plan visit was for; it is free again and nothing was charged. */
export interface ReleasedStep {
  planId: string;
  planTitle: string;
  name: string;
  seq: number;
  stepsTotal: number;
  visitStatus: string;
}

/** A logged follow-up call; ids only, the screen already knows the patient. */
export interface PlanCall {
  id: string;
  outcome: string | null;
  notes: string | null;
  nextFollowUpDate: string | null;
  actorId: string | null;
  createdAt: Date;
}

/** One plan for the editor and the detail screen. The consent file is opened on click through
 *  its own short-lived link (`hasConsentFile`), never embedded here. */
export type PlanDetail = Omit<TreatmentPlan, 'clinicId' | 'consentFileUrl'> & {
  hasConsentFile: boolean;
  /** Proposed plan with today's visit as a step: paid at the desk for it, which Accept counts once. */
  consultationPaid: string | null;
  /** The plan's doctor, named for the page header. */
  doctor: { id: string; name: string };
  /** The current accepted version; null while proposed. */
  version: {
    version: number;
    needsPatientApproval: boolean;
    patientApprovedAt: Date | null;
  } | null;
  /** The advance taken on accept, with its receipt number; null when none. */
  advance: {
    amount: string;
    paymentMode: string | null;
    /** Always set for an advance; typed like the ledger column. */
    receiptNo: string | null;
    createdAt: Date;
  } | null;
  /** Where the money stands (Phase 5): amounts as decimal strings. */
  money: {
    charged: string;
    paid: string;
    /** Owed now for finished visits; negative = credit to refund or use. */
    due: string;
    toCome: string;
    /** Still to pay for the whole plan (total − paid − written off). */
    leftToPay: string;
    writtenOff: string;
    refunded: string;
    entries: {
      id: string;
      type: string;
      amount: string;
      paymentMode: string | null;
      reason: string | null;
      stepId: string | null;
      receiptNo: string | null;
      /** A refund: the payment it gives back. */
      reversesEntryId: string | null;
      createdAt: Date;
    }[];
    instalments: {
      id: string;
      seq: number;
      amount: string;
      dueDate: string;
      paidAt: Date | null;
    }[];
  };
  /** All history rows; only the newest few are in `history`, the rest via GET /:planId/history. */
  historyTotal: number;
  /** What happened to the plan, newest first (Phase 6); null actor = the system. */
  history: {
    id: string;
    action: string;
    fromValue: string | null;
    toValue: string | null;
    reason: string | null;
    notes: string | null;
    /** The step a step action was about, so the screen can name it. */
    stepId: string | null;
    /** Money rows (payment, refund, write-off): the amount, so history reads without the ledger. */
    amount: string | null;
    actorName: string | null;
    createdAt: Date;
  }[];
  calls: PlanCall[];
  steps: PlanStepView[];
  patient: { id: string; name: string; allergies: string[] };
  /** Today's visit with the plan's doctor that step 1 can count as; null when not applicable. */
  todayVisit: PlanAppointment | null;
  /** Pay-at-each-visit plans: the next unfinished step and what to collect for it (rupees); else null. */
  nextVisit: { stepId: string; fee: string } | null;
  /** The next open step's money in any billing mode (rupee strings): its share (what Mark done charges), what is
   *  already owed, the unused advance that covers it, and the total to collect now, capped at what is left to pay. */
  nextShare: {
    stepId: string;
    amount: string;
    priorDue: string;
    fromAdvance: string;
    toCollect: string;
  } | null;
  /** Every option in the same proposal group, this one included. */
  options: {
    id: string;
    optionLabel: string | null;
    optionName: string | null;
    status: TreatmentPlan['status'];
    totalAmount: string;
  }[];
};

export interface PlanListItem {
  id: string;
  title: string;
  patientId: string;
  patientName: string;
  /** Own mobile, else the in-clinic family contact's; tells same-named patients apart. */
  patientMobile: string | null;
  doctorId: string;
  status: TreatmentPlan['status'];
  planType: TreatmentPlan['planType'];
  optionLabel: string | null;
  optionName: string | null;
  /** Suggested proposals list once: how many options, and their price range. */
  optionCount: number;
  minTotal: string;
  maxTotal: string;
  totalAmount: string;
  stepsTotal: number;
  stepsDone: number;
  /** Package plans: the last day sessions can be booked. */
  packageExpiresOn: string | null;
  /** Active, nothing booked, and the next step was due over 30 days ago: someone should follow up. */
  stalled: boolean;
  /** Owed now for completed visits (rupees string); "0.00" when nothing is due. */
  due: string;
  /** Still to pay on the whole plan (rupees string); total minus this is what's paid. */
  leftToPay: string;
  /** Next call to the patient (think / decline / call log). */
  followUpDate: string | null;
  createdAt: Date;
}

export interface PlanSuggestion {
  templateId: string;
  name: string;
  planType: TreatmentPlan['planType'];
  matchedKeyword: string;
  isOwnVersion: boolean;
  stepCount: number;
  price: string | null;
}

/** A normal visit before the plan covered it (type, prices, payment mode), restored on unlink. */
export interface CoveredVisit {
  type: string | null;
  price: string | null;
  primary: string | null;
  mode: string | null;
}

/** One reception follow-up from a plan; step fields are null for call-backs and check-ups. */
export interface PlanFollowUp {
  kind: 'plan_step' | 'plan_callback' | 'plan_checkup';
  planId: string;
  planTitle: string;
  patientId: string;
  doctorId: string;
  stepId: string | null;
  stepName: string | null;
  stepSeq: number | null;
  stepStatus: string | null;
  /** All steps on the plan, same count as the plan list's "x of y". */
  stepCount: number | null;
  planStatus: string;
  /** IST day, YYYY-MM-DD. */
  dueDate: string;
}

/** One logged follow-up call on a plan. */
export interface PlanDeskCall {
  planId: string;
  outcome: string | null;
  notes: string | null;
  nextCallDate: string | null;
  actorId: string | null;
  at: Date;
}

/** A plan suggested at a visit, as its prescription prints it; no money, by design. */
export interface PrescriptionPlan {
  title: string;
  optionLabel: string | null;
  optionName: string | null;
  status: TreatmentPlan['status'];
  steps: { seq: number; name: string; gapDays: number }[];
}

/** A signed consent form on file, for the patient's Medical Records; the file is signed on click. */
export interface PlanConsentForm {
  planId: string;
  title: string;
  optionLabel: string | null;
  doctorId: string;
  acceptedAt: Date | null;
}
