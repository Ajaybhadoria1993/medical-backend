import { z } from 'zod';

/** Every queue action targets exactly one appointment. */
export const queueActionSchema = z.object({
  appointmentId: z.string().uuid('appointmentId must be a valid UUID'),
});

export type QueueActionDto = z.infer<typeof queueActionSchema>;

/**
 * `date` is optional and defaults to today (IST) server-side, so the common
 * case needs no client clock involvement at all.
 */
export const queueBoardQuerySchema = z.object({
  /**
   * Optional. Omit it to get every doctor in the clinic, which is what the
   * reception board needs — asking the client to loop over doctors would turn
   * one screen into N requests and let them arrive at different moments,
   * which is exactly the disagreement this endpoint exists to prevent.
   */
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

export type QueueBoardQuery = z.infer<typeof queueBoardQuerySchema>;

/* ── Response shapes (for the API docs) ─────────────────────────────────────
 *
 * Mirror `appointment-engine/types/queue.types.ts`. Kept as Zod so the docs
 * registry renders a real schema rather than a prose description, the same way
 * doctorArrival/slotConfig do.
 */

/** Where a patient stands right now — derived per request, never stored. */
export const queuePositionSchema = z.enum([
  'with_doctor',
  'next',
  'waiting',
  'on_hold',
  'not_arrived',
  'done',
]);

export const queueEntrySchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  tokenNo: z.number().int().nullable(),
  appointmentTime: z.string().nullable(),
  /** The untouched lifecycle status; `Confirmed` means "with the doctor". */
  appointmentStatus: z.string(),
  position: queuePositionSchema,
  /** Only on `on_hold` entries: which action parked them. */
  holdReason: z.enum(['held', 'skipped']).optional(),
  /** Only on the `with_doctor` entry: the real instant they went in. */
  startedAt: z.string().nullable().optional(),
});

export const doctorQueueBoardSchema = z.object({
  clinicId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The one patient with the doctor, or null when the doctor is free. */
  currentPatient: queueEntrySchema.nullable(),
  /** Who should go in next. Never someone on hold. */
  nextPatient: queueEntrySchema.nullable(),
  /** Server-ordered: already reflects a manual "send-in" reorder. */
  waiting: z.array(queueEntrySchema),
  onHold: z.array(queueEntrySchema),
  completed: z.array(queueEntrySchema),
  notArrived: z.array(queueEntrySchema),
  generatedAt: z.string().datetime(),
});

/** Response of GET /queue/board, and of every queue action. */
export const queueBoardResponseSchema = z.object({
  clinicId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  doctors: z.array(doctorQueueBoardSchema),
});

/**
 * Response of GET /appointments/queue-state.
 *
 * Mirrors the controller's own projection, which is not the internal
 * `QueueDelayData` shape: it renames `cumulativeDelayMinutes` to
 * `cumulativeDelay`, `scheduledTime` to `appointmentTime`, and
 * `startedAt` to `consultationStartedAt`.
 */
export const queueStateResponseSchema = z.object({
  clinicId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: z.string().regex(/^d{4}-d{2}-d{2}$/),
  /** Minutes the last non-terminal appointment of the day has slipped. */
  cumulativeDelay: z.number().int(),
  lastCalculatedAt: z.string(),
  /** Minutes until the doctor is free for the next patient; null when unknown. */
  timeToNextMinutes: z.number().int().nullable(),
  appointments: z.array(
    z.object({
      appointmentId: z.string().uuid(),
      patientId: z.string().uuid(),
      status: z.string(),
      appointmentTime: z.string().nullable(),
      tokenNo: z.number().int().nullable(),
      projectedStartTime: z.string(),
      /** Masked to 0 for the patient already with the doctor. */
      estimatedWaitMinutes: z.number().int(),
      durationMinutes: z.number().int(),
      isOnHold: z.boolean(),
      holdReason: z.enum(['held', 'skipped']).nullable(),
      /** Their shift closed before they were reached; no estimate applies. */
      isMissedSession: z.boolean(),
      /** ISO instant the doctor took this patient in; only the current one. */
      consultationStartedAt: z.string().nullable(),
      /** ISO instant the patient checked in; null if not yet arrived. */
      arrivedAt: z.string().nullable(),
    })
  ),
});

/* ── Reception live-queue (the composed board) ──────────────────────────── */

const liveQueueEntrySchema = z.object({
  appointmentId: z.string().uuid(),
  patientName: z.string(),
  /** tokenNo (as string) if present, else appointmentTime, else '-'. */
  slot: z.string(),
  /** `Patient Arrived` — every queue action refuses a patient without this. */
  isCheckedIn: z.boolean(),
  /** Their shift closed before their turn came. */
  isMissedSession: z.boolean(),
  /** 1-based shift of a token; null on a time-based row. */
  sessionIndex: z.number().int().nullable(),
  /** Only on `onHold` entries: which action parked them. */
  holdReason: z.enum(['held', 'skipped']).optional(),
});

export const receptionLiveQueueResponseSchema = z.object({
  clinicId: z.string().uuid(),
  /** The IST day this board describes. */
  date: z.string().regex(/^d{4}-d{2}-d{2}$/),
  generatedAt: z.string().datetime(),
  doctors: z.array(
    z.object({
      doctorId: z.string().uuid(),
      name: z.string(),
      profilePhoto: z.string().nullable(),
      speciality: z.string().nullable(),
      /** Follows the queue, not the roster. */
      status: z.enum(['Consulting', 'Available']),
      /** Whether the doctor is inside their working hours right now. */
      isAvailableNow: z.boolean(),
      currentRunning: liveQueueEntrySchema
        .extend({
          /**
           * The patient's **scheduled** slot as an instant, not when they went
           * in — see docs/QUEUE_SYNCHRONIZATION.md "Still open".
           */
          startedAt: z.string().nullable(),
        })
        .nullable(),
      /** Everyone still ahead today, callable first. Held patients excluded. */
      nextInQueue: z.array(liveQueueEntrySchema),
      onHold: z.array(liveQueueEntrySchema),
      /** Checked-in patients waiting — the count that can be called in. */
      waitingCount: z.number().int(),
      /** Everyone in `nextInQueue`, arrived or not. */
      totalWaiting: z.number().int(),
      /** The appointment call/hold/skip apply to; never the one in the room. */
      actionTarget: z.string().uuid().nullable(),
      /** The appointment check-in applies to. */
      checkInTarget: z.string().uuid().nullable(),
      /** Whether a running-late announcement is still worth making. */
      canAnnounceLate: z.boolean(),
      /** The day's shifts on a split-shift token day; empty otherwise. */
      sessions: z.array(
        z.object({
          sessionIndex: z.number().int(),
          start: z.string(),
          end: z.string(),
          /** Only on a shift right after one with missed patients. */
          capacity: z.number().int().optional(),
          takenCount: z.number().int().optional(),
          freeTokens: z.array(z.number().int()).optional(),
        })
      ),
      /** Minutes per patient behind the queue's projection; null until a snapshot exists. */
      consultationMinutes: z.number().nullable(),
    })
  ),
});
