import { z } from 'zod';

export const sessionOverrideTypeSchema = z.enum([
  'running_late',
  'schedule_shift',
]);

/**
 * Bounds on an announced delay: under 5 minutes is noise not worth a push, and
 * over 240 is a session to cancel or reschedule rather than call "running
 * late". The same ceiling suits `schedule_shift` — past four hours the original
 * running order is no longer worth preserving.
 */
export const MIN_OVERRIDE_MINUTES = 5;
export const MAX_OVERRIDE_MINUTES = 240;

/**
 * How far ahead an override may be declared. A fortnight covers the real case
 * while keeping a stale row short-lived enough to be noticed.
 */
export const MAX_OVERRIDE_DAYS_AHEAD = 14;

/**
 * Announce (or clear) an override for one or more doctors. `doctorIds` is
 * always an array — staff may announce for several at once, a doctor only for
 * themselves (enforced in the service, which has the authenticated user).
 * `valueMinutes: 0` clears it; anything else must be within the announce
 * bounds, so a typo'd 1 or 600 is rejected rather than pushed to patients.
 */
export const announceSessionOverrideSchema = z.object({
  doctorIds: z
    .array(z.string().uuid('doctorIds must contain valid UUIDs'))
    .min(1, 'At least one doctorId is required')
    .max(50, 'Cannot announce for more than 50 doctors at once'),
  type: sessionOverrideTypeSchema.default('running_late'),
  valueMinutes: z
    .number()
    .int('valueMinutes must be a whole number of minutes')
    .refine(
      (v) =>
        v === 0 || (v >= MIN_OVERRIDE_MINUTES && v <= MAX_OVERRIDE_MINUTES),
      `valueMinutes must be 0 (to clear) or between ${MIN_OVERRIDE_MINUTES} and ${MAX_OVERRIDE_MINUTES}`
    ),

  /**
   * IST calendar day the override applies to, defaulting to today. Past dates
   * are refused (those appointments are over), and the ceiling stops a typo'd
   * year writing a row that waits centuries to take effect.
   */
  forDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD')
    .optional(),

  /**
   * `schedule_shift` only: which session to move, IST 'HH:mm'. Omitted means
   * the session the clock implies, which is right for a doctor late right now —
   * but "late this evening" cannot be inferred at 9am.
   */
  sessionStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sessionStart must be HH:mm')
    .optional(),

  /**
   * `schedule_shift` only: move every session that day, for a doctor who is out
   * entirely. Ignored when `sessionStart` names one, and moot on a single day.
   */
  allSessions: z.boolean().optional(),

  /**
   * `schedule_shift` only: return the appointments that would move and their
   * new times, without writing. The confirm dialog must show "09:30 → 11:30"
   * first, and which appointments are exempt is a backend rule — answering the
   * preview from the code that performs the shift is what keeps the two honest.
   */
  dryRun: z.boolean().optional().default(false),
});

/**
 * Read the active overrides for today. With no `doctorIds`, returns every
 * doctor in the clinic that currently has one.
 */
export const getSessionOverridesQuerySchema = z.object({
  /** Defaults to today, so the reception board never badges a future delay. */
  forDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD')
    .optional(),
  doctorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : v.split(',')
    ),
  type: sessionOverrideTypeSchema.optional(),
});

export type AnnounceSessionOverrideDto = z.infer<
  typeof announceSessionOverrideSchema
>;

// Response schemas — documentation only. Controllers build their payloads and
// wrap them via `sendOk`; these mirror that shape so Swagger shows a real body
// instead of an empty 200, and never validate at runtime.

/** One live (or cleared) override for a doctor on a day. */
const activeSessionOverrideSchema = z.object({
  doctorId: z.string().uuid(),
  type: sessionOverrideTypeSchema,
  /** Announced minutes; 0 means the override was cleared. */
  valueMinutes: z.number().int(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});

/** One appointment moved by a `schedule_shift`, times as IST 'HH:mm'. */
const shiftedAppointmentSchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
});

/** What a `schedule_shift` did (or would do, for `dryRun`) to one doctor's day. */
const shiftPlanSchema = z.object({
  doctorId: z.string().uuid(),
  /** How far this action moved the day; negative when correcting or clearing. */
  deltaMinutes: z.number().int(),
  /** Where the day now stands cumulatively. */
  totalMinutes: z.number().int(),
  appointments: z.array(shiftedAppointmentSchema),
  skipped: z.array(
    z.object({ appointmentId: z.string().uuid(), reason: z.string() })
  ),
  /** End of the affected session once shifted, IST 'HH:mm'. */
  sessionEnd: z.string().nullable(),
  /** 'HH:mm–HH:mm' of the session that moved; null on a single-session day. */
  shiftWindowLabel: z.string().nullable(),
  sessions: z.array(z.object({ start: z.string(), end: z.string() })),
  sessionStart: z.string().nullable(),
  appliedToAllSessions: z.boolean(),
});

export const announceSessionOverrideResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    /** IST calendar day the override applies to, 'YYYY-MM-DD'. */
    date: z.string(),
    /** Empty for a `schedule_shift` dry run. */
    overrides: z.array(activeSessionOverrideSchema),
    /** Present only for `schedule_shift` (including `dryRun`). */
    shifts: z.array(shiftPlanSchema).optional(),
    /** True when the request was a `schedule_shift` preview. */
    dryRun: z.boolean().optional(),
  }),
});

export const getSessionOverridesResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    date: z.string(),
    /** Only doctors with a non-zero value. */
    overrides: z.array(activeSessionOverrideSchema),
    /**
     * Present only when `type=schedule_shift` and `doctorIds` was supplied —
     * each named doctor's working sessions for the day, post-shift.
     */
    sessions: z
      .array(
        z.object({
          doctorId: z.string().uuid(),
          sessions: z.array(z.object({ start: z.string(), end: z.string() })),
        })
      )
      .optional(),
  }),
});

export const getSessionOverrideHistoryResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    date: z.string(),
    /** Newest first, cleared rows included. `isActive` marks the live row per (doctor, type). */
    entries: z.array(
      activeSessionOverrideSchema.extend({
        id: z.string().uuid(),
        isActive: z.boolean(),
      })
    ),
    /** ISO `createdAt` to pass back as `cursor` for the next page; null at the end. */
    nextCursor: z.string().nullable(),
  }),
});

/**
 * Read the day's full override log. Unlike the active read this returns
 * cleared rows too — the point is to show what was changed and by whom.
 */
export const getSessionOverrideHistoryQuerySchema = z.object({
  /** Page size; the log is read newest-first and scrolled, not paged through. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** ISO `createdAt` of the last row already shown. */
  cursor: z.string().optional(),
  forDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD')
    .optional(),
  doctorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : v.split(',')
    ),
});
