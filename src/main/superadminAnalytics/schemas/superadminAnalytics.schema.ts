import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/** Keeps the MRR trend and cohort maths to a range a person actually compares. */
export const MAX_PERIOD_DAYS = 366;

/** Inclusive IST calendar days; both omitted means the last 30 days. */
export const periodQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    // Week/month-to-date presets compare against the same elapsed days one week/month back.
    compare: z.enum(['week', 'month']).optional(),
  })
  .refine(({ from, to }) => (from === undefined) === (to === undefined), {
    message: 'Send both from and to, or neither.',
    path: ['from'],
  })
  .refine(
    ({ from, to }) => {
      if (!from || !to) return true;
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      return days >= 0 && days < MAX_PERIOD_DAYS;
    },
    {
      message: `Choose a range of up to ${MAX_PERIOD_DAYS} days, with from on or before to.`,
      path: ['from'],
    }
  );

export const CLINIC_STAGES = [
  'Registered',
  'SetupDone',
  'FirstValue',
  'Active',
  'Declining',
  'Dormant',
  'Churned',
] as const;

export const clinicListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** Account status, same tabs as Clinic Management; Deleted lists soft-deleted clinics only. */
  status: z.enum(['Active', 'Inactive', 'Blocked', 'Deleted']).optional(),
  stage: z.enum(CLINIC_STAGES).optional(),
  billing: z.enum(['Paid', 'Trial', 'Free']).optional(),
  source: z.string().trim().max(32).optional(),
  /** Exact match (case-insensitive) against the values listed in the response's `locations`. */
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pageNumber: z.coerce.number().int().min(1).default(1),
  /** 500 = the search cap, so the list's "All" option really is all. */
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
});

export const clinicParamSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
});

const STAFF_ROLES = [
  'Admin',
  'Doctor',
  'Receptionist',
  'Nurse',
  'Pharmacist',
  'Lab_Assistant',
  'Radiologist',
  'User',
] as const;

/** All-clinics audit log; both dates omitted means the last 30 days. */
export const auditQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    clinicId: z.string().uuid().optional(),
    type: z
      .string()
      .trim()
      .regex(/^[a-z_]+$/, 'Unknown action type')
      .max(40)
      .optional(),
    role: z.enum(STAFF_ROLES).optional(),
    pageNumber: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(({ from, to }) => (from === undefined) === (to === undefined), {
    message: 'Send both from and to, or neither.',
    path: ['from'],
  });

/** Signed-in staff devices; `activeOnly` hides sign-ins that have expired. */
export const sessionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  platform: z.enum(['web', 'mobile']).optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  pageNumber: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const userParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export type PeriodQueryDto = z.infer<typeof periodQuerySchema>;
export type AuditQueryDto = z.infer<typeof auditQuerySchema>;
export type SessionsQueryDto = z.infer<typeof sessionsQuerySchema>;
export type ClinicListQueryDto = z.infer<typeof clinicListQuerySchema>;
