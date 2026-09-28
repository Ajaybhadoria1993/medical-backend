import { z } from 'zod';

export const staffUserIdParamSchema = z.object({
  userId: z.string().uuid('Invalid User ID'),
});

export const updateStaffAssignmentSchema = z
  .object({
    accessScope: z.enum(['assigned_doctors', 'all_doctors']),
    doctorIds: z.array(z.string().uuid('Invalid Doctor ID')).default([]),
    location: z.string().trim().max(120).optional().nullable(),
    responsibility: z.string().trim().max(255).optional().nullable(),
  })
  .refine(
    (value) =>
      value.accessScope !== 'assigned_doctors' || value.doctorIds.length > 0,
    {
      // A receptionist restricted to nobody can see nothing at all — almost
      // always a half-finished form rather than an intent, so it is rejected
      // here with a message that says what to do about it.
      message:
        'Select at least one doctor, or give this staff member access to all doctors.',
      path: ['doctorIds'],
    }
  );

export type UpdateStaffAssignmentDto = z.infer<
  typeof updateStaffAssignmentSchema
>;

export const doctorIdParamSchema = z.object({
  doctorId: z.string().uuid('Invalid Doctor ID'),
});

// ---------------------------------------------------------------------------
// Response schemas — documentation only (mirror the `{ success, message, data }`
// envelope; controllers build `data` directly and are not validated against
// these).
// ---------------------------------------------------------------------------

const accessScopeSchema = z.enum(['assigned_doctors', 'all_doctors']);

const assignedDoctorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  speciality: z.string().nullable().optional(),
});

/** One staff member's full assignment view. */
const staffAssignmentViewSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  userType: z.string(),
  accessScope: accessScopeSchema,
  location: z.string().nullable(),
  responsibility: z.string().nullable(),
  /** True when no `staff_scopes` row exists yet — treated as `all_doctors`. */
  isDefault: z.boolean(),
  doctors: z.array(assignedDoctorSchema),
});

export const myScopeResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    accessScope: accessScopeSchema,
    location: z.string().nullable(),
    responsibility: z.string().nullable(),
    isDefault: z.boolean(),
    /** The doctors in reach for the caller, already resolved. */
    doctors: z.array(assignedDoctorSchema.passthrough()),
  }),
});

export const listStaffAssignmentsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    assignments: z.array(staffAssignmentViewSchema),
  }),
});

export const staffAssignmentResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: staffAssignmentViewSchema,
});

export const doctorStaffResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    doctorId: z.string().uuid(),
    staff: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        userType: z.string(),
        location: z.string().nullable(),
        /** True when this person covers the doctor only because their scope is `all_doctors`. */
        viaAllDoctorsAccess: z.boolean(),
      })
    ),
  }),
});
