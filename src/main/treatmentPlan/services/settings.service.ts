import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { TreatmentPlanSettingsModel as Settings } from '../models/treatmentPlanSettings.model';
import type { SettingsUpdate } from '../schemas/settings.schema';
import type { TreatmentPlanSettingsView } from '../types/settings.types';

export class TreatmentPlanSettingsService {
  private static readonly columns = {
    billingModes: Settings.billingModes,
    invoiceTiming: Settings.invoiceTiming,
    discountCapPercent: Settings.discountCapPercent,
    bookingMode: Settings.bookingMode,
    bookingHorizonDays: Settings.bookingHorizonDays,
    recallReminderDays: Settings.recallReminderDays,
    instalmentReminderDays: Settings.instalmentReminderDays,
    packageExpiryReminderDays: Settings.packageExpiryReminderDays,
  };

  /** One query once the row exists; the first read creates it from the column defaults. */
  static async get(clinicId: string): Promise<TreatmentPlanSettingsView> {
    const existing = await this.find(clinicId);
    if (existing) return existing;

    const [created] = await database
      .insert(Settings)
      .values({ clinicId })
      .onConflictDoNothing({ target: Settings.clinicId })
      .returning(this.columns);
    // Empty only when a parallel first read inserted the row a moment earlier.
    return created ?? (await this.find(clinicId))!;
  }

  /** One upsert: creates the row with these values or updates the existing one. */
  static async update(
    clinicId: string,
    input: SettingsUpdate
  ): Promise<TreatmentPlanSettingsView> {
    const [row] = await database
      .insert(Settings)
      .values({ clinicId, ...input })
      .onConflictDoUpdate({
        target: Settings.clinicId,
        set: { ...input, updatedAt: new Date() },
      })
      .returning(this.columns);
    return row;
  }

  private static async find(
    clinicId: string
  ): Promise<TreatmentPlanSettingsView | undefined> {
    const [row] = await database
      .select(this.columns)
      .from(Settings)
      .where(eq(Settings.clinicId, clinicId))
      .limit(1);
    return row;
  }
}
