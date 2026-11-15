import { randomUUID } from 'crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  LabOrderModel,
  IndependentPatientModel,
} from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { APPOINTMENT_TEST_PAYMENT_STATUS } from '../../test/constants/appointmentTest.constants';
import { LabsModel, UserLabAssignmentsModel } from '../models/lab.model';
import {
  LabTestResultParameterModel,
  LabUpdatedTestModel,
  LabUpdatedTestPackageItemModel,
  LabUpdatedTestPackageModel,
  LabUpdatedResultModel,
  LabUpdatedHomeCollectionModel,
  LabUpdatedOrderHomeCollectionModel,
} from '../models/labUpdated.model';
import type { paymentStatusEnum } from '../models/labUpdated.model';
import { logLabOrderActivity } from '../utils/labUpdatedActivity';
import {
  labOrderPaymentColumns,
  getLabOrderPayment,
  getLabOrderPayments,
  insertLabOrderPayment,
  updateLabOrderPayment,
} from '../utils/labOrderPayment';
import {
  getLatestHomeCollectionPayments,
  insertHomeCollectionPayment,
  type HomeCollectionPaymentEntry,
} from '../utils/homeCollectionPayment';
import { LabMoneyService } from '../../money';
import type {
  AddWalkinLabOrderInput,
  BulkUploadLabOrderReportInput,
  DistributeLabOrderPaymentInput,
  GetLabOrdersQueryInput,
  HomeSampleInput,
  SaveLabUpdatedResultsInput,
  UpdateLabOrdersBulkInput,
  UpdateLabOrdersInput,
} from '../schemas/labOrder.schemas';
import { pageMeta, pagination } from './labCatalog.service';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

type LabOrderContext = {
  labId: string;
  userId: string;
  userRole: string;
};

const formatActivityValue = (value: string | null | undefined) =>
  value?.trim() || 'None';

const formatActivityStatus = (value: string | null | undefined) =>
  formatActivityValue(value)
    .toLowerCase()
    .replace(
      /(^|[_\s-])([a-z])/g,
      (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
    );

const formatPaymentMode = (value: string | null | undefined) =>
  value ? formatActivityStatus(value) : null;

type GetLabOrdersOptions = {
  excludeNotRequiredSampleStatus?: boolean;
  splitMixedWorkflowGroups?: boolean;
  searchField?: 'patientName' | 'patientMobile';
  includeLegacyPaymentFields?: boolean;
  /** Keeps a visit as one group even when some tests are off-bill (Rejected/On-Hold/No-Show/Test-Not-Available) — used by billing history so a rejected+refunded test stays visible instead of being split out and filtered away. */
  mergeOffBillStatuses?: boolean;
};

type LabScope = {
  id: string;
  clinicId: string;
  name: string;
  address: string;
  contactNo: string;
};

type WalkinOrderItem = {
  labUpdatedTestId: string;
  labUpdatedTestPackageId: string | null;
  packageName?: string | null;
  testName: string;
  testCode: string;
  sampleType: string;
  price: number;
};

/**
 * The home collection fee is flat and undiscounted, unlike the tests it's
 * charged alongside — pull it out of the submitted total before any
 * per-test split, so it never gets folded into (or double-counted on top
 * of) a test's own price.
 */
export const resolveTestPaymentTotal = (
  submittedPrice: number,
  homeCollectionPrice: number | null | undefined
) => Math.max(0, submittedPrice - (homeCollectionPrice ?? 0));

/**
 * The home fee has first claim on the submitted total, but only up to what
 * was actually sent — it must never record more as paid than the caller
 * actually submitted, even when that total falls short of the full fee.
 */
export const resolveHomeCollectionPaymentAmount = (
  submittedPrice: number,
  homeCollectionPrice: number
) => Math.min(submittedPrice, homeCollectionPrice);

/**
 * Splits a lump payment across items weighted by what each still owes — a
 * settled item (weight 0) gets nothing. Used only by distributeLabOrderPayment;
 * kept separate from allocateWalkinPaymentAmounts, whose creation-time rule
 * (split by catalog price, even fallback) stays untouched.
 */
const splitByRemainingDue = (amount: number, remainingDues: number[]) => {
  if (remainingDues.length === 0) return [];

  const totalWeight = remainingDues.reduce((total, due) => total + due, 0);
  if (totalWeight <= 0) return remainingDues.map(() => 0);

  const rawAmounts = remainingDues.map((due) => (amount * due) / totalWeight);
  const amounts = rawAmounts.map((value) => Math.floor(value));
  const remainder = amount - amounts.reduce((total, value) => total + value, 0);

  const remainderOrder = rawAmounts
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || right.index - left.index
    );

  for (let index = 0; index < remainder; index += 1) {
    amounts[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  return amounts;
};

const allocateWalkinPaymentAmounts = (
  items: WalkinOrderItem[],
  totalPayment: number,
  discountPercent: number
) => {
  if (items.length === 0) return [];

  const discountFactor = Math.max(0, 1 - discountPercent / 100);
  const weights = items.map((item) => Math.max(0, item.price * discountFactor));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const rawAmounts =
    totalWeight > 0
      ? weights.map((weight) => (totalPayment * weight) / totalWeight)
      : items.map(() => totalPayment / items.length);
  const amounts = rawAmounts.map((amount) => Math.floor(amount));
  const remainder =
    totalPayment - amounts.reduce((total, amount) => total + amount, 0);

  const remainderOrder = rawAmounts
    .map((amount, index) => ({
      index,
      fraction: amount - Math.floor(amount),
    }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || right.index - left.index
    );

  for (let index = 0; index < remainder; index += 1) {
    amounts[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  return amounts;
};

type LabOrderType = 'prescribed' | 'walkin_package' | 'walkin_test';

type LabOrderResponseRow = {
  labOrderId: string;
  labOrderGroupId: string | null;
  testId: string | null;
  labUpdatedTestId: string | null;
  labUpdatedTestPackageId: string | null;
  isIndependent: boolean;
  patientId: string | null;
  patientName: string | null;
  patientMob: string | null;
  patientAddress: string | null;
  patientCity: string | null;
  patientState: string | null;
  patientAge: number | null;
  patientGender: string | null;
  doctorId: string | null;
  referringDoctorName: string | null;
  prescribedTestName: string | null;
  labUpdatedTestName: string | null;
  labUpdatedTestCode: string | null;
  labUpdatedSampleType: string | null;
  labUpdatedTestPrice: number | null;
  packageName: string | null;
  packageCode: string | null;
  packagePrice: number | null;
  discountPercent: string;
  price: number | null;
  paymentType: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  reportStatus: string;
  paymentStatus: string;
  workflowStatus: string;
  sampleStatus: string | null;
  sampleCode: string | null;
  reportPdf: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

type MatchingLabUpdatedTest = {
  id: string;
  testName: string;
  testCode: string | null;
  price: number;
};

type LabOrderPaymentResponse = {
  id: string;
  labOrderId: string;
  price: number | null;
  paymentStatus: string;
  paymentType: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  /** Set on a refund. */
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type LabOrderTestResponse = {
  labOrderId: string;
  orderType: LabOrderType;
  version: number;
  prescribedTest?: {
    testName: string | null;
    matchingTestName: string | null;
    matchingTestId: string | null;
    matchingTestPrice: number | null;
  };
  assignedTest?: {
    id: string | null;
    testName: string | null;
    testCode: string | null;
    sampleType: string | null;
  };
  labUpdatedTestPackageId: string | null;
  packageName: string | null;
  packagePrice: number | null;
  reportStatus: string;
  isIndependent: boolean;
  discountPercent: number;
  listedPrice: number | null;
  paymentStatus: string;
  paymentType: string;
  paymentMode: string | null;
  price: number | null;
  paymentNotes: string | null;
  payments: LabOrderPaymentResponse[];
  refundedAmount: number;
  reportPdf: string | null;
  workflowStatus: string;
  sampleStatus: string | null;
  sampleCode: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

type LabOrderHomeSampleResponse = {
  id: string;
  rateId: string | null;
  homeCollectionPrice: number;
  distance: number | null;
  unit: 'm' | 'km' | null;
  labOrderIds: string[];
  paidAmount: number | null;
  paymentStatus: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  refundedAmount: number;
  payments: HomeCollectionPaymentEntry[];
  createdAt: Date;
  updatedAt: Date;
};

type LabOrderPackagePaymentResponse = {
  packageId: string;
  packageName: string | null;
  packagePrice: number;
  discountPercent: number;
  price: number;
  paymentStatus: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  reason: string | null;
  createdAt: Date;
};

type LabOrderGroupResponse = {
  labOrderGroupId: string | null;
  patientId: string | null;
  patientName: string | null;
  patientMob: string | null;
  patientMobile: string | null;
  patientAddress: string | null;
  patientCity: string | null;
  patientState: string | null;
  patientGender: string | null;
  patientAge: number | null;
  createdAt: string;
  referringDoctorName: string | null;
  orderType: LabOrderType;
  orderTypes: LabOrderType[];
  packageId: string | null;
  packageName: string | null;
  packageCode: string | null;
  packagePrice: number | null;
  totalPrice: number;
  totalPriceAfterDiscount?: number;
  remainingAmount?: number;
  refundedAmount: number;
  paymentStatus: string;
  paymentType: string;
  paymentMode: string | null;
  paymentNotes: string | null;
  packagePayments: LabOrderPackagePaymentResponse[];
  overallStatus: string;
  overallReportPdf?: string[] | null;
  tests: LabOrderTestResponse[];
  homeSamples: LabOrderHomeSampleResponse[];
};

const getDateKey = (date: Date | null | undefined) =>
  date ? date.toISOString().slice(0, 10) : 'no-date';

const getTimestampKey = (date: Date | null | undefined) =>
  date ? date.toISOString() : 'no-date-time';

const NOT_REQUIRED_SAMPLE_STATUS = 'not_required';

/** Tests left off the bill; same set the lab dashboard leaves out of revenue. */
const OFF_BILL_WORKFLOW_STATUSES = new Set([
  'ON_HOLD',
  'REJECTED',
  'NO_SHOW',
  'TEST_NOT_AVAILABLE',
]);

const omitLegacyPaymentFields = (value: Record<string, unknown>) => {
  const result = { ...value };
  delete result.price;
  delete result.paymentStatus;
  delete result.paymentType;
  delete result.paymentMode;
  delete result.paymentNotes;
  return result;
};

export class LabOrderService {
  private static async getLabScope(
    trx: DbTransaction,
    context: LabOrderContext
  ): Promise<LabScope> {
    const [lab] = await trx
      .select({
        id: LabsModel.id,
        clinicId: LabsModel.clinicId,
        name: LabsModel.name,
        address: LabsModel.address,
        contactNo: LabsModel.contactNo,
      })
      .from(LabsModel)
      .where(eq(LabsModel.id, context.labId))
      .limit(1);

    if (!lab) {
      throw new HttpError(404, 'Lab not found');
    }

    if (
      context.userRole !== 'Admin' &&
      context.userRole !== 'Super_Admin' &&
      context.userRole !== 'Receptionist'
    ) {
      const [assignment] = await trx
        .select({ id: UserLabAssignmentsModel.id })
        .from(UserLabAssignmentsModel)
        .where(
          and(
            eq(UserLabAssignmentsModel.labId, context.labId),
            eq(UserLabAssignmentsModel.userId, context.userId),
            eq(UserLabAssignmentsModel.clinicId, lab.clinicId)
          )
        )
        .limit(1);

      if (!assignment) {
        throw new HttpError(403, 'User is not assigned to this lab');
      }
    }

    return lab;
  }

  private static getLabOrderScopeCondition(lab: LabScope) {
    return or(
      eq(LabOrderModel.clinicId, lab.clinicId),
      eq(LabUpdatedTestModel.labId, lab.id),
      eq(LabUpdatedTestPackageModel.labId, lab.id)
    ) as SQL;
  }

  private static async resolveHomeCollectionRate(
    trx: DbTransaction,
    labId: string,
    homeSample: HomeSampleInput
  ) {
    const [rate] = await trx
      .select({
        id: LabUpdatedHomeCollectionModel.id,
        labId: LabUpdatedHomeCollectionModel.labId,
        fromRange: LabUpdatedHomeCollectionModel.fromRange,
        toRange: LabUpdatedHomeCollectionModel.toRange,
        unit: LabUpdatedHomeCollectionModel.unit,
        price: LabUpdatedHomeCollectionModel.price,
      })
      .from(LabUpdatedHomeCollectionModel)
      .where(
        and(
          eq(LabUpdatedHomeCollectionModel.id, homeSample.homeCollectionId),
          eq(LabUpdatedHomeCollectionModel.labId, labId),
          eq(LabUpdatedHomeCollectionModel.isActive, true)
        )
      )
      .limit(1);

    if (!rate) {
      throw new HttpError(
        404,
        'Home collection pricing not found or inactive for this lab'
      );
    }

    if (rate.unit !== homeSample.unit) {
      throw new HttpError(
        400,
        'Home collection distance unit does not match the selected pricing range'
      );
    }

    const fromRange = Number(rate.fromRange);
    const toRange = Number(rate.toRange);
    if (homeSample.distance < fromRange || homeSample.distance > toRange) {
      throw new HttpError(
        400,
        'Home collection distance is outside the selected pricing range'
      );
    }

    return rate;
  }

  private static async createOrderHomeCollection(
    trx: DbTransaction,
    patientId: string,
    labOrderIds: string[],
    homeSample: HomeSampleInput,
    rate: Awaited<ReturnType<typeof LabOrderService.resolveHomeCollectionRate>>,
    now: Date,
    payment?: {
      // The amount actually available for the home fee — never assume the
      // full rate was covered, so this can't record more as paid than what
      // was genuinely submitted.
      price: number;
      paymentStatus: (typeof paymentStatusEnum.enumValues)[number];
      paymentMode: string | null;
      paymentNotes: string | null;
      createdBy: string;
    }
  ) {
    const [homeCollection] = await trx
      .insert(LabUpdatedOrderHomeCollectionModel)
      .values({
        labId: rate.labId,
        patientId,
        homeCollectionPrice: rate.price,
        rateId: rate.id,
        distance: String(homeSample.distance),
        unit: homeSample.unit,
        labOrderIds,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: LabUpdatedOrderHomeCollectionModel.id });

    if (payment) {
      await insertHomeCollectionPayment(trx, {
        homeCollectionId: homeCollection.id,
        labId: rate.labId,
        patientId,
        createdBy: payment.createdBy,
        price: payment.price,
        paymentStatus: payment.paymentStatus,
        paymentMode: payment.paymentMode,
        paymentNotes: payment.paymentNotes,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private static async getAssignedLabOrderTests(
    trx: DbTransaction,
    lab: LabScope,
    labOrderIds: string[]
  ) {
    return await trx
      .select({
        labOrderId: LabOrderModel.id,
        labUpdatedTestId: LabOrderModel.labUpdatedTestId,
        testId: LabUpdatedTestModel.id,
        testName: LabUpdatedTestModel.testName,
        testCode: LabUpdatedTestModel.testCode,
      })
      .from(LabOrderModel)
      .innerJoin(
        LabUpdatedTestModel,
        eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
      )
      .where(
        and(
          inArray(LabOrderModel.id, labOrderIds),
          eq(LabUpdatedTestModel.labId, lab.id)
        )
      );
  }

  static async getLabOrderCounts(context: LabOrderContext) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const normalizedWorkflowStatus = sql`upper(coalesce(${LabOrderModel.workflowStatus}, ''))`;

      const [counts] = await trx
        .select({
          initiatedOrders: sql<number>`COUNT(DISTINCT ${LabOrderModel.id}) FILTER (WHERE ${normalizedWorkflowStatus} = 'INITIATED')::int`,
          processingOrders: sql<number>`COUNT(DISTINCT ${LabOrderModel.id}) FILTER (WHERE ${normalizedWorkflowStatus} NOT IN ('INITIATED', 'COMPLETED', 'ON_HOLD', 'REJECTED', 'NO_SHOW', 'TEST_NOT_AVAILABLE'))::int`,
          completedOrders: sql<number>`COUNT(DISTINCT ${LabOrderModel.id}) FILTER (WHERE ${normalizedWorkflowStatus} = 'COMPLETED')::int`,
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
            this.getLabOrderScopeCondition(lab),
            sql`lower(coalesce(${LabOrderModel.sampleStatus}, '')) <> ${NOT_REQUIRED_SAMPLE_STATUS}`
          )
        );

      const initiatedOrders = Number(counts?.initiatedOrders ?? 0);
      const processingOrders = Number(counts?.processingOrders ?? 0);
      const completedOrders = Number(counts?.completedOrders ?? 0);

      return {
        initiatedOrders,
        processingOrders,
        completedOrders,
        totalOrders: initiatedOrders + processingOrders + completedOrders,
      };
    });
  }

  static async getLabOrderParameters(
    context: LabOrderContext,
    labOrderIds: string[]
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const uniqueLabOrderIds = Array.from(new Set(labOrderIds));
      const orders = await this.getAssignedLabOrderTests(
        trx,
        lab,
        uniqueLabOrderIds
      );

      if (orders.length !== uniqueLabOrderIds.length) {
        const foundOrderIds = new Set(orders.map((order) => order.labOrderId));
        const missingOrderIds = uniqueLabOrderIds.filter(
          (labOrderId) => !foundOrderIds.has(labOrderId)
        );

        throw new HttpError(
          404,
          `Lab order not found or has no assigned lab test: ${missingOrderIds.join(', ')}`
        );
      }

      const testIds = orders.map((order) => order.testId);
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
          resultValue: LabUpdatedResultModel.resultValue,
        })
        .from(LabTestResultParameterModel)
        .leftJoin(
          LabUpdatedResultModel,
          and(
            eq(
              LabUpdatedResultModel.parameterId,
              LabTestResultParameterModel.id
            ),
            inArray(LabUpdatedResultModel.labOrderId, uniqueLabOrderIds)
          )
        )
        .where(
          and(
            inArray(LabTestResultParameterModel.testId, testIds),
            eq(LabTestResultParameterModel.isActive, true)
          )
        );

      const parametersByTestId = new Map<string, typeof parameters>();
      for (const parameter of parameters) {
        const testParameters = parametersByTestId.get(parameter.testId) ?? [];
        testParameters.push(parameter);
        parametersByTestId.set(parameter.testId, testParameters);
      }

      return uniqueLabOrderIds.map((labOrderId) => {
        const order = orders.find((item) => item.labOrderId === labOrderId)!;

        return {
          labOrderId: order.labOrderId,
          labUpdatedTestId: order.labUpdatedTestId,
          test: {
            id: order.testId,
            testName: order.testName,
            testCode: order.testCode,
          },
          parameters: parametersByTestId.get(order.testId) ?? [],
        };
      });
    });
  }

  static async saveLabUpdatedResults(
    context: LabOrderContext,
    payload: SaveLabUpdatedResultsInput
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const labOrderIds = payload.orderResults.map(
        (orderResult) => orderResult.labOrderId
      );
      const uniqueLabOrderIds = Array.from(new Set(labOrderIds));

      if (uniqueLabOrderIds.length !== labOrderIds.length) {
        throw new HttpError(400, 'Duplicate lab order ids are not allowed');
      }

      const orders = await this.getAssignedLabOrderTests(
        trx,
        lab,
        uniqueLabOrderIds
      );
      if (orders.length !== uniqueLabOrderIds.length) {
        const foundOrderIds = new Set(orders.map((order) => order.labOrderId));
        const missingOrderIds = uniqueLabOrderIds.filter(
          (labOrderId) => !foundOrderIds.has(labOrderId)
        );
        throw new HttpError(
          404,
          `Lab order not found or has no assigned lab test: ${missingOrderIds.join(', ')}`
        );
      }

      const testIds = orders.map((order) => order.testId);
      const activeParameters = await trx
        .select({
          id: LabTestResultParameterModel.id,
          testId: LabTestResultParameterModel.testId,
          isRequired: LabTestResultParameterModel.isRequired,
        })
        .from(LabTestResultParameterModel)
        .where(
          and(
            inArray(LabTestResultParameterModel.testId, testIds),
            eq(LabTestResultParameterModel.isActive, true)
          )
        );
      const parametersByTestId = new Map<string, typeof activeParameters>();
      for (const parameter of activeParameters) {
        const testParameters = parametersByTestId.get(parameter.testId) ?? [];
        testParameters.push(parameter);
        parametersByTestId.set(parameter.testId, testParameters);
      }

      const existingResults = await trx
        .select({
          labOrderId: LabUpdatedResultModel.labOrderId,
          parameterId: LabUpdatedResultModel.parameterId,
          resultValue: LabUpdatedResultModel.resultValue,
        })
        .from(LabUpdatedResultModel)
        .where(inArray(LabUpdatedResultModel.labOrderId, uniqueLabOrderIds));
      const existingValueByKey = new Map(
        existingResults.map((result) => [
          `${result.labOrderId}:${result.parameterId}`,
          result.resultValue,
        ])
      );

      const now = new Date();
      const completedOrderIds: string[] = [];
      const savedResults: (typeof LabUpdatedResultModel.$inferSelect)[] = [];

      for (const orderResult of payload.orderResults) {
        const order = orders.find(
          (item) => item.labOrderId === orderResult.labOrderId
        )!;
        const allowedParameters = parametersByTestId.get(order.testId) ?? [];
        const allowedParameterById = new Map(
          allowedParameters.map((parameter) => [parameter.id, parameter])
        );
        const resultParameterIds = orderResult.results.map(
          (result) => result.parameterId
        );

        if (new Set(resultParameterIds).size !== resultParameterIds.length) {
          throw new HttpError(
            400,
            `Duplicate parameter ids are not allowed for lab order ${orderResult.labOrderId}`
          );
        }

        for (const result of orderResult.results) {
          if (!allowedParameterById.has(result.parameterId)) {
            throw new HttpError(
              400,
              `Parameter ${result.parameterId} is not active or does not belong to lab order ${orderResult.labOrderId}`
            );
          }

          const savedResult = await trx
            .insert(LabUpdatedResultModel)
            .values({
              labOrderId: orderResult.labOrderId,
              parameterId: result.parameterId,
              resultValue: result.resultValue,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                LabUpdatedResultModel.labOrderId,
                LabUpdatedResultModel.parameterId,
              ],
              set: {
                resultValue: result.resultValue,
                updatedAt: now,
              },
            })
            .returning();

          savedResults.push(savedResult[0]);
          existingValueByKey.set(
            `${orderResult.labOrderId}:${result.parameterId}`,
            result.resultValue
          );
        }

        const missingRequiredParameter = allowedParameters.some(
          (parameter) =>
            parameter.isRequired &&
            !String(
              existingValueByKey.get(
                `${orderResult.labOrderId}:${parameter.id}`
              ) ?? ''
            ).trim()
        );

        if (!missingRequiredParameter) {
          completedOrderIds.push(orderResult.labOrderId);
        }
      }

      if (completedOrderIds.length > 0) {
        await trx
          .update(LabOrderModel)
          .set({
            reportStatus: 'Completed',
            workflowStatus: 'COMPLETED',
            sampleStatus: 'COMPLETED',
            updatedAt: now,
          })
          .where(inArray(LabOrderModel.id, completedOrderIds));
      }

      return {
        orders: payload.orderResults.map((orderResult) => ({
          labOrderId: orderResult.labOrderId,
          completed: completedOrderIds.includes(orderResult.labOrderId),
        })),
        savedResults,
      };
    });
  }

  private static async getOrCreateWalkinPatient(
    trx: DbTransaction,
    payload: AddWalkinLabOrderInput,
    now = new Date()
  ) {
    const mobile = payload.mobile.trim();
    const [existingPatient] = await trx
      .select({
        id: UserModel.id,
        name: UserModel.name,
        mobile: UserModel.mobile,
        userStatus: UserModel.userStatus,
      })
      .from(UserModel)
      .where(
        and(eq(UserModel.userType, 'Patient'), eq(UserModel.mobile, mobile))
      )
      .limit(1);

    if (existingPatient) {
      await trx
        .insert(UserProfileModel)
        .values({
          userId: existingPatient.id,
          gender: payload.gender,
          age: payload.age,
          address: payload.address ?? null,
          city: payload.city ?? null,
          state: payload.state ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [UserProfileModel.userId],
          set: {
            gender: payload.gender,
            age: payload.age,
            ...(payload.address !== undefined
              ? { address: payload.address }
              : {}),
            ...(payload.city !== undefined ? { city: payload.city } : {}),
            ...(payload.state !== undefined ? { state: payload.state } : {}),
            updatedAt: now,
          },
        });

      const [profile] = await trx
        .select({
          address: UserProfileModel.address,
          city: UserProfileModel.city,
          state: UserProfileModel.state,
        })
        .from(UserProfileModel)
        .where(eq(UserProfileModel.userId, existingPatient.id))
        .limit(1);

      return {
        id: existingPatient.id,
        name: existingPatient.name ?? payload.name,
        mobile: existingPatient.mobile,
        gender: payload.gender,
        age: payload.age,
        address: profile?.address ?? null,
        city: profile?.city ?? null,
        state: profile?.state ?? null,
        userStatus: existingPatient.userStatus,
        isNew: false,
      };
    }

    const [createdPatient] = await trx
      .insert(UserModel)
      .values({
        name: payload.name,
        mobile,
        userType: 'Patient',
        userStatus: 'New',
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: UserModel.id,
        name: UserModel.name,
        mobile: UserModel.mobile,
        userStatus: UserModel.userStatus,
      });

    if (!createdPatient) {
      throw new HttpError(409, 'Unable to create walk-in patient');
    }

    await trx.insert(UserProfileModel).values({
      userId: createdPatient.id,
      gender: payload.gender,
      age: payload.age,
      address: payload.address ?? null,
      city: payload.city ?? null,
      state: payload.state ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: createdPatient.id,
      name: createdPatient.name,
      mobile: createdPatient.mobile,
      gender: payload.gender,
      age: payload.age,
      address: payload.address ?? null,
      city: payload.city ?? null,
      state: payload.state ?? null,
      userStatus: createdPatient.userStatus,
      isNew: true,
    };
  }

  private static async resolveWalkinOrderItems(
    trx: DbTransaction,
    labId: string,
    payload: AddWalkinLabOrderInput
  ): Promise<WalkinOrderItem[]> {
    const directTestIds = payload.labUpdatedTestIds;
    const packageIds = payload.labUpdatedTestPackageIds;
    const items: WalkinOrderItem[] = [];

    if (directTestIds.length > 0) {
      const directTests = await trx
        .select({
          id: LabUpdatedTestModel.id,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
          sampleType: LabUpdatedTestModel.sampleType,
          price: LabUpdatedTestModel.price,
        })
        .from(LabUpdatedTestModel)
        .where(
          and(
            eq(LabUpdatedTestModel.labId, labId),
            eq(LabUpdatedTestModel.status, 'active'),
            inArray(LabUpdatedTestModel.id, directTestIds)
          )
        );

      const foundTestIds = new Set(directTests.map((test) => test.id));
      const missingTestIds = directTestIds.filter(
        (id) => !foundTestIds.has(id)
      );

      if (missingTestIds.length > 0) {
        throw new HttpError(
          404,
          `Lab updated tests not found or inactive: ${missingTestIds.join(', ')}`
        );
      }

      items.push(
        ...directTests.map((test) => ({
          labUpdatedTestId: test.id,
          labUpdatedTestPackageId: null,
          testName: test.testName,
          testCode: test.testCode,
          sampleType: test.sampleType,
          price: test.price,
        }))
      );
    }

    if (packageIds.length > 0) {
      const packages = await trx
        .select({
          id: LabUpdatedTestPackageModel.id,
          packageName: LabUpdatedTestPackageModel.packageName,
        })
        .from(LabUpdatedTestPackageModel)
        .where(
          and(
            eq(LabUpdatedTestPackageModel.labId, labId),
            sql`lower(${LabUpdatedTestPackageModel.status}) = 'active'`,
            inArray(LabUpdatedTestPackageModel.id, packageIds)
          )
        );

      const foundPackageIds = new Set(packages.map((pack) => pack.id));
      const missingPackageIds = packageIds.filter(
        (id) => !foundPackageIds.has(id)
      );

      if (missingPackageIds.length > 0) {
        throw new HttpError(
          404,
          `Lab updated test packages not found or inactive: ${missingPackageIds.join(', ')}`
        );
      }

      const packageNameById = new Map(
        packages.map((pack) => [pack.id, pack.packageName])
      );

      const packageTests = await trx
        .select({
          packageId: LabUpdatedTestPackageItemModel.packageId,
          testId: LabUpdatedTestModel.id,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
          sampleType: LabUpdatedTestModel.sampleType,
          price: LabUpdatedTestModel.price,
        })
        .from(LabUpdatedTestPackageItemModel)
        .innerJoin(
          LabUpdatedTestModel,
          eq(LabUpdatedTestPackageItemModel.labTestId, LabUpdatedTestModel.id)
        )
        .where(
          and(
            inArray(LabUpdatedTestPackageItemModel.packageId, packageIds),
            eq(LabUpdatedTestModel.labId, labId),
            eq(LabUpdatedTestModel.status, 'active')
          )
        );

      const packageIdsWithTests = new Set(
        packageTests.map((test) => test.packageId)
      );
      const emptyPackageIds = packageIds.filter(
        (id) => !packageIdsWithTests.has(id)
      );

      if (emptyPackageIds.length > 0) {
        throw new HttpError(
          400,
          `No active tests found in packages: ${emptyPackageIds.join(', ')}`
        );
      }

      items.push(
        ...packageTests.map((test) => ({
          labUpdatedTestId: test.testId,
          labUpdatedTestPackageId: test.packageId,
          packageName: packageNameById.get(test.packageId) ?? null,
          testName: test.testName,
          testCode: test.testCode,
          sampleType: test.sampleType,
          price: test.price,
        }))
      );
    }

    if (items.length === 0) {
      throw new HttpError(400, 'At least one test is required');
    }

    return items;
  }

  static async addWalkinLabOrder(
    context: LabOrderContext,
    payload: AddWalkinLabOrderInput
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const now = new Date();
      const orderCreatedAt = payload.createdAt ?? now;
      const patient = await this.getOrCreateWalkinPatient(trx, payload, now);
      const labOrderGroupId = payload.labOrderGroupId
        ? await this.getPatientLabOrderGroupId(
            trx,
            lab,
            payload.labOrderGroupId,
            patient.id
          )
        : randomUUID();
      const orderItems = await this.resolveWalkinOrderItems(
        trx,
        lab.id,
        payload
      );
      const homeCollectionRate = payload.homeSample
        ? await this.resolveHomeCollectionRate(trx, lab.id, payload.homeSample)
        : null;
      const hasPayment = payload.price !== undefined;
      // The submitted price can include the home collection fee (a flat,
      // undiscounted charge) alongside the tests — split only the test
      // portion among the tests, so the fee isn't double-counted later in
      // totalPrice (test payments + homeSamples) or folded into any test's
      // own price.
      const testPaymentTotal = hasPayment
        ? resolveTestPaymentTotal(payload.price!, homeCollectionRate?.price)
        : undefined;
      const packageIds = new Set(
        orderItems
          .map((item) => item.labUpdatedTestPackageId)
          .filter((packageId): packageId is string => packageId !== null)
      );
      const [singlePackageId] = Array.from(packageIds);
      const allDirectWalkinTests = orderItems.every(
        (item) => item.labUpdatedTestPackageId === null
      );
      const allTestsFromSinglePackage =
        singlePackageId !== undefined &&
        orderItems.every(
          (item) => item.labUpdatedTestPackageId === singlePackageId
        );
      const shouldAllocatePayment =
        orderItems.length > 1 &&
        (allDirectWalkinTests || allTestsFromSinglePackage);
      const paymentAmounts =
        hasPayment && shouldAllocatePayment
          ? allocateWalkinPaymentAmounts(
              orderItems,
              testPaymentTotal!,
              payload.discountPercent ?? 0
            )
          : hasPayment
            ? orderItems.map(() => testPaymentTotal!)
            : [];

      const createdOrders = [];
      const packageActivityOrders = new Map<
        string,
        { labOrderId: string; packageName: string | null }
      >();

      for (const [itemIndex, item] of orderItems.entries()) {
        const [createdOrder] = await trx
          .insert(LabOrderModel)
          .values({
            appointmentId: null,
            testId: null,
            labUpdatedTestId: item.labUpdatedTestId,
            labUpdatedTestPackageId: item.labUpdatedTestPackageId,
            labOrderGroupId,
            isIndependent: true,
            independentPatientId: null,
            patientId: patient.id,
            doctorId: null,
            referringDoctorName: payload.referringDoctorName ?? null,
            clinicId: null,
            reportStatus: 'Initiated',
            reportPdf: null,
            discountPercent: payload.discountPercent?.toString() ?? '0',
            createdAt: orderCreatedAt,
            updatedAt: now,
          })
          .returning();

        const [payment] = hasPayment
          ? await insertLabOrderPayment(trx, {
              labOrderId: createdOrder.id,
              labId: lab.id,
              createdBy: context.userId,
              patientId: patient.id,
              price: paymentAmounts[itemIndex],
              paymentStatus: payload.paymentStatus,
              paymentMode: payload.paymentMode ?? null,
              paymentNotes: payload.paymentNotes ?? null,
              createdAt: orderCreatedAt,
              updatedAt: now,
            })
          : [];

        if (
          item.labUpdatedTestPackageId &&
          !packageActivityOrders.has(item.labUpdatedTestPackageId)
        ) {
          packageActivityOrders.set(item.labUpdatedTestPackageId, {
            labOrderId: createdOrder.id,
            packageName: item.packageName ?? null,
          });
        }

        if (!item.labUpdatedTestPackageId) {
          await logLabOrderActivity(trx, {
            labId: lab.id,
            labOrderId: createdOrder.id,
            activity: `Test Ordered - ${item.testName}`,
            performedBy: context.userId,
            createdAt: orderCreatedAt,
          });
        }

        createdOrders.push({
          ...createdOrder,
          price: payment?.price ?? null,
          paymentStatus: payment?.paymentStatus ?? null,
          paymentMode: payment?.paymentMode ?? null,
          paymentNotes: payment?.paymentNotes ?? null,
          test: {
            id: item.labUpdatedTestId,
            name: item.testName,
            code: item.testCode,
            sampleType: item.sampleType,
            price: item.price,
          },
          packageId: item.labUpdatedTestPackageId,
        });
      }

      for (const [packageId, packageActivity] of packageActivityOrders) {
        await logLabOrderActivity(trx, {
          labId: lab.id,
          labOrderId: packageActivity.labOrderId,
          activity: `Package Ordered - ${packageActivity.packageName ?? packageId}`,
          performedBy: context.userId,
          createdAt: orderCreatedAt,
        });
      }

      if (payload.homeSample && homeCollectionRate) {
        await this.createOrderHomeCollection(
          trx,
          patient.id,
          createdOrders.map((order) => order.id),
          payload.homeSample,
          homeCollectionRate,
          orderCreatedAt,
          // Same payment the tests in this call were charged under — a
          // dedicated home-fee payment status is a separate ask, not this one.
          hasPayment
            ? {
                price: resolveHomeCollectionPaymentAmount(
                  payload.price!,
                  homeCollectionRate.price
                ),
                paymentStatus: payload.paymentStatus,
                paymentMode: payload.paymentMode ?? null,
                paymentNotes: payload.paymentNotes ?? null,
                createdBy: context.userId,
              }
            : undefined
        );
      }

      return {
        lab: {
          id: lab.id,
          name: lab.name,
          clinicId: lab.clinicId,
        },
        patient,
        labOrderGroupId,
        count: createdOrders.length,
        orders: createdOrders,
      };
    });
  }

  private static async getPatientLabOrderGroupId(
    trx: DbTransaction,
    lab: LabScope,
    labOrderGroupId: string,
    patientId: string
  ) {
    const [groupOrder] = await trx
      .select({ patientId: LabOrderModel.patientId })
      .from(LabOrderModel)
      .leftJoin(
        LabUpdatedTestModel,
        eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
      )
      .leftJoin(
        LabUpdatedTestPackageModel,
        eq(LabOrderModel.labUpdatedTestPackageId, LabUpdatedTestPackageModel.id)
      )
      .where(
        and(
          eq(LabOrderModel.labOrderGroupId, labOrderGroupId),
          this.getLabOrderScopeCondition(lab)
        )
      )
      .limit(1);

    if (!groupOrder) {
      throw new HttpError(404, 'Lab order group not found');
    }

    if (groupOrder.patientId !== patientId) {
      throw new HttpError(
        400,
        'Lab order group belongs to a different patient'
      );
    }

    return labOrderGroupId;
  }

  private static buildLabOrderUpdateSet(
    updates: UpdateLabOrdersBulkInput['orders'][number]['updates']
  ): Partial<typeof LabOrderModel.$inferInsert> {
    const updateSet: Partial<typeof LabOrderModel.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (updates.labUpdatedTestId !== undefined) {
      updateSet.labUpdatedTestId = updates.labUpdatedTestId;
    }
    if (updates.reportStatus !== undefined) {
      updateSet.reportStatus = updates.reportStatus;
    }
    if (updates.workflowStatus !== undefined) {
      updateSet.workflowStatus = updates.workflowStatus;
    }
    if (updates.sampleStatus !== undefined) {
      updateSet.sampleStatus = updates.sampleStatus;
    }
    if (updates.sampleCode !== undefined) {
      updateSet.sampleCode = updates.sampleCode;
    }
    if (updates.discountPercent !== undefined) {
      updateSet.discountPercent = updates.discountPercent.toString();
    }

    return updateSet;
  }

  static async updateLabOrders(
    context: LabOrderContext,
    rawPayload: UpdateLabOrdersInput
  ) {
    if ('distribute' in rawPayload) {
      return this.distributeLabOrderPayment(context, rawPayload.distribute);
    }

    // The distribute branch returned above; TS's `in`-narrowing doesn't
    // carry through the schema's transform-inferred type, so the remaining
    // shape (always `orders` by this point) is asserted explicitly.
    const payload = rawPayload as UpdateLabOrdersBulkInput;

    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const orderIds = payload.orders.map((order) => order.labOrderId);
      const uniqueOrderIds = Array.from(new Set(orderIds));

      if (uniqueOrderIds.length !== orderIds.length) {
        throw new HttpError(400, 'Duplicate lab order ids are not allowed');
      }

      const scopedOrders = await trx
        .select({
          id: LabOrderModel.id,
          patientId: LabOrderModel.patientId,
          reportStatus: LabOrderModel.reportStatus,
          workflowStatus: LabOrderModel.workflowStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          sampleCode: LabOrderModel.sampleCode,
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
            inArray(LabOrderModel.id, uniqueOrderIds),
            this.getLabOrderScopeCondition(lab)
          )
        );

      const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
      const scopedOrderPatientIds = new Map(
        scopedOrders.map((order) => [order.id, order.patientId])
      );
      const scopedOrderStates = new Map(
        scopedOrders.map((order) => [order.id, order])
      );
      const missingOrderIds = uniqueOrderIds.filter(
        (orderId) => !scopedOrderIds.has(orderId)
      );

      if (missingOrderIds.length > 0) {
        throw new HttpError(
          404,
          `Lab orders not found for this lab: ${missingOrderIds.join(', ')}`
        );
      }

      const nextLabUpdatedTestIds = Array.from(
        new Set(
          payload.orders
            .map((order) => order.updates.labUpdatedTestId)
            .filter((id): id is string => typeof id === 'string')
        )
      );

      if (nextLabUpdatedTestIds.length > 0) {
        const validTests = await trx
          .select({ id: LabUpdatedTestModel.id })
          .from(LabUpdatedTestModel)
          .where(
            and(
              eq(LabUpdatedTestModel.labId, lab.id),
              eq(LabUpdatedTestModel.status, 'active'),
              inArray(LabUpdatedTestModel.id, nextLabUpdatedTestIds)
            )
          );

        const validTestIds = new Set(validTests.map((test) => test.id));
        const missingTestIds = nextLabUpdatedTestIds.filter(
          (testId) => !validTestIds.has(testId)
        );

        if (missingTestIds.length > 0) {
          throw new HttpError(
            404,
            `Lab updated tests not found or inactive: ${missingTestIds.join(', ')}`
          );
        }
      }

      const updatedOrders = [];
      const refundedHomeCollectionIds = new Set<string>();
      const paidHomeCollectionIds = new Set<string>();

      for (const order of payload.orders) {
        const previousOrder = scopedOrderStates.get(order.labOrderId);
        const previousPayment = await getLabOrderPayment(trx, order.labOrderId);
        const [updatedOrder] = await trx
          .update(LabOrderModel)
          .set(this.buildLabOrderUpdateSet(order.updates))
          .where(eq(LabOrderModel.id, order.labOrderId))
          .returning();

        if (updatedOrder) {
          const updates = order.updates;
          let payment = previousPayment;
          if (
            updates.paymentStatus !== undefined ||
            updates.price !== undefined ||
            updates.paymentMode !== undefined ||
            updates.paymentNotes !== undefined
          ) {
            if (updates.price !== undefined) {
              [payment] = await insertLabOrderPayment(trx, {
                labOrderId: order.labOrderId,
                labId: lab.id,
                createdBy: context.userId,
                patientId: scopedOrderPatientIds.get(order.labOrderId) ?? null,
                price: updates.price,
                paymentStatus:
                  updates.paymentStatus ??
                  previousPayment?.paymentStatus ??
                  APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
                paymentMode:
                  updates.paymentMode !== undefined
                    ? updates.paymentMode
                    : (previousPayment?.paymentMode ?? null),
                paymentNotes:
                  updates.paymentNotes !== undefined
                    ? updates.paymentNotes
                    : (previousPayment?.paymentNotes ?? null),
              });
            } else if (previousPayment) {
              [payment] = await updateLabOrderPayment(trx, previousPayment.id, {
                labId: lab.id,
                ...(updates.paymentStatus !== undefined
                  ? { paymentStatus: updates.paymentStatus }
                  : {}),
                ...(updates.paymentMode !== undefined
                  ? { paymentMode: updates.paymentMode }
                  : {}),
                ...(updates.paymentNotes !== undefined
                  ? { paymentNotes: updates.paymentNotes }
                  : {}),
              });
            } else {
              [payment] = await insertLabOrderPayment(trx, {
                labOrderId: order.labOrderId,
                labId: lab.id,
                createdBy: context.userId,
                patientId: scopedOrderPatientIds.get(order.labOrderId) ?? null,
                price: 0,
                paymentStatus:
                  updates.paymentStatus ??
                  APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
                paymentMode: updates.paymentMode ?? null,
                paymentNotes: updates.paymentNotes ?? null,
              });
            }
          }
          const refund = updates.refund
            ? await this.refundLabOrder(trx, {
                lab,
                labOrderId: order.labOrderId,
                patientId: scopedOrderPatientIds.get(order.labOrderId) ?? null,
                refund: updates.refund,
                createdBy: context.userId,
                refundedHomeCollectionIds,
              })
            : null;
          const homeSamplePayment = updates.homeSamplePayment
            ? await this.payLabOrderHomeSample(trx, {
                lab,
                labOrderId: order.labOrderId,
                payment: updates.homeSamplePayment,
                createdBy: context.userId,
                paidHomeCollectionIds,
              })
            : null;
          updatedOrders.push({
            ...updatedOrder,
            price: payment?.price ?? null,
            paymentStatus:
              payment?.paymentStatus ?? APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
            paymentMode: payment?.paymentMode ?? null,
            paymentNotes: payment?.paymentNotes ?? null,
            ...(refund ? { refund } : {}),
            ...(homeSamplePayment ? { homeSamplePayment } : {}),
          });

          const activities: string[] = [];
          const sampleCodeChanged =
            updates.sampleCode !== undefined &&
            previousOrder?.sampleCode !== updatedOrder.sampleCode;
          const sampleStatusChanged =
            updates.sampleStatus !== undefined &&
            previousOrder?.sampleStatus !== updatedOrder.sampleStatus;

          const recollectionActivity =
            updates.sampleCode && updates.recollectedReason
              ? `Sample Re-collected - ${updatedOrder.sampleCode}, because ${updates.recollectedReason}`
              : null;

          if (recollectionActivity) {
            activities.push(recollectionActivity);
          } else if (sampleCodeChanged) {
            activities.push(
              updatedOrder.sampleCode
                ? `Sample Collected - ${updatedOrder.sampleCode}`
                : 'Sample Code Removed'
            );
          } else if (
            sampleStatusChanged &&
            String(updatedOrder.sampleStatus ?? '').toUpperCase() ===
              'COLLECTED'
          ) {
            activities.push('Sample Collected');
          } else if (sampleStatusChanged) {
            activities.push(
              `Sample Status Changed to ${formatActivityStatus(
                updatedOrder.sampleStatus
              )}`
            );
          }

          if (
            updates.workflowStatus !== undefined &&
            previousOrder?.workflowStatus !== updatedOrder.workflowStatus
          ) {
            if (
              String(updatedOrder.workflowStatus).toUpperCase() === 'INITIATED'
            ) {
              activities.push('Test Initiated');
            } else {
              activities.push(
                `Moved from ${formatActivityStatus(
                  previousOrder?.workflowStatus
                )} to ${formatActivityStatus(updatedOrder.workflowStatus)}`
              );
            }
          }

          if (
            updates.reportStatus !== undefined &&
            previousOrder?.reportStatus !== updatedOrder.reportStatus
          ) {
            activities.push(
              `Report Status Changed to ${formatActivityStatus(
                updatedOrder.reportStatus
              )}`
            );
          }

          const previousPaymentStatus =
            previousPayment?.paymentStatus ??
            APPOINTMENT_TEST_PAYMENT_STATUS.PENDING;
          const updatedPaymentStatus =
            payment?.paymentStatus ?? APPOINTMENT_TEST_PAYMENT_STATUS.PENDING;
          const paymentStatusChanged =
            updates.paymentStatus !== undefined &&
            previousPaymentStatus !== updatedPaymentStatus;
          const paymentAmountChanged =
            updates.price !== undefined &&
            previousPayment?.price !== payment?.price;
          const paymentModeChanged =
            updates.paymentMode !== undefined &&
            previousPayment?.paymentMode !== payment?.paymentMode;

          if (paymentStatusChanged) {
            if (updatedPaymentStatus === APPOINTMENT_TEST_PAYMENT_STATUS.PAID) {
              const amount = payment?.price ?? 0;
              const mode = formatPaymentMode(payment?.paymentMode);
              activities.push(
                `Payment Received - ₹${amount}${mode ? ` via ${mode}` : ''}`
              );
            } else {
              activities.push(
                `Payment Status Changed to ${formatActivityStatus(
                  updatedPaymentStatus
                )}`
              );
            }
          } else if (paymentAmountChanged) {
            activities.push(`Payment Amount Updated - ₹${payment?.price ?? 0}`);
          }

          if (paymentModeChanged && !paymentStatusChanged) {
            activities.push(
              `Payment Mode Changed to ${formatPaymentMode(payment?.paymentMode) ?? 'None'}`
            );
          }

          if (updates.paymentNotes !== undefined) {
            const previousNotes = previousPayment?.paymentNotes ?? null;
            const updatedNotes = payment?.paymentNotes ?? null;
            if (previousNotes !== updatedNotes) {
              activities.push('Payment Notes Updated');
            }
          }

          if (refund) {
            const mode = formatPaymentMode(updates.refund?.paymentMode);
            activities.push(
              `Refund Issued - ₹${refund.amount}${mode ? ` via ${mode}` : ''}`
            );
          }

          if (homeSamplePayment) {
            const mode = formatPaymentMode(
              updates.homeSamplePayment?.paymentMode
            );
            activities.push(
              `Home Sample Payment Recorded - ₹${homeSamplePayment.amount}${mode ? ` via ${mode}` : ''}`
            );
          }

          if (activities.length > 0) {
            await logLabOrderActivity(trx, {
              labId: lab.id,
              labOrderId: order.labOrderId,
              activity: activities.join(' and '),
              performedBy: context.userId,
            });
          }
        }
      }

      const homeCollectionGroups = new Map<
        string,
        { homeSample: HomeSampleInput; labOrderIds: string[] }
      >();

      for (const order of payload.orders) {
        const homeSample = order.updates.homeSample;
        if (!homeSample) continue;

        const groupKey = [
          homeSample.homeCollectionId,
          homeSample.distance,
          homeSample.unit,
        ].join(':');
        const group = homeCollectionGroups.get(groupKey);

        if (group) {
          group.labOrderIds.push(order.labOrderId);
        } else {
          homeCollectionGroups.set(groupKey, {
            homeSample,
            labOrderIds: [order.labOrderId],
          });
        }
      }

      for (const group of homeCollectionGroups.values()) {
        const patientIds = new Set(
          group.labOrderIds.map((labOrderId) =>
            scopedOrderPatientIds.get(labOrderId)
          )
        );

        if (patientIds.size !== 1 || patientIds.has(null)) {
          throw new HttpError(
            400,
            'Home collection can only be added for lab orders belonging to one patient'
          );
        }

        const patientId = Array.from(patientIds)[0];
        if (!patientId) {
          throw new HttpError(
            400,
            'Home collection requires lab orders with a patient'
          );
        }

        const rate = await this.resolveHomeCollectionRate(
          trx,
          lab.id,
          group.homeSample
        );
        await this.createOrderHomeCollection(
          trx,
          patientId,
          group.labOrderIds,
          group.homeSample,
          rate,
          new Date()
        );
      }

      return {
        count: updatedOrders.length,
        orders: updatedOrders,
      };
    });
  }

  /** Refunds a test, and its home fee when asked: the test first, then the fee. */
  private static async refundLabOrder(
    trx: DbTransaction,
    input: {
      lab: LabScope;
      labOrderId: string;
      patientId: string | null;
      refund: NonNullable<
        UpdateLabOrdersBulkInput['orders'][number]['updates']['refund']
      >;
      createdBy: string;
      /** Home fees already refunded in this request; one is refunded only once. */
      refundedHomeCollectionIds: Set<string>;
    }
  ) {
    const { lab, labOrderId, refund } = input;
    await LabMoneyService.lock(trx, 'lab_test', labOrderId);
    const testRefundable = await LabMoneyService.refundable(
      trx,
      'lab_test',
      labOrderId
    );

    let homeCollectionId: string | null = null;
    let homeRefundable = 0;
    if (refund.refundHomeSample) {
      const [homeCollection] = await trx
        .select({ id: LabUpdatedOrderHomeCollectionModel.id })
        .from(LabUpdatedOrderHomeCollectionModel)
        .where(
          and(
            eq(LabUpdatedOrderHomeCollectionModel.labId, lab.id),
            sql`${labOrderId}::uuid = ANY(${LabUpdatedOrderHomeCollectionModel.labOrderIds})`
          )
        )
        .orderBy(desc(LabUpdatedOrderHomeCollectionModel.createdAt))
        .limit(1);

      if (!homeCollection) {
        throw new HttpError(400, 'This test has no home sample to refund');
      }
      if (input.refundedHomeCollectionIds.has(homeCollection.id)) {
        throw new HttpError(
          400,
          'A home sample can be refunded with one test only'
        );
      }
      input.refundedHomeCollectionIds.add(homeCollection.id);
      homeCollectionId = homeCollection.id;
      await LabMoneyService.lock(trx, 'lab_home_collection', homeCollectionId);
      homeRefundable = await LabMoneyService.refundable(
        trx,
        'lab_home_collection',
        homeCollectionId
      );
    }

    const maxRefund = testRefundable + homeRefundable;
    if (refund.amount > maxRefund) {
      throw new HttpError(
        400,
        `Refund is more than what was paid and not yet refunded (up to ₹${maxRefund})`
      );
    }

    const testAmount = Math.min(refund.amount, testRefundable);
    const homeSampleAmount = refund.amount - testAmount;
    const entry = {
      labId: lab.id,
      patientId: input.patientId,
      reason: refund.reason,
      paymentMode: refund.paymentMode ?? null,
      paymentNotes: refund.paymentNotes ?? null,
      createdBy: input.createdBy,
    };
    if (testAmount > 0) {
      await LabMoneyService.refund(trx, {
        ...entry,
        sourceType: 'lab_test',
        sourceId: labOrderId,
        amount: testAmount,
      });
    }
    if (homeSampleAmount > 0 && homeCollectionId) {
      await LabMoneyService.refund(trx, {
        ...entry,
        sourceType: 'lab_home_collection',
        sourceId: homeCollectionId,
        amount: homeSampleAmount,
      });
    }

    return { amount: refund.amount, testAmount, homeSampleAmount };
  }

  /** Records a payment against the home sample linked to this test — the fee is one entity, paid once regardless of how many tests it covers. */
  private static async payLabOrderHomeSample(
    trx: DbTransaction,
    input: {
      lab: LabScope;
      labOrderId: string;
      payment: NonNullable<
        UpdateLabOrdersBulkInput['orders'][number]['updates']['homeSamplePayment']
      >;
      createdBy: string;
      /** Home fees already paid in this request; one is paid only once. */
      paidHomeCollectionIds: Set<string>;
    }
  ) {
    const { lab, labOrderId, payment } = input;
    const [homeCollection] = await trx
      .select({
        id: LabUpdatedOrderHomeCollectionModel.id,
        patientId: LabUpdatedOrderHomeCollectionModel.patientId,
      })
      .from(LabUpdatedOrderHomeCollectionModel)
      .where(
        and(
          eq(LabUpdatedOrderHomeCollectionModel.labId, lab.id),
          sql`${labOrderId}::uuid = ANY(${LabUpdatedOrderHomeCollectionModel.labOrderIds})`
        )
      )
      .orderBy(desc(LabUpdatedOrderHomeCollectionModel.createdAt))
      .limit(1);

    if (!homeCollection) {
      throw new HttpError(400, 'This test has no home sample to pay');
    }
    if (input.paidHomeCollectionIds.has(homeCollection.id)) {
      throw new HttpError(
        400,
        'A home sample can be paid through one test only'
      );
    }
    input.paidHomeCollectionIds.add(homeCollection.id);

    await LabMoneyService.lock(trx, 'lab_home_collection', homeCollection.id);
    const [row] = await insertHomeCollectionPayment(trx, {
      homeCollectionId: homeCollection.id,
      labId: lab.id,
      patientId: homeCollection.patientId,
      createdBy: input.createdBy,
      price: payment.amount,
      paymentStatus: payment.paymentStatus,
      paymentMode: payment.paymentMode ?? null,
      paymentNotes: payment.paymentNotes ?? null,
    });

    return {
      homeCollectionId: homeCollection.id,
      amount: payment.amount,
      paymentStatus: row.paymentStatus,
    };
  }

  /**
   * One lump amount against a group, auto-split by what each test (and its
   * home fee) still owes — an alternative to the per-test price update
   * above, not a replacement: that path stays exactly as it is.
   */
  static async distributeLabOrderPayment(
    context: LabOrderContext,
    distribute: DistributeLabOrderPaymentInput
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);

      const rows = await trx
        .select({
          id: LabOrderModel.id,
          patientId: LabOrderModel.patientId,
          workflowStatus: LabOrderModel.workflowStatus,
          discountPercent: LabOrderModel.discountPercent,
          labUpdatedTestPackageId: LabOrderModel.labUpdatedTestPackageId,
          packagePrice: LabUpdatedTestPackageModel.packagePrice,
          listedPrice: LabUpdatedTestModel.price,
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
            eq(LabOrderModel.labOrderGroupId, distribute.labOrderGroupId),
            this.getLabOrderScopeCondition(lab)
          )
        );

      if (rows.length === 0) {
        throw new HttpError(404, 'Lab order group not found');
      }

      const eligibleIds = distribute.labOrderIds
        ? new Set(distribute.labOrderIds)
        : null;
      // Each package member's fair share of its package price, by its own
      // catalog weight — mirrors the split used when the package was first paid.
      const packageListedTotal = new Map<string, number>();
      for (const row of rows) {
        if (!row.labUpdatedTestPackageId) continue;
        packageListedTotal.set(
          row.labUpdatedTestPackageId,
          (packageListedTotal.get(row.labUpdatedTestPackageId) ?? 0) +
            Number(row.listedPrice ?? 0)
        );
      }

      const eligibleRows = rows.filter(
        (row) =>
          (!eligibleIds || eligibleIds.has(row.id)) &&
          !OFF_BILL_WORKFLOW_STATUSES.has(
            String(row.workflowStatus).toUpperCase()
          )
      );

      for (const row of eligibleRows) {
        await LabMoneyService.lock(trx, 'lab_test', row.id);
      }

      const expectedOf = (row: (typeof rows)[number]) => {
        const discountFactor = 1 - Number(row.discountPercent ?? 0) / 100;
        if (row.labUpdatedTestPackageId && row.packagePrice !== null) {
          const siblingTotal =
            packageListedTotal.get(row.labUpdatedTestPackageId) ?? 0;
          if (siblingTotal <= 0) return 0;
          return (
            (Number(row.packagePrice) *
              discountFactor *
              Number(row.listedPrice ?? 0)) /
            siblingTotal
          );
        }
        return Number(row.listedPrice ?? 0) * discountFactor;
      };

      const remainingDues: number[] = [];
      for (const row of eligibleRows) {
        const paid = await LabMoneyService.refundable(trx, 'lab_test', row.id);
        remainingDues.push(Math.max(0, expectedOf(row) - paid));
      }

      let homeCollectionIds: string[] = [];
      let homeRemainingTotal = 0;
      const homeRemainingById = new Map<string, number>();
      if (distribute.includeHomeSample) {
        const allRowIds = rows.map((row) => row.id);
        const homeCollections = await trx
          .select({
            id: LabUpdatedOrderHomeCollectionModel.id,
            homeCollectionPrice:
              LabUpdatedOrderHomeCollectionModel.homeCollectionPrice,
          })
          .from(LabUpdatedOrderHomeCollectionModel)
          .where(
            and(
              eq(LabUpdatedOrderHomeCollectionModel.labId, lab.id),
              sql`${LabUpdatedOrderHomeCollectionModel.labOrderIds} && ARRAY[${sql.join(
                allRowIds.map((id) => sql`${id}::uuid`),
                sql`, `
              )}]::uuid[]`
            )
          );
        homeCollectionIds = homeCollections.map((h) => h.id);
        for (const home of homeCollections) {
          await LabMoneyService.lock(trx, 'lab_home_collection', home.id);
          const netPaid = await LabMoneyService.refundable(
            trx,
            'lab_home_collection',
            home.id
          );
          const remaining = Math.max(0, home.homeCollectionPrice - netPaid);
          homeRemainingById.set(home.id, remaining);
          homeRemainingTotal += remaining;
        }
      }

      const maxAmount =
        remainingDues.reduce((t, d) => t + d, 0) + homeRemainingTotal;
      if (distribute.amount > maxAmount) {
        throw new HttpError(
          400,
          `Payment is more than what is left to pay (up to ₹${maxAmount})`
        );
      }

      const homeAmount = Math.min(distribute.amount, homeRemainingTotal);
      const leftover = distribute.amount - homeAmount;
      const testAmounts = splitByRemainingDue(leftover, remainingDues);

      const entry = {
        labId: lab.id,
        createdBy: context.userId,
        paymentStatus: distribute.paymentStatus,
        paymentMode: distribute.paymentMode ?? null,
        paymentNotes: distribute.paymentNotes ?? null,
      };

      const tests: { labOrderId: string; amount: number }[] = [];
      for (const [index, row] of eligibleRows.entries()) {
        const amount = testAmounts[index];
        if (amount <= 0) continue;
        await insertLabOrderPayment(trx, {
          ...entry,
          labOrderId: row.id,
          patientId: row.patientId,
          price: amount,
        });
        tests.push({ labOrderId: row.id, amount });
        await logLabOrderActivity(trx, {
          labId: lab.id,
          labOrderId: row.id,
          activity: `Payment Received - ₹${amount}${distribute.paymentMode ? ` via ${distribute.paymentMode}` : ''}`,
          performedBy: context.userId,
        });
      }

      let homeLeft = homeAmount;
      const homeSamples: { homeCollectionId: string; amount: number }[] = [];
      for (const homeCollectionId of homeCollectionIds) {
        if (homeLeft <= 0) break;
        const take = Math.min(
          homeLeft,
          homeRemainingById.get(homeCollectionId) ?? 0
        );
        if (take <= 0) continue;
        const [homeCollection] = await trx
          .select({ patientId: LabUpdatedOrderHomeCollectionModel.patientId })
          .from(LabUpdatedOrderHomeCollectionModel)
          .where(eq(LabUpdatedOrderHomeCollectionModel.id, homeCollectionId))
          .limit(1);
        await insertHomeCollectionPayment(trx, {
          ...entry,
          homeCollectionId,
          patientId: homeCollection.patientId,
          price: take,
        });
        homeSamples.push({ homeCollectionId, amount: take });
        homeLeft -= take;
      }

      return {
        amount: distribute.amount,
        homeSampleAmount: homeAmount,
        tests,
        homeSamples,
      };
    });
  }

  static async bulkUploadReportPdf(
    context: LabOrderContext,
    payload: BulkUploadLabOrderReportInput,
    reportPdf: string
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const uniqueOrderIds = Array.from(new Set(payload.labOrderIds));

      if (uniqueOrderIds.length !== payload.labOrderIds.length) {
        throw new HttpError(400, 'Duplicate lab order ids are not allowed');
      }

      const scopedOrders = await trx
        .select({ id: LabOrderModel.id })
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
            inArray(LabOrderModel.id, uniqueOrderIds),
            this.getLabOrderScopeCondition(lab)
          )
        );

      const scopedOrderIds = new Set(scopedOrders.map((order) => order.id));
      const missingOrderIds = uniqueOrderIds.filter(
        (orderId) => !scopedOrderIds.has(orderId)
      );

      if (missingOrderIds.length > 0) {
        throw new HttpError(
          404,
          `Lab orders not found for this lab: ${missingOrderIds.join(', ')}`
        );
      }

      const updatedOrders = await trx
        .update(LabOrderModel)
        .set({
          reportPdf,
          reportStatus: 'Completed',
          workflowStatus: 'COMPLETED',
          sampleStatus: 'COMPLETED',
          updatedAt: new Date(),
        })
        .where(inArray(LabOrderModel.id, uniqueOrderIds))
        .returning();

      const ordersWithPayment = await Promise.all(
        updatedOrders.map(async (order) => {
          const payment = await getLabOrderPayment(trx, order.id);
          return {
            ...order,
            price: payment?.price ?? null,
            paymentStatus:
              payment?.paymentStatus ?? APPOINTMENT_TEST_PAYMENT_STATUS.PENDING,
            paymentMode: payment?.paymentMode ?? null,
            paymentNotes: payment?.paymentNotes ?? null,
          };
        })
      );

      return {
        count: updatedOrders.length,
        reportPdf,
        orders: ordersWithPayment,
      };
    });
  }

  private static normalizeExactName(value: string | null | undefined) {
    return (value ?? '').trim().toLowerCase();
  }

  private static normalizeLooseName(value: string | null | undefined) {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private static getMatchingLabUpdatedTest(
    prescribedTestName: string | null,
    tests: MatchingLabUpdatedTest[]
  ) {
    const exactName = this.normalizeExactName(prescribedTestName);
    if (!exactName) return null;

    const exactMatch = tests.find(
      (test) => this.normalizeExactName(test.testName) === exactName
    );

    if (exactMatch) {
      return exactMatch;
    }

    const looseName = this.normalizeLooseName(prescribedTestName);
    const looseNameMatch =
      tests.find(
        (test) => this.normalizeLooseName(test.testName) === looseName
      ) ?? null;

    if (looseNameMatch) {
      return looseNameMatch;
    }

    const exactCode = this.normalizeExactName(prescribedTestName);

    const exactCodeMatch = tests.find(
      (test) => this.normalizeExactName(test.testCode) === exactCode
    );

    if (exactCodeMatch) {
      return exactCodeMatch;
    }

    const looseCode = this.normalizeLooseName(prescribedTestName);

    return (
      tests.find(
        (test) => this.normalizeLooseName(test.testCode) === looseCode
      ) ?? null
    );
  }

  private static getOverallStatus(tests: LabOrderTestResponse[]) {
    const statuses = tests.map((test) =>
      String(test.workflowStatus ?? '').toUpperCase()
    );
    const sampleStatuses = tests.map((test) =>
      String(test.sampleStatus ?? '').toUpperCase()
    );

    if (statuses.length === 0) return 'Initiated';
    if (statuses.every((status) => status === 'COMPLETED')) return 'Completed';
    if (statuses.every((status) => status === 'ON_HOLD')) return 'On-Hold';
    if (statuses.every((status) => status === 'INITIATED')) return 'Initiated';
    if (statuses.every((status) => status === 'REJECTED')) return 'Rejected';
    if (statuses.every((status) => status === 'NO_SHOW')) return 'No Show';
    if (statuses.every((status) => status === 'TEST_NOT_AVAILABLE')) {
      return 'Test Not Available';
    }
    if (statuses.some((status) => status === 'INITIATED')) {
      return 'Initiated';
    }

    const hasProcessing =
      statuses.some(
        (status) => status === 'IN_PROGRESS' || status.includes('PROCESS')
      ) ||
      sampleStatuses.some(
        (status) =>
          status.includes('PROCESS') ||
          status.includes('TESTING') ||
          status.includes('QUALITY')
      );

    return hasProcessing ? 'Processing' : 'Processing';
  }

  private static isWorkflowStatus(
    test: LabOrderTestResponse,
    status: 'ON_HOLD' | 'REJECTED' | 'NO_SHOW' | 'TEST_NOT_AVAILABLE'
  ) {
    return String(test.workflowStatus).toUpperCase() === status;
  }

  private static getOrderType(row: LabOrderResponseRow): LabOrderType {
    if (row.testId) return 'prescribed';
    if (row.labUpdatedTestPackageId) return 'walkin_package';
    return 'walkin_test';
  }

  private static getBaseGroupKey(row: LabOrderResponseRow) {
    if (row.labOrderGroupId) return `group:${row.labOrderGroupId}`;

    const patientKey = row.patientId ?? `unknown:${row.patientMob ?? ''}`;
    const orderType = this.getOrderType(row);

    if (orderType === 'prescribed') {
      return [
        orderType,
        patientKey,
        row.doctorId ?? row.referringDoctorName ?? 'no-doctor',
        getDateKey(row.createdAt),
      ].join(':');
    }

    if (orderType === 'walkin_package') {
      return [
        orderType,
        patientKey,
        row.labUpdatedTestPackageId ?? 'no-package',
        getTimestampKey(row.createdAt),
      ].join(':');
    }

    return [orderType, patientKey, getTimestampKey(row.createdAt)].join(':');
  }

  private static createTestResponse(
    row: LabOrderResponseRow,
    matchingTests: MatchingLabUpdatedTest[],
    payments: LabOrderPaymentResponse[] = [],
    version = 1
  ): LabOrderTestResponse {
    const matchingTest = row.testId
      ? this.getMatchingLabUpdatedTest(row.prescribedTestName, matchingTests)
      : null;
    const fallbackMatchingTest = row.labUpdatedTestId
      ? {
          id: row.labUpdatedTestId,
          testName: row.labUpdatedTestName,
          price: row.labUpdatedTestPrice,
        }
      : null;
    const resolvedMatchingTest = matchingTest ?? fallbackMatchingTest;
    const workflowStatus = String(row.workflowStatus).toUpperCase();
    const showAssignedTest = Boolean(
      row.testId &&
      row.labUpdatedTestId &&
      !['ON_HOLD', 'REJECTED', 'NO_SHOW', 'TEST_NOT_AVAILABLE'].includes(
        workflowStatus
      )
    );

    return {
      labOrderId: row.labOrderId,
      orderType: this.getOrderType(row),
      version,
      ...(row.testId
        ? showAssignedTest
          ? {
              assignedTest: {
                id: row.labUpdatedTestId,
                testName: row.labUpdatedTestName,
                testCode: row.labUpdatedTestCode,
                sampleType: row.labUpdatedSampleType,
              },
            }
          : {
              prescribedTest: {
                testName: row.prescribedTestName,
                matchingTestName: resolvedMatchingTest?.testName ?? null,
                matchingTestId: resolvedMatchingTest?.id ?? null,
                matchingTestPrice: resolvedMatchingTest?.price ?? null,
              },
            }
        : {
            assignedTest: {
              id: row.labUpdatedTestId,
              testName: row.labUpdatedTestName,
              testCode: row.labUpdatedTestCode,
              sampleType: row.labUpdatedSampleType,
            },
          }),
      labUpdatedTestPackageId: row.labUpdatedTestPackageId,
      packageName: row.packageName,
      packagePrice: row.packagePrice,
      reportStatus: row.reportStatus,
      isIndependent: row.isIndependent,
      discountPercent: Number(row.discountPercent),
      listedPrice: row.labUpdatedTestPrice,
      paymentStatus: row.paymentStatus,
      paymentType: row.paymentType,
      paymentMode: row.paymentMode,
      price: row.price,
      paymentNotes: row.paymentNotes,
      payments,
      refundedAmount: payments.reduce(
        (total, payment) =>
          payment.paymentStatus === 'refunded'
            ? total + Number(payment.price ?? 0)
            : total,
        0
      ),
      reportPdf: row.reportPdf,
      workflowStatus: row.workflowStatus,
      sampleStatus: row.sampleStatus,
      sampleCode: row.sampleCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private static getGroupCreatedAt(
    row: LabOrderResponseRow,
    orderType: LabOrderGroupResponse['orderType']
  ) {
    return orderType === 'prescribed'
      ? getDateKey(row.createdAt)
      : row.createdAt.toISOString();
  }

  private static getGroupPricing(tests: LabOrderTestResponse[]) {
    const chargedPackages = new Set<string>();
    const paymentTests: LabOrderTestResponse[] = [];
    let basePrice = 0;
    let discountedTotal = 0;
    let hasDiscountedTotal = false;

    for (const test of tests) {
      if (test.labUpdatedTestPackageId && test.packagePrice !== null) {
        // A package is charged once per batch it was ordered in, not per test row.
        const packageBatchKey = `${test.labUpdatedTestPackageId}:${test.createdAt.getTime()}`;

        if (!chargedPackages.has(packageBatchKey)) {
          chargedPackages.add(packageBatchKey);
          const packagePrice = Number(test.packagePrice);
          basePrice += packagePrice;
          discountedTotal += Math.max(
            0,
            packagePrice * (1 - Number(test.discountPercent ?? 0) / 100)
          );
          hasDiscountedTotal = true;
        }

        paymentTests.push(test);
        continue;
      }

      basePrice += Number(test.price ?? 0);

      if (test.labUpdatedTestPackageId || test.listedPrice === null) continue;

      const discountedPrice =
        Number(test.listedPrice) *
        (1 - Number(test.discountPercent ?? 0) / 100);
      discountedTotal += Math.max(0, discountedPrice);
      hasDiscountedTotal = true;
      paymentTests.push(test);
    }

    return {
      basePrice,
      discountedTotal: hasDiscountedTotal ? discountedTotal : undefined,
      paymentTests,
    };
  }

  /**
   * One line per package-level transaction, reconstructed from each
   * member's own payments[] — pure read-side grouping over data that's
   * already there, no new query and no change to any existing total.
   * Members touched in one call land within the same second, so rows are
   * grouped by (package, second, paid-or-refunded) rather than requiring
   * an exact-millisecond match across separate insert statements.
   */
  private static buildPackagePayments(
    tests: LabOrderTestResponse[]
  ): LabOrderPackagePaymentResponse[] {
    const groups = new Map<string, LabOrderPackagePaymentResponse>();

    for (const test of tests) {
      if (!test.labUpdatedTestPackageId || test.packagePrice === null) {
        continue;
      }

      for (const payment of test.payments ?? []) {
        const bucketSeconds = Math.floor(payment.createdAt.getTime() / 1000);
        const key = `${test.labUpdatedTestPackageId}:${bucketSeconds}:${payment.paymentStatus}`;
        const existing = groups.get(key);

        if (existing) {
          existing.price += Number(payment.price ?? 0);
          if (payment.createdAt < existing.createdAt) {
            existing.createdAt = payment.createdAt;
          }
          continue;
        }

        groups.set(key, {
          packageId: test.labUpdatedTestPackageId,
          packageName: test.packageName,
          packagePrice: Number(test.packagePrice),
          discountPercent: Number(test.discountPercent ?? 0),
          price: Number(payment.price ?? 0),
          paymentStatus: payment.paymentStatus,
          paymentMode: payment.paymentMode,
          paymentNotes: payment.paymentNotes,
          reason: payment.reason,
          createdAt: payment.createdAt,
        });
      }
    }

    return Array.from(groups.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
  }

  private static buildGroup(
    row: LabOrderResponseRow,
    orderTypes: LabOrderType[],
    tests: LabOrderTestResponse[],
    homeSamples: LabOrderHomeSampleResponse[] = [],
    priceTests: LabOrderTestResponse[] = tests,
    priceHomeSamples: LabOrderHomeSampleResponse[] = homeSamples
  ): LabOrderGroupResponse {
    const orderType = this.getOrderType(row);
    const overallStatus = this.getOverallStatus(tests);
    const packagePayments = this.buildPackagePayments(priceTests);
    const reportPdfs = Array.from(
      new Set(
        tests
          .map((test) => test.reportPdf)
          .filter((reportPdf): reportPdf is string => Boolean(reportPdf))
      )
    );
    const {
      basePrice,
      discountedTotal: discountedTestTotal,
      paymentTests,
    } = this.getGroupPricing(priceTests);
    const totalHomeCollectionPrice = priceHomeSamples.reduce(
      (total, homeSample) =>
        total + Number(homeSample.homeCollectionPrice ?? 0),
      0
    );
    const totalPriceAfterDiscount =
      discountedTestTotal === undefined
        ? undefined
        : Math.round((discountedTestTotal + totalHomeCollectionPrice) * 100) /
          100;
    const paidTestAmount = paymentTests.reduce(
      (total, test) =>
        total +
        (test.payments ?? []).reduce(
          (paymentTotal, payment) =>
            String(payment.paymentStatus).toLowerCase() === 'paid'
              ? paymentTotal + Number(payment.price ?? 0)
              : paymentTotal,
          0
        ),
      0
    );
    const paidHomeCollectionAmount = priceHomeSamples.reduce(
      (total, homeSample) =>
        ['paid', 'refunded'].includes(homeSample.paymentStatus.toLowerCase())
          ? total + Number(homeSample.paidAmount ?? 0)
          : total,
      0
    );
    // A refund on a billable test or home fee reopens what is owed; one on a test
    // taken off the bill (rejected, no-show…) is no longer owed, so it changes nothing.
    const isOffBill = (test: LabOrderTestResponse) =>
      OFF_BILL_WORKFLOW_STATUSES.has(String(test.workflowStatus).toUpperCase());
    const reopenedTestRefunds = paymentTests.reduce(
      (total, test) =>
        isOffBill(test) ? total : total + Number(test.refundedAmount ?? 0),
      0
    );
    const testsById = new Map(
      priceTests.map((test) => [test.labOrderId, test])
    );
    const reopenedHomeRefunds = priceHomeSamples.reduce((total, homeSample) => {
      const linkedTests = homeSample.labOrderIds
        .map((labOrderId) => testsById.get(labOrderId))
        .filter((test): test is LabOrderTestResponse => Boolean(test));
      const offBill =
        linkedTests.length > 0 && linkedTests.every((test) => isOffBill(test));
      return offBill ? total : total + Number(homeSample.refundedAmount ?? 0);
    }, 0);
    const remainingAmount =
      totalPriceAfterDiscount !== undefined
        ? Math.max(
            0,
            Math.round(
              (totalPriceAfterDiscount -
                (paidTestAmount - reopenedTestRefunds) -
                (paidHomeCollectionAmount - reopenedHomeRefunds)) *
                100
            ) / 100
          )
        : undefined;
    const refundedAmount =
      priceTests.reduce(
        (total, test) => total + Number(test.refundedAmount ?? 0),
        0
      ) +
      priceHomeSamples.reduce(
        (total, homeSample) => total + Number(homeSample.refundedAmount ?? 0),
        0
      );

    return {
      labOrderGroupId: row.labOrderGroupId,
      patientId: row.patientId,
      patientName: row.patientName,
      patientMob: row.patientMob,
      patientMobile: row.patientMob,
      patientAddress: row.patientAddress,
      patientCity: row.patientCity,
      patientState: row.patientState,
      patientGender: row.patientGender,
      patientAge: row.patientAge,
      createdAt: this.getGroupCreatedAt(row, orderType),
      referringDoctorName: row.referringDoctorName,
      orderType,
      orderTypes,
      packageId: row.labUpdatedTestPackageId,
      packageName: row.packageName,
      packageCode: row.packageCode,
      packagePrice: row.packagePrice,
      totalPrice: basePrice + totalHomeCollectionPrice,
      ...(totalPriceAfterDiscount !== undefined
        ? { totalPriceAfterDiscount }
        : {}),
      ...(remainingAmount !== undefined ? { remainingAmount } : {}),
      refundedAmount,
      paymentStatus: row.paymentStatus,
      paymentType: row.paymentType,
      paymentMode: row.paymentMode,
      paymentNotes: row.paymentNotes,
      packagePayments,
      overallStatus,
      ...(overallStatus === 'Completed'
        ? { overallReportPdf: reportPdfs.length > 0 ? reportPdfs : null }
        : {}),
      tests,
      homeSamples,
    };
  }

  private static getHomeSamplesForTests(
    tests: LabOrderTestResponse[],
    homeSamplesByOrderId: Map<string, LabOrderHomeSampleResponse[]>
  ) {
    const homeSamples = new Map<string, LabOrderHomeSampleResponse>();

    for (const test of tests) {
      for (const homeSample of homeSamplesByOrderId.get(test.labOrderId) ??
        []) {
        homeSamples.set(homeSample.id, homeSample);
      }
    }

    return Array.from(homeSamples.values());
  }

  private static groupRows(
    rows: LabOrderResponseRow[],
    matchingTests: MatchingLabUpdatedTest[],
    homeSamplesByOrderId: Map<string, LabOrderHomeSampleResponse[]> = new Map(),
    splitMixedWorkflowGroups = false,
    paymentsByOrderId: Map<string, LabOrderPaymentResponse[]> = new Map(),
    versionByOrderId: Map<string, number> = new Map(),
    mergeOffBillStatuses = false
  ) {
    const groupMap = new Map<
      string,
      {
        firstRow: LabOrderResponseRow;
        firstVersion: number;
        typeVersions: Map<LabOrderType, number>;
        tests: LabOrderTestResponse[];
      }
    >();

    for (const row of rows) {
      const key = this.getBaseGroupKey(row);
      const version = versionByOrderId.get(row.labOrderId) ?? 1;
      const orderType = this.getOrderType(row);
      const group = groupMap.get(key) ?? {
        firstRow: row,
        firstVersion: version,
        typeVersions: new Map<LabOrderType, number>(),
        tests: [],
      };

      // A real group is described by its first batch whatever the sort order.
      if (row.labOrderGroupId && version < group.firstVersion) {
        group.firstRow = row;
        group.firstVersion = version;
      }

      group.typeVersions.set(
        orderType,
        Math.min(group.typeVersions.get(orderType) ?? version, version)
      );
      group.tests.push(
        this.createTestResponse(
          row,
          matchingTests,
          paymentsByOrderId.get(row.labOrderId) ?? [],
          version
        )
      );
      groupMap.set(key, group);
    }

    const groups: LabOrderGroupResponse[] = [];
    const statusPriority = new Map([
      ['Initiated', 0],
      ['Processing', 1],
      ['Completed', 2],
      ['On-Hold', 3],
      ['Rejected', 4],
      ['No Show', 5],
      ['Test Not Available', 6],
    ]);

    const addGroup = (
      group: {
        firstRow: LabOrderResponseRow;
        typeVersions: Map<LabOrderType, number>;
      },
      tests: LabOrderTestResponse[],
      priceTests: LabOrderTestResponse[] = tests
    ) => {
      const { firstRow } = group;
      const firstOrderType = this.getOrderType(firstRow);
      const orderTypes = Array.from(group.typeVersions.entries())
        .sort(
          ([typeA, versionA], [typeB, versionB]) =>
            versionA - versionB ||
            Number(typeB === firstOrderType) - Number(typeA === firstOrderType)
        )
        .map(([orderType]) => orderType);
      const priceHomeSamples = this.getHomeSamplesForTests(
        priceTests,
        homeSamplesByOrderId
      );
      const pushGroup = (groupTests: LabOrderTestResponse[]) => {
        groups.push(
          this.buildGroup(
            firstRow,
            orderTypes,
            groupTests,
            [],
            priceTests,
            priceHomeSamples
          )
        );
      };

      if (!splitMixedWorkflowGroups || tests.length <= 1) {
        pushGroup(tests);
        return;
      }

      const testsByStatus = new Map<string, LabOrderTestResponse[]>();

      for (const test of tests) {
        const status = this.getOverallStatus([test]);
        const statusTests = testsByStatus.get(status) ?? [];
        statusTests.push(test);
        testsByStatus.set(status, statusTests);
      }

      Array.from(testsByStatus.entries())
        .sort(
          ([statusA], [statusB]) =>
            (statusPriority.get(statusA) ?? Number.MAX_SAFE_INTEGER) -
            (statusPriority.get(statusB) ?? Number.MAX_SAFE_INTEGER)
        )
        .forEach(([, statusTests]) => pushGroup(statusTests));
    };

    for (const group of groupMap.values()) {
      if (mergeOffBillStatuses) {
        addGroup(group, group.tests, group.tests);
        continue;
      }

      const rejectedTests = group.tests.filter((test) =>
        this.isWorkflowStatus(test, 'REJECTED')
      );
      const noShowTests = group.tests.filter((test) =>
        this.isWorkflowStatus(test, 'NO_SHOW')
      );
      const onHoldTests = group.tests.filter((test) =>
        this.isWorkflowStatus(test, 'ON_HOLD')
      );
      const testNotAvailableTests = group.tests.filter((test) =>
        this.isWorkflowStatus(test, 'TEST_NOT_AVAILABLE')
      );
      const otherTests = group.tests.filter(
        (test) =>
          !this.isWorkflowStatus(test, 'REJECTED') &&
          !this.isWorkflowStatus(test, 'NO_SHOW') &&
          !this.isWorkflowStatus(test, 'ON_HOLD') &&
          !this.isWorkflowStatus(test, 'TEST_NOT_AVAILABLE')
      );

      if (
        testNotAvailableTests.length > 0 &&
        testNotAvailableTests.length < group.tests.length
      ) {
        if (otherTests.length > 0) {
          addGroup(group, otherTests, group.tests);
        }
        if (onHoldTests.length > 0) {
          addGroup(group, onHoldTests, group.tests);
        }
        if (noShowTests.length > 0) {
          addGroup(group, noShowTests, group.tests);
        }
        if (rejectedTests.length > 0) {
          addGroup(group, rejectedTests, group.tests);
        }
        addGroup(group, testNotAvailableTests, group.tests);
        continue;
      }

      if (
        rejectedTests.length > 0 &&
        rejectedTests.length < group.tests.length
      ) {
        if (otherTests.length > 0) {
          addGroup(group, otherTests, group.tests);
        }
        if (onHoldTests.length > 0) {
          addGroup(group, onHoldTests, group.tests);
        }
        if (noShowTests.length > 0) {
          addGroup(group, noShowTests, group.tests);
        }
        if (testNotAvailableTests.length > 0) {
          addGroup(group, testNotAvailableTests, group.tests);
        }
        addGroup(group, rejectedTests, group.tests);
        continue;
      }

      if (noShowTests.length > 0 && noShowTests.length < group.tests.length) {
        if (otherTests.length > 0) {
          addGroup(group, otherTests, group.tests);
        }
        if (onHoldTests.length > 0) {
          addGroup(group, onHoldTests, group.tests);
        }
        if (rejectedTests.length > 0) {
          addGroup(group, rejectedTests, group.tests);
        }
        if (testNotAvailableTests.length > 0) {
          addGroup(group, testNotAvailableTests, group.tests);
        }
        addGroup(group, noShowTests, group.tests);
        continue;
      }

      if (onHoldTests.length > 0 && onHoldTests.length < group.tests.length) {
        if (otherTests.length > 0) {
          addGroup(group, otherTests, group.tests);
        }
        if (noShowTests.length > 0) {
          addGroup(group, noShowTests, group.tests);
        }
        if (testNotAvailableTests.length > 0) {
          addGroup(group, testNotAvailableTests, group.tests);
        }
        addGroup(group, onHoldTests, group.tests);
        continue;
      }

      addGroup(group, group.tests, group.tests);
    }

    return groups.map((group) => ({
      ...group,
      homeSamples: this.getHomeSamplesForTests(
        group.tests,
        homeSamplesByOrderId
      ),
    }));
  }

  private static async getTestVersions(
    trx: DbTransaction,
    lab: LabScope,
    rows: LabOrderResponseRow[]
  ) {
    const batchesByKey = new Map<
      string,
      { createdAt: number; orderedAt: number }[]
    >();
    const addBatch = (key: string, createdAt: number, orderedAt: number) => {
      const batches = batchesByKey.get(key) ?? [];
      batches.push({ createdAt, orderedAt });
      batchesByKey.set(key, batches);
    };
    const labOrderGroupIds = new Set<string>();

    for (const row of rows) {
      if (row.labOrderGroupId) {
        labOrderGroupIds.add(row.labOrderGroupId);
        continue;
      }
      const createdAt = row.createdAt.getTime();
      addBatch(this.getBaseGroupKey(row), createdAt, createdAt);
    }

    if (labOrderGroupIds.size > 0) {
      const groupBatches = await trx
        .select({
          labOrderGroupId: LabOrderModel.labOrderGroupId,
          createdAt: LabOrderModel.createdAt,
          // /assign rows get created_at from the DB clock in the session zone;
          // every other insert writes a UTC instant, so align both before ordering.
          orderedAt:
            sql<number>`min(extract(epoch from case when ${LabOrderModel.appointmentId} is not null then ${LabOrderModel.createdAt}::timestamptz else ${LabOrderModel.createdAt} at time zone 'UTC' end) * 1000)`.mapWith(
              Number
            ),
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
            inArray(
              LabOrderModel.labOrderGroupId,
              Array.from(labOrderGroupIds)
            ),
            this.getLabOrderScopeCondition(lab)
          )
        )
        .groupBy(LabOrderModel.labOrderGroupId, LabOrderModel.createdAt);

      for (const batch of groupBatches) {
        if (!batch.labOrderGroupId) continue;
        addBatch(
          batch.labOrderGroupId,
          batch.createdAt.getTime(),
          batch.orderedAt
        );
      }
    }

    const versionsByKey = new Map<string, Map<number, number>>();

    for (const [key, batches] of batchesByKey) {
      const versions = new Map<number, number>();
      batches
        .sort(
          (batchA, batchB) =>
            batchA.orderedAt - batchB.orderedAt ||
            batchA.createdAt - batchB.createdAt
        )
        .forEach((batch) => {
          if (!versions.has(batch.createdAt)) {
            versions.set(batch.createdAt, versions.size + 1);
          }
        });
      versionsByKey.set(key, versions);
    }

    return new Map(
      rows.map((row) => [
        row.labOrderId,
        versionsByKey
          .get(row.labOrderGroupId ?? this.getBaseGroupKey(row))
          ?.get(row.createdAt.getTime()) ?? 1,
      ])
    );
  }

  private static getOrderBy(query: GetLabOrdersQueryInput) {
    const sortOrder = query.sortOrder === 'asc' ? asc : desc;

    switch (query.sortBy) {
      case 'createdAt':
        return [sortOrder(LabOrderModel.createdAt)];
      case 'patientName':
        return [
          sortOrder(
            sql<string>`coalesce(${UserModel.name}, ${IndependentPatientModel.name}, '')`
          ),
        ];
      case 'testName':
        return [
          sortOrder(
            sql<string>`coalesce(${TestCatalogModel.name}, ${LabUpdatedTestModel.testName}, '')`
          ),
        ];
      case 'date':
      default:
        return [sortOrder(LabOrderModel.createdAt), desc(LabOrderModel.id)];
    }
  }

  static async getLabOrders(
    context: LabOrderContext,
    query: GetLabOrdersQueryInput,
    allowedOverallStatuses: string[] = [],
    options: GetLabOrdersOptions = {}
  ) {
    return await database.transaction(async (trx) => {
      const lab = await this.getLabScope(trx, context);
      const { page, limit } = pagination(query);
      const patientUser = alias(UserModel, 'lab_order_patient_user');
      const doctorUser = alias(UserModel, 'lab_order_doctor_user');
      const patientProfile = alias(
        UserProfileModel,
        'lab_order_patient_profile'
      );
      const patientNameExpression = sql<
        string | null
      >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`;
      const patientMobileExpression = sql<
        string | null
      >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`;
      const patientAgeExpression = sql<
        number | null
      >`coalesce(${patientProfile.age}, ${IndependentPatientModel.age})`;
      const patientGenderExpression = sql<
        string | null
      >`coalesce(${patientProfile.gender}, ${IndependentPatientModel.gender})`;
      const doctorNameExpression = sql<
        string | null
      >`coalesce(${doctorUser.name}, ${LabOrderModel.referringDoctorName}, ${IndependentPatientModel.doctorName})`;

      const conditions: SQL[] = [this.getLabOrderScopeCondition(lab)];

      if (query.labOrderId) {
        conditions.push(eq(LabOrderModel.id, query.labOrderId));
      }
      if (query.appointmentId) {
        conditions.push(eq(LabOrderModel.appointmentId, query.appointmentId));
      }
      if (query.patientId) {
        conditions.push(eq(LabOrderModel.patientId, query.patientId));
      }
      if (query.doctorId) {
        conditions.push(eq(LabOrderModel.doctorId, query.doctorId));
      }
      if (query.referringDoctorName) {
        const referringDoctorPattern = `%${query.referringDoctorName}%`;
        conditions.push(
          or(
            sql`${doctorUser.name} ILIKE ${referringDoctorPattern}`,
            sql`${LabOrderModel.referringDoctorName} ILIKE ${referringDoctorPattern}`,
            sql`${IndependentPatientModel.doctorName} ILIKE ${referringDoctorPattern}`
          ) as SQL
        );
      }
      if (query.labUpdatedTestPackageId || query.packageId) {
        conditions.push(
          eq(
            LabOrderModel.labUpdatedTestPackageId,
            query.labUpdatedTestPackageId ?? query.packageId!
          )
        );
      }
      if (query.workflowStatus) {
        conditions.push(eq(LabOrderModel.workflowStatus, query.workflowStatus));
      }
      if (query.reportStatus) {
        conditions.push(eq(LabOrderModel.reportStatus, query.reportStatus));
      }
      if (query.paymentStatus) {
        conditions.push(
          eq(labOrderPaymentColumns.paymentStatus, query.paymentStatus)
        );
      }
      if (query.sampleStatus) {
        conditions.push(eq(LabOrderModel.sampleStatus, query.sampleStatus));
      }
      if (query.sampleCode) {
        conditions.push(eq(LabOrderModel.sampleCode, query.sampleCode));
      }
      if (options.excludeNotRequiredSampleStatus) {
        conditions.push(
          sql`lower(coalesce(${LabOrderModel.sampleStatus}, '')) <> ${NOT_REQUIRED_SAMPLE_STATUS}`
        );
      }
      if (query.dateFrom) {
        conditions.push(gte(LabOrderModel.createdAt, query.dateFrom));
      }
      if (query.dateTo) {
        conditions.push(lte(LabOrderModel.createdAt, query.dateTo));
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        if (options.searchField === 'patientName') {
          conditions.push(sql`${patientNameExpression} ILIKE ${pattern}`);
        } else if (options.searchField === 'patientMobile') {
          conditions.push(sql`${patientMobileExpression} ILIKE ${pattern}`);
        } else {
          conditions.push(
            or(
              sql`${patientNameExpression} ILIKE ${pattern}`,
              sql`${patientMobileExpression} ILIKE ${pattern}`,
              sql`${doctorNameExpression} ILIKE ${pattern}`,
              sql`${TestCatalogModel.name} ILIKE ${pattern}`,
              sql`${LabUpdatedTestModel.testName} ILIKE ${pattern}`,
              sql`${LabUpdatedTestModel.testCode} ILIKE ${pattern}`,
              sql`${LabUpdatedTestPackageModel.packageName} ILIKE ${pattern}`,
              sql`${LabUpdatedTestPackageModel.packageCode} ILIKE ${pattern}`
            ) as SQL
          );
        }
      }

      const where = and(...conditions);

      const matchingTests = await trx
        .select({
          id: LabUpdatedTestModel.id,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
          price: LabUpdatedTestModel.price,
        })
        .from(LabUpdatedTestModel)
        .where(
          and(
            eq(LabUpdatedTestModel.labId, lab.id),
            eq(LabUpdatedTestModel.status, 'active')
          )
        );

      const rows: LabOrderResponseRow[] = await trx
        .select({
          labOrderId: LabOrderModel.id,
          labOrderGroupId: LabOrderModel.labOrderGroupId,
          testId: LabOrderModel.testId,
          labUpdatedTestId: LabOrderModel.labUpdatedTestId,
          labUpdatedTestPackageId: LabOrderModel.labUpdatedTestPackageId,
          isIndependent: LabOrderModel.isIndependent,
          patientId: LabOrderModel.patientId,
          patientName: patientNameExpression,
          patientMob: patientMobileExpression,
          patientAddress: patientProfile.address,
          patientCity: patientProfile.city,
          patientState: patientProfile.state,
          patientAge: patientAgeExpression,
          patientGender: patientGenderExpression,
          doctorId: LabOrderModel.doctorId,
          referringDoctorName: doctorNameExpression,
          prescribedTestName: TestCatalogModel.name,
          labUpdatedTestName: LabUpdatedTestModel.testName,
          labUpdatedTestCode: LabUpdatedTestModel.testCode,
          labUpdatedSampleType: LabUpdatedTestModel.sampleType,
          labUpdatedTestPrice: LabUpdatedTestModel.price,
          packageName: LabUpdatedTestPackageModel.packageName,
          packageCode: LabUpdatedTestPackageModel.packageCode,
          packagePrice: LabUpdatedTestPackageModel.packagePrice,
          discountPercent: LabOrderModel.discountPercent,
          price: labOrderPaymentColumns.price,
          paymentType: labOrderPaymentColumns.paymentType,
          paymentMode: labOrderPaymentColumns.paymentMode,
          paymentNotes: labOrderPaymentColumns.paymentNotes,
          reportStatus: LabOrderModel.reportStatus,
          paymentStatus: labOrderPaymentColumns.paymentStatus,
          workflowStatus: LabOrderModel.workflowStatus,
          sampleStatus: LabOrderModel.sampleStatus,
          sampleCode: LabOrderModel.sampleCode,
          reportPdf: LabOrderModel.reportPdf,
          createdAt: LabOrderModel.createdAt,
          updatedAt: LabOrderModel.updatedAt,
        })
        .from(LabOrderModel)
        .leftJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
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
        .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
        .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .leftJoin(
          IndependentPatientModel,
          eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
        )
        .where(where)
        .orderBy(...this.getOrderBy(query));

      const uniqueLabOrderIds = Array.from(
        new Set(rows.map((row) => row.labOrderId))
      );
      const paymentRows: LabOrderPaymentResponse[] = await getLabOrderPayments(
        trx,
        uniqueLabOrderIds
      );
      const paymentsByOrderId = new Map<string, LabOrderPaymentResponse[]>();
      for (const payment of paymentRows) {
        const payments = paymentsByOrderId.get(payment.labOrderId) ?? [];
        payments.push(payment);
        paymentsByOrderId.set(payment.labOrderId, payments);
      }
      const homeCollectionRows =
        uniqueLabOrderIds.length === 0
          ? []
          : await trx
              .select()
              .from(LabUpdatedOrderHomeCollectionModel)
              .where(
                and(
                  eq(LabUpdatedOrderHomeCollectionModel.labId, lab.id),
                  sql`${LabUpdatedOrderHomeCollectionModel.labOrderIds} && ARRAY[${sql.join(
                    uniqueLabOrderIds.map(
                      (labOrderId) => sql`${labOrderId}::uuid`
                    ),
                    sql`, `
                  )}]::uuid[]`
                )
              )
              .orderBy(desc(LabUpdatedOrderHomeCollectionModel.createdAt));

      const latestHomeCollectionPaymentById =
        await getLatestHomeCollectionPayments(
          trx,
          homeCollectionRows.map((row) => row.id)
        );

      const homeSamplesByOrderId = new Map<
        string,
        LabOrderHomeSampleResponse[]
      >();

      for (const homeCollection of homeCollectionRows) {
        const homeCollectionPayment = latestHomeCollectionPaymentById.get(
          homeCollection.id
        );
        const homeSample: LabOrderHomeSampleResponse = {
          id: homeCollection.id,
          rateId: homeCollection.rateId,
          homeCollectionPrice: homeCollection.homeCollectionPrice,
          distance:
            homeCollection.distance === null
              ? null
              : Number(homeCollection.distance),
          unit: homeCollection.unit,
          labOrderIds: homeCollection.labOrderIds,
          paidAmount: homeCollectionPayment?.paidAmount ?? null,
          paymentStatus: homeCollectionPayment?.paymentStatus ?? 'pending',
          paymentMode: homeCollectionPayment?.paymentMode ?? null,
          paymentNotes: homeCollectionPayment?.paymentNotes ?? null,
          refundedAmount: homeCollectionPayment?.refundedAmount ?? 0,
          payments: homeCollectionPayment?.payments ?? [],
          createdAt: homeCollection.createdAt,
          updatedAt: homeCollection.updatedAt,
        };

        for (const labOrderId of homeCollection.labOrderIds) {
          if (!uniqueLabOrderIds.includes(labOrderId)) continue;

          const existing = homeSamplesByOrderId.get(labOrderId) ?? [];
          existing.push(homeSample);
          homeSamplesByOrderId.set(labOrderId, existing);
        }
      }

      const versionByOrderId = await this.getTestVersions(trx, lab, rows);
      const groups = this.groupRows(
        rows,
        matchingTests,
        homeSamplesByOrderId,
        options.splitMixedWorkflowGroups ?? false,
        paymentsByOrderId,
        versionByOrderId,
        options.mergeOffBillStatuses ?? false
      );
      const orderTypeFilter = query.orderType;
      const orderTypeFilteredGroups = orderTypeFilter
        ? groups.filter((group) => group.orderTypes.includes(orderTypeFilter))
        : groups;
      const sampleTypeFilteredGroups = query.sampleType
        ? orderTypeFilteredGroups.filter((group) =>
            query.sampleType === 'homeCollected'
              ? group.homeSamples.length > 0
              : group.homeSamples.length === 0
          )
        : orderTypeFilteredGroups;
      const overallStatusFilter =
        query.overallStatus === 'TestNotAvailable'
          ? 'Test Not Available'
          : query.overallStatus === 'NoShow'
            ? 'No Show'
            : query.overallStatus;
      const filteredGroups = overallStatusFilter
        ? sampleTypeFilteredGroups.filter(
            (group) => group.overallStatus === overallStatusFilter
          )
        : allowedOverallStatuses.length > 0
          ? sampleTypeFilteredGroups.filter((group) =>
              allowedOverallStatuses.includes(group.overallStatus)
            )
          : sampleTypeFilteredGroups;
      const totalGroups = filteredGroups.length;
      const offset = (page - 1) * limit;
      const pagedGroups = filteredGroups.slice(offset, offset + limit);
      const responsePatients: LabOrderGroupResponse[] =
        options.includeLegacyPaymentFields
          ? pagedGroups
          : (pagedGroups.map((group) => ({
              ...omitLegacyPaymentFields(group),
              tests: group.tests.map((test) => omitLegacyPaymentFields(test)),
            })) as unknown as LabOrderGroupResponse[]);

      return {
        lab: {
          id: lab.id,
          name: lab.name,
          labAddress: lab.address,
          labContantNo: lab.contactNo,
        },
        view: 'grouped',
        patients: responsePatients,
        pagination: pageMeta(totalGroups, page, limit),
      };
    });
  }

  static async getBillingHistory(
    context: LabOrderContext,
    query: GetLabOrdersQueryInput
  ) {
    const result = await this.getLabOrders(
      context,
      { ...query, overallStatus: undefined },
      ['Initiated', 'Processing', 'Completed'],
      {
        excludeNotRequiredSampleStatus: true,
        includeLegacyPaymentFields: true,
        // A visit with any still-billable test keeps its Rejected/No-Show/
        // On-Hold/Test-Not-Available tests alongside it in one object,
        // instead of splitting them into a separate card that then gets
        // filtered out by allowedOverallStatuses above.
        mergeOffBillStatuses: true,
      }
    );

    return {
      ...result,
      patients: result.patients.map((patient) => {
        const homeSamples = patient.homeSamples ?? [];
        const totalHomeCollectionPrice = homeSamples.reduce(
          (total, homeSample) =>
            total + Number(homeSample.homeCollectionPrice ?? 0),
          0
        );
        const { basePrice } = this.getGroupPricing(patient.tests);

        return {
          ...patient,
          totalPrice: basePrice + totalHomeCollectionPrice,
          ...(homeSamples.length > 0 ? { totalHomeCollectionPrice } : {}),
        };
      }),
    };
  }

  static async searchLabOrdersBySampleCode(
    context: LabOrderContext,
    sampleCode: string,
    query: Omit<
      Partial<GetLabOrdersQueryInput>,
      'labOrderId' | 'sampleCode'
    > = {}
  ) {
    const baseQuery = {
      ...query,
      overallStatus: undefined,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      sortOrder: query.sortOrder ?? 'desc',
    } satisfies GetLabOrdersQueryInput;

    const sampleCodeResult = await this.getLabOrders(context, {
      ...baseQuery,
      sampleCode,
    });

    if ((sampleCodeResult.pagination?.total ?? 0) > 0) {
      return sampleCodeResult;
    }

    const patientNameResult = await this.getLabOrders(
      context,
      { ...baseQuery, search: sampleCode, sampleCode: undefined },
      [],
      { searchField: 'patientName' }
    );

    if ((patientNameResult.pagination?.total ?? 0) > 0) {
      return patientNameResult;
    }

    return await this.getLabOrders(
      context,
      { ...baseQuery, search: sampleCode, sampleCode: undefined },
      [],
      { searchField: 'patientMobile' }
    );
  }

  static async getLabOrderById(
    labOrderId: string,
    context: LabOrderContext,
    query: Partial<Omit<GetLabOrdersQueryInput, 'labOrderId'>> = {}
  ) {
    const result = await this.getLabOrders(context, {
      ...query,
      labOrderId,
      page: 1,
      limit: 1,
      sortOrder: query.sortOrder ?? 'desc',
    });

    const hasResult = (result.patients?.length ?? 0) > 0;

    if (!hasResult) {
      throw new HttpError(404, 'Lab order not found');
    }

    return result;
  }
}
