import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { database } from '../../configurations/dbConnection';
import type { MessageChannel, PlanPort } from '../../main/credits';
import { ClinicModel } from '../../main/clinic/models/clinic.model';
import {
  FEATURE_KEYS,
  LimitationService,
  PlansService,
  SubscriptionReadService,
  PlanFeaturesModel,
  SubscriptionPlanModel,
  type FeatureKey,
} from '../../main/subscription';

const FEATURE_BY_CHANNEL: Record<MessageChannel, FeatureKey> = {
  whatsapp: FEATURE_KEYS.WHATSAPP_MESSAGES,
};

// clinics.created_at is IST wall clock in a zone-less column (WORKFLOW §6); this makes it a real instant.
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Read-only. Limits use the existing Redis-cached lookups and read like checkUsageLimit:
 *  no plan or no row = unlimited, disabled = 0. */
export const planAdapter: PlanPort = {
  async getMessageLimit(clinicId, channel) {
    const plan = await LimitationService.getClinicActivePlan(clinicId);
    if (!plan) return { unlimited: true };

    const row = await LimitationService.getPlanLimit(
      plan.planId,
      FEATURE_BY_CHANNEL[channel],
      plan.planVersionId
    );
    if (!row || row.isUnlimited) return { unlimited: true };

    return { unlimited: false, limit: row.enabled ? (row.limitValue ?? 0) : 0 };
  },

  /** The current period's start (or when the last plan ended); else when the clinic was created. */
  async getBillingAnchor(clinicId) {
    const anchor = await SubscriptionReadService.billingAnchor(clinicId);
    if (anchor) return anchor;

    const [clinic] = await database
      .select({ createdAt: ClinicModel.createdAt })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    return clinic
      ? new Date(clinic.createdAt.getTime() - IST_OFFSET_MS)
      : new Date();
  },

  async getPlansWithoutMessageLimit(channel) {
    const rows = await database
      .select({
        planId: SubscriptionPlanModel.id,
        planName: SubscriptionPlanModel.name,
      })
      .from(SubscriptionPlanModel)
      .leftJoin(
        PlanFeaturesModel,
        and(
          eq(PlanFeaturesModel.planId, SubscriptionPlanModel.id),
          inArray(
            PlanFeaturesModel.planVersionId,
            await PlansService.latestVersionIds()
          ),
          eq(PlanFeaturesModel.featureKey, FEATURE_BY_CHANNEL[channel])
        )
      )
      .where(isNull(PlanFeaturesModel.id))
      .orderBy(asc(SubscriptionPlanModel.name));
    return rows;
  },
};
