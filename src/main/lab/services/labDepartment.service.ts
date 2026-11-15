import { and, asc, count, eq, ilike, or, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import defaultSuggestions from '../utils/labUpdatedDefaultSuggestions.json';
import { LabUpdatedDepartmentModel } from '../models/labUpdated.model';
import {
  CreateLabDepartmentInput,
  GetLabDepartmentsQueryInput,
  UpdateLabDepartmentInput,
} from '../schemas/labDepartment.schemas';
import {
  attachTestsToDepartments,
  ensureDepartment,
  ensureUniqueDepartment,
  LabCatalogContext,
  LabCatalogDepartmentInput,
  pageMeta,
  pagination,
  verifyLabAccess,
} from './labCatalog.service';

const suggestions = defaultSuggestions as {
  departments: LabCatalogDepartmentInput[];
};

export class LabDepartmentService {
  static getDefaultDepartments() {
    return suggestions.departments.map(({ name, code, status }) => ({
      name,
      code,
      status,
    }));
  }

  static async createDepartment(
    payload: CreateLabDepartmentInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      await ensureUniqueDepartment(trx, context.labId, payload);

      const now = new Date();
      const [department] = await trx
        .insert(LabUpdatedDepartmentModel)
        .values({
          ...payload,
          labId: context.labId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return department;
    });
  }

  static async getDepartments(
    context: LabCatalogContext,
    query: GetLabDepartmentsQueryInput
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const { page, limit, offset } = pagination(query);
      const conditions: SQL[] = [
        eq(LabUpdatedDepartmentModel.labId, context.labId),
      ];

      if (query.status) {
        conditions.push(eq(LabUpdatedDepartmentModel.status, query.status));
      }
      if (query.search) {
        conditions.push(
          or(
            ilike(LabUpdatedDepartmentModel.name, `%${query.search}%`),
            ilike(LabUpdatedDepartmentModel.code, `%${query.search}%`)
          ) as SQL
        );
      }

      const where = and(...conditions);
      const [{ total }] = await trx
        .select({ total: count() })
        .from(LabUpdatedDepartmentModel)
        .where(where);

      const departments = await trx
        .select()
        .from(LabUpdatedDepartmentModel)
        .where(where)
        .orderBy(asc(LabUpdatedDepartmentModel.name))
        .limit(limit)
        .offset(offset);

      return {
        departments: await attachTestsToDepartments(trx, departments),
        pagination: pageMeta(Number(total ?? 0), page, limit),
      };
    });
  }

  static async getDepartmentById(
    departmentId: string,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const department = await ensureDepartment(
        trx,
        context.labId,
        departmentId
      );
      const [departmentWithTests] = await attachTestsToDepartments(trx, [
        department,
      ]);

      return departmentWithTests;
    });
  }

  static async updateDepartment(
    departmentId: string,
    payload: UpdateLabDepartmentInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const existing = await ensureDepartment(trx, context.labId, departmentId);

      if (payload.name || payload.code) {
        await ensureUniqueDepartment(
          trx,
          context.labId,
          {
            name: payload.name ?? existing.name,
            code: payload.code ?? existing.code,
          },
          departmentId
        );
      }

      const [department] = await trx
        .update(LabUpdatedDepartmentModel)
        .set({ ...payload, updatedAt: new Date() })
        .where(eq(LabUpdatedDepartmentModel.id, departmentId))
        .returning();

      return department;
    });
  }
}
