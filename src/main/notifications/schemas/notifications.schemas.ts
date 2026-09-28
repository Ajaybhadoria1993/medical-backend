import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Inbox listing: category/kind tabs plus keyset pagination. */
export const inboxQuerySchema = z.object({
  kind: z.enum(['notification', 'activity']).optional(),
  category: z
    .enum([
      'appointments',
      'payments',
      'prescription',
      'lab',
      'staff',
      'system',
    ])
    .optional(),
  // Action Required spans every category, so it is a flag rather than a tab.
  actionRequired: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  // Outstanding work only — what the Action Required tab actually asks for.
  unresolvedOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

export const markManyReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(200),
});

export const notifParamsSchema = z.object({
  notificationId: z.string().uuid('Invalid notification ID'),
});

export const registerDeviceSchema = z.object({
  deviceToken: z.string().min(1, 'Device token is required'),
  platform: z.enum(['ios', 'android']),
});

export const unregisterDeviceParamsSchema = z.object({
  deviceToken: z.string().min(1, 'Device token is required'),
});

/* ---------------- Response shapes (documentation only) ----------------
 * These describe what the Notification Center endpoints return, so Swagger
 * renders a real schema rather than "Successful response" and nothing else.
 * They are not used to validate outgoing responses — the service layer owns
 * that — so keep them in step with it by hand when a field is added.
 */

const notificationItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
  category: z.enum([
    'appointments',
    'payments',
    'prescription',
    'lab',
    'staff',
    'system',
  ]),
  priority: z.enum(['action_required', 'normal', 'low']),
  kind: z.enum(['notification', 'activity']),
  eventKey: z.string().nullable(),
  /** Route pattern plus the values that fill it, both resolved server-side. */
  clickRoute: z.string().nullable(),
  clickParams: z.record(z.string(), z.unknown()).nullable(),
});

export const inboxResponseSchema = z.object({
  items: z.array(notificationItemSchema),
  hasMore: z.boolean(),
  /** Opaque keyset cursor. Pass back as `cursor`; null when exhausted. */
  nextCursor: z.string().nullable(),
});

export const unreadCountResponseSchema = z.object({
  /** Bounded at `cap` — render "99+" when badgeCapped is true. */
  badge: z.number().int(),
  badgeCapped: z.boolean(),
  cap: z.number().int(),
  total: z.number().int(),
  actionRequired: z.number().int(),
  /** Exact per category, unlike the badge: a rounded tab label would be wrong. */
  byCategory: z.record(z.string(), z.number().int()),
});

export const eventCatalogResponseSchema = z.object({
  events: z.array(
    z.object({
      /** Preference key (legacy alias) — what a toggle reads and writes. */
      key: z.string(),
      /** Canonical registry key, e.g. 'appointment.created'. */
      eventKey: z.string(),
      label: z.string(),
      description: z.string(),
      category: z.string(),
      priority: z.string(),
      kind: z.string(),
      configurable: z.boolean(),
      channels: z.array(z.enum(['inApp', 'push'])),
      defaults: z.record(z.string(), z.boolean()),
    })
  ),
  categories: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      eventCount: z.number().int(),
    })
  ),
});

export type ListQueryDto = z.infer<typeof listQuerySchema>;
export type InboxQueryDto = z.infer<typeof inboxQuerySchema>;
export type MarkManyReadDto = z.infer<typeof markManyReadSchema>;
export type NotifParamsDto = z.infer<typeof notifParamsSchema>;
export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;
export type UnregisterDeviceParamsDto = z.infer<
  typeof unregisterDeviceParamsSchema
>;
