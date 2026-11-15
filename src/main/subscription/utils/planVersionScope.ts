import { eq, type AnyColumn } from 'drizzle-orm';

/** Rows of one plan version: plan_features and plan_add_on_limits are kept per version. */
export const ofPlanVersion = (
  table: { planVersionId: AnyColumn },
  planVersionId: string
) => eq(table.planVersionId, planVersionId);
