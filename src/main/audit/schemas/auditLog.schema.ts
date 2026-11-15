import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const auditClinicParamSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic ID'),
});

export const AUDIT_ACTION_TYPES = [
  'appointment',
  'patient',
  'record',
  'clinic',
  'staff',
  'account',
  'subscription',
] as const;

/** Caps every read to a window the (clinic_id, created_at) index serves quickly. */
export const AUDIT_MAX_RANGE_DAYS = 90;

export const auditLogQuerySchema = z
  .object({
    /** Prefix of the action key, e.g. `appointment` matches `appointment.cancelled`. */
    type: z.enum(AUDIT_ACTION_TYPES).optional(),
    userId: z.string().uuid('Invalid user ID').optional(),
    /** Inclusive IST calendar days; both required so no request scans all history. */
    from: isoDate,
    to: isoDate,
    pageNumber: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine(
    ({ from, to }) => {
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      return days >= 0 && days < AUDIT_MAX_RANGE_DAYS;
    },
    {
      message: `Choose a range of up to ${AUDIT_MAX_RANGE_DAYS} days, with from on or before to.`,
      path: ['from'],
    }
  );

export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;
