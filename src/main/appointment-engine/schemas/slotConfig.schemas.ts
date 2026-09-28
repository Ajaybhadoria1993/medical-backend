import { z } from 'zod';
import { MAX_TOKENS_PER_SHIFT } from '../../appointments/schemas/appointment.schemas';
import { OVERRIDE_APPOINTMENT_TYPES } from '../../appointments/utils/appointmentType.constants';

/** How far ahead a slot config can be set — matches the session-override bound for the same reason. */
export const MAX_SLOT_CONFIG_DAYS_AHEAD = 60;

const sessionStartSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sessionStart must be HH:mm');

/** Customize one shift's slot structure — time-based (slotMinutes/numberOfSlots) or token-based (noOfPatients), never both. */
export const setSlotConfigSchema = z
  .object({
    doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
    forDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD'),
    /** Omitted means "the day's only session" — rejected if the day has more than one. */
    sessionStart: sessionStartSchema.optional(),

    slotMinutes: z.number().int().positive().optional(),
    stepMinutes: z.number().int().min(0).optional(),
    numberOfSlots: z.number().int().positive().optional(),
    noOfPatients: z
      .number()
      .int()
      .positive()
      .max(
        MAX_TOKENS_PER_SHIFT,
        `noOfPatients cannot exceed ${MAX_TOKENS_PER_SHIFT}`
      )
      .optional(),
    /** Why the capacity is being added, so the added tokens can say so. */
    appointmentType: z.enum(OVERRIDE_APPOINTMENT_TYPES).optional(),
  })
  .refine(
    (dto) =>
      !(
        dto.noOfPatients != null &&
        (dto.slotMinutes != null ||
          dto.stepMinutes != null ||
          dto.numberOfSlots != null)
      ),
    {
      message:
        'noOfPatients (token-based) cannot be combined with slotMinutes/stepMinutes/numberOfSlots (time-based)',
    }
  )
  .refine(
    (dto) =>
      dto.noOfPatients != null ||
      dto.slotMinutes != null ||
      dto.numberOfSlots != null,
    {
      message:
        'At least one of slotMinutes, numberOfSlots or noOfPatients is required',
    }
  );

export type SetSlotConfigDto = z.infer<typeof setSlotConfigSchema>;

export const getSlotConfigQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  sessionStart: sessionStartSchema.optional(),
});

export type GetSlotConfigQueryDto = z.infer<typeof getSlotConfigQuerySchema>;

/** Shape of `SessionSlotConfig` — one session's resolved slot setup. */
export const sessionSlotConfigSchema = z.object({
  sessionStart: sessionStartSchema,
  sessionEnd: sessionStartSchema,
  windowMinutes: z.number().int(),
  isTokenBased: z.boolean(),
  slotMinutes: z.number().int().nullable(),
  stepMinutes: z.number().int().nullable(),
  numberOfSlots: z.number().int().nullable(),
  customized: z.boolean(),
});

/** Response of POST /slot-config. */
export const setSlotConfigResponseSchema = sessionSlotConfigSchema;

/** Response of GET /slot-config. */
export const getSlotConfigResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isTokenBased: z.boolean(),
  sessions: z.array(sessionSlotConfigSchema),
  selected: sessionSlotConfigSchema.nullable(),
});

/** Query for the custom-slot-aware "get available slots" endpoint — same shape as the legacy booking-slots lookup. */
export const getAvailableSlotsQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

export type GetAvailableSlotsQueryDto = z.infer<
  typeof getAvailableSlotsQuerySchema
>;

/** Query for the missed-slot chooser: which session the passed slot belongs to, and what may be done with it. */
export const getMissedSlotOptionsQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  slotStart: sessionStartSchema,
});

export type GetMissedSlotOptionsQueryDto = z.infer<
  typeof getMissedSlotOptionsQuerySchema
>;

/** Response of GET /missed-slot-options — the resolved decision, so the client renders it rather than deriving one. */
export const getMissedSlotOptionsResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: sessionStartSchema,
  isMissed: z.boolean(),
  canShift: z.boolean(),
  shift: z
    .object({
      targetStart: sessionStartSchema,
      targetEnd: sessionStartSchema,
      needsCreation: z.boolean(),
      reason: z.literal('after_session_end'),
    })
    .nullable(),
  shiftBlockedReason: z.string().nullable(),
  canBookAnyway: z.boolean(),
});
