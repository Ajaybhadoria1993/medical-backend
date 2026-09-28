import { z } from 'zod';

/** Mark a doctor's arrival for today. `doctorId` is required only when the actor isn't the doctor. */
export const markDoctorArrivalSchema = z.object({
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
  arrivedAt: z
    .string()
    .datetime({ message: 'arrivedAt must be an ISO 8601 datetime' })
    .optional(),

  /** IST 'HH:mm'; omitted means whichever shift the clock currently implies. */
  sessionStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'sessionStart must be HH:mm')
    .optional(),
});

export type MarkDoctorArrivalDto = z.infer<typeof markDoctorArrivalSchema>;

/** Read today's arrival status; no `doctorIds` returns every doctor in the clinic who has arrived. */
export const getDoctorArrivalQuerySchema = z.object({
  doctorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : v.split(',')
    ),
  /** Opt-in: every shift's arrival, for a screen that names the shift it shows. */
  allSessions: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type GetDoctorArrivalQueryDto = z.infer<
  typeof getDoctorArrivalQuerySchema
>;

/** Shape of `ActiveDoctorArrival` — the arrival record returned by both endpoints. */
export const activeDoctorArrivalSchema = z.object({
  doctorId: z.string().uuid(),
  arrivedAt: z.string().datetime(),
  sessionStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  source: z.enum(['self', 'reception', 'auto_confirm']),
  createdBy: z.string().uuid(),
});

/** Response of POST /doctor-arrival. */
export const markDoctorArrivalResponseSchema = activeDoctorArrivalSchema;

/** Response of GET /doctor-arrival. */
export const getDoctorArrivalResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arrivals: z.array(activeDoctorArrivalSchema),
});
