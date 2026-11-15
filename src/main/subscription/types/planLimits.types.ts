/** Super Admin plan-limits screen: header numbers, usage and upgrade signals. */
export interface PlanLimitsStats {
  totalPlans: number;
  totalSubscribers: number;
  monthlyRecurringRevenue: number;
  totalFeaturesManaged: number;
}

export interface UsageInsights {
  whatsappUsageReachedLimit: number;
  doctorAccountsReachedLimit: number;
  storageReachedLimit: number;
}

export interface UpgradeOpportunities {
  whatsappLimitReachedClinics: number;
  doctorAccountUpgradeNeededClinics: number;
  storageUpgradeNeededClinics: number;
}

export interface PlanLimitRow {
  id: string;
  planId: string;
  featureKey: string;
  limitValue: number | null;
  isUnlimited: boolean;
  enabled: boolean;
  description: string | null;
}
