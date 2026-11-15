import { sql } from 'drizzle-orm';
import { ApplicationCancellationPolicyModel } from '../../main/cancellation-policy/models/cancellationPolicy.model';
import { logSeed, newCounts, syncRow, tally } from './seedSync';

/** The one app-level policy row; a Super Admin owns its values once it exists. */
export async function seedCancellationPolicy() {
  const counts = newCounts();
  const changed: string[] = [];
  const { result } = await syncRow({
    table: ApplicationCancellationPolicyModel,
    where: sql`true`,
    values: {},
    createOnly: {
      cancellationFeatureEnabled: true,
      refundFeatureEnabled: true,
      rescheduleFeatureEnabled: true,
      policyPrecedence: 'Application > Clinic',
      allowClinicConfiguration: true,
      defaultRefundPercentage: 100,
      defaultRefundCooldownHours: 6,
      partialRefundCooldownHours: 0,
      partialRefundPercentage: 0,
    },
  });
  tally(counts, changed, 'application policy', result);
  logSeed('cancellation policy', counts, changed);
}
