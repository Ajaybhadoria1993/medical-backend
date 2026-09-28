import { eq, and, desc, sql, or, isNull } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { TestCatalogModel } from '../models/testCatalog.model';
import {
  createTestSchema,
  updateTestSchema,
} from '../schemas/patientsTest.schema';
import { HttpError } from '../../../middlewear/errorHandler';
import { z } from 'zod';
import { notifyTestLogCreated } from '../../../utils/notificationHelpers';

import {
  getOffsetPagination,
  getSorting,
  buildSearchCondition,
  buildWhere,
  getTotalCount,
  buildPaginationMeta,
} from '../../../utils/queryHelpers';

type CreateTestDto = z.infer<typeof createTestSchema>;
type UpdateTestDto = z.infer<typeof updateTestSchema>;

interface TestQueryDto {
  pageNumber?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  status?: string | string[];
}

export class PatientsTestService {
  static async createTest(
    payload: CreateTestDto, // Now contains clinicId and doctorId from middleware
    clinicId: string,
    doctorId: string,
    performerUserId: string,
    performerRole: string
  ) {
    const newTest = await database.transaction(async (trx) => {
      const [created] = await trx
        .insert(TestCatalogModel)
        .values({
          name: payload.name,
          category: payload.category,
          price: payload.price,
          status: payload.status || 'active',
          clinicId: clinicId,
          doctorId: doctorId,
        })
        .returning();

      return created;
    });

    // Post-commit: the notification writes on a different connection than `trx`.
    await notifyTestLogCreated(
      clinicId,
      newTest.id,
      newTest.name,
      performerUserId,
      performerRole
    );

    return newTest;
  }

  static async updateTest(
    id: string,
    payload: UpdateTestDto,
    doctorId: string
  ) {
    return await database.transaction(async (trx) => {
      const existingTests = await trx
        .select()
        .from(TestCatalogModel)
        .where(
          and(
            eq(TestCatalogModel.id, id),
            eq(TestCatalogModel.isDeleted, false)
          )
        )
        .limit(1);

      const existingTest = existingTests[0];

      if (!existingTest) {
        throw new HttpError(404, 'Test not found');
      }

      if (existingTest.doctorId !== doctorId) {
        throw new HttpError(403, 'You are not authorized to update this test');
      }

      const [updatedTest] = await trx
        .update(TestCatalogModel)
        .set({ ...payload, updatedAt: new Date() })
        .where(
          and(
            eq(TestCatalogModel.id, id),
            eq(TestCatalogModel.isDeleted, false)
          )
        )
        .returning();

      if (!updatedTest) {
        throw new HttpError(404, 'Test not found');
      }
      return updatedTest;
    });
  }

  static async deleteTest(id: string) {
    return await database.transaction(async (trx) => {
      const [deletedTest] = await trx
        .update(TestCatalogModel)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(TestCatalogModel.id, id),
            eq(TestCatalogModel.isDeleted, false)
          )
        )
        .returning();

      if (!deletedTest) {
        throw new HttpError(404, 'Test not found');
      }
      return deletedTest;
    });
  }

  static async getTest(id: string) {
    return await database.transaction(async (trx) => {
      const [test] = await trx
        .select()
        .from(TestCatalogModel)
        .where(
          and(
            eq(TestCatalogModel.id, id),
            eq(TestCatalogModel.isDeleted, false)
          )
        );

      if (!test) {
        throw new HttpError(404, 'Test not found');
      }
      return test;
    });
  }

  static async getAllTests(clinicId: string, query: TestQueryDto = {}) {
    return await database.transaction(async (trx) => {
      // ===== PAGINATION =====
      const pagination = getOffsetPagination(query, 100);
      const { limit, offset, pageSize, pageNumber } = pagination;

      const whereConditions = [
        and(
          or(
            eq(TestCatalogModel.clinicId, clinicId),
            isNull(TestCatalogModel.clinicId)
          ),
          eq(TestCatalogModel.isDeleted, false)
        ),
      ];

      if (query.status) {
        const statuses = Array.isArray(query.status)
          ? query.status
          : String(query.status)
              .split(',')
              .map((s) => s.trim());

        if (statuses.length > 0) {
          // OPTION 1: Use SQL IN clause (recommended)
          whereConditions.push(
            sql`${TestCatalogModel.status} IN (${statuses.map((s) => sql`${s}`)})`
          );
        }
      }

      // Search across test name, description, and other relevant fields
      if (query.search) {
        const searchCondition = buildSearchCondition(
          query.search,
          [TestCatalogModel.name, TestCatalogModel.category],
          5 // max 5 search terms
        );

        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      const finalWhereCondition = buildWhere(whereConditions);

      // ===== GET TOTAL COUNT =====
      const totalCount = await getTotalCount(
        trx,
        TestCatalogModel,
        finalWhereCondition
      );

      // ===== BUILD SORTING =====
      const allowedSortColumns = {
        testName: TestCatalogModel.name,
        createdAt: TestCatalogModel.createdAt,
        updatedAt: TestCatalogModel.updatedAt,
        // price: TestCatalogModel.price,
      };

      const sortClauses = getSorting(
        allowedSortColumns,
        (query.sortBy as keyof typeof allowedSortColumns) || 'createdAt',
        query.sortOrder || 'desc'
      );

      // Fallback to recent first if no sort specified
      const defaultSorting = [desc(TestCatalogModel.createdAt)];

      // ===== FETCH TESTS =====
      const tests = await trx
        .select()
        .from(TestCatalogModel)
        .where(finalWhereCondition)
        .orderBy(...(sortClauses.length > 0 ? sortClauses : defaultSorting))
        .limit(limit)
        .offset(offset);

      // ===== BUILD PAGINATION METADATA =====
      const paginationMeta = buildPaginationMeta(
        totalCount,
        pageNumber,
        pageSize
      );

      return {
        tests,
        pagination: paginationMeta,
      };
    });
  }
}
