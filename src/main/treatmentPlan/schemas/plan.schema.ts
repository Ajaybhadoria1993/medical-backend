import { z } from 'zod';
import {
  tpBillingModeEnum,
  tpPlanStatusEnum,
} from '../models/treatmentEnums.model';

const money = z.coerce
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50');
const specialtyValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
const specialtyData = z.record(z.string(), specialtyValue).default({});

const planStepSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the step a name').max(150),
    gapDays: z.number().int().min(0).max(365),
    maxGapDays: z.number().int().min(0).max(730).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
    fee: money,
    selectedOption: z
      .object({ label: z.string().trim().min(1).max(60), extraFee: money })
      .strict()
      .nullable()
      .optional(),
    specialtyData,
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

/** Reasons that let a flagged plan be saved (DEV_PLAN 2.4); each is recorded in plan history. */
const overridesSchema = z
  .object({
    gapReason: z.string().trim().min(3).max(255).optional(),
    discountReason: z.string().trim().min(3).max(255).optional(),
    duplicateReason: z.string().trim().min(3).max(255).optional(),
  })
  .strict()
  .default({});

const planFields = {
  title: z.string().trim().min(1, 'Give the plan a title').max(150),
  diagnosis: z.string().trim().min(1, 'Enter the diagnosis').max(2000),
  planType: z.enum(['staged', 'package', 'review'], {
    error:
      'Only Staged, Session package and Review plans are available for now',
  }),
  pricingMode: z.enum(['per_step', 'package']),
  packagePrice: money.nullable().optional(),
  packageExpiryDays: z.number().int().min(1).max(1825).nullable().optional(),
  consentRequired: z.boolean().default(false),
  discountAmount: money.default('0'),
  /** For a custom plan with specialty fields; a template plan uses the template's specialty. */
  specialty: z.string().trim().max(100).optional(),
  specialtyData,
  steps: z.array(planStepSchema).min(1, 'Add at least one step').max(100),
  overrides: overridesSchema,
};

/** Q28: reviews are paid per visit, with no package price or expiry. */
function checkReview(
  p: {
    planType: string;
    pricingMode: string;
    packagePrice?: string | null;
    packageExpiryDays?: number | null;
  },
  ctx: z.RefinementCtx
) {
  if (p.planType !== 'review') return;
  if (p.pricingMode !== 'per_step')
    ctx.addIssue({ code: 'custom', message: 'Reviews are paid per visit' });
  if (p.packagePrice != null || p.packageExpiryDays != null)
    ctx.addIssue({
      code: 'custom',
      message: 'Package price and valid-for days are only for packages',
    });
}

export const planCreateSchema = z
  .object({
    patientId: z.string().uuid('Choose the patient'),
    appointmentId: z.string().uuid().optional(),
    /** With appointmentId: the step that consultation visit counts as once accepted (the UI offers step 1). */
    consultationStepSeq: z.number().int().min(1).max(100).optional(),
    templateId: z.string().uuid().nullable().optional(),
    /** Started from a ready-made catalogue template without copying it into the clinic. */
    libraryTemplateId: z.string().uuid().optional(),
    ...planFields,
  })
  .strict()
  .superRefine(checkReview);

const optionName = z
  .string()
  .trim()
  .min(2, 'Name this option, e.g. Ceramic crown')
  .max(60);

export const planUpdateSchema = z
  .object({
    ...planFields,
    optionName: optionName.optional(),
    /** The updated_at the editor loaded; a different one means someone else saved first. */
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine(checkReview);

/** A new option needs a name; the first option gets one too if it has none yet. */
export const planOptionAddSchema = z
  .object({ name: optionName, sourceName: optionName.optional() })
  .strict();

export const planIdParamSchema = z.object({
  planId: z.string().uuid('Invalid plan ID'),
});

export const planListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.enum(tpPlanStatusEnum.enumValues).optional(),
  /** Reception's work lists (4.7): steps waiting for a date, or a visit the patient missed. */
  stage: z
    .enum([
      'needs_booking',
      'missed',
      'active',
      'stalled',
      'payment_due',
      'checkup_due',
    ])
    .optional(),
  /** Patient name or mobile, or the plan title. */
  q: z.string().trim().max(100).optional(),
  sortBy: z.enum(['createdAt', 'totalAmount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const patientIdParamSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
});

export const suggestionQuerySchema = z.object({
  diagnosis: z.string().trim().min(2).max(2000),
});

export const saveAsTemplateSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the template a name').max(150),
  })
  .strict();

export type PlanCreate = z.infer<typeof planCreateSchema>;
export type PlanUpdate = z.infer<typeof planUpdateSchema>;
export type PlanStepInput = z.infer<typeof planStepSchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;

/** Same words as appointment payments, so screens and reports share one vocabulary. */
export const PAYMENT_MODES = ['Cash', 'UPI', 'Card'] as const;
export const CALL_OUTCOMES = [
  'no_answer',
  'will_decide',
  'call_later',
  'other',
] as const;

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Pick a valid date');
// Multipart sends every field as text, and an untouched box as "".
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().max(max).optional()
  );
const optionalYmd = z.preprocess(
  (v) => (v === '' ? undefined : v),
  ymd.optional()
);

/** The patient's answer (DEV_PLAN 3.1, 3.2). Accept arrives as multipart when a consent file is attached. */
export const planDecisionSchema = z
  .discriminatedUnion('decision', [
    z.object({
      decision: z.literal('accept'),
      billingMode: z.enum(tpBillingModeEnum.enumValues),
      advanceAmount: money.default('0'),
      paymentMode: z.preprocess(
        (v) => (v === '' ? undefined : v),
        z.enum(PAYMENT_MODES).optional()
      ),
      /** Made once per form by the screen; a retry returns the first advance, never a second. */
      requestId: z.string().uuid(),
      notes: optionalText(500),
      /** Package in instalments: amount and due day of each (5.3). Multipart sends it as JSON text. */
      instalments: z.preprocess(
        (v) => {
          if (typeof v !== 'string' || !v) return v;
          try {
            return JSON.parse(v);
          } catch {
            return v; // left as text, so the array check below reports it
          }
        },
        z
          .array(z.object({ amount: money, dueDate: ymd }).strict())
          .min(1)
          .max(24)
          .optional()
      ),
    }),
    z.object({
      decision: z.literal('think'),
      followUpDate: ymd,
      notes: optionalText(500),
    }),
    z.object({
      decision: z.literal('decline'),
      reason: optionalText(255),
      followUpDate: optionalYmd,
    }),
  ])
  .superRefine((b, ctx) => {
    if (
      b.decision === 'accept' &&
      Number(b.advanceAmount) > 0 &&
      !b.paymentMode
    )
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMode'],
        message: 'Choose how the advance was paid',
      });
    if (
      b.decision === 'accept' &&
      b.billingMode === 'package_instalments' &&
      !b.instalments?.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['instalments'],
        message: 'Add the instalments',
      });
    if (
      b.decision === 'accept' &&
      b.billingMode !== 'package_instalments' &&
      b.instalments?.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['instalments'],
        message: 'Instalments are only for "Package in instalments"',
      });
  });

/** A follow-up call with its outcome and, optionally, the next call date (3.2). */
export const planFollowUpSchema = z
  .object({
    outcome: z.enum(CALL_OUTCOMES),
    notes: optionalText(500),
    nextFollowUpDate: optionalYmd,
  })
  .strict();

export type PlanDecision = z.infer<typeof planDecisionSchema>;
export type PlanFollowUp = z.infer<typeof planFollowUpSchema>;

// ── Phase 4: booking and visits ──────────────────────────────────────────────

export const planStepParamSchema = z.object({
  planId: z.string().uuid('Invalid plan ID'),
  stepId: z.string().uuid('Invalid step ID'),
});

export const appointmentIdParamSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID'),
});

/** Many visits at once, comma-separated, for the plan tag on a visit list. */
export const visitStepsBulkQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => [
      ...new Set(
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      ),
    ])
    .pipe(z.array(z.string().uuid('Invalid appointment ID')).min(1).max(100)),
});

export const bookingOptionsQuerySchema = z.object({ date: ymd });

/** One visit for a step: a time on slot days, a session on token days (the next token is issued). */
const visitPick = z.object({
  date: ymd,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Pick a time')
    .nullable()
    .optional(),
  sessionIndex: z.number().int().min(1).max(9).nullable().optional(),
  /** Token clinics: the number picked; omitted = the next free one. */
  tokenNo: z.number().int().min(1).max(999).nullable().optional(),
});

export const bookStepSchema = visitPick
  .extend({
    /** Needed to book before the step's earliest day (Doctor or Admin only). */
    overrideReason: z.string().trim().min(3).max(255).optional(),
  })
  .strict();

/** The visits the "Book all" preview offered, as the staff member confirmed them (4.3). */
export const bookAllSchema = z
  .object({
    picks: z
      .array(
        visitPick
          .extend({
            stepId: z.string().uuid(),
            /** The patient's own visit that day, linked instead of booking a second one. */
            appointmentId: z.string().uuid().nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

export const linkStepSchema = z
  .object({
    appointmentId: z.string().uuid('Invalid appointment ID'),
    overrideReason: z.string().trim().min(3).max(255).optional(),
  })
  .strict();

export type BookStep = z.infer<typeof bookStepSchema>;

/** Keeps a visit that is now earlier than its gap allows, with the reason (same rule as booking early). */
export const keepEarlySchema = z
  .object({
    reason: z.string().trim().min(3, 'Say why in a few words').max(255),
  })
  .strict();
export type KeepEarly = z.infer<typeof keepEarlySchema>;

/** A step the patient had done without a booked visit (walk-in); the day defaults to today. */
export const markStepDoneSchema = z
  .object({
    doneOn: ymd.optional(),
    note: z.string().trim().max(255).optional(),
  })
  .strict();
export type MarkStepDone = z.infer<typeof markStepDoneSchema>;
export type BookAll = z.infer<typeof bookAllSchema>;
export type LinkStep = z.infer<typeof linkStepSchema>;

// ── Phase 5: payments ────────────────────────────────────────────────────────

const positiveMoney = money.refine(
  (v) => Number(v) > 0,
  'Enter an amount above zero'
);
const reason = z.string().trim().min(3, 'Give a reason').max(255);
/** Made once per form by the screen; a retry returns the first entry, never a second (Q17). */
const requestId = z.string().uuid();

export const planPaymentSchema = z
  .object({
    amount: positiveMoney,
    paymentMode: z.enum(PAYMENT_MODES),
    notes: z.string().trim().max(255).optional(),
    requestId,
  })
  .strict();

/** Fixed reasons, so refund reports group cleanly; "completed_visits" is the only one that may go past unused advance. */
export const REFUND_REASONS = {
  treatment_stopped: 'Treatment stopped',
  paid_by_mistake: 'Paid extra by mistake',
  price_lowered: 'Plan price lowered',
  not_satisfied: 'Patient not satisfied',
  completed_visits: 'Refund for completed visits',
  other: 'Other',
} as const;
export type RefundReason = keyof typeof REFUND_REASONS;

export const planRefundSchema = z
  .object({
    amount: positiveMoney,
    paymentMode: z.enum(PAYMENT_MODES),
    /** The payment or advance receipt this refund gives back (part of). */
    paymentEntryId: z.string().uuid('Pick the payment to refund'),
    reasonCode: z.enum(
      Object.keys(REFUND_REASONS) as [RefundReason, ...RefundReason[]]
    ),
    note: z.string().trim().max(255).optional(),
    requestId,
  })
  .strict()
  .refine(
    (b) =>
      !['other', 'completed_visits'].includes(b.reasonCode) ||
      (b.note?.length ?? 0) >= 3,
    { path: ['note'], message: 'Add a short note for this reason' }
  );

export const planWriteOffSchema = z
  .object({ amount: positiveMoney, reason, requestId })
  .strict();

// requestId stays optional so an older app without it is not refused.
export const planDiscountSchema = z
  .object({ amount: positiveMoney, reason, requestId: requestId.optional() })
  .strict();

// ── Phase 6: track and close ─────────────────────────────────────────────────

export const planPauseSchema = z.object({ reason }).strict();

export const planEndSchema = z
  .object({
    reason,
    /** True stops every message for this plan (e.g. the patient has died). */
    sensitive: z.boolean().default(false),
  })
  .strict();

export const planRecallSchema = z
  .object({ recallDate: ymd.nullable() })
  .strict();

export const planExtendSchema = z
  .object({
    expiresOn: ymd,
    /** Optional; charged at once as "Package extension". */
    fee: positiveMoney.optional(),
    reason,
    requestId,
  })
  .strict();

export const planNoteSchema = z
  .object({ note: z.string().trim().min(1, 'Write a note').max(1000) })
  .strict();

export const planHistoryQuerySchema = z.object({
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type PlanPause = z.infer<typeof planPauseSchema>;
export type PlanEnd = z.infer<typeof planEndSchema>;
export type PlanRecall = z.infer<typeof planRecallSchema>;
export type PlanExtend = z.infer<typeof planExtendSchema>;
export type PlanNote = z.infer<typeof planNoteSchema>;

export type PlanPayment = z.infer<typeof planPaymentSchema>;
export type PlanRefund = z.infer<typeof planRefundSchema>;
export type PlanWriteOff = z.infer<typeof planWriteOffSchema>;
export type PlanDiscount = z.infer<typeof planDiscountSchema>;
