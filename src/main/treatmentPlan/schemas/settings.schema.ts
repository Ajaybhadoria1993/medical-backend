import { z } from 'zod';
import { tpBillingModeEnum } from '../models/treatmentEnums.model';

const reminderDays = z.number().int().min(0).max(60);

export const settingsUpdateSchema = z
  .object({
    billingModes: z
      .array(z.enum(tpBillingModeEnum.enumValues))
      .min(1, 'Offer at least one billing mode')
      .refine((v) => new Set(v).size === v.length, 'Billing modes repeat'),
    invoiceTiming: z.enum(['per_step', 'at_end']),
    discountCapPercent: z.number().int().min(0).max(100),
    // Dedicated treatment time arrives with D3; until then only normal booking exists.
    bookingMode: z.enum(['normal']),
    bookingHorizonDays: z.number().int().min(1).max(365).nullable(),
    recallReminderDays: reminderDays,
    instalmentReminderDays: reminderDays,
    packageExpiryReminderDays: reminderDays,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one setting');

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// Swagger only: the envelope sendOk returns for GET and PUT /settings.
export const settingsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    billingModes: z.array(z.enum(tpBillingModeEnum.enumValues)),
    invoiceTiming: z.enum(['per_step', 'at_end']),
    discountCapPercent: z.number().int(),
    bookingMode: z.enum(['normal', 'dedicated']),
    bookingHorizonDays: z.number().int().nullable(),
    recallReminderDays: z.number().int(),
    instalmentReminderDays: z.number().int(),
    packageExpiryReminderDays: z.number().int(),
  }),
});
