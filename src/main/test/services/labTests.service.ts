import {
  eq,
  and,
  desc,
  sql,
  isNull,
  count,
  ilike,
  or,
  asc,
  ne,
  notInArray,
} from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { z } from 'zod';

import {
  getOffsetPagination,
  getSorting,
  buildSearchCondition,
  buildWhere,
  getTotalCount,
  buildPaginationMeta,
} from '../../../utils/queryHelpers';
import { LabTestCatalogModel } from '../models/labTestCatalog.model';
import { DEPARTMENT_CODES } from '../../lab/services/lab.service';
import {
  createLabTestsSchema,
  updateLabTestsSchema,
} from '../schemas/labTests.schema';
import { LabOrderModel } from '../models/labOrder.model';
import { UserModel } from '../../users/models/user.model';
import { TestCatalogModel } from '../models/testCatalog.model';
import {
  LabDepartmentsMasterModel,
  LabDepartmentsModel,
} from '../../lab/models/lab.model';

type CreateLabTestsDto = z.infer<typeof createLabTestsSchema>;
type UpdateLabTestsDto = z.infer<typeof updateLabTestsSchema>;

interface labTestsQueryDto {
  pageNumber?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  status?: string | string[];
}

interface QueryParams {
  pageNumber: number;
  pageSize: number;
  reportStatus?: string;
  paymentStatus?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface MatchingTest {
  id: string;
  reportStatus: string;
  paymentStatus: string;
  price: number | null;
  reportPdf: string | null;
  createdAt: Date;
  patientId: string | null;
  patientName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  testId: string;
  testName: string;
  testCategory: string | null;
  matchedLabTest: {
    id: string;
    name: string;
    testCode: string | null;
    category: string | null;
    price: number | null;
    labId: string | null;
  } | null;
  matchFound: boolean;
  matchScore?: number;
}

type LabTestStatus = 'active' | 'deactive' | 'inactive';

function getPayloadTestName(
  payload: CreateLabTestsDto | UpdateLabTestsDto
): string | undefined {
  return payload.name ?? payload.testName;
}

function normalizeLabTestStatus(status?: LabTestStatus) {
  if (!status) return 'active';
  return status === 'deactive' ? 'inactive' : status;
}

export class labTestsService {
  private static async ensureDepartmentAssignedToLab(
    trx: Parameters<Parameters<typeof database.transaction>[0]>[0],
    labId: string,
    departmentId: string
  ) {
    const [department] = await trx
      .select({
        id: LabDepartmentsMasterModel.id,
        name: LabDepartmentsMasterModel.name,
      })
      .from(LabDepartmentsMasterModel)
      .innerJoin(
        LabDepartmentsModel,
        eq(LabDepartmentsMasterModel.id, LabDepartmentsModel.departmentId)
      )
      .where(
        and(
          eq(LabDepartmentsMasterModel.id, departmentId),
          eq(LabDepartmentsMasterModel.status, 'active'),
          eq(LabDepartmentsModel.labId, labId)
        )
      )
      .limit(1);

    if (!department) {
      throw new HttpError(
        404,
        'Department is not assigned to this lab or is inactive'
      );
    }

    return department;
  }

  static async createLabTests(
    payload: CreateLabTestsDto,
    clinicId: string,
    labId: string,
    userId: string
  ) {
    return await database.transaction(async (trx) => {
      const testName = getPayloadTestName(payload);
      if (!testName) {
        throw new HttpError(400, 'Name is required');
      }

      let category = payload.category;
      if (payload.departmentId) {
        const department = await this.ensureDepartmentAssignedToLab(
          trx,
          labId,
          payload.departmentId
        );
        category = department.name;
      }

      const [existingTest] = await trx
        .select({ id: LabTestCatalogModel.id })
        .from(LabTestCatalogModel)
        .where(
          and(
            eq(LabTestCatalogModel.labId, labId),
            payload.departmentId
              ? eq(LabTestCatalogModel.departmentId, payload.departmentId)
              : isNull(LabTestCatalogModel.departmentId),
            eq(LabTestCatalogModel.name, testName),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .limit(1);

      if (existingTest) {
        throw new HttpError(409, 'Lab test already exists for this lab');
      }

      const [newTest] = await trx
        .insert(LabTestCatalogModel)
        .values({
          name: testName,
          category,
          departmentId: payload.departmentId,
          sampleType: payload.sampleType,
          price: payload.price,
          status: normalizeLabTestStatus(payload.status),
          clinicId: clinicId,
          labId: labId,
          createdBy: userId,
          updatedBy: userId,
          source: 'custom',
        })
        .returning();

      return newTest;
    });
  }

  static async updateLabTests(
    id: string,
    payload: UpdateLabTestsDto,
    labId: string,
    userId: string
  ) {
    return await database.transaction(async (trx) => {
      const existingTests = await trx
        .select()
        .from(LabTestCatalogModel)
        .where(
          and(
            eq(LabTestCatalogModel.id, id),
            eq(LabTestCatalogModel.labId, labId),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .limit(1);

      const existingTest = existingTests[0];

      if (!existingTest) {
        throw new HttpError(404, 'Lab test not found');
      }

      if (existingTest.labId !== labId) {
        throw new HttpError(403, 'You are not authorized to update this test');
      }

      const testName = getPayloadTestName(payload);
      const departmentId = payload.departmentId ?? existingTest.departmentId;
      let category = payload.category ?? existingTest.category;

      if (payload.departmentId) {
        const department = await this.ensureDepartmentAssignedToLab(
          trx,
          labId,
          payload.departmentId
        );
        category = department.name;
      }

      if (testName || payload.departmentId) {
        const [duplicateTest] = await trx
          .select({ id: LabTestCatalogModel.id })
          .from(LabTestCatalogModel)
          .where(
            and(
              eq(LabTestCatalogModel.labId, labId),
              departmentId
                ? eq(LabTestCatalogModel.departmentId, departmentId)
                : isNull(LabTestCatalogModel.departmentId),
              eq(LabTestCatalogModel.name, testName ?? existingTest.name),
              ne(LabTestCatalogModel.id, id),
              isNull(LabTestCatalogModel.deletedAt)
            )
          )
          .limit(1);

        if (duplicateTest) {
          throw new HttpError(409, 'Lab test already exists for this lab');
        }
      }

      const [updatedTest] = await trx
        .update(LabTestCatalogModel)
        .set({
          ...(testName ? { name: testName } : {}),
          ...(category ? { category } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(payload.sampleType !== undefined
            ? { sampleType: payload.sampleType }
            : {}),
          ...(payload.price !== undefined ? { price: payload.price } : {}),
          ...(payload.status !== undefined
            ? { status: normalizeLabTestStatus(payload.status) }
            : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(LabTestCatalogModel.id, id),
            eq(LabTestCatalogModel.labId, labId),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .returning();

      if (!updatedTest) {
        throw new HttpError(404, 'Lab test not found');
      }
      return updatedTest;
    });
  }

  static async deleteLabTests(id: string, labId: string) {
    return await database.transaction(async (trx) => {
      const [deletedTest] = await trx
        .update(LabTestCatalogModel)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(LabTestCatalogModel.id, id),
            eq(LabTestCatalogModel.labId, labId),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .returning();

      if (!deletedTest) {
        throw new HttpError(404, 'Lab test not found');
      }
      return deletedTest;
    });
  }

  static async getLabTests(id: string, labId: string) {
    return await database.transaction(async (trx) => {
      const [test] = await trx
        .select()
        .from(LabTestCatalogModel)
        .where(
          and(
            eq(LabTestCatalogModel.id, id),
            eq(LabTestCatalogModel.labId, labId),
            isNull(LabTestCatalogModel.deletedAt)
          )
        )
        .limit(1);

      if (!test) {
        throw new HttpError(404, 'Lab test not found');
      }
      return test;
    });
  }

  static async getAllLabTests(labId: string, query: labTestsQueryDto = {}) {
    return await database.transaction(async (trx) => {
      // ===== PAGINATION =====
      const pagination = getOffsetPagination(query, 100);
      const { limit, offset, pageSize, pageNumber } = pagination;

      const whereConditions = [
        and(
          eq(LabTestCatalogModel.labId, labId),
          isNull(LabTestCatalogModel.deletedAt),
          notInArray(LabTestCatalogModel.testCode, DEPARTMENT_CODES)
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
            sql`${LabTestCatalogModel.status} IN (${statuses.map((s) => sql`${s}`)})`
          );
        }
      } else {
        whereConditions.push(eq(LabTestCatalogModel.status, 'active'));
      }

      // Search across test name, description, and other relevant fields
      if (query.search) {
        const searchCondition = buildSearchCondition(
          query.search,
          [LabTestCatalogModel.name, LabTestCatalogModel.category],
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
        LabTestCatalogModel,
        finalWhereCondition
      );

      // ===== BUILD SORTING =====
      const allowedSortColumns = {
        testName: LabTestCatalogModel.name,
        createdAt: LabTestCatalogModel.createdAt,
        updatedAt: LabTestCatalogModel.updatedAt,
        // price: LabTestCatalogModel.price,
      };

      const sortClauses = getSorting(
        allowedSortColumns,
        (query.sortBy as keyof typeof allowedSortColumns) || 'createdAt',
        query.sortOrder || 'desc'
      );

      // Fallback to recent first if no sort specified
      const defaultSorting = [desc(LabTestCatalogModel.createdAt)];

      // ===== FETCH TESTS =====
      const tests = await trx
        .select()
        .from(LabTestCatalogModel)
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

  static async getMatchingTestsService(
    clinicId: string,
    labId: string,
    labAssistantId: string,
    query: QueryParams
  ) {
    // 1. Verify lab assistant belongs to this clinic
    const [labAssistant] = await database
      .select({
        id: UserModel.id,
        name: UserModel.name,
      })
      .from(UserModel)
      .where(
        and(
          eq(UserModel.id, labAssistantId),
          eq(UserModel.userType, 'Lab_Assistant')
        )
      )
      .limit(1);

    if (!labAssistant) {
      throw new HttpError(
        403,
        'Access denied: Not a lab assistant for this clinic'
      );
    }

    // 2. Get all active lab tests for this lab
    const labTests = await database
      .select({
        id: LabTestCatalogModel.id,
        name: LabTestCatalogModel.name,
        testCode: LabTestCatalogModel.testCode,
        category: LabTestCatalogModel.category,
        price: LabTestCatalogModel.price,
        labId: LabTestCatalogModel.labId,
      })
      .from(LabTestCatalogModel)
      .where(
        and(
          eq(LabTestCatalogModel.clinicId, clinicId),
          eq(LabTestCatalogModel.labId, labId),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt)
        )
      );

    // Create lookup map for faster matching
    const labTestsMap = new Map();
    labTests.forEach((test) => {
      if (test.name) {
        labTestsMap.set(test.name.toLowerCase(), test);
        // Also store common variations
        if (test.name.toLowerCase().includes('cbc')) {
          labTestsMap.set('complete blood count', test);
        }
        if (test.name.toLowerCase().includes('complete blood count')) {
          labTestsMap.set('cbc', test);
        }
      }
    });

    // 3. Build base WHERE conditions
    const baseConditions = [eq(LabOrderModel.clinicId, clinicId)];

    if (query.reportStatus) {
      baseConditions.push(
        sql`${LabOrderModel.reportStatus} = ${query.reportStatus}`
      );
    }

    if (query.paymentStatus) {
      baseConditions.push(
        sql`${LabOrderModel.paymentStatus} = ${query.paymentStatus}`
      );
    }

    // 4. Build search condition separately
    let searchCondition = undefined;
    if (query.search) {
      searchCondition = or(
        ilike(UserModel.name, `%${query.search}%`),
        ilike(TestCatalogModel.name, `%${query.search}%`),
        ilike(TestCatalogModel.category, `%${query.search}%`)
      );
    }

    // 5. Build final WHERE condition
    let finalWhereCondition;
    if (searchCondition) {
      finalWhereCondition = and(and(...baseConditions), searchCondition);
    } else {
      finalWhereCondition = and(...baseConditions);
    }

    // 6. Get total count
    const countResult = await database
      .select({ count: count() })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .leftJoin(UserModel, eq(LabOrderModel.patientId, UserModel.id))
      .where(finalWhereCondition);

    const totalCount = Number(countResult[0]?.count || 0);

    // 7. Calculate pagination
    const offset = (query.pageNumber - 1) * query.pageSize;

    // 8. Build order by clause
    let orderByClause;
    if (query.sortBy === 'createdAt') {
      orderByClause =
        query.sortOrder === 'asc'
          ? asc(LabOrderModel.createdAt)
          : desc(LabOrderModel.createdAt);
    } else {
      orderByClause = desc(LabOrderModel.createdAt);
    }

    // 9. Get paginated results
    const appointmentTests = await database
      .select({
        id: LabOrderModel.id,
        reportStatus: LabOrderModel.reportStatus,
        paymentStatus: LabOrderModel.paymentStatus,
        price: LabOrderModel.price,
        reportPdf: LabOrderModel.reportPdf,
        createdAt: LabOrderModel.createdAt,
        patientId: UserModel.id,
        patientName: UserModel.name,
        doctorId: sql`doctor_user.id`,
        doctorName: sql`doctor_user.name`,
        testId: TestCatalogModel.id,
        testName: TestCatalogModel.name,
        testCategory: TestCatalogModel.category,
      })
      .from(LabOrderModel)
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .leftJoin(UserModel, eq(LabOrderModel.patientId, UserModel.id))
      .leftJoin(
        sql`${UserModel} as doctor_user`,
        eq(LabOrderModel.doctorId, sql`doctor_user.id`)
      )
      .where(finalWhereCondition)
      .orderBy(orderByClause)
      .limit(query.pageSize)
      .offset(offset);

    // 10. Find matches for each appointment test
    // Helper: normalize a name by stripping underscores, hyphens, and special
    // chars so "URINE_ROUTINE" becomes "urine routine" and matches "Urine Routine".
    const normalizeName = (raw: string | null | undefined): string =>
      (raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const testsWithMatches: MatchingTest[] = [];

    for (const test of appointmentTests) {
      const testNameNorm = normalizeName(test.testName);
      const testCategory = test.testCategory;
      let matchedLabTest = null;
      let bestMatchScore = 0;

      // Try ALL lab tests — category match gives a bonus but is not required.
      // Previously tests were skipped entirely when category didn't match,
      // which broke cases like doctor category="Urine" vs lab category="Clinical Pathology".
      for (const labTest of labTests) {
        const labTestNameNorm = normalizeName(labTest.name);
        const sameCategory =
          labTest.category?.toLowerCase().trim() ===
          testCategory?.toLowerCase().trim();

        let matchScore = 0;

        // Strategy 0: testCode match (highest confidence)
        // If the lab catalog has a testCode (e.g. URINE_ROUTINE) and the
        // doctor's test name normalizes to the same thing, it's a direct hit.
        if (labTest.testCode) {
          const labTestCodeNorm = normalizeName(labTest.testCode);
          if (labTestCodeNorm && labTestCodeNorm === testNameNorm) {
            matchScore = 1.0;
          }
        }

        // Strategy 1: Exact normalized name match
        if (matchScore === 0 && labTestNameNorm === testNameNorm) {
          matchScore = 1.0;
        }

        // Strategy 2: One contains the other
        if (
          matchScore === 0 &&
          (labTestNameNorm.includes(testNameNorm) ||
            testNameNorm.includes(labTestNameNorm))
        ) {
          matchScore = 0.9;
        }

        // Strategy 3: Acronym / abbreviation matching
        if (matchScore === 0) {
          const testWords = testNameNorm
            .split(/\s+/)
            .filter((w) => w.length > 0);
          const labWords = labTestNameNorm
            .split(/\s+/)
            .filter((w) => w.length > 0);

          const testAcronym = testWords.map((w) => w[0]).join('');
          const labAcronym = labWords.map((w) => w[0]).join('');

          if (testAcronym === labAcronym && testAcronym.length > 1) {
            matchScore = 0.85;
          } else if (
            testAcronym === labTestNameNorm ||
            labAcronym === testNameNorm
          ) {
            matchScore = 0.85;
          }
          // Strategy 4: Word overlap
          else {
            const commonWords = testWords.filter((w) => labWords.includes(w));
            if (commonWords.length > 0) {
              matchScore =
                0.7 *
                (commonWords.length /
                  Math.max(testWords.length, labWords.length));
            }
            // Strategy 5: Character overlap (for short strings)
            else {
              let charMatches = 0;
              const minLength = Math.min(
                testNameNorm.length,
                labTestNameNorm.length
              );
              for (let i = 0; i < minLength; i++) {
                if (testNameNorm[i] === labTestNameNorm[i]) {
                  charMatches++;
                }
              }
              if (charMatches > 0) {
                matchScore = 0.5 * (charMatches / minLength);
              }
            }
          }
        }

        // Category bonus: boost score slightly when categories also match
        if (sameCategory && matchScore > 0) {
          matchScore = Math.min(1.0, matchScore + 0.05);
        }

        // Track the best match
        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore;
          matchedLabTest = labTest;
        }
      }

      // Include ALL tests — matched or not — so the frontend can show
      // "Not in My Test" for unmatched tests instead of hiding them.
      const isMatched = bestMatchScore > 0.5 && matchedLabTest != null;

      testsWithMatches.push({
        id: test.id,
        reportStatus: test.reportStatus,
        paymentStatus: test.paymentStatus,
        price: test.price,
        reportPdf: test.reportPdf,
        createdAt: test.createdAt,
        patientId: test.patientId,
        patientName: test.patientName,
        doctorId: test.doctorId ? String(test.doctorId) : null,
        doctorName: test.doctorName ? String(test.doctorName) : null,
        testId: test.testId,
        testName: test.testName || '',
        testCategory: test.testCategory,
        matchedLabTest: isMatched
          ? {
              id: matchedLabTest!.id,
              name: matchedLabTest!.name || '',
              testCode: matchedLabTest!.testCode ?? null,
              category: matchedLabTest!.category,
              price: matchedLabTest!.price,
              labId: matchedLabTest!.labId,
            }
          : null,
        matchFound: isMatched,
        matchScore: Math.round(bestMatchScore * 100),
      });
    }

    // 11. Apply client-side sorting if needed
    if (query.sortBy === 'patientName') {
      testsWithMatches.sort((a, b) => {
        const nameA = a.patientName || '';
        const nameB = b.patientName || '';
        const comparison = nameA.localeCompare(nameB);
        return query.sortOrder === 'asc' ? comparison : -comparison;
      });
    } else if (query.sortBy === 'testName') {
      testsWithMatches.sort((a, b) => {
        const nameA = a.testName || '';
        const nameB = b.testName || '';
        const comparison = nameA.localeCompare(nameB);
        return query.sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    // 12. Return response
    return {
      tests: testsWithMatches,
      pagination: {
        pageNumber: query.pageNumber,
        pageSize: query.pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / query.pageSize),
        hasNextPage: query.pageNumber < Math.ceil(totalCount / query.pageSize),
        hasPreviousPage: query.pageNumber > 1,
        matchedCount: testsWithMatches.length,
      },
    };
  }
}
