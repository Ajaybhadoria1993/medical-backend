import { and, eq, isNull } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import {
  TreatmentTemplateModel as T,
  TreatmentTemplateStepModel as Step,
} from '../../models/treatmentTemplate.model';
import { TreatmentSpecialtyConfigModel as Config } from '../../models/treatmentPlanSettings.model';
import { specialtyConfigCreateSchema } from '../../schemas/specialtyConfig.schema';
import { libraryTemplateSchema } from '../../schemas/template.schema';
import seedData from '../../seeds/libraryTemplates.json';
import specialtyConfigData from '../../seeds/specialtyConfigs.json';

export class LibrarySeedService {
  /** Inserts each ready-made template whose code is missing, as an unchecked draft with no fees.
   *  Never updates: after the first run Super Admin owns the row (Q11). Returns rows inserted. */
  static async run(): Promise<number> {
    let inserted = 0;
    for (const raw of seedData) {
      const t = libraryTemplateSchema.parse(raw);
      const added = await database.transaction(async (tx) => {
        const [exists] = await tx
          .select({ id: T.id })
          .from(T)
          .where(and(eq(T.code, t.code!), isNull(T.clinicId)))
          .limit(1);
        if (exists) return false;

        const [row] = await tx
          .insert(T)
          .values({
            clinicId: null,
            code: t.code,
            name: t.name,
            specialty: t.specialty,
            planType: t.planType,
            pricingMode: t.pricingMode,
            sessionCount: t.sessionCount ?? null,
            intervalDays: t.intervalDays ?? null,
            packageExpiryDays: t.packageExpiryDays ?? null,
            consentRequired: t.consentRequired,
            // Cosmetic templates come marked for GST; tax is applied later.
            taxable: t.taxable,
            instalmentsAllowed: t.instalmentsAllowed,
            recallAfterDays: t.recallAfterDays ?? null,
            diagnosisKeywords: t.diagnosisKeywords,
            status: 'draft',
          })
          .returning({ id: T.id });
        if (t.steps.length)
          await tx.insert(Step).values(
            t.steps.map((s, i) => ({
              templateId: row.id,
              clinicId: null,
              seq: i + 1,
              name: s.name,
              gapDays: s.gapDays,
              maxGapDays: s.maxGapDays ?? null,
              durationMinutes: s.durationMinutes ?? null,
            }))
          );
        return true;
      });
      if (added) inserted += 1;
    }
    return inserted;
  }

  /** Platform field sets per specialty (ENT's Area, Side…), added only when missing.
   *  Never updates: Super Admin edits them afterwards. Returns rows inserted. */
  static async runSpecialtyConfigs(): Promise<number> {
    let inserted = 0;
    for (const raw of specialtyConfigData) {
      const c = specialtyConfigCreateSchema.parse(raw);
      const [exists] = await database
        .select({ id: Config.id })
        .from(Config)
        .where(and(eq(Config.specialty, c.specialty), isNull(Config.clinicId)))
        .limit(1);
      if (exists) continue;
      await database.insert(Config).values({ ...c, clinicId: null });
      inserted += 1;
    }
    return inserted;
  }
}
