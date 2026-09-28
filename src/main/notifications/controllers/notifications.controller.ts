import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import {
  sendCreated,
  sendNoContent,
  sendOk,
} from '../../../utils/response.utils';
import { SnsNotificationService } from '../services/sns.service';
import {
  listNotificationsForUser,
  listUnreadNotificationsForUser,
  markNotificationRead,
  deleteNotification,
  deleteAllNotificationsForUser,
  listInbox,
  getUnreadBreakdown,
  getUnreadCount,
  markManyRead,
  markAllNotificationsRead,
  resolveNotification,
  getNotificationForUser,
  UNREAD_COUNT_CAP,
} from '../services/notifications.service';
import { getEventCatalog } from '../preferences/eventCatalog';

/** GET /notifications/events — registry-derived catalogue for the caller's role. */
export const listEventCatalogHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const catalog = getEventCatalog(req.user.userType);
    return sendOk(res, 'Notification events fetched successfully', catalog);
  }
);

/**
 * POST /api/v1/notifications/devices
 * Register device token for push notifications (FCM tokens).
 */
export const registerDeviceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { deviceToken, platform } = req.validatedBody;
    const result = await SnsNotificationService.registerDevice(
      req.user.id,
      deviceToken,
      platform
    );
    return sendCreated(res, 'Device registered successfully', result);
  }
);

/**
 * DELETE /api/v1/notifications/devices/:deviceToken
 * Unregister device token.
 */
export const unregisterDeviceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { deviceToken } = req.validatedParams;
    await SnsNotificationService.unregisterDevice(deviceToken);
    return sendNoContent(res, 'Device unregistered successfully');
  }
);

/** GET /notifications/inbox — keyset-paginated feed. */
export const listInboxHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await listInbox(req.user.id, req.validatedQuery ?? {});
    return sendOk(res, 'Notifications fetched successfully', result);
  }
);

/** GET /notifications/unread-count — bounded badge, exact per-category counts. */
export const unreadCountHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const [badge, breakdown] = await Promise.all([
      getUnreadCount(req.user.id),
      getUnreadBreakdown(req.user.id),
    ]);

    return sendOk(res, 'Unread count fetched successfully', {
      badge,
      badgeCapped: badge >= UNREAD_COUNT_CAP,
      cap: UNREAD_COUNT_CAP,
      ...breakdown,
    });
  }
);

/**
 * PUT /api/v1/notifications/read
 * Mark several of the caller's notifications read in one request.
 */
export const markManyReadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { notificationIds } = req.validatedBody;
    const updated = await markManyRead(req.user.id, notificationIds);
    return sendOk(res, 'Notifications marked as read', {
      updated: updated.length,
    });
  }
);

/**
 * PUT /api/v1/notifications/resolve/:notificationId
 * Mark the work a notification asks for as done.
 *
 * Separate from marking it read: this is what removes the row from the Action
 * Required tab. Resolving an already-resolved row is a no-op rather than an
 * error — two receptionists clearing the same item is a race to expect, not a
 * failure to report — but the row must exist and belong to the caller.
 */
export const resolveNotificationHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { notificationId } = req.validatedParams;
    const updated = await resolveNotification(req.user.id, notificationId);

    if (!updated) {
      const existing = await getNotificationForUser(
        req.user.id,
        notificationId
      );
      if (!existing) {
        throw new HttpError(404, 'Notification not found');
      }
      // Already resolved by someone else — report the settled state.
      return sendOk(res, 'Notification already resolved', existing);
    }

    return sendOk(res, 'Notification resolved', updated);
  }
);

/**
 * PUT /api/v1/notifications/read-all
 * Mark every unread notification of the caller's read.
 */
export const markAllReadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await markAllNotificationsRead(req.user.id);
    return sendOk(res, 'All notifications marked as read', result);
  }
);

/**
 * GET /api/v1/notifications
 * Get all notifications for the authenticated user.
 */
export const listNotificationsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { limit, offset } = req.validatedQuery ?? {};
    const result = await listNotificationsForUser(req.user.id, {
      limit,
      offset,
    });
    return sendOk(res, 'Notifications fetched successfully', result);
  }
);

/**
 * GET /api/v1/notifications/unread
 * Get unread notifications for the authenticated user.
 */
export const listUnreadNotificationsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { limit, offset } = req.validatedQuery ?? {};
    const result = await listUnreadNotificationsForUser(req.user.id, {
      limit,
      offset,
    });
    return sendOk(res, 'Unread notifications fetched successfully', result);
  }
);

/**
 * PUT /api/v1/notifications/read/:notificationId
 * Mark a specific notification as read.
 */
export const markReadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { notificationId } = req.validatedParams;

    // One statement: the update is user-scoped, so no match means it is not
    // theirs — indistinguishable from not existing, which is the right answer
    // to give either way.
    const result = await markNotificationRead(req.user.id, notificationId);
    if (!result) {
      throw new HttpError(404, 'Notification not found');
    }

    return sendOk(res, 'Notification marked as read', result);
  }
);

/**
 * DELETE /api/v1/notifications/:notificationId
 * Delete a specific notification.
 */
export const deleteNotificationHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { notificationId } = req.validatedParams;

    const result = await deleteNotification(req.user.id, notificationId);
    if (!result) {
      throw new HttpError(404, 'Notification not found');
    }

    return sendOk(res, 'Notification deleted successfully', result);
  }
);

/**
 * DELETE /api/v1/notifications/all
 * Delete all notifications for the authenticated user.
 */
export const deleteAllHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await deleteAllNotificationsForUser(req.user.id);
    return sendOk(res, 'All notifications deleted successfully', {
      deletedCount: result?.length ?? 0,
    });
  }
);
