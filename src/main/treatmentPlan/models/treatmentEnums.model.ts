import { pgEnum } from 'drizzle-orm/pg-core';

/** timeline, review and cycle are reserved; Phase 1 accepts only staged and package. */
export const tpPlanTypeEnum = pgEnum('tp_plan_type', [
  'staged',
  'package',
  'timeline',
  'review',
  'cycle',
]);

export const tpTemplateStatusEnum = pgEnum('tp_template_status', [
  'draft',
  'active',
  'inactive',
  'archived',
]);

export const tpPlanStatusEnum = pgEnum('tp_plan_status', [
  'proposed',
  'accepted',
  'in_treatment',
  'completed',
  'declined',
  'paused',
  'ended_early',
]);

/** The step's own outcome; "booked" and "arrived" are read from the linked appointment. */
export const tpStepStatusEnum = pgEnum('tp_step_status', [
  'pending',
  'in_progress',
  'done',
  'missed',
  'skipped',
  'window_missed',
]);

export const tpPricingModeEnum = pgEnum('tp_pricing_mode', [
  'per_step',
  'package',
]);

/** How a plan is billed, not the cash/UPI/card payment mode. */
export const tpBillingModeEnum = pgEnum('tp_billing_mode', [
  'per_visit',
  'advance_per_visit',
  'package_full',
  'package_instalments',
]);

export const tpBookingModeEnum = pgEnum('tp_booking_mode', [
  'normal',
  'dedicated',
]);
