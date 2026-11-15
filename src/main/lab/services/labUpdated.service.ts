import {
  asc,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { startOfDayIST, getISTDateString } from '../../../utils/istDateTime';
import defaultSuggestions from '../utils/labUpdatedDefaultSuggestions.json';
import {
  IndependentPatientModel,
  LabOrderModel,
} from '../../test/models/labOrder.model';
import { UserModel } from '../../users/models/user.model';
import {
  LabTestResultParameterModel,
  LabUpdatedDepartmentModel,
  LabUpdatedActivityModel,
  LabUpdatedTestModel,
  LabUpdatedTestPackageModel,
} from '../models/labUpdated.model';
import { LabsModel } from '../models/lab.model';
import {
  ApplyLabUpdatedSuggestionsInput,
  GetLabOrderActivitiesInput,
  GetReferringDoctorsQueryInput,
  UpdateLabSampleCodeSettingsInput,
} from '../schemas/labUpdated.schemas';
import {
  DbTransaction,
  ensureDepartment,
  ensureGroup,
  ensureGroupByName,
  LabCatalogContext,
  LabCatalogDepartmentInput,
  LabCatalogTestInput,
  normalizeCode,
  normalizeName,
  pageMeta,
  pagination,
  replaceAliases,
  upsertParameters,
  verifyLabAccess,
} from './labCatalog.service';

const suggestions = defaultSuggestions as {
  departments: LabCatalogDepartmentInput[];
};

export class LabUpdatedService {
  static getDefaultSuggestions() {
    return suggestions;
  }

  static async getLabDetails(context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [lab] = await trx
        .select()
        .from(LabsModel)
        .where(
          and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt))
        )
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      return lab;
    });
  }

  static async hasActiveDepartment(context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [department] = await trx
        .select({ id: LabUpdatedDepartmentModel.id })
        .from(LabUpdatedDepartmentModel)
        .where(
          and(
            eq(LabUpdatedDepartmentModel.labId, context.labId),
            eq(LabUpdatedDepartmentModel.status, 'active')
          )
        )
        .limit(1);

      return { hasActiveDepartment: Boolean(department) };
    });
  }

  static async getLabOrderActivities(
    context: LabCatalogContext,
    payload: GetLabOrderActivitiesInput
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [lab] = await trx
        .select({ clinicId: LabsModel.clinicId })
        .from(LabsModel)
        .where(
          and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt))
        )
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      const labOrderIds = Array.from(new Set(payload.labOrderIds));
      const scopedOrders = await trx
        .select({
          id: LabOrderModel.id,
          testName: LabUpdatedTestModel.testName,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .where(
          and(
            inArray(LabOrderModel.id, labOrderIds),
            or(
              eq(LabOrderModel.clinicId, lab.clinicId),
              eq(LabUpdatedTestModel.labId, context.labId),
              eq(LabUpdatedTestPackageModel.labId, context.labId)
            )
          )
        );

      const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
      const testNamesByOrderId = new Map(
        scopedOrders.map((order) => [order.id, order.testName])
      );
      const missingOrderIds = labOrderIds.filter(
        (labOrderId) => !scopedOrderIds.has(labOrderId)
      );

      if (missingOrderIds.length > 0) {
        throw new HttpError(
          404,
          `Lab orders not found for this lab: ${missingOrderIds.join(', ')}`
        );
      }

      const activityGroups = [];
      for (const labOrderId of labOrderIds) {
        const activities = await trx
          .select({
            id: LabUpdatedActivityModel.id,
            labOrderId: LabUpdatedActivityModel.labOrderId,
            activity: LabUpdatedActivityModel.activity,
            createdAt: LabUpdatedActivityModel.createdAt,
            performedBy: {
              id: UserModel.id,
              name: UserModel.name,
              role: UserModel.userType,
            },
          })
          .from(LabUpdatedActivityModel)
          .leftJoin(
            UserModel,
            eq(LabUpdatedActivityModel.performedBy, UserModel.id)
          )
          .where(
            and(
              eq(LabUpdatedActivityModel.labId, context.labId),
              eq(LabUpdatedActivityModel.labOrderId, labOrderId)
            )
          )
          .orderBy(desc(LabUpdatedActivityModel.createdAt))
          .limit(payload.limit);

        activityGroups.push({
          labOrderId,
          testName: testNamesByOrderId.get(labOrderId) ?? null,
          activities,
          returnedCount: activities.length,
        });
      }

      return {
        limitPerLabOrder: payload.limit,
        orders: activityGroups,
      };
    });
  }

  static async getReferringDoctors(
    context: LabCatalogContext,
    query: GetReferringDoctorsQueryInput
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [lab] = await trx
        .select({ clinicId: LabsModel.clinicId })
        .from(LabsModel)
        .where(
          and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt))
        )
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      const doctorUser = alias(UserModel, 'referring_doctor_user');
      const referringDoctorNameExpression = sql<string | null>`coalesce(
        ${doctorUser.name},
        ${LabOrderModel.referringDoctorName},
        ${IndependentPatientModel.doctorName}
      )`;
      const conditions = [
        or(
          eq(LabOrderModel.clinicId, lab.clinicId),
          eq(LabUpdatedTestModel.labId, context.labId),
          eq(LabUpdatedTestPackageModel.labId, context.labId)
        ),
        sql`${referringDoctorNameExpression} IS NOT NULL`,
      ];

      if (query.search) {
        conditions.push(
          sql`${referringDoctorNameExpression} ILIKE ${`%${query.search}%`}`
        );
      }

      const where = and(...conditions);
      const { page, limit, offset } = pagination(query);

      const [{ total }] = await trx
        .select({
          total: sql<number>`COUNT(DISTINCT ${referringDoctorNameExpression})::int`,
        })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .leftJoin(
          IndependentPatientModel,
          eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
        )
        .where(where);

      const referringDoctors = await trx
        .selectDistinct({ name: referringDoctorNameExpression })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .leftJoin(
          IndependentPatientModel,
          eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
        )
        .where(where)
        .orderBy(asc(referringDoctorNameExpression))
        .limit(limit)
        .offset(offset);

      return {
        referringDoctors,
        pagination: pageMeta(Number(total ?? 0), page, limit),
      };
    });
  }

  static async getSampleCodeSettings(context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [lab] = await trx
        .select({
          id: LabsModel.id,
          clinicId: LabsModel.clinicId,
          autoGenerateSampleCode: LabsModel.autoGenerateSampleCode,
        })
        .from(LabsModel)
        .where(
          and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt))
        )
        .limit(1);

      if (!lab) {
        throw new HttpError(404, 'Lab not found');
      }

      const date = getISTDateString();
      const prefix = date
        .split('-')
        .reverse()
        .map((part) => part.slice(-2))
        .join('');

      if (!lab.autoGenerateSampleCode) {
        return {
          id: lab.id,
          autoGenerateSampleCode: false,
          date,
          sampleCode: null,
        };
      }

      const dayStart = startOfDayIST(date);
      const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const orders = await trx
        .select({ sampleCode: LabOrderModel.sampleCode })
        .from(LabOrderModel)
        .leftJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(
          LabUpdatedTestPackageModel,
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            LabUpdatedTestPackageModel.id
          )
        )
        .where(
          and(
            isNotNull(LabOrderModel.sampleCode),
            // A sample code is assigned while processing an existing order,
            // so use the order's update time instead of its creation time.
            // Keep the createdAt fallback for legacy rows where updatedAt is
            // still null.
            or(
              and(
                gte(LabOrderModel.updatedAt, dayStart),
                lt(LabOrderModel.updatedAt, nextDayStart)
              ),
              and(
                isNull(LabOrderModel.updatedAt),
                gte(LabOrderModel.createdAt, dayStart),
                lt(LabOrderModel.createdAt, nextDayStart)
              )
            ),
            or(
              eq(LabOrderModel.clinicId, lab.clinicId),
              eq(LabUpdatedTestModel.labId, lab.id),
              eq(LabUpdatedTestPackageModel.labId, lab.id)
            )
          )
        );

      const sequencePattern = new RegExp(`^${prefix}-(\\d+)$`);
      const highestSequence = orders.reduce((highest, order) => {
        const match = order.sampleCode?.match(sequencePattern);
        const sequence = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(sequence)
          ? Math.max(highest, sequence)
          : highest;
      }, 0);

      return {
        id: lab.id,
        autoGenerateSampleCode: true,
        date,
        sampleCode: `${prefix}-${String(highestSequence + 1).padStart(3, '0')}`,
      };
    });
  }

  static async updateSampleCodeSettings(
    payload: UpdateLabSampleCodeSettingsInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const [updatedLab] = await trx
        .update(LabsModel)
        .set({
          autoGenerateSampleCode: payload.autoGenerateSampleCode,
          updatedAt: new Date(),
        })
        .where(
          and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt))
        )
        .returning({
          id: LabsModel.id,
          autoGenerateSampleCode: LabsModel.autoGenerateSampleCode,
        });

      if (!updatedLab) {
        throw new HttpError(404, 'Lab not found');
      }

      return updatedLab;
    });
  }

  static async getTestResultParametersByTestIds(
    testIds: string[],
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const uniqueTestIds = Array.from(new Set(testIds));
      const tests = await trx
        .select({
          id: LabUpdatedTestModel.id,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
        })
        .from(LabUpdatedTestModel)
        .where(
          and(
            eq(LabUpdatedTestModel.labId, context.labId),
            inArray(LabUpdatedTestModel.id, uniqueTestIds)
          )
        );

      if (tests.length !== uniqueTestIds.length) {
        const foundTestIds = new Set(tests.map((test) => test.id));
        const missingTestIds = uniqueTestIds.filter(
          (testId) => !foundTestIds.has(testId)
        );

        throw new HttpError(
          404,
          `Test not found for this lab: ${missingTestIds.join(', ')}`
        );
      }

      const parameters = await trx
        .select({
          id: LabTestResultParameterModel.id,
          testId: LabTestResultParameterModel.testId,
          parameterName: LabTestResultParameterModel.parameterName,
          inputType: LabTestResultParameterModel.inputType,
          unit: LabTestResultParameterModel.unit,
          referenceRange: LabTestResultParameterModel.referenceRange,
          isRequired: LabTestResultParameterModel.isRequired,
          isActive: LabTestResultParameterModel.isActive,
          createdAt: LabTestResultParameterModel.createdAt,
          updatedAt: LabTestResultParameterModel.updatedAt,
        })
        .from(LabTestResultParameterModel)
        .where(inArray(LabTestResultParameterModel.testId, uniqueTestIds));

      const parametersByTestId = new Map<string, typeof parameters>();
      for (const parameter of parameters) {
        const testParameters = parametersByTestId.get(parameter.testId) ?? [];
        testParameters.push(parameter);
        parametersByTestId.set(parameter.testId, testParameters);
      }

      const testById = new Map(tests.map((test) => [test.id, test]));

      return uniqueTestIds.map((testId) => ({
        test: testById.get(testId),
        parameters: parametersByTestId.get(testId) ?? [],
      }));
    });
  }

  static async getDefaultSuggestionsForLab(context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const labDepartments = await trx
        .select({
          id: LabUpdatedDepartmentModel.id,
          name: LabUpdatedDepartmentModel.name,
          code: LabUpdatedDepartmentModel.code,
          status: LabUpdatedDepartmentModel.status,
        })
        .from(LabUpdatedDepartmentModel)
        .where(eq(LabUpdatedDepartmentModel.labId, context.labId));

      const departmentByCode = new Map(
        labDepartments.map((department) => [
          normalizeCode(department.code),
          department,
        ])
      );

      const departmentByExactName = new Map(
        labDepartments.map((department) => [department.name, department])
      );

      const departmentByName = new Map(
        labDepartments.map((department) => [
          normalizeName(department.name),
          department,
        ])
      );

      const labTests =
        labDepartments.length > 0
          ? await trx
              .select({
                id: LabUpdatedTestModel.id,
                departmentId: LabUpdatedTestModel.departmentId,
                testName: LabUpdatedTestModel.testName,
                comments: LabUpdatedTestModel.comments,
                interpretation: LabUpdatedTestModel.interpretation,
                notes: LabUpdatedTestModel.notes,
                testCode: LabUpdatedTestModel.testCode,
                testType: LabUpdatedTestModel.testType,
                sampleType: LabUpdatedTestModel.sampleType,
                price: LabUpdatedTestModel.price,
                status: LabUpdatedTestModel.status,
              })
              .from(LabUpdatedTestModel)
              .where(
                and(
                  eq(LabUpdatedTestModel.labId, context.labId),
                  inArray(
                    LabUpdatedTestModel.departmentId,
                    labDepartments.map((department) => department.id)
                  )
                )
              )
          : [];

      const testByDepartmentAndExactName = new Map(
        labTests.map((test) => [`${test.departmentId}:${test.testName}`, test])
      );

      const testByDepartmentAndCode = new Map(
        labTests.map((test) => [
          `${test.departmentId}:${normalizeCode(test.testCode)}`,
          test,
        ])
      );

      const testByDepartmentAndName = new Map(
        labTests.map((test) => [
          `${test.departmentId}:${normalizeName(test.testName)}`,
          test,
        ])
      );

      const allLabParameters =
        labTests.length > 0
          ? await trx
              .select({
                id: LabTestResultParameterModel.id,
                testId: LabTestResultParameterModel.testId,
                parameterName: LabTestResultParameterModel.parameterName,
                inputType: LabTestResultParameterModel.inputType,
                unit: LabTestResultParameterModel.unit,
                referenceRange: LabTestResultParameterModel.referenceRange,
                isRequired: LabTestResultParameterModel.isRequired,
                isActive: LabTestResultParameterModel.isActive,
              })
              .from(LabTestResultParameterModel)
              .where(
                inArray(
                  LabTestResultParameterModel.testId,
                  labTests.map((test) => test.id)
                )
              )
          : [];

      const labParameters = allLabParameters.filter(
        (parameter) => parameter.isActive
      );

      const parameterByTestAndName = new Set(
        labParameters.map(
          (parameter) =>
            `${parameter.testId}:${normalizeName(parameter.parameterName)}`
        )
      );

      const testsByDepartmentId = new Map<string, typeof labTests>();
      for (const test of labTests) {
        const departmentTests =
          testsByDepartmentId.get(test.departmentId) ?? [];
        departmentTests.push(test);
        testsByDepartmentId.set(test.departmentId, departmentTests);
      }

      const parametersByTestId = new Map<string, typeof allLabParameters>();
      for (const parameter of allLabParameters) {
        const testParameters = parametersByTestId.get(parameter.testId) ?? [];
        testParameters.push(parameter);
        parametersByTestId.set(parameter.testId, testParameters);
      }

      const formatCustomParameter = (
        parameter: (typeof allLabParameters)[number]
      ) => ({
        id: parameter.id,
        parameterName: parameter.parameterName,
        inputType: parameter.inputType,
        unit: parameter.unit,
        referenceRange: parameter.referenceRange,
        isRequired: parameter.isRequired,
        isActive: parameter.isActive,
        createdForMyLab: parameter.isActive,
        isCustom: true,
      });

      const getCustomParameters = (
        test: (typeof labTests)[number],
        defaultParameters: LabCatalogTestInput['parameters'] = []
      ) =>
        (parametersByTestId.get(test.id) ?? [])
          .filter(
            (parameter) =>
              !defaultParameters.some(
                (defaultParameter) =>
                  normalizeName(defaultParameter.parameterName) ===
                  normalizeName(parameter.parameterName)
              )
          )
          .map(formatCustomParameter);

      const formatCustomTest = (test: (typeof labTests)[number]) => ({
        id: test.id,
        testName: test.testName,
        comments: test.comments,
        interpretation: test.interpretation,
        notes: test.notes,
        testCode: test.testCode,
        testType: test.testType,
        sampleType: test.sampleType,
        price: test.price,
        status: test.status,
        createdForMyLab: test.status === 'active',
        isCustom: true,
        parameters: (parametersByTestId.get(test.id) ?? []).map(
          formatCustomParameter
        ),
      });

      const isDefaultDepartment = (
        department: (typeof labDepartments)[number]
      ) =>
        suggestions.departments.some(
          (defaultDepartment) =>
            defaultDepartment.name === department.name ||
            normalizeCode(defaultDepartment.code) ===
              normalizeCode(department.code) ||
            normalizeName(defaultDepartment.name) ===
              normalizeName(department.name)
        );

      const isDefaultTest = (
        test: (typeof labTests)[number],
        defaultTests: LabCatalogTestInput[] = []
      ) =>
        defaultTests.some(
          (defaultTest) =>
            defaultTest.testName === test.testName ||
            normalizeCode(defaultTest.testCode) ===
              normalizeCode(test.testCode) ||
            normalizeName(defaultTest.testName) === normalizeName(test.testName)
        );

      return {
        departments: [
          ...suggestions.departments.map((department) => {
            const { tests = [], ...departmentDetails } = department;
            const labDepartment =
              departmentByExactName.get(department.name) ??
              departmentByCode.get(normalizeCode(department.code)) ??
              departmentByName.get(normalizeName(department.name));
            const createdForMyLab = labDepartment?.status === 'active';

            return {
              ...departmentDetails,
              createdForMyLab,
              isCustom: false,
              tests: [
                ...tests.map((test) => {
                  const { parameters = [], ...testDetails } = test;
                  const labTest = labDepartment
                    ? (testByDepartmentAndExactName.get(
                        `${labDepartment.id}:${test.testName}`
                      ) ??
                      testByDepartmentAndCode.get(
                        `${labDepartment.id}:${normalizeCode(test.testCode)}`
                      ) ??
                      testByDepartmentAndName.get(
                        `${labDepartment.id}:${normalizeName(test.testName)}`
                      ))
                    : undefined;
                  const testCreatedForMyLab = labTest?.status === 'active';

                  return {
                    ...testDetails,
                    createdForMyLab: testCreatedForMyLab,
                    isCustom: false,
                    ...(labTest
                      ? {
                          price: labTest.price,
                          comments: labTest.comments ?? test.comments,
                          interpretation:
                            labTest.interpretation ?? test.interpretation,
                          notes: labTest.notes ?? test.notes,
                        }
                      : {}),
                    parameters: [
                      ...parameters.map((parameter) => ({
                        ...parameter,
                        createdForMyLab: labTest
                          ? parameterByTestAndName.has(
                              `${labTest.id}:${normalizeName(
                                parameter.parameterName
                              )}`
                            )
                          : false,
                        isCustom: false,
                      })),
                      ...(labTest
                        ? getCustomParameters(labTest, parameters)
                        : []),
                    ],
                  };
                }),
                ...(labDepartment
                  ? (testsByDepartmentId.get(labDepartment.id) ?? [])
                      .filter((test) => !isDefaultTest(test, tests))
                      .map(formatCustomTest)
                  : []),
              ],
            };
          }),
          ...labDepartments
            .filter((department) => !isDefaultDepartment(department))
            .map((department) => ({
              name: department.name,
              code: department.code,
              status: department.status,
              createdForMyLab: department.status === 'active',
              isCustom: true,
              tests: (testsByDepartmentId.get(department.id) ?? []).map(
                formatCustomTest
              ),
            })),
        ],
      };
    });
  }

  private static async upsertSuggestedDepartment(
    trx: DbTransaction,
    labId: string,
    department: LabCatalogDepartmentInput,
    now = new Date()
  ) {
    const code = normalizeCode(department.code);
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
      const [updated] = await trx
        .update(LabUpdatedDepartmentModel)
        .set({
          name: department.name,
          status: department.status ?? 'active',
          updatedAt: now,
        })
        .where(eq(LabUpdatedDepartmentModel.id, existing.id))
        .returning();

      return updated;
    }

    const [created] = await trx
      .insert(LabUpdatedDepartmentModel)
      .values({
        labId,
        name: department.name,
        code,
        status: department.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  }

  private static async upsertSuggestedTest(
    trx: DbTransaction,
    labId: string,
    departmentId: string,
    test: LabCatalogTestInput,
    now = new Date()
  ) {
    const code = normalizeCode(test.testCode);
    const groupId = test.groupId
      ? (await ensureGroup(trx, labId, test.groupId)).id
      : test.groupName
        ? await ensureGroupByName(trx, labId, test.groupName, now)
        : null;

    const [existing] = await trx
      .select()
      .from(LabUpdatedTestModel)
      .where(
        and(
          eq(LabUpdatedTestModel.labId, labId),
          eq(LabUpdatedTestModel.testCode, code)
        )
      )
      .limit(1);

    if (existing) {
      const [savedTest] = await trx
        .update(LabUpdatedTestModel)
        .set({
          departmentId,
          testName: test.testName,
          shortName: test.shortName ?? null,
          loincCode: test.loincCode ?? null,
          comments: test.comments ?? null,
          interpretation: test.interpretation ?? null,
          notes: test.notes ?? null,
          sampleType: test.sampleType,
          container: test.container ?? null,
          sampleVolume: test.sampleVolume ?? null,
          stability: test.stability ?? null,
          storage: test.storage ?? null,
          method: test.method ?? null,
          technology: test.technology ?? null,
          testType: test.testType ?? null,
          turnaroundTimeHours: test.turnaroundTimeHours ?? null,
          clinicalSignificance: test.clinicalSignificance ?? null,
          limitations: test.limitations ?? null,
          advice: test.advice ?? null,
          testDisclaimer: test.testDisclaimer ?? null,
          whenResultHigh: test.whenResultHigh ?? null,
          whenResultLow: test.whenResultLow ?? null,
          whenResultCritical: test.whenResultCritical ?? null,
          ...(test.price !== undefined ? { price: test.price } : {}),
          groupId,
          status: test.status ?? 'active',
          version: sql`${LabUpdatedTestModel.version} + 1`,
          updatedAt: now,
        })
        .where(eq(LabUpdatedTestModel.id, existing.id))
        .returning();

      await replaceAliases(trx, existing.id, test.aliases, now);
      await upsertParameters(trx, existing.id, test.parameters ?? [], now);
      return savedTest;
    }

    const [created] = await trx
      .insert(LabUpdatedTestModel)
      .values({
        labId,
        departmentId,
        testName: test.testName,
        shortName: test.shortName ?? null,
        loincCode: test.loincCode ?? null,
        comments: test.comments ?? null,
        interpretation: test.interpretation ?? null,
        notes: test.notes ?? null,
        testCode: code,
        sampleType: test.sampleType,
        container: test.container ?? null,
        sampleVolume: test.sampleVolume ?? null,
        stability: test.stability ?? null,
        storage: test.storage ?? null,
        method: test.method ?? null,
        technology: test.technology ?? null,
        testType: test.testType ?? null,
        turnaroundTimeHours: test.turnaroundTimeHours ?? null,
        clinicalSignificance: test.clinicalSignificance ?? null,
        limitations: test.limitations ?? null,
        advice: test.advice ?? null,
        testDisclaimer: test.testDisclaimer ?? null,
        whenResultHigh: test.whenResultHigh ?? null,
        whenResultLow: test.whenResultLow ?? null,
        whenResultCritical: test.whenResultCritical ?? null,
        price: test.price ?? 0,
        groupId,
        status: test.status ?? 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await replaceAliases(trx, created.id, test.aliases, now);
    await upsertParameters(trx, created.id, test.parameters ?? [], now);
    return created;
  }

  private static async getSelectedParameterIds(
    trx: DbTransaction,
    testId: string,
    parameters: LabCatalogTestInput['parameters']
  ) {
    if (!parameters || parameters.length === 0) return [];

    const selectedNames = new Set(
      parameters.map((parameter) => normalizeName(parameter.parameterName))
    );

    const savedParameters = await trx
      .select({
        id: LabTestResultParameterModel.id,
        parameterName: LabTestResultParameterModel.parameterName,
      })
      .from(LabTestResultParameterModel)
      .where(eq(LabTestResultParameterModel.testId, testId));

    return savedParameters
      .filter((parameter) =>
        selectedNames.has(normalizeName(parameter.parameterName))
      )
      .map((parameter) => parameter.id);
  }

  private static async syncInactiveItems(
    trx: DbTransaction,
    labId: string,
    activeDepartmentIds: Set<string>,
    activeTestIds: Set<string>,
    activeParameterIds: Set<string>,
    now = new Date()
  ) {
    const allLabTests = await trx
      .select({ id: LabUpdatedTestModel.id })
      .from(LabUpdatedTestModel)
      .where(eq(LabUpdatedTestModel.labId, labId));

    const allLabTestIds = allLabTests.map((test) => test.id);

    if (allLabTestIds.length > 0) {
      const activeParameterIdList = Array.from(activeParameterIds);

      await trx
        .update(LabTestResultParameterModel)
        .set({ isActive: false, updatedAt: now })
        .where(
          activeParameterIdList.length > 0
            ? and(
                inArray(LabTestResultParameterModel.testId, allLabTestIds),
                notInArray(
                  LabTestResultParameterModel.id,
                  activeParameterIdList
                )
              )
            : inArray(LabTestResultParameterModel.testId, allLabTestIds)
        );
    }

    const activeTestIdList = Array.from(activeTestIds);

    await trx
      .update(LabUpdatedTestModel)
      .set({ status: 'inactive', updatedAt: now })
      .where(
        activeTestIdList.length > 0
          ? and(
              eq(LabUpdatedTestModel.labId, labId),
              notInArray(LabUpdatedTestModel.id, activeTestIdList)
            )
          : eq(LabUpdatedTestModel.labId, labId)
      );

    const activeDepartmentIdList = Array.from(activeDepartmentIds);

    await trx
      .update(LabUpdatedDepartmentModel)
      .set({ status: 'inactive', updatedAt: now })
      .where(
        activeDepartmentIdList.length > 0
          ? and(
              eq(LabUpdatedDepartmentModel.labId, labId),
              notInArray(LabUpdatedDepartmentModel.id, activeDepartmentIdList)
            )
          : eq(LabUpdatedDepartmentModel.labId, labId)
      );
  }

  static async applySuggestions(
    payload: ApplyLabUpdatedSuggestionsInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const now = new Date();
      const departmentCodes = new Set(
        (payload.departmentCodes ?? []).map((code) => normalizeCode(code))
      );
      const testCodes = new Set(
        (payload.testCodes ?? []).map((code) => normalizeCode(code))
      );
      const testPrices = new Map(
        Object.entries(payload.testPrices ?? {}).map(([code, price]) => [
          normalizeCode(code),
          price,
        ])
      );

      const createdDepartments: (typeof LabUpdatedDepartmentModel.$inferSelect)[] =
        [];
      const createdTests: (typeof LabUpdatedTestModel.$inferSelect)[] = [];
      const activeDepartmentIds = new Set<string>();
      const activeTestIds = new Set<string>();
      const activeParameterIds = new Set<string>();

      for (const department of suggestions.departments) {
        const selectedDepartment = departmentCodes.has(
          normalizeCode(department.code)
        );
        const selectedTests = (department.tests ?? []).filter(
          (test) =>
            selectedDepartment || testCodes.has(normalizeCode(test.testCode))
        );

        if (!selectedDepartment && selectedTests.length === 0) continue;

        const savedDepartment = await this.upsertSuggestedDepartment(
          trx,
          context.labId,
          department,
          now
        );
        createdDepartments.push(savedDepartment);
        activeDepartmentIds.add(savedDepartment.id);

        for (const test of selectedTests) {
          const savedTest = await this.upsertSuggestedTest(
            trx,
            context.labId,
            savedDepartment.id,
            {
              ...test,
              price: testPrices.get(normalizeCode(test.testCode)),
            },
            now
          );

          createdTests.push(savedTest);
          activeTestIds.add(savedTest.id);

          const selectedParameterIds = await this.getSelectedParameterIds(
            trx,
            savedTest.id,
            test.parameters
          );
          selectedParameterIds.forEach((parameterId) =>
            activeParameterIds.add(parameterId)
          );
        }
      }

      for (const department of payload.departments ?? []) {
        const savedDepartment = await this.upsertSuggestedDepartment(
          trx,
          context.labId,
          department,
          now
        );
        createdDepartments.push(savedDepartment);
        activeDepartmentIds.add(savedDepartment.id);
      }

      for (const test of payload.tests ?? []) {
        const departmentCode = test.departmentCode;
        const department = departmentCode
          ? suggestions.departments.find(
              (item) =>
                normalizeCode(item.code) === normalizeCode(departmentCode)
            )
          : undefined;
        const defaultTest = department?.tests?.find(
          (item) =>
            normalizeCode(item.testCode) === normalizeCode(test.testCode)
        );
        const savedDepartment = department
          ? await this.upsertSuggestedDepartment(
              trx,
              context.labId,
              department,
              now
            )
          : test.departmentId
            ? await ensureDepartment(trx, context.labId, test.departmentId)
            : undefined;

        if (!savedDepartment) {
          throw new HttpError(
            400,
            'departmentId or departmentCode is required'
          );
        }

        const [activeDepartment] = await trx
          .update(LabUpdatedDepartmentModel)
          .set({ status: 'active', updatedAt: now })
          .where(eq(LabUpdatedDepartmentModel.id, savedDepartment.id))
          .returning();

        activeDepartmentIds.add(activeDepartment.id);

        const savedTest = await this.upsertSuggestedTest(
          trx,
          context.labId,
          activeDepartment.id,
          {
            ...test,
            comments: test.comments ?? defaultTest?.comments,
            interpretation: test.interpretation ?? defaultTest?.interpretation,
            notes: test.notes ?? defaultTest?.notes,
          },
          now
        );
        createdTests.push(savedTest);
        activeTestIds.add(savedTest.id);

        const selectedParameterIds = await this.getSelectedParameterIds(
          trx,
          savedTest.id,
          test.parameters
        );
        selectedParameterIds.forEach((parameterId) =>
          activeParameterIds.add(parameterId)
        );
      }

      await this.syncInactiveItems(
        trx,
        context.labId,
        activeDepartmentIds,
        activeTestIds,
        activeParameterIds,
        now
      );

      return {
        departments: createdDepartments,
        tests: createdTests,
      };
    });
  }
}
