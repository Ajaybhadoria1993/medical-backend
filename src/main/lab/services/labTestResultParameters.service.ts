import { asc, eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  LabTestResultParameterModel,
  LabUpdatedDepartmentModel,
  LabUpdatedTestModel,
} from '../models/labUpdated.model';
import {
  CreateLabTestResultParameterInput,
  UpdateLabTestResultParameterInput,
} from '../schemas/labTestResultParameters.schemas';
import {
  findLibraryTest,
  formatTest,
  isCustomParameter,
  LabCatalogContext,
  parseReferenceRange,
  replaceParameterOptions,
  replaceParameterRanges,
  verifyLabAccess,
} from './labCatalog.service';

// Must stay in sync with RANGE_INPUT_TYPES / OPTION_INPUT_TYPES in
// labCatalog.service.ts — see docs/lab/LAB_CATALOG_SCHEMA_REWORK.md.
const applyRangesOrOptions = async (
  trx: Parameters<typeof replaceParameterRanges>[0],
  parameterId: string,
  inputType: string,
  payload: Pick<
    CreateLabTestResultParameterInput | UpdateLabTestResultParameterInput,
    'ranges' | 'options' | 'referenceRange' | 'referenceGender'
  >,
  now: Date
) => {
  if (inputType === 'number') {
    // Explicit ranges win; otherwise keep the structured ranges in sync with a
    // referenceRange the caller just sent, if it parses cleanly. An
    // unparseable or absent referenceRange leaves existing ranges untouched.
    const derived = parseReferenceRange(
      payload.referenceRange,
      payload.referenceGender ?? 'All'
    );
    const ranges = payload.ranges ?? (derived ? [derived] : undefined);
    await replaceParameterRanges(trx, parameterId, ranges, now);
  } else if (inputType === 'select') {
    await replaceParameterOptions(trx, parameterId, payload.options, now);
  }
};

export class LabTestResultParametersService {
  static async createParameter(
    payload: CreateLabTestResultParameterInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const test = await formatTest(trx, payload.testId);
      if (test.labId !== context.labId) {
        throw new HttpError(403, 'Test does not belong to this lab');
      }

      const now = new Date();
      const [parameter] = await trx
        .insert(LabTestResultParameterModel)
        .values({
          testId: payload.testId,
          parameterName: payload.parameterName,
          code: payload.code ?? null,
          inputType: payload.inputType ?? 'text',
          unit: payload.unit ?? null,
          unitless: payload.unitless ?? false,
          decimals: payload.decimals ?? 1,
          section: payload.section ?? null,
          formula: payload.formula ?? null,
          referenceRange: payload.referenceRange ?? null,
          isRequired: payload.isRequired ?? false,
          isActive: payload.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await applyRangesOrOptions(
        trx,
        parameter.id,
        payload.inputType ?? 'text',
        payload,
        now
      );

      const libraryTest = findLibraryTest(
        { code: test.departmentCode, name: test.departmentName },
        test
      );
      return {
        ...parameter,
        isCustom: isCustomParameter(libraryTest, parameter.parameterName),
      };
    });
  }

  static async getParameters(context: LabCatalogContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const rows = await trx
        .select({
          id: LabTestResultParameterModel.id,
          testId: LabTestResultParameterModel.testId,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
          departmentCode: LabUpdatedDepartmentModel.code,
          departmentName: LabUpdatedDepartmentModel.name,
          parameterName: LabTestResultParameterModel.parameterName,
          code: LabTestResultParameterModel.code,
          inputType: LabTestResultParameterModel.inputType,
          unit: LabTestResultParameterModel.unit,
          unitless: LabTestResultParameterModel.unitless,
          decimals: LabTestResultParameterModel.decimals,
          section: LabTestResultParameterModel.section,
          formula: LabTestResultParameterModel.formula,
          referenceRange: LabTestResultParameterModel.referenceRange,
          isRequired: LabTestResultParameterModel.isRequired,
          isActive: LabTestResultParameterModel.isActive,
          createdAt: LabTestResultParameterModel.createdAt,
          updatedAt: LabTestResultParameterModel.updatedAt,
        })
        .from(LabTestResultParameterModel)
        .innerJoin(
          LabUpdatedTestModel,
          eq(LabTestResultParameterModel.testId, LabUpdatedTestModel.id)
        )
        .innerJoin(
          LabUpdatedDepartmentModel,
          eq(LabUpdatedTestModel.departmentId, LabUpdatedDepartmentModel.id)
        )
        .where(eq(LabUpdatedTestModel.labId, context.labId))
        .orderBy(asc(LabUpdatedTestModel.testName));

      return rows.map((row) => ({
        ...row,
        isCustom: isCustomParameter(
          findLibraryTest(
            { code: row.departmentCode, name: row.departmentName },
            row
          ),
          row.parameterName
        ),
      }));
    });
  }

  static async getParametersByTestId(
    testId: string,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const test = await formatTest(trx, testId);
      if (test.labId !== context.labId) {
        throw new HttpError(403, 'Test does not belong to this lab');
      }
      return test.parameters;
    });
  }

  static async updateParameter(
    parameterId: string,
    payload: UpdateLabTestResultParameterInput,
    context: LabCatalogContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const [existing] = await trx
        .select({
          parameter: LabTestResultParameterModel,
          labId: LabUpdatedTestModel.labId,
          testCode: LabUpdatedTestModel.testCode,
          testName: LabUpdatedTestModel.testName,
          departmentCode: LabUpdatedDepartmentModel.code,
          departmentName: LabUpdatedDepartmentModel.name,
        })
        .from(LabTestResultParameterModel)
        .innerJoin(
          LabUpdatedTestModel,
          eq(LabTestResultParameterModel.testId, LabUpdatedTestModel.id)
        )
        .innerJoin(
          LabUpdatedDepartmentModel,
          eq(LabUpdatedTestModel.departmentId, LabUpdatedDepartmentModel.id)
        )
        .where(eq(LabTestResultParameterModel.id, parameterId))
        .limit(1);

      if (!existing) throw new HttpError(404, 'Parameter not found');
      if (existing.labId !== context.labId) {
        throw new HttpError(403, 'Parameter does not belong to this lab');
      }

      const now = new Date();
      const [parameter] = await trx
        .update(LabTestResultParameterModel)
        .set({
          ...(payload.parameterName !== undefined
            ? { parameterName: payload.parameterName }
            : {}),
          ...(payload.code !== undefined ? { code: payload.code } : {}),
          ...(payload.inputType !== undefined
            ? { inputType: payload.inputType }
            : {}),
          ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
          ...(payload.unitless !== undefined
            ? { unitless: payload.unitless }
            : {}),
          ...(payload.decimals !== undefined
            ? { decimals: payload.decimals }
            : {}),
          ...(payload.section !== undefined
            ? { section: payload.section }
            : {}),
          ...(payload.formula !== undefined
            ? { formula: payload.formula }
            : {}),
          ...(payload.referenceRange !== undefined
            ? { referenceRange: payload.referenceRange }
            : {}),
          ...(payload.isRequired !== undefined
            ? { isRequired: payload.isRequired }
            : {}),
          ...(payload.isActive !== undefined
            ? { isActive: payload.isActive }
            : {}),
          updatedAt: now,
        })
        .where(eq(LabTestResultParameterModel.id, parameterId))
        .returning();

      const inputType = payload.inputType ?? existing.parameter.inputType;
      await applyRangesOrOptions(trx, parameterId, inputType, payload, now);

      const libraryTest = findLibraryTest(
        { code: existing.departmentCode, name: existing.departmentName },
        existing
      );
      return {
        ...parameter,
        isCustom: isCustomParameter(libraryTest, parameter.parameterName),
      };
    });
  }
}
