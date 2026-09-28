// src/middlewear/subscriptionAccess.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { asyncHandler, HttpError } from './errorHandler';
import { database } from '../configurations/dbConnection';
import { ClinicSubscriptionModel } from '../main/subscription/models/subscription.model';
import { ClinicAssignModel } from '../main/clinic/models/clinic.model';
import { PharmacyAssignModel } from '../main/pharmacy/models/pharmacy.model';
import { UserLabAssignmentsModel } from '../main/lab/models/lab.model';
import { eq, and, inArray } from 'drizzle-orm';
import redisClient from '../configurations/redisConfig';
import { isSubscriptionValid } from '../utils/subscriptionExpiry';
/**
 * Clinic-Based Subscription Access Middleware
 *
 * Rules:
 * 1. Clinic must have an active subscription
 * 2. Subscription must NOT be expired
 * 3. If subscription expired → Block PAID features
 * 4. FREE features always accessible (don't use this middleware on free routes)
 *
 * Usage:
 * - Add to PAID feature routes: lab, pharmacy, medicine, receptionist
 * - Don't add to FREE feature routes: appointments, patients, doctors, etc.
 */

/**
 * Check if clinic has active, non-expired subscription
 */

export async function hasActiveSubscription(
  clinicId: string
): Promise<boolean> {
  if (!clinicId) {
    return false;
  }

  const redisKey = `clinic_active_subscription:${clinicId}`;
  const now = new Date();

  // 1️⃣ Redis check
  const cached = await redisClient.get(redisKey);

  if (cached) {
    const cachedData = JSON.parse(cached);

    // Explicitly marked as no subscription
    if (cachedData.noSubscription) {
      return false;
    }

    // expiresAt null means never expires (Free plan) → valid
    if (cachedData.expiresAt === null) {
      return true;
    }

    if (isSubscriptionValid(cachedData.expiresAt, now)) {
      return true;
    }
    await redisClient.del(redisKey);
  }

  const subs = await database
    .select({
      expiresAt: ClinicSubscriptionModel.expiresAt,
    })
    .from(ClinicSubscriptionModel)
    .where(
      and(
        eq(ClinicSubscriptionModel.clinicId, clinicId),
        eq(ClinicSubscriptionModel.active, true)
      )
    );

  if (subs.length === 0) {
    await redisClient.setex(
      redisKey,
      300,
      JSON.stringify({ noSubscription: true })
    );
    return false;
  }

  // 3️⃣ Expiry validation: null expiresAt = never expires (valid)
  const validSub = subs.find((sub) => isSubscriptionValid(sub.expiresAt, now));

  if (!validSub) {
    await redisClient.setex(
      redisKey,
      300,
      JSON.stringify({ noSubscription: true })
    );
    return false;
  }

  // 4️⃣ Cache valid subscription
  if (validSub.expiresAt) {
    const expiryDate = new Date(validSub.expiresAt);
    const ttl = Math.floor((expiryDate.getTime() - now.getTime()) / 1000);
    await redisClient.setex(
      redisKey,
      Math.max(ttl, 60),
      JSON.stringify({ expiresAt: validSub.expiresAt })
    );
  } else {
    // Never expires (Free plan) — cache for 5 minutes
    await redisClient.setex(redisKey, 300, JSON.stringify({ expiresAt: null }));
  }

  return true;
}

/**
 * Middleware: Require active subscription (checks clinic subscription)
 * Use this on PAID feature routes
 */
export const requireSubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId; // From requireClinic middleware

    if (!clinicId) {
      throw new HttpError(
        401,
        'Clinic context required. Please ensure you are accessing from a valid clinic.'
      );
    }

    const hasSubscription = await hasActiveSubscription(clinicId);

    if (!hasSubscription) {
      throw new HttpError(
        403,
        'This feature requires an active clinic subscription. Please subscribe to access premium features.'
      );
    }

    return next();
  }
);

/**
 * Middleware: Require active user subscription.
 * Checks the user subscription expiry date against today.
 * If expired or no active subscription, blocks access.
 * Only checks from the cache key, with no database query fallback.
 */
export const requireUserSubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      throw new HttpError(401, 'User authentication required.');
    }

    const redisKey = `user_subscription_expiry:${userId}`;
    const now = new Date();

    // 1️⃣ Check Redis Cache
    const cachedExpiry = await redisClient.get(redisKey);

    if (cachedExpiry) {
      if (cachedExpiry !== 'null') {
        const expiryDate = new Date(cachedExpiry);
        if (!isNaN(expiryDate.getTime())) {
          if (isSubscriptionValid(expiryDate, now)) {
            return next();
          }
          throw new HttpError(
            403,
            'Your clinic subscription has expired. Access denied.'
          );
        }
      }
      // If cachedExpiry is 'null', we do NOT allow direct access from cache. We check DB.
    }

    // 2️⃣ Fallback to DB
    const [clinicAssignments, pharmacyAssignments, labAssignments] =
      await Promise.all([
        database
          .select({ clinicId: ClinicAssignModel.clinicId })
          .from(ClinicAssignModel)
          .where(eq(ClinicAssignModel.userId, userId)),
        database
          .select({ clinicId: PharmacyAssignModel.clinicId })
          .from(PharmacyAssignModel)
          .where(eq(PharmacyAssignModel.userId, userId)),
        database
          .select({ clinicId: UserLabAssignmentsModel.clinicId })
          .from(UserLabAssignmentsModel)
          .where(eq(UserLabAssignmentsModel.userId, userId)),
      ]);

    const clinicIds = Array.from(
      new Set<string>([
        ...clinicAssignments.map((uc) => uc.clinicId).filter(Boolean),
        ...pharmacyAssignments.map((uc) => uc.clinicId).filter(Boolean),
        ...labAssignments.map((uc) => uc.clinicId).filter(Boolean),
      ])
    );

    if (clinicIds.length === 0) {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      await redisClient.set(redisKey, fiveDaysAgo.toISOString());

      throw new HttpError(
        403,
        'Your clinic subscription has expired or is invalid. Access denied.'
      );
    }

    const dbSubscriptions = await database
      .select({
        expiresAt: ClinicSubscriptionModel.expiresAt,
        price: ClinicSubscriptionModel.price,
      })
      .from(ClinicSubscriptionModel)
      .where(
        and(
          inArray(ClinicSubscriptionModel.clinicId, clinicIds),
          eq(ClinicSubscriptionModel.active, true)
        )
      );

    if (dbSubscriptions.length === 0) {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      await redisClient.set(redisKey, fiveDaysAgo.toISOString());

      throw new HttpError(
        403,
        'Your clinic subscription has expired or is invalid. Access denied.'
      );
    }

    let chosenExpiry: Date | null = null;
    const hasNeverExpires = false;

    for (const sub of dbSubscriptions) {
      if (sub.expiresAt === null) {
        throw new HttpError(
          403,
          'Your clinic subscription has expired. Access denied.'
        );
      } else {
        const subExpiry = new Date(sub.expiresAt);
        if (chosenExpiry === null || subExpiry > chosenExpiry) {
          chosenExpiry = subExpiry;
        }
      }
    }

    if (hasNeverExpires || chosenExpiry === null) {
      await redisClient.set(redisKey, 'null');
      return next();
    }

    await redisClient.set(redisKey, chosenExpiry.toISOString());

    if (isSubscriptionValid(chosenExpiry, now)) {
      return next();
    }

    throw new HttpError(
      403,
      'Your clinic subscription has expired. Access denied.'
    );
  }
);

/**
 * Middleware aliases for specific features
 * All check the same thing (active clinic subscription), but with specific error messages
 */

export const requireLabSubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required');
    }

    const hasSubscription = await hasActiveSubscription(clinicId);

    if (!hasSubscription) {
      throw new HttpError(
        403,
        'Lab features require an active clinic subscription. Please subscribe to access lab management.'
      );
    }

    return next();
  }
);

export const requirePharmacySubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required');
    }

    const hasSubscription = await hasActiveSubscription(clinicId);

    if (!hasSubscription) {
      throw new HttpError(
        403,
        'Pharmacy features require an active clinic subscription. Please subscribe to access pharmacy management.'
      );
    }

    return next();
  }
);

export const requireMedicineSubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required');
    }

    const hasSubscription = await hasActiveSubscription(clinicId);

    if (!hasSubscription) {
      throw new HttpError(
        403,
        'Medicine features require an active clinic subscription. Please subscribe to access medicine management.'
      );
    }

    return next();
  }
);

export const requireReceptionistSubscription = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      throw new HttpError(401, 'Clinic context required');
    }

    const hasSubscription = await hasActiveSubscription(clinicId);

    if (!hasSubscription) {
      throw new HttpError(
        403,
        'Receptionist features require an active clinic subscription. Please subscribe to access receptionist features.'
      );
    }

    return next();
  }
);

/**
 * Helper: Check subscription status (for UI/info endpoints)
 * Adds subscription info to request object
 */
export const checkSubscriptionStatus = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const clinicId = req.clinicId;

    if (!clinicId) {
      req.subscriptionStatus = {
        hasSubscription: false,
        isExpired: true,
      };
      return next();
    }

    const subscriptions = await database
      .select()
      .from(ClinicSubscriptionModel)
      .where(
        and(
          eq(ClinicSubscriptionModel.clinicId, clinicId),
          eq(ClinicSubscriptionModel.active, true)
        )
      );

    if (subscriptions.length === 0) {
      req.subscriptionStatus = {
        hasSubscription: false,
        isExpired: true,
      };
      return next();
    }

    const now = new Date();
    let hasActive = false;

    for (const sub of subscriptions) {
      if (!sub.expiresAt || new Date(sub.expiresAt) > now) {
        hasActive = true;
        req.subscriptionStatus = {
          hasSubscription: true,
          isExpired: false,
          expiresAt: sub.expiresAt,
          planId: sub.planId,
        };
        break;
      }
    }

    if (!hasActive) {
      req.subscriptionStatus = {
        hasSubscription: true,
        isExpired: true,
      };
    }

    return next();
  }
);

// Extend Express Request type
declare module 'express' {
  interface Request {
    subscriptionStatus?: {
      hasSubscription: boolean;
      isExpired: boolean;
      expiresAt?: Date | null;
      planId?: string;
    };
  }
}
