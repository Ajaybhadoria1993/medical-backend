/* eslint-disable @typescript-eslint/no-explicit-any */
// clinic-symptom.service.ts
import { and, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ClinicModel } from '../models/clinic.model';
import { ClinicSymptomModel } from '../models/clinic-symptom.model';

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

/** A clinic's symptoms a patient/staff may attach to a booking: active and not soft-deleted. */
const bookableWhere = (clinicId: string) =>
  and(
    eq(ClinicSymptomModel.clinicId, clinicId),
    eq(ClinicSymptomModel.status, 'Active'),
    eq(ClinicSymptomModel.isDeleted, false)
  );

export class ClinicSymptomService {
  /** Names → ids for a booking: reuses the clinic's existing symptoms, creates the rest in `tx`. */
  static async resolveIdsByName(tx: Tx, clinicId: string, names: string[]) {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (unique.length === 0) return [];

    const existing = await tx
      .select({ id: ClinicSymptomModel.id, name: ClinicSymptomModel.name })
      .from(ClinicSymptomModel)
      .where(
        and(
          eq(ClinicSymptomModel.clinicId, clinicId),
          inArray(ClinicSymptomModel.name, unique),
          eq(ClinicSymptomModel.isDeleted, false)
        )
      );

    const found = new Set(existing.map((r) => r.name));
    const missing = unique.filter((n) => !found.has(n));
    const created = missing.length
      ? await tx
          .insert(ClinicSymptomModel)
          .values(
            missing.map((name) => ({
              clinicId,
              name,
              description: `Symptom: ${name}`,
            }))
          )
          .returning({ id: ClinicSymptomModel.id })
      : [];

    return [...existing, ...created].map((r) => r.id);
  }

  /** Symptoms a patient may pick when booking: the clinic's active, non-deleted ones. */
  static async listBookable(clinicId: string) {
    const [clinic] = await database
      .select({ id: ClinicModel.id })
      .from(ClinicModel)
      .where(eq(ClinicModel.id, clinicId))
      .limit(1);
    if (!clinic) throw new HttpError(404, 'Clinic not found');

    return database
      .select({
        id: ClinicSymptomModel.id,
        name: ClinicSymptomModel.name,
        description: ClinicSymptomModel.description,
      })
      .from(ClinicSymptomModel)
      .where(bookableWhere(clinicId))
      .orderBy(ClinicSymptomModel.name);
  }

  /** De-duplicates `ids` and rejects any that are not a bookable symptom of `clinicId` (one query). */
  static async assertBookable(
    clinicId: string,
    ids: string[],
    db: Pick<typeof database, 'select'> = database
  ) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return unique;

    const rows = await db
      .select({ id: ClinicSymptomModel.id })
      .from(ClinicSymptomModel)
      .where(
        and(bookableWhere(clinicId), inArray(ClinicSymptomModel.id, unique))
      );

    if (rows.length !== unique.length) {
      throw new HttpError(400, 'One or more selected symptoms are invalid');
    }
    return unique;
  }

  /** Keeps only ids still bookable for `clinicId`; never throws (used after payment, where failing would strand a paid booking). */
  static async filterBookable(clinicId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return unique;

    const rows = await database
      .select({ id: ClinicSymptomModel.id })
      .from(ClinicSymptomModel)
      .where(
        and(bookableWhere(clinicId), inArray(ClinicSymptomModel.id, unique))
      );
    return rows.map((r) => r.id);
  }

  // ➕ Create
  static async create(clinicId: string, payload: any) {
    // Idempotent: booking posts every picked symptom, so an existing one returns as-is.
    const [existing] = await database
      .select()
      .from(ClinicSymptomModel)
      .where(
        and(
          eq(ClinicSymptomModel.clinicId, clinicId),
          eq(ClinicSymptomModel.name, payload.name),
          eq(ClinicSymptomModel.isDeleted, false)
        )
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await database
      .insert(ClinicSymptomModel)
      .values({
        clinicId,
        name: payload.name,
        description: payload.description,
        status: payload.status ?? 'Active',
      })
      .returning();

    return created;
  }

  // ✏️ Update
  static async update(id: string, clinicId: string, payload: any) {
    const [existing] = await database
      .select()
      .from(ClinicSymptomModel)
      .where(
        and(
          eq(ClinicSymptomModel.id, id),
          eq(ClinicSymptomModel.clinicId, clinicId),
          eq(ClinicSymptomModel.isDeleted, false)
        )
      )
      .limit(1);

    if (!existing) {
      throw new HttpError(404, 'Symptom not found');
    }

    // duplicate name check
    if (payload.name) {
      const [duplicate] = await database
        .select()
        .from(ClinicSymptomModel)
        .where(
          and(
            eq(ClinicSymptomModel.clinicId, clinicId),
            eq(ClinicSymptomModel.name, payload.name),
            eq(ClinicSymptomModel.isDeleted, false),
            ne(ClinicSymptomModel.id, id)
          )
        )
        .limit(1);

      if (duplicate) {
        throw new HttpError(400, 'Symptom name already exists');
      }
    }

    const [updated] = await database
      .update(ClinicSymptomModel)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(eq(ClinicSymptomModel.id, id))
      .returning();

    return updated;
  }

  // ❌ Soft Delete
  static async delete(id: string, clinicId: string) {
    const [deleted] = await database
      .update(ClinicSymptomModel)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
      })
      .where(
        and(
          eq(ClinicSymptomModel.id, id),
          eq(ClinicSymptomModel.clinicId, clinicId)
        )
      )
      .returning();

    if (!deleted) {
      throw new HttpError(404, 'Symptom not found');
    }

    return true;
  }

  // clinic-symptom.service.ts

  static async getByClinic(clinicId: string, search?: string) {
    if (search && search.trim()) {
      return await database
        .select()
        .from(ClinicSymptomModel)
        .where(
          and(
            eq(ClinicSymptomModel.clinicId, clinicId),
            eq(ClinicSymptomModel.isDeleted, false),
            or(
              ilike(ClinicSymptomModel.name, `%${search}%`),
              ilike(ClinicSymptomModel.description, `%${search}%`)
            )
          )
        )
        .orderBy(ClinicSymptomModel.createdAt);
    }

    // 👇 no search
    return await database
      .select()
      .from(ClinicSymptomModel)
      .where(
        and(
          eq(ClinicSymptomModel.clinicId, clinicId),
          eq(ClinicSymptomModel.isDeleted, false)
        )
      )
      .orderBy(ClinicSymptomModel.createdAt);
  }
}
