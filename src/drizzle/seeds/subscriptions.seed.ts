import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../../main/subscription/models/subscription.model';
import { PlanVersionModel } from '../../main/subscription/models/planVersion.model';
import { planPriceForCycle } from '../../main/subscription/utils/billingCycle.utils';
import { CouponModel } from '../../main/subscription/models/coupon.model';
import { CouponUsageModel } from '../../main/subscription/models/couponUsage.model';
import { PlanFeaturesModel } from '../../main/subscription/models/planFeatures.model';
import {
  AddOnModel,
  PlanAddOnLimitsModel,
} from '../../main/subscription/models/addon.model';
import logger from '../../utils/logger';
import { logSeed, newCounts, syncRow, tally, type Tx } from './seedSync';

interface PlanFeatureSeed {
  featureKey: string;
  displayName: string;
  description: string | null;
  type?: 'numeric' | 'boolean' | 'marketing';
  limitValue?: number | null;
  isUnlimited?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  isMarketingFeature?: boolean;
}

interface PlanAddOnLimitSeed {
  addOnFeatureKey: string;
  maxCap: number | null;
}

interface PlanSeed {
  slug: string;
  /** Previous slugs of this plan; existing rows are renamed, not duplicated. */
  legacySlugs?: string[];
  name: string;
  description: string;
  price: any;
  currency: string;
  isTrialPlan?: boolean;
  trialDays?: number | null;
  isDefaultFallback?: boolean;
  isMostPopular?: boolean;
  /** Struck-through "was" price on plan cards; display only. */
  compareAtMonthly?: number | null;
  compareAtYearly?: number | null;
  features: PlanFeatureSeed[];
  addOnLimits?: PlanAddOnLimitSeed[];
}

const plans: PlanSeed[] = [
  {
    slug: 'solo',
    compareAtMonthly: 299,
    legacySlugs: ['Free'],
    name: 'Solo',
    description: 'Solo access for small clinics',
    price: 0,
    currency: 'INR',
    isTrialPlan: false,
    trialDays: null,
    isDefaultFallback: true,
    features: [
      {
        featureKey: 'doctor_accounts',
        displayName: 'Doctor Accounts',
        description: '1 Doctor account',
        limitValue: 1,
        isUnlimited: false,
        enabled: true,
        sortOrder: 1,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'staff_accounts',
        displayName: 'Staff Accounts',
        description: 'No staff accounts',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 2,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'appointments_per_month',
        displayName: 'Monthly Appointments',
        description: 'Unlimited appointment booking',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 3,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'cloud_storage',
        displayName: 'Cloud Storage',
        description: '100 MB (Prescriptions only)',
        limitValue: 100,
        isUnlimited: false,
        enabled: true,
        sortOrder: 4,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'storage_months',
        displayName: 'Data Retention',
        description: '3 months storage retention',
        limitValue: 3,
        isUnlimited: false,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'whatsapp_messages_per_month',
        displayName: 'WhatsApp Automation',
        description: 'WhatsApp messages using credits (no free messages)',
        limitValue: 0,
        isUnlimited: false,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EMR',
        description: 'Standard Rx templates & basic EMR',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 6,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'waiting_room_queue',
        displayName: 'Waiting Room Queue',
        description: 'Live Queue & real-time ETA',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 7,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'reports_analytics',
        displayName: 'Reports & Analytics',
        description: 'Basic daily clinic reports',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 8,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'priority_support',
        displayName: 'Customer Support',
        description: 'Community & Email support',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 9,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'payment_history_months',
        displayName: 'Payment History',
        description: '3 months access',
        limitValue: 3,
        isUnlimited: false,
        enabled: true,
        sortOrder: 10,
        isMarketingFeature: false,
        type: 'numeric',
      },
      {
        featureKey: 'lab_integration',
        displayName: 'Diagnostic Lab Module',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 11,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'pharmacy_integration',
        displayName: 'Pharmacy Module',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 12,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'public_booking_page',
        displayName: 'Public Booking Page',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 13,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'add_ons',
        displayName: 'Add-Ons Feature',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 14,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'dashboard_full_access',
        displayName: 'Dashboard Full Access',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 15,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'custom_branded_rx',
        displayName: 'Custom Branded Rx',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 16,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'ocr_prescription_scan',
        displayName: 'OCR Prescription Scan',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 17,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'chatbot_support',
        displayName: 'Chatbot Support',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 18,
        isMarketingFeature: false,
        type: 'boolean',
      },
    ],
  },
  {
    slug: 'clinic-monthly',
    compareAtMonthly: 899,
    legacySlugs: ['basic-monthly'],
    name: 'Clinic',
    description: 'Essential features for small practices and clinics',
    price: 499,
    currency: 'INR',
    isTrialPlan: true,
    trialDays: 30,
    isDefaultFallback: false,
    isMostPopular: true,
    features: [
      {
        featureKey: 'doctor_accounts',
        displayName: 'Doctor Accounts',
        description: '1 Doctor account',
        limitValue: 1,
        isUnlimited: false,
        enabled: true,
        sortOrder: 1,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'staff_accounts',
        displayName: 'Staff Accounts',
        description: '1 Staff account',
        limitValue: 1,
        isUnlimited: false,
        enabled: true,
        sortOrder: 2,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'appointments_per_month',
        displayName: 'Monthly Appointments',
        description: 'Unlimited appointment booking',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 3,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'cloud_storage',
        displayName: 'Cloud Storage',
        description: '500 MB (Records, scans and Rx)',
        limitValue: 500,
        isUnlimited: false,
        enabled: true,
        sortOrder: 4,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'storage_months',
        displayName: 'Data Retention',
        description: 'Unlimited permanent storage',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'whatsapp_messages_per_month',
        displayName: 'WhatsApp Automation',
        description: '300 free WhatsApp messages a month, then credits',
        limitValue: 300,
        isUnlimited: false,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EMR',
        description: 'Custom-branded Rx & digital EMR',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 6,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'waiting_room_queue',
        displayName: 'Waiting Room Queue',
        description: 'Live Queue & real-time ETA',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 7,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'public_booking_page',
        displayName: 'Public Booking Page',
        description: 'Public profile & booking link',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 8,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'add_ons',
        displayName: 'Add-Ons Feature',
        description: 'Purchase additional resources',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 9,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'reports_analytics',
        displayName: 'Reports & Analytics',
        description: 'Standard financial reports',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 10,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'chatbot_support',
        displayName: 'Customer Support',
        description: 'Email & 24/7 AI Chatbot',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 11,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'custom_branded_rx',
        displayName: 'Custom Branded Rx',
        description: 'Custom-branded Rx templates and layout customization',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 12,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'payment_history_months',
        displayName: 'Payment History',
        description: null,
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 13,
        isMarketingFeature: false,
        type: 'numeric',
      },
      {
        featureKey: 'pharmacy_integration',
        displayName: 'Pharmacy Module',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 14,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'lab_integration',
        displayName: 'Diagnostic Lab Module',
        description: null,
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 15,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'dashboard_full_access',
        displayName: 'Dashboard Full Access',
        description: 'Full dashboard analytics and insights',
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 16,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'ocr_prescription_scan',
        displayName: 'OCR Prescription Scan',
        description: 'AI / OCR prescription digitization',
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 17,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'priority_support',
        displayName: 'Priority Support',
        description: 'Priority customer support',
        limitValue: null,
        isUnlimited: false,
        enabled: false,
        sortOrder: 18,
        isMarketingFeature: false,
        type: 'boolean',
      },
    ],
    addOnLimits: [
      { addOnFeatureKey: 'additional_doctor', maxCap: 1 },
      { addOnFeatureKey: 'additional_staff', maxCap: 2 },
      { addOnFeatureKey: 'additional_storage', maxCap: 1024 },
    ],
  },
  {
    slug: 'carehub-monthly',
    compareAtMonthly: 1999,
    legacySlugs: ['pro-monthly'],
    name: 'CareHub',
    description: 'Advanced features for growing clinics',
    price: 999,
    currency: 'INR',
    isTrialPlan: false,
    trialDays: null,
    isDefaultFallback: false,
    features: [
      {
        featureKey: 'doctor_accounts',
        displayName: 'Doctor Accounts',
        description: 'Up to 2 Doctor accounts',
        limitValue: 2,
        isUnlimited: false,
        enabled: true,
        sortOrder: 1,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'staff_accounts',
        displayName: 'Staff Accounts',
        description: '4 Staff accounts',
        limitValue: 4,
        isUnlimited: false,
        enabled: true,
        sortOrder: 2,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'appointments_per_month',
        displayName: 'Monthly Appointments',
        description: 'Unlimited appointment booking',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 3,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'cloud_storage',
        displayName: 'Cloud Storage',
        description: '3 GB (High-res scans, reports and Rx)',
        limitValue: 3072,
        isUnlimited: false,
        enabled: true,
        sortOrder: 4,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'storage_months',
        displayName: 'Data Retention',
        description: 'Unlimited permanent storage',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: false,
        type: 'numeric',
      },
      {
        featureKey: 'whatsapp_messages_per_month',
        displayName: 'WhatsApp Automation',
        description: '1,000 free WhatsApp messages a month, then credits',
        limitValue: 1000,
        isUnlimited: false,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EMR',
        description: 'Custom-branded Rx & OCR Scan',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 6,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'waiting_room_queue',
        displayName: 'Waiting Room Queue',
        description: 'Live Queue & real-time ETA',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 7,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'public_booking_page',
        displayName: 'Public Booking Page',
        description: 'Public profile & booking link',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 8,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'add_ons',
        displayName: 'Add-Ons Feature',
        description: 'Purchase additional resources',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 9,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'pharmacy_integration',
        displayName: 'Pharmacy Module',
        description: 'Full Pharmacy & POS Inventory',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 10,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'lab_integration',
        displayName: 'Diagnostic Lab Module',
        description: 'Full Lab & Report Builder',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 11,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'reports_analytics',
        displayName: 'Reports & Analytics',
        description: 'Advanced BI & analytics reports',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 12,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'priority_support',
        displayName: 'Customer Support',
        description: 'Priority Email & 24/7 AI Chatbot',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 13,
        isMarketingFeature: true,
        type: 'boolean',
      },
      {
        featureKey: 'custom_branded_rx',
        displayName: 'Custom Branded Rx',
        description: 'Custom-branded Rx templates and layout customization',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 14,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'ocr_prescription_scan',
        displayName: 'OCR Prescription Scan',
        description: 'AI / OCR prescription digitization and scanning',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 15,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'chatbot_support',
        displayName: 'Chatbot Support',
        description: 'AI / Chatbot support assistance',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 16,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'dashboard_full_access',
        displayName: 'Full Dashboard Analytics',
        description: 'Full dashboard analytics and insights',
        limitValue: null,
        isUnlimited: false,
        enabled: true,
        sortOrder: 17,
        isMarketingFeature: false,
        type: 'boolean',
      },
      {
        featureKey: 'payment_history_months',
        displayName: 'Payment History',
        description: null,
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 18,
        isMarketingFeature: false,
        type: 'numeric',
      },
    ],
    addOnLimits: [
      { addOnFeatureKey: 'additional_doctor', maxCap: 5 },
      { addOnFeatureKey: 'additional_staff', maxCap: 10 },
      { addOnFeatureKey: 'additional_storage', maxCap: 2048 },
    ],
  },
];

/** Fixed ids so every environment seeds the same plan ids. */
const SEEDED_PLAN_IDS: Record<string, string> = {
  solo: '00000000-0000-4000-a000-000000000001',
  'clinic-monthly': '00000000-0000-4000-a000-000000000002',
  'carehub-monthly': '00000000-0000-4000-a000-000000000003',
};

export type { Tx };

/** Start of every plan's version 1, early enough that all existing subscriptions fall inside it. */
const FIRST_VERSION_FROM = new Date('2020-01-01T00:00:00.000Z');

/** Returns the plan's version 1, creating it from today's price once; later runs never change it. */
export async function ensureFirstVersion(
  tx: Tx,
  planId: string,
  monthlyPrice: number,
  isFree: boolean
): Promise<string> {
  const [existing] = await tx
    .select({ id: PlanVersionModel.id })
    .from(PlanVersionModel)
    .where(
      and(
        eq(PlanVersionModel.planId, planId),
        eq(PlanVersionModel.versionNo, 1)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(PlanVersionModel)
    .values({
      planId,
      versionNo: 1,
      monthlyPrice: isFree ? null : String(monthlyPrice),
      yearlyPrice: isFree
        ? null
        : String(planPriceForCycle(monthlyPrice, 'yearly')),
      effectiveFrom: FIRST_VERSION_FROM,
    })
    .returning({ id: PlanVersionModel.id });
  return created.id;
}

/** Renames a legacy plan (e.g. pro-monthly → carehub-monthly) keeping its id, which Razorpay notes carry;
 *  a duplicate under the new slug is merged into it. */
async function migrateLegacyPlans(
  tx: Tx,
  slug: string,
  legacySlugs: string[]
): Promise<void> {
  const legacyPlans = await tx
    .select({ id: SubscriptionPlanModel.id })
    .from(SubscriptionPlanModel)
    .where(inArray(SubscriptionPlanModel.slug, legacySlugs));
  if (legacyPlans.length === 0) return;

  const duplicates = await tx
    .select({ id: SubscriptionPlanModel.id })
    .from(SubscriptionPlanModel)
    .where(eq(SubscriptionPlanModel.slug, slug));

  const [keeper, ...rest] = legacyPlans;
  const targetId = keeper.id;
  const staleIds = [...rest, ...duplicates].map((p) => p.id);

  if (staleIds.length > 0) {
    await mergePlanReferences(tx, staleIds, targetId);
    // plan_features / plan_add_on_limits cascade with the plan row.
    await tx
      .delete(SubscriptionPlanModel)
      .where(inArray(SubscriptionPlanModel.id, staleIds));
  }

  // After the delete, so the unique slug is free.
  await tx
    .update(SubscriptionPlanModel)
    .set({ slug, updatedAt: new Date() })
    .where(eq(SubscriptionPlanModel.id, targetId));
  logger.info(`Renamed legacy plan ${legacySlugs.join(', ')} → ${slug}`);
}

async function mergePlanReferences(
  tx: Tx,
  staleIds: string[],
  targetId: string
): Promise<void> {
  await tx
    .update(ClinicSubscriptionModel)
    .set({ planId: targetId })
    .where(inArray(ClinicSubscriptionModel.planId, staleIds));
  await tx
    .update(ClinicSubscriptionModel)
    .set({ scheduledPlanId: targetId })
    .where(inArray(ClinicSubscriptionModel.scheduledPlanId, staleIds));
  await tx
    .update(CouponUsageModel)
    .set({ planId: targetId })
    .where(inArray(CouponUsageModel.planId, staleIds));

  const coupons = await tx
    .select({
      id: CouponModel.id,
      applicablePlanIds: CouponModel.applicablePlanIds,
    })
    .from(CouponModel);
  for (const coupon of coupons) {
    const ids = coupon.applicablePlanIds;
    if (!ids?.some((id) => staleIds.includes(id))) continue;
    await tx
      .update(CouponModel)
      .set({
        applicablePlanIds: [
          ...new Set(ids.map((id) => (staleIds.includes(id) ? targetId : id))),
        ],
        updatedAt: new Date(),
      })
      .where(eq(CouponModel.id, coupon.id));
  }
}

/** Version 1 rows of a plan: the only ones a seed may touch (newer versions are the Super Admin's). */
const versionOneOrLegacy = (
  planCol: typeof PlanFeaturesModel.planId | typeof PlanAddOnLimitsModel.planId,
  versionCol:
    | typeof PlanFeaturesModel.planVersionId
    | typeof PlanAddOnLimitsModel.planVersionId,
  planId: string,
  versionId: string
) =>
  and(eq(planCol, planId), or(eq(versionCol, versionId), isNull(versionCol)));

/**
 * Plans by slug. Seed-owned fields (kind, trial, fallback) stay in step; name, description and
 * the "was" prices are the Super Admin's once created. Version 1 features and add-on limits are
 * synced key by key, so an unchanged run writes nothing.
 */
export async function seedSubscriptions() {
  const planCounts = newCounts();
  const featureCounts = newCounts();
  const limitCounts = newCounts();
  const changed: string[] = [];

  await database.transaction(async (tx) => {
    // Deprecated key; its rows are removed wherever they still exist.
    const deprecated = await tx
      .delete(PlanFeaturesModel)
      .where(eq(PlanFeaturesModel.featureKey, 'receptionist_accounts'))
      .returning({ id: PlanFeaturesModel.id });
    featureCounts.removed += deprecated.length;

    // One trial and one fallback plan at most: clear the flag only where the seed no longer gives it.
    const trialSlugs = plans.filter((p) => p.isTrialPlan).map((p) => p.slug);
    const fallbackSlugs = plans
      .filter((p) => p.isDefaultFallback)
      .map((p) => p.slug);
    await tx
      .update(SubscriptionPlanModel)
      .set({ isTrialPlan: false, updatedAt: new Date() })
      .where(
        and(
          eq(SubscriptionPlanModel.ownerType, 'clinic'),
          eq(SubscriptionPlanModel.isTrialPlan, true),
          trialSlugs.length
            ? notInArray(SubscriptionPlanModel.slug, trialSlugs)
            : undefined
        )
      );
    await tx
      .update(SubscriptionPlanModel)
      .set({ isDefaultFallback: false, updatedAt: new Date() })
      .where(
        and(
          eq(SubscriptionPlanModel.ownerType, 'clinic'),
          eq(SubscriptionPlanModel.isDefaultFallback, true),
          fallbackSlugs.length
            ? notInArray(SubscriptionPlanModel.slug, fallbackSlugs)
            : undefined
        )
      );

    for (const planData of plans) {
      const { features, legacySlugs, addOnLimits, ...plan } = planData;
      const isFree = plan.slug === 'solo' || plan.slug === 'Free';

      if (legacySlugs?.length) {
        await migrateLegacyPlans(tx, plan.slug, legacySlugs);
      }

      const customId = SEEDED_PLAN_IDS[plan.slug];
      const { result, row } = await syncRow({
        db: tx,
        table: SubscriptionPlanModel,
        where: eq(SubscriptionPlanModel.slug, plan.slug),
        values: {
          slug: plan.slug,
          currency: plan.currency,
          kind: isFree ? 'free' : 'paid',
          ownerType: 'clinic',
          isTrialPlan: plan.isTrialPlan ?? false,
          trialDays: plan.trialDays ?? null,
          isDefaultFallback: plan.isDefaultFallback ?? false,
        },
        createOnly: {
          ...(customId ? { id: customId } : {}),
          name: plan.name,
          description: plan.description,
          price: String(plan.price),
          isMostPopular: plan.isMostPopular ?? false,
          compareAtMonthly: plan.compareAtMonthly?.toFixed(2) ?? null,
          compareAtYearly: plan.compareAtYearly?.toFixed(2) ?? null,
        },
      });
      tally(planCounts, changed, plan.slug, result);
      const planId = row.id;

      const versionId = await ensureFirstVersion(
        tx,
        planId,
        Number(plan.price),
        isFree
      );

      // Version 1 features by key; legacy unversioned rows and keys no longer seeded are removed.
      const seedKeys = features.map((f) => f.featureKey);
      const staleFeatures = await tx
        .delete(PlanFeaturesModel)
        .where(
          and(
            versionOneOrLegacy(
              PlanFeaturesModel.planId,
              PlanFeaturesModel.planVersionId,
              planId,
              versionId
            ),
            or(
              isNull(PlanFeaturesModel.planVersionId),
              seedKeys.length
                ? notInArray(PlanFeaturesModel.featureKey, seedKeys)
                : undefined
            )
          )
        )
        .returning({ id: PlanFeaturesModel.id });
      featureCounts.removed += staleFeatures.length;
      for (const feature of features) {
        const { result: featureResult } = await syncRow({
          db: tx,
          table: PlanFeaturesModel,
          where: and(
            eq(PlanFeaturesModel.planVersionId, versionId),
            eq(PlanFeaturesModel.featureKey, feature.featureKey)
          ),
          values: {
            planId,
            planVersionId: versionId,
            featureKey: feature.featureKey,
            displayName: feature.displayName,
            description: feature.description,
            type:
              feature.type ??
              (feature.limitValue !== null ? 'numeric' : 'boolean'),
            limitValue: feature.limitValue ?? null,
            isUnlimited: feature.isUnlimited ?? false,
            enabled: feature.enabled ?? true,
            sortOrder: feature.sortOrder ?? 0,
            isMarketingFeature: feature.isMarketingFeature ?? false,
          },
        });
        tally(
          featureCounts,
          changed,
          `${plan.slug}/${feature.featureKey}`,
          featureResult
        );
      }

      if (!addOnLimits?.length) continue;
      const addOnRows = await tx
        .select({ id: AddOnModel.id, featureKey: AddOnModel.featureKey })
        .from(AddOnModel)
        .where(
          inArray(
            AddOnModel.featureKey,
            addOnLimits.map((l) => l.addOnFeatureKey)
          )
        );
      const addOnIds = new Map(addOnRows.map((r) => [r.featureKey, r.id]));
      // A missing add-on would leave the plan with no limit row, blocking add-on purchases on it.
      const missing = addOnLimits.find((l) => !addOnIds.has(l.addOnFeatureKey));
      if (missing) {
        throw new Error(
          `Add-on "${missing.addOnFeatureKey}" not found while seeding plan "${plan.slug}"; run seedAddOns first`
        );
      }

      // Version 1 add-on caps by add-on; legacy unversioned rows and add-ons no longer seeded are removed.
      const staleLimits = await tx
        .delete(PlanAddOnLimitsModel)
        .where(
          and(
            versionOneOrLegacy(
              PlanAddOnLimitsModel.planId,
              PlanAddOnLimitsModel.planVersionId,
              planId,
              versionId
            ),
            or(
              isNull(PlanAddOnLimitsModel.planVersionId),
              notInArray(PlanAddOnLimitsModel.addOnId, [...addOnIds.values()])
            )
          )
        )
        .returning({ id: PlanAddOnLimitsModel.id });
      limitCounts.removed += staleLimits.length;
      for (const limitSeed of addOnLimits) {
        const addOnId = addOnIds.get(limitSeed.addOnFeatureKey) as string;
        const { result: limitResult } = await syncRow({
          db: tx,
          table: PlanAddOnLimitsModel,
          where: and(
            eq(PlanAddOnLimitsModel.planVersionId, versionId),
            eq(PlanAddOnLimitsModel.addOnId, addOnId)
          ),
          values: {
            planId,
            planVersionId: versionId,
            addOnId,
            maxCap: limitSeed.maxCap,
          },
        });
        tally(
          limitCounts,
          changed,
          `${plan.slug}/${limitSeed.addOnFeatureKey}`,
          limitResult
        );
      }
    }
  });

  logSeed('plans', planCounts);
  logSeed('plan features', featureCounts);
  logSeed('plan add-on limits', limitCounts, changed);
}
