import { z } from 'zod';

/** Marks a past, never-booked grid slot as handled — the client stops offering it as Missed/Available once dismissed. */
export const dismissMissedSlotSchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  forDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'forDate must be YYYY-MM-DD'),
  /** The dismissed slot's own start time, not a session boundary. */
  slotStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'slotStart must be HH:mm'),
});

export type DismissMissedSlotDto = z.infer<typeof dismissMissedSlotSchema>;

export const dismissMissedSlotResponseSchema = z.object({
  forDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
