// src/schemas/access.schemas.ts
import { z } from 'zod';

export const updateSettingsSchema = z.object({
  emailNotification: z.boolean().optional(),
  smsNotification: z.boolean().optional(),
  whatsappNotification: z.boolean().optional(),
  appointmentReminder: z.number().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
});

export type SettingUpdateDto = z.infer<typeof updateSettingsSchema>;

export const updateNotificationPreferencesSchema = z.object({
  inApp: z.record(z.string(), z.boolean()).optional(),
  push: z.record(z.string(), z.boolean()).optional(),
});

export type UpdateNotificationPreferencesDto = z.infer<
  typeof updateNotificationPreferencesSchema
>;
