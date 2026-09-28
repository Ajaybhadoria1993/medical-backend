// src/main/subscription/services/renewalReminder.service.ts
import { and, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import redisClient from '../../../configurations/redisConfig';
import { sendEmail } from '../../../utils/email';
import { sendNotificationToUser } from '../../../utils/notification.utils';
import { envConfig } from '../../../utils/envConfig';
import { notify } from '../../notifications/queues/notification.queue';
import {
  subscriptionRenewalTemplate,
  AddOnInfo,
} from '../../../htmltamplates/subscriptionRenewal';
import {
  billingCycleFromProviderId,
  planPriceForCycle,
} from '../utils/billingCycle.utils';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../models/subscription.model';
import { AddOnModel, ClinicAddOnModel } from '../models/addon.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { UserModel } from '../../users/models/user.model';
import { LimitationService, FEATURE_KEYS } from './limitation.service';
import logger from '../../../utils/logger';

/**
 * Days before expiry at which to send reminders.
 * Sends at 7 days, 3 days, and 1 day before expiry.
 */
const REMINDER_DAYS = [7, 3, 1];

interface ReminderResult {
  clinicId: string;
  clinicName: string;
  adminEmail: string;
  daysRemaining: number;
  totalAmount: number;
  emailSent: boolean;
  notificationSent: boolean;
}

export class RenewalReminderService {
  /**
   * Check all active paid subscriptions and send renewal reminders
   * for those expiring within the configured reminder days.
   *
   * Designed to be called once daily by a cron job.
   * Uses Redis flags to prevent duplicate reminders for the same day.
   */
  static async sendExpiryReminders(): Promise<{
    processed: number;
    remindersSent: ReminderResult[];
    errors: string[];
  }> {
    const now = new Date();
    const remindersSent: ReminderResult[] = [];
    const errors: string[] = [];

    // Find subscriptions expiring within the next 7 days
    const maxFuture = new Date(now);
    maxFuture.setDate(maxFuture.getDate() + Math.max(...REMINDER_DAYS) + 1);

    const expiringSubscriptions = await database
      .select({
        subscriptionId: ClinicSubscriptionModel.id,
        clinicId: ClinicSubscriptionModel.clinicId,
        planId: ClinicSubscriptionModel.planId,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        planName: SubscriptionPlanModel.name,
        planSlug: SubscriptionPlanModel.slug,
        planPrice: SubscriptionPlanModel.price,
        clinicName: ClinicModel.clinicName,
        adminUserId: ClinicModel.userId,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .innerJoin(
        ClinicModel,
        eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.active, true),
          notInArray(SubscriptionPlanModel.slug, ['solo', 'Free']),
          gte(ClinicSubscriptionModel.expiresAt, now),
          lte(ClinicSubscriptionModel.expiresAt, maxFuture)
        )
      );

    for (const sub of expiringSubscriptions) {
      if (!sub.expiresAt) continue;

      const msUntilExpiry = new Date(sub.expiresAt).getTime() - now.getTime();
      const daysRemaining = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      // Check if this falls on a reminder day
      const shouldRemind = REMINDER_DAYS.includes(daysRemaining);
      if (!shouldRemind) continue;

      // Check Redis flag to avoid duplicate reminders
      const reminderKey = `renewal_reminder:${sub.clinicId}:${daysRemaining}`;
      const alreadySent = await redisClient.get(reminderKey);
      if (alreadySent) continue;

      try {
        // Get admin user info
        const [admin] = await database
          .select({
            id: UserModel.id,
            name: UserModel.name,
            email: UserModel.email,
          })
          .from(UserModel)
          .where(eq(UserModel.id, sub.adminUserId))
          .limit(1);

        if (!admin || !admin.email) {
          errors.push(
            `Clinic ${sub.clinicId}: Admin user not found or no email`
          );
          continue;
        }

        const billingCycle = billingCycleFromProviderId(
          sub.providerSubscriptionId
        );
        const basePlanPrice = planPriceForCycle(sub.planPrice, billingCycle);

        // Fetch active add-ons for this clinic
        const clinicAddOns = await database
          .select({
            addOnName: AddOnModel.name,
            quantity: ClinicAddOnModel.quantity,
            price: ClinicAddOnModel.price,
          })
          .from(ClinicAddOnModel)
          .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
          .where(
            and(
              eq(ClinicAddOnModel.clinicId, sub.clinicId),
              eq(ClinicAddOnModel.isActive, true)
            )
          );

        // Build add-on info for email
        const addOns: AddOnInfo[] = clinicAddOns.map((a) => ({
          name: a.addOnName,
          quantity: a.quantity,
          price: Number(a.price),
        }));

        const addOnTotal = addOns.reduce((sum, a) => sum + a.price, 0);
        const totalAmount = basePlanPrice + addOnTotal;

        // Get current usage for the warning
        const doctorCheck = await LimitationService.checkDoctorLimit(
          sub.clinicId
        );
        const staffCheck = await LimitationService.checkStaffLimit(
          sub.clinicId
        );

        // Get free plan limits for comparison
        const freePlanLimit = await this.getFreePlanLimits();

        const renewalUrl = `${process.env.FRONTEND_URL || 'https://infinitymedisetu.com/app'}/subscription/renew?planId=${sub.planId}&cycle=${billingCycle}&clinicId=${sub.clinicId}`;

        // Send email
        const emailHtml = subscriptionRenewalTemplate({
          adminName: admin.name || 'Admin',
          clinicName: sub.clinicName,
          planName: sub.planName,
          planPrice: basePlanPrice,
          billingCycle,
          addOns,
          totalAmount,
          expiresAt: new Date(sub.expiresAt),
          daysRemaining,
          renewalUrl,
          staffCount: staffCheck.currentUsage,
          doctorCount: doctorCheck.currentUsage,
          staffLimit: freePlanLimit.staffLimit,
          doctorLimit: freePlanLimit.doctorLimit,
        });

        let emailSent = false;
        let notificationSent = false;

        try {
          await sendEmail(
            admin.email,
            `Your ${sub.planName} Plan Expires in ${daysRemaining} Day(s) at ${sub.clinicName}`,
            emailHtml
          );
          emailSent = true;
        } catch (emailErr) {
          logger.error(
            `Failed to send renewal email for clinic ${sub.clinicId}:`,
            emailErr
          );
        }

        // Send in-app notification to admin
        try {
          if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
            // The registry collapses repeat reminders into one row, so the
            // warnings fired on successive days as expiry approaches replace
            // each other instead of stacking five copies in the inbox.
            await notify('subscription.expiring', {
              clinicId: sub.clinicId,
              clinicName: sub.clinicName,
              adminUserId: admin.id,
              planName: sub.planName,
              totalAmount,
              daysRemaining,
            });
          } else {
            await sendNotificationToUser({
              userId: admin.id,
              title: 'Subscription Expiring Soon',
              body:
                daysRemaining <= 1
                  ? `Your ${sub.planName} plan (₹${totalAmount}) for ${sub.clinicName} expires tomorrow! Renew now to keep your staff accounts active.`
                  : `Your ${sub.planName} plan (₹${totalAmount}) for ${sub.clinicName} expires in ${daysRemaining} days. Renew to avoid staff deactivation.`,
              type: 'alert',
              metadata: {
                clinicId: sub.clinicId,
                source: 'subscription-renewal',
                daysRemaining,
                totalAmount,
                renewalUrl,
              },
            });
          }
          notificationSent = true;
        } catch (notifErr) {
          logger.error(
            `Failed to send renewal notification for clinic ${sub.clinicId}:`,
            notifErr
          );
        }

        // Mark as sent (TTL = 2 days to avoid re-sending for this reminder tier)
        await redisClient.setex(reminderKey, 172800, '1');

        remindersSent.push({
          clinicId: sub.clinicId,
          clinicName: sub.clinicName,
          adminEmail: admin.email,
          daysRemaining,
          totalAmount,
          emailSent,
          notificationSent,
        });
      } catch (err) {
        errors.push(
          `Clinic ${sub.clinicId}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    return {
      processed: expiringSubscriptions.length,
      remindersSent,
      errors,
    };
  }

  /**
   * Get the Free plan's staff and doctor limits for comparison in email warnings.
   */
  private static async getFreePlanLimits(): Promise<{
    staffLimit: number;
    doctorLimit: number;
  }> {
    const cacheKey = 'free_plan_limits';
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Default values if not configured
    let staffLimit = 1;
    let doctorLimit = 2;

    const [freePlan] = await database
      .select({ id: SubscriptionPlanModel.id })
      .from(SubscriptionPlanModel)
      .where(inArray(SubscriptionPlanModel.slug, ['solo', 'Free']))
      .limit(1);

    if (freePlan) {
      const staffLimitResult = await LimitationService.getPlanLimit(
        freePlan.id,
        FEATURE_KEYS.STAFF_ACCOUNTS
      );
      const doctorLimitResult = await LimitationService.getPlanLimit(
        freePlan.id,
        FEATURE_KEYS.DOCTOR_ACCOUNTS
      );

      if (staffLimitResult && staffLimitResult.limitValue) {
        staffLimit = staffLimitResult.limitValue;
      }

      if (doctorLimitResult && doctorLimitResult.limitValue) {
        doctorLimit = doctorLimitResult.limitValue;
      }
    }

    const result = { staffLimit, doctorLimit };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(result));

    return result;
  }

  /**
   * Send a single renewal reminder to a specific clinic (manual trigger by admin).
   */
  static async sendReminderToClinic(clinicId: string): Promise<{
    sent: boolean;
    message: string;
  }> {
    const [sub] = await database
      .select({
        planId: ClinicSubscriptionModel.planId,
        expiresAt: ClinicSubscriptionModel.expiresAt,
        providerSubscriptionId: ClinicSubscriptionModel.providerSubscriptionId,
        planName: SubscriptionPlanModel.name,
        planSlug: SubscriptionPlanModel.slug,
        planPrice: SubscriptionPlanModel.price,
        clinicName: ClinicModel.clinicName,
        adminUserId: ClinicModel.userId,
      })
      .from(ClinicSubscriptionModel)
      .innerJoin(
        SubscriptionPlanModel,
        eq(ClinicSubscriptionModel.planId, SubscriptionPlanModel.id)
      )
      .innerJoin(
        ClinicModel,
        eq(ClinicSubscriptionModel.clinicId, ClinicModel.id)
      )
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true),
          notInArray(SubscriptionPlanModel.slug, ['solo', 'Free'])
        )
      )
      .limit(1);

    if (!sub || !sub.expiresAt) {
      return { sent: false, message: 'No active paid subscription found' };
    }

    const now = new Date();
    const msUntilExpiry = new Date(sub.expiresAt).getTime() - now.getTime();
    const daysRemaining = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
      return { sent: false, message: 'Subscription has already expired' };
    }

    const [admin] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
        email: UserModel.email,
      })
      .from(UserModel)
      .where(eq(UserModel.id, sub.adminUserId))
      .limit(1);

    if (!admin || !admin.email) {
      return { sent: false, message: 'Admin user not found or no email' };
    }

    const billingCycle = billingCycleFromProviderId(sub.providerSubscriptionId);
    const basePlanPrice = planPriceForCycle(sub.planPrice, billingCycle);

    // Fetch active add-ons
    const clinicAddOns = await database
      .select({
        addOnName: AddOnModel.name,
        quantity: ClinicAddOnModel.quantity,
        price: ClinicAddOnModel.price,
      })
      .from(ClinicAddOnModel)
      .innerJoin(AddOnModel, eq(ClinicAddOnModel.addOnId, AddOnModel.id))
      .where(
        and(
          eq(ClinicAddOnModel.clinicId, clinicId),
          eq(ClinicAddOnModel.isActive, true)
        )
      );

    const addOns: AddOnInfo[] = clinicAddOns.map((a) => ({
      name: a.addOnName,
      quantity: a.quantity,
      price: Number(a.price),
    }));

    const addOnTotal = addOns.reduce((sum, a) => sum + a.price, 0);
    const totalAmount = basePlanPrice + addOnTotal;

    const doctorCheck = await LimitationService.checkDoctorLimit(clinicId);
    const staffCheck = await LimitationService.checkStaffLimit(clinicId);
    const freePlanLimit = await this.getFreePlanLimits();

    const renewalUrl = `${process.env.FRONTEND_URL || 'https://infinitymedisetu.com/app'}/subscription/renew?planId=${sub.planId}&cycle=${billingCycle}&clinicId=${clinicId}`;

    const emailHtml = subscriptionRenewalTemplate({
      adminName: admin.name || 'Admin',
      clinicName: sub.clinicName,
      planName: sub.planName,
      planPrice: basePlanPrice,
      billingCycle,
      addOns,
      totalAmount,
      expiresAt: new Date(sub.expiresAt),
      daysRemaining,
      renewalUrl,
      staffCount: staffCheck.currentUsage,
      doctorCount: doctorCheck.currentUsage,
      staffLimit: freePlanLimit.staffLimit,
      doctorLimit: freePlanLimit.doctorLimit,
    });

    await sendEmail(
      admin.email,
      `Your ${sub.planName} Plan Expires in ${daysRemaining} Day(s) at ${sub.clinicName}`,
      emailHtml
    );

    /*
     * Same event as the nightly cron above, and for the same reason: this is
     * the manual "remind them now" button, and a reminder sent by hand should
     * land in the admin's inbox as the *same* collapsed row the automatic ones
     * use — not as a second, separate warning about one expiry.
     *
     * This path was missed when the cron path moved to the registry, so it kept
     * writing through the legacy helper: no collapse, no registry click route,
     * and preferences resolved under a different key. Nothing failed, which is
     * why it survived.
     */
    if (envConfig.NOTIFICATIONS_REGISTRY_ENABLED) {
      await notify('subscription.expiring', {
        clinicId,
        clinicName: sub.clinicName,
        adminUserId: admin.id,
        planName: sub.planName,
        totalAmount,
        daysRemaining,
      });
    } else {
      await sendNotificationToUser({
        userId: admin.id,
        title: 'Subscription Expiring Soon',
        body: `Your ${sub.planName} plan (₹${totalAmount}) for ${sub.clinicName} expires in ${daysRemaining} days. Renew to avoid staff deactivation.`,
        type: 'alert',
        metadata: {
          clinicId,
          source: 'subscription-renewal',
          daysRemaining,
          totalAmount,
          renewalUrl,
        },
      });
    }

    return {
      sent: true,
      message: `Reminder sent to ${admin.email} — Total: ₹${totalAmount}`,
    };
  }
}
