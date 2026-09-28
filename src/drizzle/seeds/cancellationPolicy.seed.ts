import logger from '../../utils/logger';
import { database } from '../../configurations/dbConnection';
import { eq } from 'drizzle-orm';
import { ApplicationCancellationPolicyModel } from '../../main/cancellation-policy/models/cancellationPolicy.model';

export async function seedCancellationPolicy() {
  try {
    logger.info('Seeding Application-Level Cancellation Policy settings...');

    const policyData = {
      cancellationFeatureEnabled: true,
      refundFeatureEnabled: true,
      rescheduleFeatureEnabled: true,
      policyPrecedence: 'Application > Clinic',
      allowClinicConfiguration: true,
      defaultRefundPercentage: 100,
      defaultRefundCooldownHours: 24,
      partialRefundCooldownHours: 12,
      partialRefundPercentage: 50,
    };

    // Fetch existing settings if any
    const [existing] = await database
      .select()
      .from(ApplicationCancellationPolicyModel)
      .limit(1);

    if (existing) {
      logger.info(
        'Application-level cancellation policy settings already exist. Updating settings...'
      );
      await database
        .update(ApplicationCancellationPolicyModel)
        .set({
          ...policyData,
          updatedAt: new Date(),
        })
        .where(eq(ApplicationCancellationPolicyModel.id, existing.id));
    } else {
      logger.info(
        'No application-level settings found. Creating new configuration...'
      );
      await database
        .insert(ApplicationCancellationPolicyModel)
        .values(policyData);
    }

    logger.info(
      'Application cancellation policy settings seeded successfully!'
    );
  } catch (error) {
    logger.error('Error seeding cancellation policy settings:', error);
    throw error;
  }
}
