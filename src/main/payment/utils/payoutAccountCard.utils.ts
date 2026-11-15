/** A clinic's payout setup as one card: what it can do now and, when stuck, why. */

/** Shown instead of Razorpay's "Max retry exceeded" lines; only Razorpay support can unlock it. */
export const BANK_CHECKS_LOCKED =
  'Razorpay has stopped checking new bank details for this account. Contact MediArogya support to unlock it.';
const LOCKED = /stopped checking new bank details|max retry exceeded/i;

export type PayoutCardState =
  'not_set_up' | 'action_needed' | 'verifying' | 'ready' | 'suspended';

/** The stage a submit stopped at; the form shows it next to the reason. */
export type PayoutStage = 'account' | 'documents' | 'activation';

export interface PayoutCard {
  state: PayoutCardState;
  label: string;
  reason: string | null;
  failedStage: PayoutStage | null;
  /** Required documents not uploaded yet (labels), for the form. */
  missingDocuments: string[];
  /** Documents Razorpay asked for on this account, with why; empty means details are enough. */
  askedDocuments: AskedDocument[];
  bank: {
    holder: string | null;
    bankName: string | null;
    ifsc: string | null;
    last4: string | null;
  } | null;
  canChangeBank: boolean;
  /** Razorpay stopped bank checks after repeated failures; the form leads with a status card (unlocks send no event). */
  bankChecksLocked: boolean;
  /** The UPI ID payouts go to, once ready; null when they go to a bank account. */
  upiId: string | null;
  /** False in Razorpay test mode, where UPI payouts are refused; the form then offers bank only. */
  upiPayoutsAvailable?: boolean;
  /** Saved form and uploaded files, so a retry starts filled in; null once verifying or ready. */
  form: {
    details: unknown;
    uploadedDocuments: { documentType: string; fileName: string | null }[];
  } | null;
}

const LABEL: Record<PayoutCardState, string> = {
  not_set_up: 'Not Set Up',
  action_needed: 'Action Needed',
  verifying: 'Verifying Bank',
  ready: 'Ready To Receive Payments',
  suspended: 'Suspended',
};

/** One document Razorpay asked for, as the form shows it. */
export interface AskedDocument {
  documentType: string;
  label: string;
  description: string;
  required: boolean;
  maxPages?: number;
}

/** The onboarding status fields the card reads. */
export interface PayoutStatusInput {
  accountId: string | null;
  routeStatus: string;
  rejectionReason: string | null;
  requiredDocuments: AskedDocument[];
  uploadedDocuments: {
    documentType: string;
    status: string;
    fileName?: string | null;
  }[];
  submittedDetails?: unknown;
}

/** The verified bank on file, as stored (account number already masked). */
export interface PayoutBankInput {
  beneficiaryName: string | null;
  bankName: string | null;
  maskedAccountNumber: string | null;
  ifscCode: string | null;
}

/** Razorpay's common bank refusals in plain words; anything else is shown as Razorpay wrote it. */
export function plainBankReason(reason: string | null): string | null {
  if (!reason) return reason;
  // Saved lock reasons may carry older wording; the card always shows today's sentence.
  if (LOCKED.test(reason)) return BANK_CHECKS_LOCKED;
  if (
    /name/i.test(reason) &&
    /(mismatch|match|differ|beneficiary)/i.test(reason)
  )
    return "The account holder name doesn't match your bank's records. Enter it exactly as on your passbook, then submit again.";
  if (/ifsc/i.test(reason) && /(invalid|incorrect|not found)/i.test(reason))
    return "The IFSC code isn't valid. Use Find IFSC to pick your branch, then submit again.";
  if (
    /account number/i.test(reason) &&
    /(invalid|incorrect|not found|closed|inactive)/i.test(reason)
  )
    return "Razorpay couldn't reach this bank account. Check the account number with your bank, then submit again.";
  return reason;
}

/** Stored Route status (+ bank) → the card; a failed submit adds its stage and reason. */
export function payoutCard(
  s: PayoutStatusInput,
  bank: PayoutBankInput | null,
  failure?: { stage: PayoutStage; reason: string }
): PayoutCard {
  const state: PayoutCardState = failure
    ? 'action_needed'
    : !s.accountId || s.routeStatus === 'INACTIVE'
      ? 'not_set_up'
      : s.routeStatus === 'PENDING'
        ? 'verifying'
        : s.routeStatus === 'ACTIVE'
          ? 'ready'
          : s.routeStatus === 'SUSPENDED'
            ? 'suspended'
            : 'action_needed';
  const uploaded = new Set(
    s.uploadedDocuments
      .filter((d) => d.status === 'uploaded')
      .map((d) => d.documentType)
  );
  const reason = plainBankReason(
    failure?.reason ??
      (state === 'action_needed'
        ? s.rejectionReason || 'Finish setting up your payout account'
        : state === 'suspended'
          ? s.rejectionReason
          : null)
  );
  // Bank history keeps the destination (a UPI ID masked, bank name "UPI"); the form is deleted once ready.
  const upiId =
    state === 'ready'
      ? bank?.bankName === 'UPI'
        ? bank.maskedAccountNumber
        : ((s.submittedDetails as { upi?: { vpa?: string } } | null)?.upi
            ?.vpa ?? null)
      : null;
  return {
    state,
    label: LABEL[state],
    reason,
    failedStage: failure?.stage ?? null,
    missingDocuments: s.requiredDocuments
      .filter((d) => d.required && !uploaded.has(d.documentType))
      .map((d) => d.label),
    askedDocuments:
      state === 'verifying' || state === 'ready' ? [] : s.requiredDocuments,
    bank:
      state === 'ready' && bank && !upiId
        ? {
            holder: bank.beneficiaryName,
            bankName: bank.bankName,
            ifsc: bank.ifscCode,
            last4:
              bank.maskedAccountNumber?.replace(/\D/g, '').slice(-4) || null,
          }
        : null,
    // Either destination can be switched after setup (UPI <-> bank).
    canChangeBank: state === 'ready',
    bankChecksLocked: LOCKED.test(reason ?? ''),
    upiId,
    form:
      state === 'verifying' || state === 'ready'
        ? null
        : {
            details: s.submittedDetails ?? null,
            uploadedDocuments: s.uploadedDocuments
              .filter((d) => d.status === 'uploaded')
              .map((d) => ({
                documentType: d.documentType,
                fileName: d.fileName ?? null,
              })),
          },
  };
}
