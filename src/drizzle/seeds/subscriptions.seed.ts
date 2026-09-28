import { eq, inArray, notInArray } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import {
  ClinicSubscriptionModel,
  SubscriptionPlanModel,
} from '../../main/subscription/models/subscription.model';
import { PlanFeaturesModel } from '../../main/subscription/models/planFeatures.model';
import { CouponUsageModel } from '../../main/subscription/models/couponUsage.model';
import { CouponModel } from '../../main/subscription/models/coupon.model';
import logger from '../../utils/logger';

interface PlanFeatureSeed {
  featureKey: string;
  displayName: string;
  description: string;
  type?: 'numeric' | 'boolean' | 'marketing';
  limitValue?: number | null;
  isUnlimited?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  isMarketingFeature?: boolean;
}

interface PlanSeed {
  slug: string;
  name: string;
  description: string;
  price: any;
  currency: string;
  isTrialPlan?: boolean;
  trialDays?: number | null;
  isDefaultFallback?: boolean;
  features: PlanFeatureSeed[];
}

const plans: PlanSeed[] = [
  {
    slug: 'solo',
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
        description: '1 Receptionist account',
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
        description: 'Unlimited WhatsApp notifications',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EHR',
        description: 'Standard Rx templates & basic EHR',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
    name: 'Clinic',
    description: 'Essential features for small practices and clinics',
    price: 499,
    currency: 'INR',
    isTrialPlan: true,
    trialDays: 30,
    isDefaultFallback: false,
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
        description: 'Unlimited WhatsApp notifications',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EHR',
        description: 'Custom-branded Rx & digital EHR',
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
        description: 'Unlimited access',
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
        description: 'Disabled',
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
        description: 'Disabled',
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
  },
  {
    slug: 'carehub-monthly',
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
        description: 'Unlimited WhatsApp notifications',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 5,
        isMarketingFeature: true,
        type: 'numeric',
      },
      {
        featureKey: 'smart_prescriptions',
        displayName: 'Smart Prescriptions & EHR',
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
        description: 'Unlimited access',
        limitValue: null,
        isUnlimited: true,
        enabled: true,
        sortOrder: 18,
        isMarketingFeature: false,
        type: 'numeric',
      },
    ],
  },
];

export async function seedSubscriptions() {
  try {
    logger.info('Seeding subscription plans and unified features...');

    await database.transaction(async (tx) => {
      // Clean up deprecated receptionist_accounts feature key if present.
      await tx
        .delete(PlanFeaturesModel)
        .where(eq(PlanFeaturesModel.featureKey, 'receptionist_accounts'));

      for (const planData of plans) {
        const { features, ...plan } = planData;

        const [insertedPlan] = await tx
          .insert(SubscriptionPlanModel)
          .values({
            slug: plan.slug,
            name: plan.name,
            description: plan.description,
            price: plan.price,
            currency: plan.currency,
            isTrialPlan: plan.isTrialPlan ?? false,
            trialDays: plan.trialDays ?? null,
            isDefaultFallback: plan.isDefaultFallback ?? false,
          })
          .onConflictDoUpdate({
            target: [SubscriptionPlanModel.slug],
            set: {
              name: plan.name,
              description: plan.description,
              price: plan.price,
              currency: plan.currency,
              isTrialPlan: plan.isTrialPlan ?? false,
              trialDays: plan.trialDays ?? null,
              isDefaultFallback: plan.isDefaultFallback ?? false,
              updatedAt: new Date(),
            },
          })
          .returning({ id: SubscriptionPlanModel.id });

        // Replace the plan's complete feature configuration on every seed.
        await tx
          .delete(PlanFeaturesModel)
          .where(eq(PlanFeaturesModel.planId, insertedPlan.id));

        if (features.length > 0) {
          await tx.insert(PlanFeaturesModel).values(
            features.map((feature) => ({
              planId: insertedPlan.id,
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
            }))
          );
        }
      }

      // The seed file is the source of truth for the available plan catalog.
      // Remove any unreferenced plan that is no longer defined above, without
      // keeping a hard-coded list of previous plan names or slugs.
      const seededSlugs = plans.map((plan) => plan.slug);
      const seededPlans = await tx
        .select({
          id: SubscriptionPlanModel.id,
          slug: SubscriptionPlanModel.slug,
          price: SubscriptionPlanModel.price,
          currency: SubscriptionPlanModel.currency,
        })
        .from(SubscriptionPlanModel)
        .where(inArray(SubscriptionPlanModel.slug, seededSlugs));

      const stalePlans = await tx
        .select({
          id: SubscriptionPlanModel.id,
          slug: SubscriptionPlanModel.slug,
          price: SubscriptionPlanModel.price,
          currency: SubscriptionPlanModel.currency,
        })
        .from(SubscriptionPlanModel)
        .where(notInArray(SubscriptionPlanModel.slug, seededSlugs));

      const stalePlanMappings = stalePlans.map((stalePlan) => {
        const matchingPlans = seededPlans.filter(
          (seededPlan) =>
            seededPlan.price === stalePlan.price &&
            seededPlan.currency === stalePlan.currency
        );

        if (matchingPlans.length !== 1) {
          throw new Error(
            `Cannot replace stale subscription plan "${stalePlan.slug}": expected exactly one seeded plan with price ${stalePlan.price} ${stalePlan.currency}, found ${matchingPlans.length}.`
          );
        }

        return { stalePlan, targetPlan: matchingPlans[0] };
      });

      if (stalePlanMappings.length > 0) {
        const stalePlanIds = stalePlans.map((plan) => plan.id);
        const targetPlanIdByStaleId = new Map(
          stalePlanMappings.map(({ stalePlan, targetPlan }) => [
            stalePlan.id,
            targetPlan.id,
          ])
        );

        for (const { stalePlan, targetPlan } of stalePlanMappings) {
          await tx
            .update(ClinicSubscriptionModel)
            .set({ planId: targetPlan.id })
            .where(eq(ClinicSubscriptionModel.planId, stalePlan.id));

          await tx
            .update(ClinicSubscriptionModel)
            .set({ scheduledPlanId: targetPlan.id })
            .where(eq(ClinicSubscriptionModel.scheduledPlanId, stalePlan.id));

          await tx
            .update(CouponUsageModel)
            .set({ planId: targetPlan.id })
            .where(eq(CouponUsageModel.planId, stalePlan.id));
        }

        const coupons = await tx
          .select({
            id: CouponModel.id,
            applicablePlanIds: CouponModel.applicablePlanIds,
          })
          .from(CouponModel);

        for (const coupon of coupons) {
          const applicablePlanIds = coupon.applicablePlanIds
            ? [
                ...new Set(
                  coupon.applicablePlanIds.map(
                    (id) => targetPlanIdByStaleId.get(id) ?? id
                  )
                ),
              ]
            : null;

          if (
            !coupon.applicablePlanIds ||
            coupon.applicablePlanIds.every(
              (id, index) => applicablePlanIds?.[index] === id
            )
          ) {
            continue;
          }

          await tx
            .update(CouponModel)
            .set({ applicablePlanIds, updatedAt: new Date() })
            .where(eq(CouponModel.id, coupon.id));
        }

        await tx
          .delete(SubscriptionPlanModel)
          .where(inArray(SubscriptionPlanModel.id, stalePlanIds));
      }
    });

    logger.info('Subscription plans and features seeded successfully!');
  } catch (error) {
    logger.error('Error seeding subscriptions:', error);
    throw error;
  }
}
