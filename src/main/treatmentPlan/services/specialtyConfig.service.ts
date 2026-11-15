import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { TreatmentSpecialtyConfigModel as Config } from '../models/treatmentPlanSettings.model';
import type {
  SpecialtyConfigCreate,
  SpecialtyConfigUpdate,
} from '../schemas/specialtyConfig.schema';
import { isUniqueViolation } from '../../../utils/db.utils';

const formColumns = {
  specialty: Config.specialty,
  planFields: Config.planFields,
  stepFields: Config.stepFields,
  widget: Config.widget,
};

export class SpecialtyConfigService {
  /** Super Admin: every platform config, inactive ones included. */
  static async listPlatform(pageNumber: number, pageSize: number) {
    const where = isNull(Config.clinicId);
    const [items, [count]] = await Promise.all([
      database
        .select()
        .from(Config)
        .where(where)
        .orderBy(asc(Config.specialty))
        .limit(pageSize)
        .offset((pageNumber - 1) * pageSize),
      database
        .select({ total: sql<number>`count(*)::int` })
        .from(Config)
        .where(where),
    ]);
    return { items, total: count?.total ?? 0, pageNumber, pageSize };
  }

  static async create(input: SpecialtyConfigCreate) {
    try {
      const [row] = await database
        .insert(Config)
        .values({ ...input, clinicId: null })
        .returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new HttpError(
          409,
          `${input.specialty} already has a field set; edit that one`
        );
      throw err;
    }
  }

  static async update(id: string, input: SpecialtyConfigUpdate) {
    const [row] = await database
      .update(Config)
      .set(input)
      .where(and(eq(Config.id, id), isNull(Config.clinicId)))
      .returning();
    if (!row) throw new HttpError(404, 'Specialty config not found');
    return row;
  }

  /** Fields a form shows for one specialty: the clinic's own set first, else the platform's.
   *  Null when none is active, so the form hides the specialty section (S1). */
  static async forClinic(clinicId: string, specialty: string) {
    const [row] = await database
      .select(formColumns)
      .from(Config)
      .where(
        and(
          eq(Config.specialty, specialty),
          eq(Config.isActive, true),
          or(eq(Config.clinicId, clinicId), isNull(Config.clinicId))
        )
      )
      // Clinic rows sort before the platform row (nulls last).
      .orderBy(sql`${Config.clinicId} nulls last`)
      .limit(1);
    return row ?? null;
  }
}
