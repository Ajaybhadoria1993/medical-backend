import { and, asc, count, eq, ilike, or, sql, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import defaultSuggestions from '../utils/labUpdatedDefaultSuggestions.json';
import {
  LabUpdatedDepartmentModel,
  LabUpdatedTestModel,
} from '../models/labUpdated.model';
import {
  CreateLabTestInput,
  GetLabTestsQueryInput,
  UpdateLabTestInput,
} from '../schemas/labTests.schemas';
import {
  DbTransaction,
  ensureDepartment,
  ensureGroup,
  ensureUniqueTest,
  findLibraryTest,
  formatTest,
  LabCatalogDepartmentInput,
  LabCatalogContext,
  normalizeCode,
  pageMeta,
  pagination,
  replaceAliases,
  replaceParameters,
  verifyLabAccess,
} from './labCatalog.service';

const suggestions = defaultSuggestions as {
  departments: LabCatalogDepartmentInput[];
};

const getOrCreateDepartmentByCode = async (
  trx: DbTransaction,
  labId: string,
  departmentCode: string,
  now = new Date()
) => {
  const code = normalizeCode(departmentCode);
  const [existing] = await trx
    .select()
    .from(LabUpdatedDepartmentModel)
    .where(
      and(
        eq(LabUpdatedDepartmentModel.labId, labId),
        eq(LabUpdatedDepartmentModel.code, code)
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const suggestedDepartment = suggestions.departments.find(
    (department) => normalizeCode(department.code) === code
  );

  if (!suggestedDepartment) {
    throw new HttpError(
      404,
      'Department code not found in default suggestions'
    );
  }

  const [created] = await trx
    .insert(LabUpdatedDepartmentModel)
    .values({
      labId,
      name: suggestedDepartment.name,
      code,
      status: suggestedDepartment.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
};

export class LabTestsService {
  static async createTest(
    payload: CreateLabTestInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const now = new Date();
      const department = await getOrCreateDepartmentByCode(
        trx,
        context.labId,
        payload.departmentCode,
        now
      );

      await ensureUniqueTest(trx, context.labId, {
        testName: payload.testName,
        testCode: payload.testCode,
        departmentId: department.id,
      });

      if (payload.groupId) {
        await ensureGroup(trx, context.labId, payload.groupId);
      }

      const [test] = await trx
        .insert(LabUpdatedTestModel)
        .values({
          labId: context.labId,
          testName: payload.testName,
          shortName: payload.shortName ?? null,
          loincCode: payload.loincCode ?? null,
          comments: payload.comments ?? null,
          interpretation: payload.interpretation ?? null,
          notes: payload.notes ?? null,
          testCode: payload.testCode,
          sampleType: payload.sampleType,
          container: payload.container ?? null,
          sampleVolume: payload.sampleVolume ?? null,
          stability: payload.stability ?? null,
          storage: payload.storage ?? null,
          method: payload.method ?? null,
          technology: payload.technology ?? null,
          testType: payload.testType ?? null,
          turnaroundTimeHours: payload.turnaroundTimeHours ?? null,
          clinicalSignificance: payload.clinicalSignificance ?? null,
          limitations: payload.limitations ?? null,
          advice: payload.advice ?? null,
          testDisclaimer: payload.testDisclaimer ?? null,
          whenResultHigh: payload.whenResultHigh ?? null,
          whenResultLow: payload.whenResultLow ?? null,
          whenResultCritical: payload.whenResultCritical ?? null,
          price: payload.price,
          departmentId: department.id,
          groupId: payload.groupId ?? null,
          status: payload.status,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await replaceAliases(trx, test.id, payload.aliases, now);
      await replaceParameters(trx, test.id, payload.parameters, now);
      return await formatTest(trx, test.id);
    });
  }

  static async getTests(
    context: LabCatalogContext,
    query: GetLabTestsQueryInput
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const { page, limit, offset } = pagination(query);
      const conditions: SQL[] = [eq(LabUpdatedTestModel.labId, context.labId)];

      if (query.status) {
        conditions.push(eq(LabUpdatedTestModel.status, query.status));
      }
      if (query.departmentId) {
        conditions.push(
          eq(LabUpdatedTestModel.departmentId, query.departmentId)
        );
      }
      if (query.search) {
        conditions.push(
          or(
            ilike(LabUpdatedTestModel.testName, `%${query.search}%`),
            ilike(LabUpdatedTestModel.testCode, `%${query.search}%`),
            ilike(LabUpdatedTestModel.sampleType, `%${query.search}%`)
          ) as SQL
        );
      }

      const where = and(...conditions);
      const [{ total }] = await trx
        .select({ total: count() })
        .from(LabUpdatedTestModel)
        .where(where);

      const tests = await trx
        .select({
          id: LabUpdatedTestModel.id,
          labId: LabUpdatedTestModel.labId,
          testName: LabUpdatedTestModel.testName,
          shortName: LabUpdatedTestModel.shortName,
          comments: LabUpdatedTestModel.comments,
          interpretation: LabUpdatedTestModel.interpretation,
          notes: LabUpdatedTestModel.notes,
          testCode: LabUpdatedTestModel.testCode,
          sampleType: LabUpdatedTestModel.sampleType,
          testType: LabUpdatedTestModel.testType,
          turnaroundTimeHours: LabUpdatedTestModel.turnaroundTimeHours,
          price: LabUpdatedTestModel.price,
          departmentId: LabUpdatedTestModel.departmentId,
          departmentName: LabUpdatedDepartmentModel.name,
          departmentCode: LabUpdatedDepartmentModel.code,
          groupId: LabUpdatedTestModel.groupId,
          version: LabUpdatedTestModel.version,
          status: LabUpdatedTestModel.status,
          createdAt: LabUpdatedTestModel.createdAt,
          updatedAt: LabUpdatedTestModel.updatedAt,
        })
        .from(LabUpdatedTestModel)
        .innerJoin(
          LabUpdatedDepartmentModel,
          eq(LabUpdatedTestModel.departmentId, LabUpdatedDepartmentModel.id)
        )
        .where(where)
        .orderBy(asc(LabUpdatedTestModel.testName))
        .limit(limit)
        .offset(offset);

      return {
        tests: tests.map((test) => ({
          ...test,
          isCustom: !findLibraryTest(
            { code: test.departmentCode, name: test.departmentName },
            test
          ),
        })),
        pagination: pageMeta(Number(total ?? 0), page, limit),
      };
    });
  }

  static async getTestById(testId: string, context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const test = await formatTest(trx, testId);
      if (test.labId !== context.labId) {
        throw new HttpError(403, 'Test does not belong to this lab');
      }
      return test;
    });
  }

  static async updateTest(
    testId: string,
    payload: UpdateLabTestInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const existing = await formatTest(trx, testId);
      if (existing.labId !== context.labId) {
        throw new HttpError(403, 'Test does not belong to this lab');
      }
      const departmentId = payload.departmentId ?? existing.departmentId;

      if (payload.departmentId) {
        await ensureDepartment(trx, context.labId, payload.departmentId);
      }

      if (payload.groupId) {
        await ensureGroup(trx, context.labId, payload.groupId);
      }

      if (payload.testName || payload.testCode || payload.departmentId) {
        await ensureUniqueTest(
          trx,
          context.labId,
          {
            testName: payload.testName ?? existing.testName,
            testCode: payload.testCode ?? existing.testCode,
            departmentId,
          },
          testId
        );
      }

      await trx
        .update(LabUpdatedTestModel)
        .set({
          ...(payload.testName ? { testName: payload.testName } : {}),
          ...(payload.shortName !== undefined
            ? { shortName: payload.shortName }
            : {}),
          ...(payload.loincCode !== undefined
            ? { loincCode: payload.loincCode }
            : {}),
          ...(payload.comments !== undefined
            ? { comments: payload.comments }
            : {}),
          ...(payload.interpretation !== undefined
            ? { interpretation: payload.interpretation }
            : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
          ...(payload.testCode ? { testCode: payload.testCode } : {}),
          ...(payload.sampleType ? { sampleType: payload.sampleType } : {}),
          ...(payload.container !== undefined
            ? { container: payload.container }
            : {}),
          ...(payload.sampleVolume !== undefined
            ? { sampleVolume: payload.sampleVolume }
            : {}),
          ...(payload.stability !== undefined
            ? { stability: payload.stability }
            : {}),
          ...(payload.storage !== undefined
            ? { storage: payload.storage }
            : {}),
          ...(payload.method !== undefined ? { method: payload.method } : {}),
          ...(payload.technology !== undefined
            ? { technology: payload.technology }
            : {}),
          ...(payload.testType !== undefined
            ? { testType: payload.testType }
            : {}),
          ...(payload.turnaroundTimeHours !== undefined
            ? { turnaroundTimeHours: payload.turnaroundTimeHours }
            : {}),
          ...(payload.clinicalSignificance !== undefined
            ? { clinicalSignificance: payload.clinicalSignificance }
            : {}),
          ...(payload.limitations !== undefined
            ? { limitations: payload.limitations }
            : {}),
          ...(payload.advice !== undefined ? { advice: payload.advice } : {}),
          ...(payload.testDisclaimer !== undefined
            ? { testDisclaimer: payload.testDisclaimer }
            : {}),
          ...(payload.whenResultHigh !== undefined
            ? { whenResultHigh: payload.whenResultHigh }
            : {}),
          ...(payload.whenResultLow !== undefined
            ? { whenResultLow: payload.whenResultLow }
            : {}),
          ...(payload.whenResultCritical !== undefined
            ? { whenResultCritical: payload.whenResultCritical }
            : {}),
          ...(payload.price !== undefined ? { price: payload.price } : {}),
          ...(payload.departmentId
            ? { departmentId: payload.departmentId }
            : {}),
          ...(payload.groupId !== undefined
            ? { groupId: payload.groupId }
            : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
          version: sql`${LabUpdatedTestModel.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(LabUpdatedTestModel.id, testId));

      if (payload.aliases !== undefined) {
        await replaceAliases(trx, testId, payload.aliases);
      }

      if (payload.parameters !== undefined) {
        await replaceParameters(trx, testId, payload.parameters);
      }

      return await formatTest(trx, testId);
    });
  }
}
