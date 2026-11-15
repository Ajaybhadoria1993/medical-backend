import { invalidateClinicDashboardCaches } from '../../dashboard/utils/dashboardCache.utils';
import { realtimeBus, target } from '../../realtime';

/** Plan money moved (money sync Phase 1, step 6): revenue snapshots are stale. Call after commit.
 *  Caches first, then the board signal, the same order appointments use. */
export function signalPlanMoney(clinicId: string): void {
  void invalidateClinicDashboardCaches(clinicId).finally(() =>
    realtimeBus.notify(target.board(clinicId), 'billing.plan_money')
  );
  signalPlanChange(clinicId);
}

/** Call after commit, so open plan pages reload the saved change. */
export function signalPlanChange(clinicId: string): void {
  realtimeBus.notify(target.treatmentPlans(clinicId), 'treatment_plan.changed');
}
