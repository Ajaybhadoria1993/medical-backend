import type { ClinicFacts, SubscriptionSpan } from '../types/metrics.types';
import type { FollowupDetection } from '../types/followup.types';
import { toPayoutState } from './payoutState.utils';
import {
  NO_FIRST_VALUE_DAYS,
  SETUP_STUCK_DAYS,
  billingAt,
  clinicStage,
  covers,
  daysSince,
} from './metrics.utils';

/** Days before trial expiry that a conversion call is due. */
export const TRIAL_ENDING_DAYS = 3;

// Rejected or blocked clinics were turned away on purpose; nobody should chase them.
const IGNORED_STATUSES = new Set(['Rejected', 'Blocked']);

/** Why a clinic can't be paid, which decides who acts: Razorpay support or the clinic. */
export type PayoutCause =
  | 'bank_locked'
  | 'bank_details'
  | 'documents'
  | 'suspended'
  | 'rejected'
  | 'other';

export const PAYOUT_CAUSE_SUMMARY: Record<PayoutCause, string> = {
  bank_locked:
    'Razorpay locked bank checks after repeated failures; Razorpay must reset it',
  bank_details:
    "Razorpay couldn't verify the bank or UPI details; the clinic must enter different ones",
  documents: 'Razorpay needs KYC details or documents from the clinic',
  suspended: 'Razorpay paused payouts on this account; ask Razorpay why',
  rejected: 'Razorpay rejected the payout account; ask Razorpay what to change',
  other: 'Razorpay needs a change before payouts can start',
};

/** Reads Razorpay's stored status and reason into one cause; the lock text is set by the payment module. */
export function payoutCause(
  status?: string | null,
  reason?: string | null
): PayoutCause {
  const s = String(status ?? '').toUpperCase();
  const r = reason ?? '';
  if (s === 'SUSPENDED') return 'suspended';
  if (/stopped checking new bank details|max retry exceeded/i.test(r))
    return 'bank_locked';
  if (/bank|ifsc|account (number|holder)|upi|vpa|penny/i.test(r))
    return 'bank_details';
  if (/pan|document|proof|kyc|gst|aadhaar|passport|address/i.test(r))
    return 'documents';
  if (s === 'REJECTED') return 'rejected';
  return 'other';
}

/** Every problem open today, at most one per clinic per type. Pure, so the nightly run is testable. */
export function detectFollowups(
  facts: ClinicFacts[],
  spans: SubscriptionSpan[],
  now: Date
): FollowupDetection[] {
  const out: FollowupDetection[] = [];
  for (const f of facts) {
    if (f.deleted || IGNORED_STATUSES.has(f.accountStatus)) continue;
    const stage = clinicStage(f, now);
    // Whole days: these numbers are printed in the task reason.
    const age = Math.floor(daysSince(f.createdAt, now));
    const idle = f.lastActivityAt
      ? Math.floor(daysSince(f.lastActivityAt, now))
      : null;
    const { billing } = billingAt(spans, f.clinicId, now);
    const add = (d: Omit<FollowupDetection, 'clinicId'>) =>
      out.push({ clinicId: f.clinicId, ...d });

    if (stage === 'Registered' && age >= SETUP_STUCK_DAYS)
      add({
        type: 'setup_stuck',
        priority: 'medium',
        reason: `Signed up ${age} days ago, setup not finished`,
        triggerData: { daysSinceSignup: age },
      });
    // A Pending clinic can't book until we approve it; that wait lives on the Requests board.
    if (
      stage === 'SetupDone' &&
      age >= NO_FIRST_VALUE_DAYS &&
      f.accountStatus !== 'Pending'
    )
      add({
        type: 'no_first_value',
        priority: 'medium',
        reason: `Set up but no completed appointment after ${age} days`,
        triggerData: { daysSinceSignup: age },
      });
    if (stage === 'Declining')
      add({
        type: 'usage_drop',
        priority: billing === 'Paid' ? 'high' : 'medium',
        reason: `Appointments fell from ${f.appointmentsPrev30} to ${f.appointments30} (last 30 days)`,
        triggerData: {
          appointments30: f.appointments30,
          appointmentsPrev30: f.appointmentsPrev30,
        },
      });
    if (stage === 'Dormant')
      add({
        type: 'dormant',
        priority: billing === 'Paid' ? 'high' : 'medium',
        reason: `No activity for ${idle} days`,
        triggerData: { daysIdle: idle, billing },
      });
    if (stage === 'Churned')
      add({
        type: 'churn_risk',
        priority: billing === 'Paid' ? 'high' : 'low',
        reason: `No activity for ${idle} days`,
        triggerData: { daysIdle: idle, billing },
      });

    // A clinic that can't be paid: Razorpay needs a change, rejected, suspended or locked bank checks.
    const payout = toPayoutState(f.payoutStatus ?? null);
    if (payout === 'action_needed' || payout === 'suspended') {
      const waiting = f.payoutChangedAt
        ? Math.floor(daysSince(f.payoutChangedAt, now))
        : null;
      const cause = payoutCause(f.payoutStatus, f.payoutReason);
      add({
        type: 'payout_blocked',
        priority: 'high',
        // Written for the team: what is wrong and who must act, not the clinic-facing text.
        reason: `${PAYOUT_CAUSE_SUMMARY[cause]}${waiting ? ` (${waiting} day${waiting === 1 ? '' : 's'})` : ''}`,
        triggerData: {
          cause,
          razorpayReason: (f.payoutReason || '').slice(0, 300) || null,
          payoutState: payout,
          daysWaiting: waiting,
          razorpayAccountId: f.payoutAccountId ?? null,
        },
      });
    }

    const trial = spans.find(
      (s) =>
        s.clinicId === f.clinicId &&
        s.isTrial &&
        s.expiresAt !== null &&
        covers(s, now)
    );
    const daysLeft = trial?.expiresAt
      ? Math.ceil((trial.expiresAt.getTime() - now.getTime()) / 86_400_000)
      : null;
    if (
      billing === 'Trial' &&
      daysLeft !== null &&
      daysLeft <= TRIAL_ENDING_DAYS
    )
      add({
        type: 'trial_ending',
        priority: 'high',
        reason: `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}, not paid yet`,
        triggerData: { trialDaysLeft: daysLeft, plan: trial?.planName ?? null },
      });
  }
  return out;
}
