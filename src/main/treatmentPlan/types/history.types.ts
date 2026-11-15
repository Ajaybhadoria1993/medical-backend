/** `meta` per history action: ids and numbers only, never patient details (DEV_PLAN §3.4). */
export interface HistoryMetaByAction {
  plan_created: { templateId?: string; libraryTemplateId?: string };
  status_change: null;
  ended_early: { sensitive: boolean };
  version_created: { version: number; needsPatientApproval: boolean };
  /** Staff recorded the patient's yes to a changed accepted plan. */
  version_approved: { version: number };
  /** Plan edit: a gap set below the template's minimum; booking (Phase 4): a date before the earliest. */
  gap_override:
    | { stepId: string; minGapDays: number; gapDays: number }
    | { stepId: string; earliestDate: string; bookedDate: string };
  discount_approved: {
    discountAmount: string;
    capPercent: number;
    /** The form's id; a retry with it applies nothing (Q17, Q29). */
    requestId?: string;
  };
  refund: { ledgerEntryId: string; amount: string; paymentEntryId?: string };
  payment: { ledgerEntryId: string; amount: string };
  write_off: { ledgerEntryId: string; amount: string };
  credit_note: { ledgerEntryId: string; amount: string };
  step_done: { stepId: string; appointmentId?: string };
  step_missed: { stepId: string; appointmentId?: string };
  step_linked: { stepId: string; appointmentId?: string };
  step_unlinked: { stepId: string; appointmentId?: string };
  /** A booked visit kept although it's now before its gap; the reason is in `reason`. */
  step_kept_early: { stepId: string };
  follow_up_call: { nextFollowUpDate?: string };
  /** A desk follow-up row closed without a visit; the reason is in `reason`. */
  follow_up_dismissed: { kind: string; refId: string };
  template_copy: { sourceTemplateId: string };
  template_edit: { changedFields: string[] };
  plan_edit: { changedFields: string[] };
  option_added: { sourcePlanId: string; optionLabel: string };
  option_removed: { optionLabel: string | null; optionName: string | null };
  duplicate_override: { activePlanIds: string[] };
  package_extended: { extensionFee?: string; ledgerEntryId?: string };
  /** Phase 6: a staff note on the plan; the text is in `notes`. */
  note: null;
  recall_set: { recallDate: string | null };
}

export type HistoryAction = keyof HistoryMetaByAction;

export type HistoryMeta = HistoryMetaByAction[HistoryAction];
