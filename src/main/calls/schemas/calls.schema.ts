import { z } from 'zod';

export const placeCallSchema = z.object({
  type: z.enum(['RECEPTION', 'NEXT_PATIENT']).default('RECEPTION'),
  /** Omit to ring every assigned receptionist who is online. */
  receptionistId: z.string().uuid().optional(),
});

export const callIdParamsSchema = z.object({
  callId: z.string().uuid(),
});

export const activeCallsQuerySchema = z.object({
  withReceptionists: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type PlaceCallBody = z.infer<typeof placeCallSchema>;
export type CallIdParams = z.infer<typeof callIdParamsSchema>;
export type ActiveCallsQuery = z.infer<typeof activeCallsQuerySchema>;
