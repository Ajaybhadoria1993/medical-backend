import { z } from 'zod';
import { MAX_TRIAL_DAYS } from '../utils/trialDays.utils';

const reason = z
  .string()
  .trim()
  .min(5, 'Say why (at least 5 characters)')
  .max(255);

const days = z.number().int().min(1).max(MAX_TRIAL_DAYS);

export const freeTrialClinicParamsSchema = z.object({
  clinicId: z.string().uuid('Invalid clinic id'),
});

export const freeTrialDaysSchema = z.object({ days, reason });

export const freeTrialClearSchema = z.object({ reason });
