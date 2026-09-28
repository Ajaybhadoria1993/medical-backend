import { z } from 'zod';

export const permissionUserIdParamSchema = z.object({
  userId: z.string().uuid('Invalid User ID'),
});

export const updateUserPermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)),
});

export const permissionCatalogQuerySchema = z.object({
  // Optional: without it the endpoint keeps returning the whole catalog.
  role: z
    .enum([
      'Doctor',
      'Receptionist',
      'Nurse',
      'Pharmacist',
      'Lab_Assistant',
      'Radiologist',
    ])
    .optional(),
});

export type PermissionCatalogQueryDto = z.infer<
  typeof permissionCatalogQuerySchema
>;

// ---------------------------------------------------------------------------
// Response schemas — documentation only.
//
// Controllers wrap their payloads in the standard `{ success, message, data }`
// envelope from `sendOk` and build `data` directly; these mirror that shape so
// Swagger renders a real response body. Not used for runtime validation.
// ---------------------------------------------------------------------------

/** One catalog entry. `granted` / `viaRole` are present only on the per-user and per-role matrix. */
const permissionCatalogEntrySchema = z.object({
  key: z.string(), // e.g. "appointment:create"
  resource: z.string(), // e.g. "appointment"
  action: z.string(), // e.g. "create"
  description: z.string(),
  granted: z.boolean().optional(),
  viaRole: z.boolean().optional(),
});

/** Catalog entries grouped by resource. */
const permissionResourceGroupSchema = z.object({
  resource: z.string(),
  permissions: z.array(permissionCatalogEntrySchema),
});

export const permissionCatalogResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  /** Without `?role=`: plain groups. With `?role=`: each entry carries `granted` + `viaRole`. */
  data: z.array(permissionResourceGroupSchema),
});

export const myPermissionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    /** Effective keys = role defaults ∪ explicit grants. Super_Admin gets the full set. */
    permissions: z.array(z.string()),
  }),
});

export const userPermissionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    userId: z.string().uuid(),
    userType: z.string(),
    /** Full catalog for the user's role, each entry flagged `granted` / `viaRole`. */
    permissions: z.array(permissionResourceGroupSchema),
  }),
});

export const updateUserPermissionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    /** Keys added by this call (empty when nothing changed). */
    added: z.array(z.string()),
    /** Keys revoked by this call. */
    removed: z.array(z.string()),
  }),
});
