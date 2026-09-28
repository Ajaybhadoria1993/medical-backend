// src/main/notifications/routes/v1/notifications.route.ts
import { Router } from 'express';
import { requireAuth } from '../../../../middlewear/auth.middleware';
import { validate } from '../../../../middlewear/validation.middleware';
import { docsRegistry } from '../../../../utils/docsRegistry';
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
  listNotificationsHandler,
  listUnreadNotificationsHandler,
  listInboxHandler,
  listEventCatalogHandler,
  unreadCountHandler,
  markManyReadHandler,
  markAllReadHandler,
  resolveNotificationHandler,
  markReadHandler,
  deleteNotificationHandler,
  deleteAllHandler,
} from '../../controllers/notifications.controller';
import {
  eventCatalogResponseSchema,
  inboxQuerySchema,
  inboxResponseSchema,
  unreadCountResponseSchema,
  listQuerySchema,
  markManyReadSchema,
  notifParamsSchema,
  registerDeviceSchema,
  unregisterDeviceParamsSchema,
} from '../../schemas/notifications.schemas';

const router = Router();

// Device Token Registration Endpoints
router.post(
  '/devices',
  requireAuth,
  validate(registerDeviceSchema, 'body'),
  registerDeviceHandler
);

router.delete(
  '/devices/:deviceToken',
  requireAuth,
  validate(unregisterDeviceParamsSchema, 'params'),
  unregisterDeviceHandler
);

// Notification Center (Phase 2). Registered before '/' so the literal path
// wins over any generic matcher added later.
router.get(
  '/inbox',
  requireAuth,
  validate(inboxQuerySchema, 'query'),
  listInboxHandler
);

router.get('/unread-count', requireAuth, unreadCountHandler);

// Registry-derived event catalogue for the My Notifications screen. No schema
// to validate: the caller's role is the only input and it comes from the token.
router.get('/events', requireAuth, listEventCatalogHandler);

router.put(
  '/read',
  requireAuth,
  validate(markManyReadSchema, 'body'),
  markManyReadHandler
);

router.put('/read-all', requireAuth, markAllReadHandler);

// Notification Inbox Endpoints (legacy shape, consumed by mobile)
router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  listNotificationsHandler
);

router.get(
  '/unread',
  requireAuth,
  validate(listQuerySchema, 'query'),
  listUnreadNotificationsHandler
);

router.put(
  '/read/:notificationId',
  requireAuth,
  validate(notifParamsSchema, 'params'),
  markReadHandler
);

// Marks the *work* done, not just the row seen — this is what clears the
// Action Required tab. Under `/resolve/` rather than `/:id/resolve` to match
// the `/read/:notificationId` shape directly above.
router.put(
  '/resolve/:notificationId',
  requireAuth,
  validate(notifParamsSchema, 'params'),
  resolveNotificationHandler
);

router.delete('/all', requireAuth, deleteAllHandler);

router.delete(
  '/:notificationId',
  requireAuth,
  validate(notifParamsSchema, 'params'),
  deleteNotificationHandler
);

export default router;

// ─── API Docs ─────────────────────────────────────────────────────────────────

docsRegistry.addEndpoint({
  method: 'post',
  path: '/api/v1/notifications/devices',
  description:
    'Register a device push token (FCM token) for the authenticated user',
  requestSchema: registerDeviceSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/notifications/devices/:deviceToken',
  description: 'Unregister a device push token',
  params: unregisterDeviceParamsSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications',
  description: 'List notifications for current user',
  query: listQuerySchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/unread',
  description: 'List unread notifications for current user',
  query: listQuerySchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/notifications/read/:notificationId',
  description: 'Mark a notification as read',
  params: notifParamsSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/notifications/:notificationId',
  description: 'Delete a notification',
  params: notifParamsSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'delete',
  path: '/api/v1/notifications/all',
  description: 'Delete all notifications for current user',
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/events',
  description:
    "Event catalogue for the caller's role, generated from the notification registry. Feeds the My Notifications settings screen.",
  responseSchema: eventCatalogResponseSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/inbox',
  description:
    "Notification Center feed, newest first. Keyset paginated: pass the previous response's `nextCursor` to get the next page, and stop when `hasMore` is false. Offset pagination is deliberately not offered — rows arriving while a user pages would shift every later page.",
  query: inboxQuerySchema,
  responseSchema: inboxResponseSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'get',
  path: '/api/v1/notifications/unread-count',
  description:
    'Unread counts for the bell and the Center\'s tabs. `badge` is bounded at the cap (render "99+" when `badgeCapped`), because an exact count over a large backlog costs a full scan to display a number nobody reads. The per-category counts are exact — an abbreviated tab label would be wrong rather than short.',
  responseSchema: unreadCountResponseSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/notifications/read',
  description:
    "Mark several of the caller's own notifications read in one request. Scoped by user id in the statement itself, so ids belonging to another user match nothing rather than erroring.",
  requestSchema: markManyReadSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/notifications/resolve/:notificationId',
  description:
    'Mark the work a notification asks for as done — the payment taken, the follow-up booked. Distinct from marking it read: the Action Required tab counts unresolved rows, so this is what empties it. Resolving an already-resolved row returns 200 with the settled row rather than an error, since two staff clearing the same item is an expected race.',
  params: notifParamsSchema,
  tags: ['notifications'],
});

docsRegistry.addEndpoint({
  method: 'put',
  path: '/api/v1/notifications/read-all',
  description:
    "Mark every one of the caller's notifications read. Returns only the affected ids, not the rows — a user with a large backlog should not pull it all over the wire to clear a badge.",
  tags: ['notifications'],
});
