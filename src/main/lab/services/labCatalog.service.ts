import { and, asc, eq, ilike, inArray, isNull, ne, or, SQL } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import defaultSuggestions from '../utils/labUpdatedDefaultSuggestions.json';
import { LabsModel, UserLabAssignmentsModel } from '../models/lab.model';
import {
  LabTestResultParameterModel,
  LabUpdatedDepartmentModel,
  LabUpdatedParameterOptionModel,
  LabUpdatedParameterReferenceRangeModel,
  LabUpdatedTestAliasModel,
  LabUpdatedTestGroupModel,
  LabUpdatedTestModel,
  LabUpdatedTestPackageItemModel,
  LabUpdatedTestPackageModel,
} from '../models/labUpdated.model';

// Parameters with one of these inputTypes carry structured reference ranges;
// 'select' carries a fixed option list instead. Never both (see
// docs/lab/LAB_CATALOG_SCHEMA_REWORK.md).
const RANGE_INPUT_TYPES = new Set(['number']);
const OPTION_INPUT_TYPES = new Set(['select']);

export type DbTransaction = Parameters<
  Parameters<typeof database.transaction>[0]
>[0];

export type LabCatalogContext = {
  labId: string;
  userId: string;
  userRole: string;
};

export type LabCatalogReferenceRangeInput = {
  gender?: string;
  ageFromYears?: number | null;
  ageToYears?: number | null;
  condition?: string | null;
  type?: string;
  lowRange?: number | null;
  highRange?: number | null;
  label?: string | null;
};

export type LabCatalogParameterOptionInput = {
  optionValue: string;
  isNormal?: boolean;
};

export type LabCatalogParameterInput = {
  parameterName: string;
  code?: string | null;
  inputType?: string;
  unit?: string | null;
  unitless?: boolean;
  decimals?: number;
  section?: string | null;
  formula?: string | null;
  referenceRange?: string | null;
  // Input-only: the flat shape (one entry per gender) gets merged into one
  // parameter with gender-specific ranges by normalizeParameterInputs.
  referenceGender?: string;
  isRequired?: boolean;
  isActive?: boolean;
  ranges?: LabCatalogReferenceRangeInput[];
  options?: LabCatalogParameterOptionInput[];
};

export type LabCatalogTestInput = {
  testName: string;
  shortName?: string | null;
  loincCode?: string | null;
  comments?: string | null;
  interpretation?: string | null;
  notes?: string | null;
  testCode: string;
  sampleType: string;
  container?: string | null;
  sampleVolume?: string | null;
  stability?: string | null;
  storage?: string | null;
  method?: string | null;
  technology?: string | null;
  testType?: string | null;
  turnaroundTimeHours?: number | null;
  clinicalSignificance?: string | null;
  limitations?: string | null;
  advice?: string | null;
  testDisclaimer?: string | null;
  whenResultHigh?: string | null;
  whenResultLow?: string | null;
  whenResultCritical?: string | null;
  price?: number;
  departmentId?: string;
  departmentCode?: string;
  groupId?: string | null;
  groupName?: string | null;
  status?: string;
  aliases?: string[];
  parameters?: LabCatalogParameterInput[];
};

export type LabCatalogDepartmentInput = {
  name: string;
  code: string;
  status?: string;
  tests?: LabCatalogTestInput[];
};

export const normalizeCode = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, '_');

export const normalizeName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

// Custom vs system is derived on read, not stored: a row is "system" when it
// matches the default library by code or name. A lab-created test that reuses
// a library code or name therefore reads as system — accepted trade-off of
// not having an origin column.
const libraryDepartments = (
  defaultSuggestions as { departments: LabCatalogDepartmentInput[] }
).departments.map((department) => ({
  code: normalizeCode(department.code),
  name: normalizeName(department.name),
  tests: (department.tests ?? []).map((test) => ({
    code: normalizeCode(test.testCode),
    name: normalizeName(test.testName),
    parameterNames: new Set(
      (test.parameters ?? []).map((parameter) =>
        normalizeName(parameter.parameterName)
      )
    ),
  })),
}));

export type LibraryTest = (typeof libraryDepartments)[number]['tests'][number];

export const findLibraryTest = (
  department: { code: string; name: string },
  test: { testCode: string; testName: string }
): LibraryTest | undefined => {
  const libraryDepartment = libraryDepartments.find(
    (item) =>
      item.code === normalizeCode(department.code) ||
      item.name === normalizeName(department.name)
  );
  return libraryDepartment?.tests.find(
    (item) =>
      item.code === normalizeCode(test.testCode) ||
      item.name === normalizeName(test.testName)
  );
};

export const isCustomParameter = (
  libraryTest: LibraryTest | undefined,
  parameterName: string
) =>
  !libraryTest || !libraryTest.parameterNames.has(normalizeName(parameterName));

export const verifyLabAccess = async (
  trx: DbTransaction,
  context: LabCatalogContext
) => {
  const [lab] = await trx
    .select({ id: LabsModel.id })
    .from(LabsModel)
    .where(and(eq(LabsModel.id, context.labId), isNull(LabsModel.deletedAt)))
    .limit(1);

  if (!lab) {
    throw new HttpError(404, 'Lab not found');
  }

  if (context.userRole === 'Admin' || context.userRole === 'Super_Admin') {
    return;
  }

  const [assignment] = await trx
    .select({ id: UserLabAssignmentsModel.id })
    .from(UserLabAssignmentsModel)
    .where(
      and(
        eq(UserLabAssignmentsModel.labId, context.labId),
        eq(UserLabAssignmentsModel.userId, context.userId)
      )
    )
    .limit(1);

  if (!assignment) {
    throw new HttpError(403, 'User is not assigned to this lab');
  }
};

export const pagination = (query: { page?: number; limit?: number }) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

export const pageMeta = (total: number, page: number, limit: number) => {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

export const ensureDepartment = async (
  trx: DbTransaction,
  labId: string,
  departmentId: string
) => {
  const [department] = await trx
    .select()
    .from(LabUpdatedDepartmentModel)
    .where(
      and(
        eq(LabUpdatedDepartmentModel.id, departmentId),
        eq(LabUpdatedDepartmentModel.labId, labId)
      )
    )
    .limit(1);

  if (!department) {
    throw new HttpError(404, 'Department not found for this lab');
  }

  return department;
};

export const ensureUniqueDepartment = async (
  trx: DbTransaction,
  labId: string,
  payload: Pick<LabCatalogDepartmentInput, 'name' | 'code'>,
  departmentId?: string
) => {
  const conditions = [
    eq(LabUpdatedDepartmentModel.labId, labId),
    or(
      ilike(LabUpdatedDepartmentModel.name, payload.name),
      eq(LabUpdatedDepartmentModel.code, payload.code)
    ),
  ].filter(Boolean) as SQL[];

  if (departmentId) {
    conditions.push(ne(LabUpdatedDepartmentModel.id, departmentId));
  }

  const [existing] = await trx
    .select({ id: LabUpdatedDepartmentModel.id })
    .from(LabUpdatedDepartmentModel)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new HttpError(409, 'Department name or code already exists');
  }
};

export const ensureGroup = async (
  trx: DbTransaction,
  labId: string,
  groupId: string
) => {
  const [group] = await trx
    .select({ id: LabUpdatedTestGroupModel.id })
    .from(LabUpdatedTestGroupModel)
    .where(
      and(
        eq(LabUpdatedTestGroupModel.id, groupId),
        eq(LabUpdatedTestGroupModel.labId, labId)
      )
    )
    .limit(1);

  if (!group) {
    throw new HttpError(404, 'Test group not found for this lab');
  }

  return group;
};

// Auto-create-or-match a group by name for the /suggestions apply flow,
// matching how getOrCreateDepartmentByCode resolves departments by code.
export const ensureGroupByName = async (
  trx: DbTransaction,
  labId: string,
  groupName: string,
  now = new Date()
) => {
  const name = groupName.trim();
  const [existing] = await trx
    .select({ id: LabUpdatedTestGroupModel.id })
    .from(LabUpdatedTestGroupModel)
    .where(
      and(
        eq(LabUpdatedTestGroupModel.labId, labId),
        ilike(LabUpdatedTestGroupModel.name, name)
      )
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await trx
    .insert(LabUpdatedTestGroupModel)
    .values({
      labId,
      name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: LabUpdatedTestGroupModel.id });

  return created.id;
};

export const ensureUniqueTest = async (
  trx: DbTransaction,
  labId: string,
  payload: Pick<LabCatalogTestInput, 'testName' | 'testCode'> & {
    departmentId: string;
  },
  testId?: string
) => {
  const codeConditions: SQL[] = [
    eq(LabUpdatedTestModel.labId, labId),
    eq(LabUpdatedTestModel.testCode, payload.testCode),
  ];

  const nameConditions: SQL[] = [
    eq(LabUpdatedTestModel.labId, labId),
    eq(LabUpdatedTestModel.departmentId, payload.departmentId),
    ilike(LabUpdatedTestModel.testName, payload.testName),
  ];

  if (testId) {
    codeConditions.push(ne(LabUpdatedTestModel.id, testId));
    nameConditions.push(ne(LabUpdatedTestModel.id, testId));
  }

  const [existing] = await trx
    .select({ id: LabUpdatedTestModel.id })
    .from(LabUpdatedTestModel)
    .where(or(and(...codeConditions), and(...nameConditions)))
    .limit(1);

  if (existing) {
    throw new HttpError(409, 'Test name or code already exists');
  }
};

export const getValidTests = async (
  trx: DbTransaction,
  labId: string,
  labTestIds: string[]
) => {
  const uniqueIds = Array.from(new Set(labTestIds));
  if (uniqueIds.length !== labTestIds.length) {
    throw new HttpError(400, 'Duplicate tests are not allowed');
  }

  const tests = await trx
    .select()
    .from(LabUpdatedTestModel)
    .where(
      and(
        inArray(LabUpdatedTestModel.id, uniqueIds),
        eq(LabUpdatedTestModel.labId, labId),
        eq(LabUpdatedTestModel.status, 'active')
      )
    );

  if (tests.length !== uniqueIds.length) {
    throw new HttpError(404, 'One or more tests were not found or inactive');
  }

  return tests;
};

export const replaceAliases = async (
  trx: DbTransaction,
  testId: string,
  aliases: string[] | undefined,
  now = new Date()
) => {
  if (aliases === undefined) return;

  await trx
    .delete(LabUpdatedTestAliasModel)
    .where(eq(LabUpdatedTestAliasModel.testId, testId));

  const uniqueAliases = Array.from(
    new Set(aliases.map((alias) => alias.trim()).filter(Boolean))
  );

  if (uniqueAliases.length === 0) return;

  await trx.insert(LabUpdatedTestAliasModel).values(
    uniqueAliases.map((alias) => ({
      testId,
      alias,
      createdAt: now,
    }))
  );
};

export const replaceParameterRanges = async (
  trx: DbTransaction,
  parameterId: string,
  ranges: LabCatalogReferenceRangeInput[] | undefined,
  now = new Date()
) => {
  if (ranges === undefined) return;

  await trx
    .delete(LabUpdatedParameterReferenceRangeModel)
    .where(eq(LabUpdatedParameterReferenceRangeModel.parameterId, parameterId));

  if (ranges.length === 0) return;

  await trx.insert(LabUpdatedParameterReferenceRangeModel).values(
    ranges.map((range) => ({
      parameterId,
      gender: range.gender ?? 'All',
      ageFromYears:
        range.ageFromYears === undefined || range.ageFromYears === null
          ? null
          : String(range.ageFromYears),
      ageToYears:
        range.ageToYears === undefined || range.ageToYears === null
          ? null
          : String(range.ageToYears),
      condition: range.condition ?? null,
      type: range.type ?? 'range',
      lowRange:
        range.lowRange === undefined || range.lowRange === null
          ? null
          : String(range.lowRange),
      highRange:
        range.highRange === undefined || range.highRange === null
          ? null
          : String(range.highRange),
      label: range.label ?? null,
      createdAt: now,
      updatedAt: now,
    }))
  );
};

export const replaceParameterOptions = async (
  trx: DbTransaction,
  parameterId: string,
  options: LabCatalogParameterOptionInput[] | undefined,
  now = new Date()
) => {
  if (options === undefined) return;

  await trx
    .delete(LabUpdatedParameterOptionModel)
    .where(eq(LabUpdatedParameterOptionModel.parameterId, parameterId));

  if (options.length === 0) return;

  await trx.insert(LabUpdatedParameterOptionModel).values(
    options.map((option) => ({
      parameterId,
      optionValue: option.optionValue,
      isNormal: option.isNormal ?? false,
      createdAt: now,
    }))
  );
};

const NUMBER = '(\\d+(?:\\.\\d+)?)';
const RANGE_RE = new RegExp(`^${NUMBER}\\s*-\\s*${NUMBER}(.*)$`);
const LT_RE = new RegExp(`^(?:<=|<|≤)\\s*${NUMBER}(.*)$`);
const GT_RE = new RegExp(`^(?:>=|>|≥)\\s*${NUMBER}(.*)$`);
const GENDER_PREFIX_RE = /^(male|female|all)\s*:\s*/i;

// Trailing text may be a unit or a short note ("0–5 /HPF", "0.8–1.2 (fasting)")
// but not a second clause or a titre ("< 1:80") — those are left unparsed.
const isSafeRemainder = (rest: string) =>
  rest === '' || (/^(\s|[×%/(µ])/.test(rest) && !rest.includes(';'));

// Strict on purpose: anything hedged or multi-clause ("Approximately…",
// "Laboratory-specific; …") stays text-only rather than being guessed into a
// structured range that would flag patient results.
export const parseReferenceRange = (
  text: string | null | undefined,
  gender = 'All'
): LabCatalogReferenceRangeInput | null => {
  if (!text) return null;
  const s = text
    .trim()
    .replace(GENDER_PREFIX_RE, '')
    .replace(/[–—]/g, '-')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');

  let m = s.match(RANGE_RE);
  if (m && isSafeRemainder(m[3])) {
    return {
      gender,
      type: 'range',
      lowRange: Number(m[1]),
      highRange: Number(m[2]),
    };
  }
  m = s.match(LT_RE);
  if (m && isSafeRemainder(m[2])) {
    return { gender, type: 'lt', highRange: Number(m[1]) };
  }
  m = s.match(GT_RE);
  if (m && isSafeRemainder(m[2])) {
    return { gender, type: 'gt', lowRange: Number(m[1]) };
  }
  return null;
};

const withDerivedRanges = (
  parameter: LabCatalogParameterInput
): LabCatalogReferenceRangeInput[] | undefined => {
  if (parameter.ranges !== undefined) return parameter.ranges;
  if (!RANGE_INPUT_TYPES.has(parameter.inputType || 'text')) return undefined;
  const derived = parseReferenceRange(
    parameter.referenceRange,
    parameter.referenceGender ?? 'All'
  );
  return derived ? [derived] : undefined;
};

// Accepts both shapes: one entry per parameter with `ranges`, or the flat
// one-entry-per-gender shape (`referenceGender` + `referenceRange` string).
// Same-name entries merge into one parameter so the (testId, parameterName)
// unique index holds.
export const normalizeParameterInputs = (
  parameters: LabCatalogParameterInput[]
): LabCatalogParameterInput[] => {
  const groups = new Map<string, LabCatalogParameterInput[]>();
  for (const parameter of parameters) {
    const key = normalizeName(parameter.parameterName);
    groups.set(key, [...(groups.get(key) ?? []), parameter]);
  }

  return Array.from(groups.values()).map((entries) => {
    const [first] = entries;
    if (entries.length === 1) {
      return { ...first, ranges: withDerivedRanges(first) };
    }

    const genders = entries.map((entry) => entry.referenceGender ?? 'All');
    if (new Set(genders).size !== genders.length) {
      throw new HttpError(
        400,
        `Parameter "${first.parameterName}" is listed more than once for the same referenceGender`
      );
    }

    const derived = entries.map(withDerivedRanges);
    const ranges = derived.every((list) => list === undefined)
      ? undefined
      : derived.flatMap((list) => list ?? []);

    const referenceRange =
      entries
        .filter((entry) => entry.referenceRange)
        .map(
          (entry) =>
            `${entry.referenceGender ?? 'All'}: ${String(entry.referenceRange).replace(GENDER_PREFIX_RE, '')}`
        )
        .join('; ') || null;

    if (referenceRange && referenceRange.length > 255) {
      throw new HttpError(
        400,
        `Combined referenceRange for "${first.parameterName}" exceeds 255 characters`
      );
    }

    return { ...first, referenceGender: undefined, referenceRange, ranges };
  });
};

const replaceParameterRangesOrOptions = async (
  trx: DbTransaction,
  parameterId: string,
  parameter: LabCatalogParameterInput,
  now: Date
) => {
  const inputType = parameter.inputType || 'text';

  if (RANGE_INPUT_TYPES.has(inputType)) {
    await replaceParameterRanges(trx, parameterId, parameter.ranges, now);
  } else if (OPTION_INPUT_TYPES.has(inputType)) {
    await replaceParameterOptions(trx, parameterId, parameter.options, now);
  }
};

export const replaceParameters = async (
  trx: DbTransaction,
  testId: string,
  parameters: LabCatalogParameterInput[],
  now = new Date()
) => {
  await trx
    .delete(LabTestResultParameterModel)
    .where(eq(LabTestResultParameterModel.testId, testId));

  for (const parameter of normalizeParameterInputs(parameters)) {
    const [created] = await trx
      .insert(LabTestResultParameterModel)
      .values({
        testId,
        parameterName: parameter.parameterName,
        code: parameter.code ?? null,
        inputType: parameter.inputType || 'text',
        unit: parameter.unit ?? null,
        unitless: parameter.unitless ?? false,
        decimals: parameter.decimals ?? 1,
        section: parameter.section ?? null,
        formula: parameter.formula ?? null,
        referenceRange: parameter.referenceRange ?? null,
        isRequired: parameter.isRequired ?? false,
        isActive: parameter.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: LabTestResultParameterModel.id });

    await replaceParameterRangesOrOptions(trx, created.id, parameter, now);
  }
};

export const upsertParameters = async (
  trx: DbTransaction,
  testId: string,
  parameters: LabCatalogParameterInput[],
  now = new Date()
) => {
  for (const parameter of normalizeParameterInputs(parameters)) {
    const [existing] = await trx
      .select({ id: LabTestResultParameterModel.id })
      .from(LabTestResultParameterModel)
      .where(
        and(
          eq(LabTestResultParameterModel.testId, testId),
          ilike(
            LabTestResultParameterModel.parameterName,
            parameter.parameterName
          )
        )
      )
      .limit(1);

    if (existing) {
      await trx
        .update(LabTestResultParameterModel)
        .set({
          code: parameter.code ?? null,
          inputType: parameter.inputType || 'text',
          unit: parameter.unit ?? null,
          unitless: parameter.unitless ?? false,
          decimals: parameter.decimals ?? 1,
          section: parameter.section ?? null,
          formula: parameter.formula ?? null,
          referenceRange: parameter.referenceRange ?? null,
          isRequired: parameter.isRequired ?? false,
          isActive: parameter.isActive ?? true,
          updatedAt: now,
        })
        .where(eq(LabTestResultParameterModel.id, existing.id));

      await replaceParameterRangesOrOptions(trx, existing.id, parameter, now);
      continue;
    }

    const [created] = await trx
      .insert(LabTestResultParameterModel)
      .values({
        testId,
        parameterName: parameter.parameterName,
        code: parameter.code ?? null,
        inputType: parameter.inputType || 'text',
        unit: parameter.unit ?? null,
        unitless: parameter.unitless ?? false,
        decimals: parameter.decimals ?? 1,
        section: parameter.section ?? null,
        formula: parameter.formula ?? null,
        referenceRange: parameter.referenceRange ?? null,
        isRequired: parameter.isRequired ?? false,
        isActive: parameter.isActive ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: LabTestResultParameterModel.id });

    await replaceParameterRangesOrOptions(trx, created.id, parameter, now);
  }
};

const toNumberOrNull = (value: string | null) =>
  value === null ? null : Number(value);

const toRangeOutput = (
  range: typeof LabUpdatedParameterReferenceRangeModel.$inferSelect
) => ({
  ...range,
  ageFromYears: toNumberOrNull(range.ageFromYears),
  ageToYears: toNumberOrNull(range.ageToYears),
  lowRange: toNumberOrNull(range.lowRange),
  highRange: toNumberOrNull(range.highRange),
});

export const formatTest = async (trx: DbTransaction, testId: string) => {
  const [test] = await trx
    .select({
      id: LabUpdatedTestModel.id,
      labId: LabUpdatedTestModel.labId,
      testName: LabUpdatedTestModel.testName,
      shortName: LabUpdatedTestModel.shortName,
      loincCode: LabUpdatedTestModel.loincCode,
      comments: LabUpdatedTestModel.comments,
      interpretation: LabUpdatedTestModel.interpretation,
      notes: LabUpdatedTestModel.notes,
      testCode: LabUpdatedTestModel.testCode,
      sampleType: LabUpdatedTestModel.sampleType,
      container: LabUpdatedTestModel.container,
      sampleVolume: LabUpdatedTestModel.sampleVolume,
      stability: LabUpdatedTestModel.stability,
      storage: LabUpdatedTestModel.storage,
      method: LabUpdatedTestModel.method,
      technology: LabUpdatedTestModel.technology,
      testType: LabUpdatedTestModel.testType,
      turnaroundTimeHours: LabUpdatedTestModel.turnaroundTimeHours,
      clinicalSignificance: LabUpdatedTestModel.clinicalSignificance,
      limitations: LabUpdatedTestModel.limitations,
      advice: LabUpdatedTestModel.advice,
      testDisclaimer: LabUpdatedTestModel.testDisclaimer,
      whenResultHigh: LabUpdatedTestModel.whenResultHigh,
      whenResultLow: LabUpdatedTestModel.whenResultLow,
      whenResultCritical: LabUpdatedTestModel.whenResultCritical,
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
    .where(eq(LabUpdatedTestModel.id, testId))
    .limit(1);

  if (!test) {
    throw new HttpError(404, 'Test not found');
  }

  const [aliasRows, parameterRows] = await Promise.all([
    trx
      .select({ alias: LabUpdatedTestAliasModel.alias })
      .from(LabUpdatedTestAliasModel)
      .where(eq(LabUpdatedTestAliasModel.testId, testId))
      .orderBy(asc(LabUpdatedTestAliasModel.createdAt)),
    trx
      .select()
      .from(LabTestResultParameterModel)
      .where(eq(LabTestResultParameterModel.testId, testId))
      .orderBy(asc(LabTestResultParameterModel.createdAt)),
  ]);

  const rangeParameterIds = parameterRows
    .filter((parameter) => RANGE_INPUT_TYPES.has(parameter.inputType))
    .map((parameter) => parameter.id);
  const optionParameterIds = parameterRows
    .filter((parameter) => OPTION_INPUT_TYPES.has(parameter.inputType))
    .map((parameter) => parameter.id);

  const [rangeRows, optionRows] = await Promise.all([
    rangeParameterIds.length > 0
      ? trx
          .select()
          .from(LabUpdatedParameterReferenceRangeModel)
          .where(
            inArray(
              LabUpdatedParameterReferenceRangeModel.parameterId,
              rangeParameterIds
            )
          )
      : Promise.resolve([]),
    optionParameterIds.length > 0
      ? trx
          .select()
          .from(LabUpdatedParameterOptionModel)
          .where(
            inArray(
              LabUpdatedParameterOptionModel.parameterId,
              optionParameterIds
            )
          )
      : Promise.resolve([]),
  ]);

  const rangesByParameterId = new Map<string, typeof rangeRows>();
  for (const range of rangeRows) {
    const list = rangesByParameterId.get(range.parameterId) ?? [];
    list.push(range);
    rangesByParameterId.set(range.parameterId, list);
  }

  const optionsByParameterId = new Map<string, typeof optionRows>();
  for (const option of optionRows) {
    const list = optionsByParameterId.get(option.parameterId) ?? [];
    list.push(option);
    optionsByParameterId.set(option.parameterId, list);
  }

  const libraryTest = findLibraryTest(
    { code: test.departmentCode, name: test.departmentName },
    test
  );

  const parameters = parameterRows.map((row) => {
    const parameter = {
      ...row,
      isCustom: isCustomParameter(libraryTest, row.parameterName),
    };
    if (RANGE_INPUT_TYPES.has(row.inputType)) {
      return {
        ...parameter,
        ranges: (rangesByParameterId.get(row.id) ?? []).map(toRangeOutput),
      };
    }
    if (OPTION_INPUT_TYPES.has(row.inputType)) {
      return { ...parameter, options: optionsByParameterId.get(row.id) ?? [] };
    }
    return parameter;
  });

  return {
    ...test,
    isCustom: !libraryTest,
    aliases: aliasRows.map((row) => row.alias),
    parameters,
  };
};

export const replacePackageItems = async (
  trx: DbTransaction,
  packageId: string,
  labTestIds: string[],
  now = new Date()
) => {
  await trx
    .delete(LabUpdatedTestPackageItemModel)
    .where(eq(LabUpdatedTestPackageItemModel.packageId, packageId));

  await trx.insert(LabUpdatedTestPackageItemModel).values(
    labTestIds.map((labTestId) => ({
      packageId,
      labTestId,
      createdAt: now,
      updatedAt: now,
    }))
  );
};

export const formatPackage = async (trx: DbTransaction, packageId: string) => {
  const [labPackage] = await trx
    .select()
    .from(LabUpdatedTestPackageModel)
    .where(
      and(
        eq(LabUpdatedTestPackageModel.id, packageId),
        isNull(LabUpdatedTestPackageModel.deletedAt)
      )
    )
    .limit(1);

  if (!labPackage) {
    throw new HttpError(404, 'Package not found');
  }

  const tests = await trx
    .select({
      id: LabUpdatedTestModel.id,
      testName: LabUpdatedTestModel.testName,
      testCode: LabUpdatedTestModel.testCode,
      sampleType: LabUpdatedTestModel.sampleType,
      price: LabUpdatedTestModel.price,
      departmentId: LabUpdatedTestModel.departmentId,
      status: LabUpdatedTestModel.status,
    })
    .from(LabUpdatedTestPackageItemModel)
    .innerJoin(
      LabUpdatedTestModel,
      eq(LabUpdatedTestPackageItemModel.labTestId, LabUpdatedTestModel.id)
    )
    .where(eq(LabUpdatedTestPackageItemModel.packageId, packageId))
    .orderBy(asc(LabUpdatedTestPackageItemModel.createdAt));

  const totalTestPrice = tests.reduce(
    (total, test) => total + Number(test.price ?? 0),
    0
  );

  return { ...labPackage, totalTestPrice, tests };
};

export const attachTestsToDepartments = async <
  T extends typeof LabUpdatedDepartmentModel.$inferSelect,
>(
  trx: DbTransaction,
  departments: T[]
) => {
  if (departments.length === 0) return [];

  const departmentIds = departments.map((department) => department.id);
  const tests = await trx
    .select({
      id: LabUpdatedTestModel.id,
      labId: LabUpdatedTestModel.labId,
      testName: LabUpdatedTestModel.testName,
      testCode: LabUpdatedTestModel.testCode,
      sampleType: LabUpdatedTestModel.sampleType,
      price: LabUpdatedTestModel.price,
      departmentId: LabUpdatedTestModel.departmentId,
      status: LabUpdatedTestModel.status,
      createdAt: LabUpdatedTestModel.createdAt,
      updatedAt: LabUpdatedTestModel.updatedAt,
    })
    .from(LabUpdatedTestModel)
    .where(inArray(LabUpdatedTestModel.departmentId, departmentIds))
    .orderBy(asc(LabUpdatedTestModel.testName));

  const testsByDepartmentId = new Map<string, typeof tests>();

  for (const test of tests) {
    const departmentTests = testsByDepartmentId.get(test.departmentId) ?? [];
    departmentTests.push(test);
    testsByDepartmentId.set(test.departmentId, departmentTests);
  }

  return departments.map((department) => ({
    ...department,
    tests: testsByDepartmentId.get(department.id) ?? [],
  }));
};
