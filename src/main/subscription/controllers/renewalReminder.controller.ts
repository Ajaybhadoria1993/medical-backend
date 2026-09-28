// src/main/subscription/controllers/renewalReminder.controller.ts
import { Request, Response } from 'express';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import { sendOk } from '../../../utils/response.utils';
import { RenewalReminderService } from '../services/renewalReminder.service';

/**
 * POST /api/v1/subscription/reminders/send-expiry-reminders
 * Trigger expiry reminders for all clinics with subscriptions expiring soon.
 * Designed to be called by a daily cron job or manually by Super Admin.
 * @access Super Admin
 */
export const sendExpiryReminders = asyncHandler(
  async (_req: Request, res: Response) => {
    const result = await RenewalReminderService.sendExpiryReminders();

    return sendOk(res, 'Expiry reminders processed', {
      processed: result.processed,
      remindersSent: result.remindersSent.length,
      details: result.remindersSent,
      errors: result.errors,
    });
  }
);

/**
 * POST /api/v1/subscription/reminders/send-to-clinic
 * Send a renewal reminder to a specific clinic (manual trigger).
 * @access Super Admin or Clinic Admin
 */
export const sendReminderToClinic = asyncHandler(
  async (req: Request, res: Response) => {
    const clinicId = req.clinicId || req.body?.clinicId;

    if (!clinicId) {
      throw new HttpError(400, 'clinicId is required');
    }

    const result = await RenewalReminderService.sendReminderToClinic(clinicId);

    if (!result.sent) {
      throw new HttpError(400, result.message);
    }

    return sendOk(res, result.message);
  }
);
