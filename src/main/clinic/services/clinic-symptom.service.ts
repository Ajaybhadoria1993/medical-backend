/* eslint-disable @typescript-eslint/no-explicit-any */
// clinic-symptom.service.ts
import { and, eq, ilike, ne, or } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { ClinicSymptomModel } from '../models/clinic-symptom.model';

export class ClinicSymptomService {
  // ➕ Create
  static async create(clinicId: string, payload: any) {
    // duplicate check
    const [existing] = await database
      .select({ id: ClinicSymptomModel.id })
      .from(ClinicSymptomModel)
      .where(
        and(
          eq(ClinicSymptomModel.clinicId, clinicId),
          eq(ClinicSymptomModel.name, payload.name),
          eq(ClinicSymptomModel.isDeleted, false)
        )
      )
      .limit(1);

    if (existing) {
      throw new HttpError(400, 'Symptom already exists in clinic');
    }

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
