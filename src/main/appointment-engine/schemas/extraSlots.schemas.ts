import { z } from 'zod';

const sessionStartSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sessionStart must be HH:mm');

/** Adds extra capacity after a session's end (walk-in surge), not a structural change to the grid — time-based only. */
export const setExtraSlotsSchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  forDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD'),
  /** Omitted means "the day's only session" — rejected if the day has more than one. */
  sessionStart: sessionStartSchema.optional(),

  numberOfSlots: z
    .number()
    .int()
    .min(0, 'numberOfSlots must be 0 (to clear) or positive')
    .max(50, 'Cannot add more than 50 extra slots at once'),
  slotMinutes: z.number().int().positive(),
  stepMinutes: z.number().int().min(0).optional(),
});

export type SetExtraSlotsDto = z.infer<typeof setExtraSlotsSchema>;

export const getExtraSlotsQuerySchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  sessionStart: sessionStartSchema.optional(),
});

export type GetExtraSlotsQueryDto = z.infer<typeof getExtraSlotsQuerySchema>;

/** Shape of one session's resolved extra-slots setup. */
export const extraSlotsConfigSchema = z.object({
  sessionStart: sessionStartSchema,
  sessionEnd: sessionStartSchema,
  numberOfSlots: z.number().int(),
  slotMinutes: z.number().int().nullable(),
  stepMinutes: z.number().int().nullable(),
});

export const setExtraSlotsResponseSchema = extraSlotsConfigSchema;

export const getExtraSlotsResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessions: z.array(extraSlotsConfigSchema),
  selected: extraSlotsConfigSchema.nullable(),
});
