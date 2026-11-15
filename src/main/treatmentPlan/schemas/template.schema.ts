import { z } from 'zod';
import { specialitySchema } from '../../../utils/specialtyCatalog';
import { tpTemplateStatusEnum } from '../models/treatmentEnums.model';

const money = z.coerce
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.50');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const days = (max: number) => z.number().int().min(0).max(max);
const optionalInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().optional();

// Timeline and cycle stay reserved in the enum until their phase (DEV_PLAN §13).
const planType = z.enum(['staged', 'package', 'review'], {
  error: 'Only Staged, Session package and Review plans are available for now',
});

const stepSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the step a name').max(150),
    gapDays: days(365),
    maxGapDays: optionalInt(0, 730),
    durationMinutes: optionalInt(1, 600),
    fee: money.nullable().optional(),
    options: z
      .array(
        z
          .object({ label: z.string().trim().min(1).max(60), extraFee: money })
          .strict()
      )
      .max(10)
      .default([]),
  })
  .strict()
  .refine(
    (s) => s.maxGapDays == null || s.maxGapDays >= s.gapDays,
    'Latest gap must be at least the minimum gap'
  );

const templateFields = {
  name: z.string().trim().min(1, 'Give the template a name').max(150),
  specialty: specialitySchema.pipe(z.string().min(1, 'Choose a speciality')),
  planType,
  pricingMode: z.enum(['per_step', 'package']),
  packagePrice: money.nullable().optional(),
  sessionCount: optionalInt(1, 100),
  intervalDays: optionalInt(1, 365),
  packageExpiryDays: optionalInt(1, 1825),
  consentRequired: z.boolean().default(false),
  taxable: z.boolean().default(false),
  instalmentsAllowed: z.boolean().default(false),
  recallAfterDays: optionalInt(1, 3650),
  diagnosisKeywords: z
    .array(z.string().trim().toLowerCase().min(1).max(60))
    .max(30)
    .default([])
    .transform((list) => [...new Set(list)]),
  steps: z.array(stepSchema).max(30).default([]),
};

type TemplateShape = {
  planType: 'staged' | 'package' | 'review';
  pricingMode: 'per_step' | 'package';
  packagePrice?: string | null;
  sessionCount?: number | null;
  intervalDays?: number | null;
  packageExpiryDays?: number | null;
  instalmentsAllowed?: boolean;
  steps: unknown[];
};

/** The per-type rules shared by create, edit and the Super Admin forms. */
function checkType(t: TemplateShape, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (t.planType === 'staged') {
    if (!t.steps.length) issue('Add at least one step');
    if (t.sessionCount != null || t.intervalDays != null)
      issue('Session count and interval are only for packages and reviews');
    return;
  }
  // Q28: the one step is the review (name + fee) the plan repeats N times; paid per visit, no expiry.
  if (t.planType === 'review') {
    if (t.steps.length !== 1)
      issue('A review plan has one review step with its fee');
    if (t.sessionCount == null) issue('Enter the number of reviews');
    if (t.intervalDays == null) issue('Enter the days between reviews');
    if (t.pricingMode !== 'per_step') issue('Reviews are paid per visit');
    if (t.packagePrice != null || t.packageExpiryDays != null)
      issue('Package price and valid-for days are only for packages');
    if (t.instalmentsAllowed) issue('Instalments are only for packages');
    return;
  }
  if (t.steps.length) issue('A package has sessions, not steps');
  if (t.sessionCount == null) issue('Enter the number of sessions');
  if (t.intervalDays == null) issue('Enter the days between sessions');
  if (t.pricingMode !== 'package') issue('A package is priced as a package');
  // The package must last long enough to fit every session at its interval.
  if (
    t.sessionCount != null &&
    t.intervalDays != null &&
    t.packageExpiryDays != null
  ) {
    const span = (t.sessionCount - 1) * t.intervalDays;
    if (t.packageExpiryDays < span)
      issue(
        `The sessions take ${span} days; make the package valid for at least ${span} days`
      );
  }
}

export const templateBodySchema = z
  .object(templateFields)
  .strict()
  .superRefine(checkType);

export const templateCreateSchema = z
  .object({
    ...templateFields,
    // Doctor only: makes the new template their own version.
    ownVersion: z.boolean().default(false),
  })
  .strict()
  .superRefine(checkType);

export const libraryTemplateSchema = z
  .object({
    ...templateFields,
    code: z
      .string()
      .regex(/^[a-z0-9_.]{3,64}$/, 'Code: lowercase letters, digits, _ and .')
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine(checkType);

export const templateListQuerySchema = z.object({
  status: z.enum(tpTemplateStatusEnum.enumValues).optional(),
  specialty: z.string().trim().max(100).optional(),
  q: z.string().trim().max(60).optional(),
  owner: z.enum(['clinic', 'mine']).optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const templateIdParamSchema = z.object({
  id: z.string().uuid('Invalid template ID'),
});

export const templateCopySchema = z
  .object({ target: z.enum(['clinic', 'own']) })
  .strict();

export const templatePreviewSchema = z
  .object({
    planType,
    startDate: isoDate.optional(),
    pricingMode: z.enum(['per_step', 'package']),
    packagePrice: money.nullable().optional(),
    sessionCount: optionalInt(1, 100),
    intervalDays: optionalInt(1, 365),
    steps: z
      .array(
        z.object({
          name: z.string().max(150).optional(),
          gapDays: days(365),
          fee: money.nullable().optional(),
        })
      )
      .max(30)
      .default([]),
  })
  .strict();

export type TemplateBody = z.infer<typeof templateBodySchema>;
export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;
export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>;
