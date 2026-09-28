import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { HttpError } from '../../../middlewear/errorHandler';
import { comparePassword, hashPassword } from '../../../utils/authUtils';
import { UserModel } from '../../users/models/user.model';
import { TokenService } from '../../users/services/token.service';
import { realtimeBus } from '../../realtime';
import { SettingModel } from '../models/setting.model';
import {
  SettingUpdateDto,
  UpdateNotificationPreferencesDto,
} from '../schemas/setting.schemas';

export class SettingServices {
  static async getSetting(userId: string) {
    const [setting] = await database
      .select()
      .from(SettingModel)
      .where(eq(SettingModel.userId, userId))
      .limit(1);
    return setting;
  }
  static async updateSetting(userId: string, payload: SettingUpdateDto) {
    const [setting] = await database
      .update(SettingModel)
      .set({ ...payload })
      .where(eq(SettingModel.userId, userId))
      .returning({
        id: SettingModel.id,
        emailNotification: SettingModel.emailNotification,
        smsNotification: SettingModel.smsNotification,
        whatsappNotification: SettingModel.whatsappNotification,
        appointmentReminder: SettingModel.appointmentReminder,
      });
    if (
      payload.newPassword &&
      payload.currentPassword &&
      payload.confirmPassword
    ) {
      if (payload.newPassword !== payload.confirmPassword)
        throw new HttpError(400, 'Password does not match');

      const [existPassword] = await database
        .select({
          password: UserModel.password,
        })
        .from(UserModel)
        .where(eq(UserModel.id, userId))
        .limit(1);

      if (!existPassword || !existPassword.password)
        throw new HttpError(400, 'User not found or password not set');

      const ok = await comparePassword(
        payload.currentPassword,
        existPassword.password
      );

      if (!ok) throw new HttpError(400, 'Invalid password');

      const hashedPassword = await hashPassword(payload.newPassword);
      const now = new Date();
      const pwdChangedSeconds = Math.floor(now.getTime() / 1000);

      await database
        .update(UserModel)
        .set({
          password: hashedPassword,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(UserModel.id, userId));

      await redisClient.del(`user:${userId}`);
      await redisClient.setex(
        `user:password_changed_at:${userId}`,
        86400 * 30,
        String(pwdChangedSeconds)
      );
      await TokenService.revokeAllForUser(userId);

      // Broadcast real-time invalidation to all other devices/sockets for this user
      realtimeBus.notifySessionInvalidated(userId, 'PASSWORD_CHANGED');
    }

    return setting;
  }

  static async getNotificationPreferences(userId: string, role: string) {
    const { resolveNotificationPreferences } =
      await import('../../notifications/preferences/notificationPreferences.utils');
    return await resolveNotificationPreferences(userId, role);
  }

  static async updateNotificationPreferences(
    userId: string,
    role: string,
    payload: UpdateNotificationPreferencesDto
  ) {
    const {
      resolveNotificationPreferences,
      invalidateNotificationPreferenceCache,
    } =
      await import('../../notifications/preferences/notificationPreferences.utils');
    const { NON_CONFIGURABLE_NOTIFICATIONS } =
      await import('../../notifications/preferences/notificationPreferences.constants');

    // 1. Get existing settings
    const [setting] = await database
      .select()
      .from(SettingModel)
      .where(eq(SettingModel.userId, userId))
      .limit(1);

    const currentPrefs = (setting?.notificationPreferences || {}) as Record<
      string,
      Record<string, boolean>
    >;

    const inAppOverrides = { ...(currentPrefs.inApp || {}) };
    const pushOverrides = { ...(currentPrefs.push || {}) };

    // 2. Merge overrides while ignoring non-configurable keys
    if (payload.inApp) {
      for (const [key, val] of Object.entries(payload.inApp)) {
        if (!NON_CONFIGURABLE_NOTIFICATIONS.includes(key)) {
          inAppOverrides[key] = val;
        }
      }
    }

    if (payload.push) {
      for (const [key, val] of Object.entries(payload.push)) {
        if (!NON_CONFIGURABLE_NOTIFICATIONS.includes(key)) {
          pushOverrides[key] = val;
        }
      }
    }

    const newPrefs = {
      inApp: inAppOverrides,
      push: pushOverrides,
    };

    // 3. Save to database
    if (setting) {
      await database
        .update(SettingModel)
        .set({
          notificationPreferences: newPrefs,
          updatedAt: new Date(),
        })
        .where(eq(SettingModel.userId, userId));
    } else {
      await database.insert(SettingModel).values({
        userId,
        notificationPreferences: newPrefs,
      });
    }

    // 4. Invalidate Redis cache
    await invalidateNotificationPreferenceCache(userId);

    // 5. Return updated & resolved preferences
    return await resolveNotificationPreferences(userId, role);
  }
}
