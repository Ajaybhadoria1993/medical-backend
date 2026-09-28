import { LabNotificationService } from '../../notifications/services/labNotification.service';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { database } from '../../../configurations/dbConnection';
import { deleteFromS3 } from '../../../configurations/s3';
import { labReportTemplate1 } from '../../../htmltamplates/lab_report_template1';
import { labReportTemplate2 } from '../../../htmltamplates/lab_report_template2';
import { labReportTemplate3 } from '../../../htmltamplates/lab_report_template3';
import { labReportTemplate4 } from '../../../htmltamplates/lab_report_template4';
import { LabReportTemplateModel } from '../models/lab.model';
import { HttpError } from '../../../middlewear/errorHandler';
import { signalLabChange } from '../../realtime';
import { generateAndUploadPdf } from '../../../utils/pdf.utils';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { signS3Url } from '../../files/services/fileUrl.service';
import { DOCUMENT_TTL_SECONDS } from '../../files/utils/s3Ref.utils';
import {
  APPOINTMENT_TEST_SAMPLE_STATUS,
  APPOINTMENT_TEST_WORKFLOW_STATUS,
  APPOINTMENT_TEST_TRACKING_EVENT,
} from '../../test/constants/appointmentTest.constants';
import {
  LabOrderModel,
  LabOrderTrackingEventModel,
  IndependentPatientModel,
} from '../../test/models/labOrder.model';
import { LabTestCatalogModel } from '../../test/models/labTestCatalog.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  LabOrderResultsModel,
  LabOrderResultValuesModel,
  LabReportTemplateParametersModel,
  LabReportTemplatesModel,
} from '../models/labResult.model';
import { UserLabAssignmentsModel, LabsModel } from '../models/lab.model';
import { LabSamplesModel } from '../models/labSample.model';
import {
  AddLabCustomFieldInput,
  HideLabDefaultFieldInput,
  OverrideLabDefaultFieldInput,
  ResetLabDefaultFieldOverrideInput,
  SaveLabResultInput,
  UnhideLabDefaultFieldInput,
  UpdateLabCustomFieldInput,
  UpdateLabResultInput,
} from '../schemas/lab.schemas';

type DbTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type LabResultStatus = 'Draft' | 'Completed' | 'Verified';
type LabResultFlag = 'Low' | 'Normal' | 'High' | 'Abnormal' | 'Not Applicable';

type LabResultContext = {
  clinicId: string;
  userId: string;
  labId?: string;
  userRole?: string;
};

type ResultValueInput = {
  parameterId: string;
  value: string;
};

type LabParameterSourceType = 'DEFAULT' | 'CUSTOM';
type LabReportTemplateParameterRow =
  typeof LabReportTemplateParametersModel.$inferSelect;
type DefaultFieldOverrideValues = Partial<{
  displayNameOverride: string | null;
  unitOverride: string | null;
  referenceRangeOverride: string | null;
  inputTypeOverride: string | null;
  sectionNameOverride: string | null;
  sortOrderOverride: number | null;
  isRequiredOverride: boolean | null;
  isHidden: boolean;
  isActive: boolean;
}>;

type MergedTemplateParameter = {
  parameterId: string;
  sectionName: string | null;
  parameterName: string;
  originalParameterName: string | null;
  unit: string | null;
  referenceRange: string | null;
  inputType: string;
  sortOrder: number;
  isRequired: boolean;
  sourceType: LabParameterSourceType;
  isCustom: boolean;
  value: string;
};

export class LabResultService {
  private static normalizeText(value: string | null | undefined) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ');
  }

  private static normalizeCode(value: string | null | undefined) {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');
  }

  static resolveTemplateCode(testName: string, category?: string | null) {
    const normalized = this.normalizeCode(`${testName} ${category ?? ''}`);

    const matchers: Array<[string, string[]]> = [
      ['CBC', ['CBC', 'COMPLETEBLOODCOUNT']],
      ['HEMOGLOBIN', ['HEMOGLOBIN', 'HAEMOGLOBIN', 'HB']],
      ['TLC', ['TLC', 'TOTALLEUKOCYTECOUNT', 'TOTALLEUKOCYTESCOUNT']],
      ['DLC', ['DLC', 'DIFFERENTIALLEUKOCYTECOUNT']],
      ['PLATELET_COUNT', ['PLATELETCOUNT']],
      ['ESR', ['ESR', 'ERYTHROCYTESEDIMENTATIONRATE']],
      ['BIOCHEMISTRY', ['BIOCHEMISTRY']],
      [
        'BLOOD_SUGAR',
        [
          'BLOODSUGAR',
          'RANDOMBLOODSUGAR',
          'FASTINGBLOODSUGAR',
          'POSTPRANDIALBLOODSUGAR',
          'HBA1C',
        ],
      ],
      ['LFT', ['LFT', 'LIVERFUNCTIONTEST']],
      ['KFT', ['KFT', 'KIDNEYFUNCTIONTEST', 'RENALFUNCTIONTEST', 'RFT']],
      ['LIPID_PROFILE', ['LIPIDPROFILE', 'LIPIDPANEL']],
      ['URIC_ACID', ['URICACID']],
      ['CREATININE', ['CREATININE', 'CREATINE']],
      ['CLINICAL_PATHOLOGY', ['CLINICALPATHOLOGY']],
      [
        'URINE_ROUTINE',
        [
          'URINEROUTINE',
          'URINEMICROSCOPY',
          'URINEANALYSIS',
          'URINALYSIS',
          'URINE',
        ],
      ],
      ['STOOL_ROUTINE', ['STOOLROUTINE', 'STOOLEXAMINATION']],
      [
        'PREGNANCY_TEST',
        ['PREGNANCYTEST', 'URINEPREGNANCYTEST', 'BETA HCG', 'BETAHCG'],
      ],
      ['MICROBIOLOGY', ['MICROBIOLOGY']],
      ['BLOOD_CULTURE', ['BLOODCULTURE']],
      ['URINE_CULTURE', ['URINECULTURE']],
      ['SPUTUM_CULTURE', ['SPUTUMCULTURE']],
      ['SEROLOGY_IMMUNOLOGY', ['SEROLOGYIMMUNOLOGY', 'SEROLOGY', 'IMMUNOLOGY']],
      ['HIV', ['HIV', 'HIV12']],
      ['HBSAG', ['HBSAG', 'HEPATITISBSURFACEANTIGEN']],
      ['DENGUE', ['DENGUE', 'NS1']],
      ['TYPHOID', ['TYPHOID', 'WIDAL']],
      ['CRP', ['CRP', 'CREACTIVEPROTEIN']],
      ['RA_FACTOR', ['RAFACTOR', 'RHEUMATOIDFACTOR']],
      ['COAGULATION', ['COAGULATION']],
      ['PT_INR', ['PTINR', 'PROTHROMBINTIME']],
      ['APTT', ['APTT', 'ACTIVATEDPARTIALTHROMBOPLASTINTIME']],
      ['BLEEDING_TIME', ['BLEEDINGTIME']],
      ['CLOTTING_TIME', ['CLOTTINGTIME']],
      ['PARASITOLOGY', ['PARASITOLOGY']],
      ['MALARIA', ['MALARIA']],
      ['STOOL_PARASITE', ['STOOLPARASITE']],
      ['HISTOPATHOLOGY', ['HISTOPATHOLOGY']],
      ['BIOPSY', ['BIOPSY']],
      ['FNAC', ['FNAC']],
      ['CYTOLOGY', ['CYTOLOGY']],
      ['PAP_SMEAR', ['PAPSMEAR']],
      ['FLUID_CYTOLOGY', ['FLUIDCYTOLOGY']],
      ['MOLECULAR_DIAGNOSTICS', ['MOLECULARDIAGNOSTICS', 'MOLECULAR']],
      ['RT_PCR', ['RTPCR', 'PCR']],
      ['HPV_DNA', ['HPVDNA', 'HPV']],
      ['BLOOD_BANK', ['BLOODBANK']],
      ['BLOOD_GROUPING', ['BLOODGROUPING', 'BLOODGROUP']],
      ['CROSS_MATCH', ['CROSSMATCH']],
    ];

    for (const [code, aliases] of matchers) {
      if (aliases.some((alias) => normalized.includes(alias))) {
        return code;
      }
    }

    return null;
  }

  /**
   * Primary template code resolution: look up the lab_test by name in the
   * lab's catalog and use its testCode field. This provides a deterministic
   * mapping (e.g. Hemoglobin → HEMOGLOBIN, TLC → TLC) instead of the old
   * fuzzy name approach that collapsed individual tests into department
   * templates.
   */
  private static async resolveTestCodeFromCatalog(
    trx: DbTransaction,
    labId: string,
    order: { testName: string; testCategory: string | null }
  ) {
    const orderNameNormalized = this.normalizeCode(order.testName);

    // First try exact name match
    const catalogTests = await trx
      .select({
        testCode: LabTestCatalogModel.testCode,
        testName: LabTestCatalogModel.name,
      })
      .from(LabTestCatalogModel)
      .where(
        and(
          eq(LabTestCatalogModel.labId, labId),
          eq(LabTestCatalogModel.status, 'active'),
          isNull(LabTestCatalogModel.deletedAt)
        )
      );

    for (const catalogTest of catalogTests) {
      const catalogNameNormalized = this.normalizeCode(catalogTest.testName);

      const isSameTest =
        catalogNameNormalized === orderNameNormalized ||
        catalogNameNormalized.includes(orderNameNormalized) ||
        orderNameNormalized.includes(catalogNameNormalized);

      if (isSameTest && catalogTest.testCode) {
        return catalogTest.testCode;
      }
    }

    return null;
  }

  private static async resolveTemplateCodeForOrder(
    trx: DbTransaction,
    order: { testName: string; testCategory: string | null },
    labId?: string
  ) {
    // 1. Primary path: resolve from lab catalog testCode
    if (labId) {
      try {
        const catalogTestCode = await this.resolveTestCodeFromCatalog(
          trx,
          labId,
          order
        );
        if (catalogTestCode) return catalogTestCode;
      } catch {
        // test_code column may not exist yet (migration pending) — fall through
      }
    }

    // 2. Fallback: fuzzy name match (for custom tests without testCode)
    const directCode = this.resolveTemplateCode(
      order.testName,
      order.testCategory
    );

    return directCode;
  }

  private static parseNumericRange(referenceRange: string | null | undefined) {
    if (!referenceRange) return null;

    const normalized = referenceRange.replace(/[–—]/g, '-').trim();
    const match = normalized.match(
      /^([+-]?\d+(?:\.\d+)?)\s*-\s*([+-]?\d+(?:\.\d+)?)$/
    );

    if (!match) return null;

    const low = Number(match[1]);
    const high = Number(match[2]);

    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

    return { low, high };
  }

  private static calculateFlag(
    value: string,
    referenceRange: string | null | undefined
  ): LabResultFlag {
    const trimmedValue = value.trim();
    const reference = referenceRange?.trim();

    if (!trimmedValue || !reference || reference === '-') {
      return 'Not Applicable';
    }

    const range = this.parseNumericRange(reference);
    const numericValue = Number(trimmedValue);

    if (range && Number.isFinite(numericValue)) {
      if (numericValue < range.low) return 'Low';
      if (numericValue > range.high) return 'High';
      return 'Normal';
    }

    const normalizedValue = this.normalizeText(trimmedValue);
    const normalizedReference = this.normalizeText(reference);

    if (!normalizedValue || !normalizedReference) {
      return 'Not Applicable';
    }

    if (normalizedValue === normalizedReference) {
      return 'Normal';
    }

    if (
      normalizedReference.includes('negative') &&
      normalizedValue.includes('positive')
    ) {
      return 'Abnormal';
    }

    if (
      normalizedReference.includes('positive') &&
      normalizedValue.includes('negative')
    ) {
      return 'Abnormal';
    }

    return 'Not Applicable';
  }

  private static async assertLabAccess(
    trx: DbTransaction,
    context: LabResultContext
  ) {
    if (!context.labId) return;

    if (
      context.userRole === 'Admin' ||
      context.userRole === 'Super_Admin' ||
      context.userRole === 'Receptionist'
    ) {
      const [lab] = await trx
        .select({ id: LabsModel.id })
        .from(LabsModel)
        .where(
          and(
            eq(LabsModel.id, context.labId),
            eq(LabsModel.clinicId, context.clinicId),
            isNull(LabsModel.deletedAt)
          )
        )
        .limit(1);

      if (lab) {
        return;
      }

      throw new HttpError(403, 'Lab access denied');
    }

    const [assignment] = await trx
      .select({ id: UserLabAssignmentsModel.id })
      .from(UserLabAssignmentsModel)
      .where(
        and(
          eq(UserLabAssignmentsModel.userId, context.userId),
          eq(UserLabAssignmentsModel.labId, context.labId),
          eq(UserLabAssignmentsModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    if (!assignment) {
      throw new HttpError(403, 'Lab assistant is not allowed for this lab');
    }
  }

  private static requireLabId(context: LabResultContext) {
    if (!context.labId) {
      throw new HttpError(400, 'Lab context is required');
    }

    return context.labId;
  }

  private static resolveOrderLabId(
    order: {
      assignedLabId: string | null;
    },
    context: LabResultContext
  ) {
    if (context.userRole === 'Lab_Assistant') {
      return this.requireLabId(context);
    }

    return order.assignedLabId ?? this.requireLabId(context);
  }

  private static resolveParameterUserId(
    context: LabResultContext,
    labAssistantId?: string | null,
    enteredBy?: string | null
  ) {
    if (context.userRole === 'Lab_Assistant') {
      return context.userId;
    }

    return labAssistantId ?? enteredBy ?? context.userId;
  }

  private static async getLabIdentity(
    trx: DbTransaction,
    labId: string,
    clinicId: string
  ) {
    const [lab] = await trx
      .select({
        id: LabsModel.id,
        name: LabsModel.name,
        address: LabsModel.address,
        contactNumber: LabsModel.contactNo,
      })
      .from(LabsModel)
      .where(
        and(
          eq(LabsModel.id, labId),
          eq(LabsModel.clinicId, clinicId),
          isNull(LabsModel.deletedAt)
        )
      )
      .limit(1);

    if (!lab) {
      throw new HttpError(404, 'Lab not found');
    }

    return lab;
  }

  private static assertCanManageFields(context: LabResultContext) {
    this.requireLabId(context);

    if (!['Admin', 'Lab_Assistant'].includes(context.userRole ?? '')) {
      throw new HttpError(
        403,
        'User is not authorized to manage lab report fields'
      );
    }
  }

  private static async getScopedLabOrder(
    trx: DbTransaction,
    labOrderId: string,
    context: LabResultContext
  ) {
    await this.assertLabAccess(trx, context);

    const patientUser = alias(UserModel, 'lab_result_patient_user');
    const patientProfile = alias(
      UserProfileModel,
      'lab_result_patient_profile'
    );
    const doctorUser = alias(UserModel, 'lab_result_doctor_user');

    const [record] = await trx
      .select({
        appointmentTest: LabOrderModel,
        appointmentId: LabOrderModel.appointmentId,
        appointmentDate: sql<Date>`coalesce(${AppointmentModel.appointmentDate}, ${LabOrderModel.createdAt})`,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        patientId: patientUser.id,
        patientName: sql<
          string | null
        >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`,
        patientEmail: patientUser.email,
        patientMobile: sql<
          string | null
        >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`,
        patientAge: sql<
          number | null
        >`coalesce(${patientProfile.age}, ${IndependentPatientModel.age})`,
        patientDob: patientProfile.dob,
        patientGender: sql<
          string | null
        >`coalesce(${patientProfile.gender}, ${IndependentPatientModel.gender})`,
        doctorId: doctorUser.id,
        doctorName: sql<
          string | null
        >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`,
        testId: TestCatalogModel.id,
        testName: TestCatalogModel.name,
        testCategory: TestCatalogModel.category,
        assignedLabId: UserLabAssignmentsModel.labId,
      })
      .from(LabOrderModel)
      .leftJoin(
        AppointmentModel,
        eq(LabOrderModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .innerJoin(ClinicModel, eq(LabOrderModel.clinicId, ClinicModel.id))
      .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
      .leftJoin(patientProfile, eq(patientProfile.userId, patientUser.id))
      .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .leftJoin(
        UserLabAssignmentsModel,
        and(
          eq(LabOrderModel.labAssistantId, UserLabAssignmentsModel.userId),
          eq(UserLabAssignmentsModel.clinicId, context.clinicId)
        )
      )
      .where(
        and(
          eq(LabOrderModel.id, labOrderId),
          eq(LabOrderModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    if (!record) {
      throw new HttpError(404, 'Lab order not found');
    }

    if (
      context.userRole === 'Lab_Assistant' &&
      context.labId &&
      record.appointmentTest.labAssistantId &&
      record.assignedLabId !== context.labId
    ) {
      throw new HttpError(403, 'Lab order is assigned to another lab');
    }

    return record;
  }

  private static ensureSampleReady(order: {
    appointmentTest: { sampleStatus: string | null };
  }) {
    if (
      order.appointmentTest.sampleStatus !==
        APPOINTMENT_TEST_SAMPLE_STATUS.QUALITY_CHECK &&
      order.appointmentTest.sampleStatus !==
        APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED
    ) {
      throw new HttpError(
        400,
        'Result entry is available only after sample is verified/quality checked'
      );
    }
  }

  private static async getTemplateForOrder(
    trx: DbTransaction,
    order: { testName: string; testCategory: string | null },
    labId?: string
  ) {
    let templateCode = await this.resolveTemplateCodeForOrder(
      trx,
      order,
      labId
    );

    // When no template code is resolved and we have a lab context,
    // auto-create a lab-specific template so the lab assistant can
    // add custom parameters via "Manage Fields".
    if (!templateCode) {
      if (!labId) {
        throw new HttpError(
          404,
          `No report template configured for ${order.testName}`
        );
      }

      templateCode = `CUSTOM_${this.normalizeCode(order.testName)}`;
    }

    const [existingTemplate] = await trx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          eq(LabReportTemplatesModel.code, templateCode),
          eq(LabReportTemplatesModel.isActive, true),
          labId
            ? or(
                eq(LabReportTemplatesModel.labId, labId),
                isNull(LabReportTemplatesModel.labId)
              )
            : isNull(LabReportTemplatesModel.labId)
        )
      )
      .orderBy(
        labId
          ? sql`CASE WHEN ${LabReportTemplatesModel.labId} = ${labId} THEN 0 ELSE 1 END`
          : asc(LabReportTemplatesModel.name)
      )
      .limit(1);

    if (existingTemplate) {
      return existingTemplate;
    }

    // No existing template found — auto-create a lab-specific one
    if (!labId) {
      throw new HttpError(
        404,
        `Active report template not found for ${order.testName}`
      );
    }

    const sampleType = order.testCategory ?? 'Other';

    const [newTemplate] = await trx
      .insert(LabReportTemplatesModel)
      .values({
        labId,
        name: order.testName,
        code: templateCode,
        sampleType,
        description: `Auto-created template for ${order.testName}`,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    // If the insert was a no-op due to conflict, re-fetch the existing row
    if (!newTemplate) {
      const [conflictTemplate] = await trx
        .select()
        .from(LabReportTemplatesModel)
        .where(
          and(
            eq(LabReportTemplatesModel.code, templateCode),
            eq(LabReportTemplatesModel.labId, labId),
            eq(LabReportTemplatesModel.isActive, true)
          )
        )
        .limit(1);

      if (!conflictTemplate) {
        throw new HttpError(
          404,
          `Active report template not found for ${order.testName}`
        );
      }

      return conflictTemplate;
    }

    return newTemplate;
  }

  private static async validateTemplateMatchesOrder(
    trx: DbTransaction,
    templateId: string,
    order: { testName: string; testCategory: string | null },
    labId?: string
  ) {
    const [template] = await trx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          eq(LabReportTemplatesModel.id, templateId),
          eq(LabReportTemplatesModel.isActive, true),
          labId
            ? or(
                eq(LabReportTemplatesModel.labId, labId),
                isNull(LabReportTemplatesModel.labId)
              )
            : isNull(LabReportTemplatesModel.labId)
        )
      )
      .limit(1);

    if (!template) {
      throw new HttpError(404, 'Report template not found');
    }

    const expectedCode = await this.resolveTemplateCodeForOrder(
      trx,
      order,
      labId
    );

    // Accept the template if the code matches the resolved code, or if it
    // matches the auto-generated CUSTOM_<test_name> code (for tests without
    // a seeded template).
    const autoCreatedCode = `CUSTOM_${this.normalizeCode(order.testName)}`;
    const codeMatches =
      (expectedCode && template.code === expectedCode) ||
      template.code === autoCreatedCode;

    if (!codeMatches) {
      throw new HttpError(
        400,
        `Template ${template.code} does not match lab order test ${order.testName}`
      );
    }

    return template;
  }

  private static async getMergedTemplateParameters(
    trx: DbTransaction,
    templateId: string,
    labId: string,
    userId: string
  ): Promise<MergedTemplateParameter[]> {
    const defaultParameters = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.templateId, templateId),
          eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
          eq(LabReportTemplateParametersModel.isCustom, false),
          eq(LabReportTemplateParametersModel.isActive, true),
          isNull(LabReportTemplateParametersModel.labId)
        )
      );

    const defaultParameterIds = defaultParameters.map(
      (parameter) => parameter.id
    );
    const overrideParameters = defaultParameterIds.length
      ? await trx
          .select()
          .from(LabReportTemplateParametersModel)
          .where(
            and(
              eq(LabReportTemplateParametersModel.labId, labId),
              eq(LabReportTemplateParametersModel.createdBy, userId),
              eq(LabReportTemplateParametersModel.templateId, templateId),
              eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
              eq(LabReportTemplateParametersModel.isCustom, false),
              eq(LabReportTemplateParametersModel.isActive, true),
              inArray(
                LabReportTemplateParametersModel.baseParameterId,
                defaultParameterIds
              )
            )
          )
      : [];

    const overrideByParameterId = new Map(
      overrideParameters
        .filter((override) => override.baseParameterId)
        .map((override) => [override.baseParameterId, override])
    );

    const mergedDefaults = defaultParameters.flatMap((parameter) => {
      const override = overrideByParameterId.get(parameter.id);

      if (override?.isHidden) {
        return [];
      }

      return [
        {
          parameterId: parameter.id,
          sectionName: override?.sectionName ?? parameter.sectionName ?? null,
          parameterName: override?.parameterName ?? parameter.parameterName,
          originalParameterName: parameter.parameterName,
          unit: override?.unit ?? parameter.unit ?? null,
          referenceRange:
            override?.referenceRange ?? parameter.referenceRange ?? null,
          inputType: override?.inputType ?? parameter.inputType,
          sortOrder: override?.sortOrder ?? parameter.sortOrder,
          isRequired: override?.isRequired ?? parameter.isRequired,
          sourceType: 'DEFAULT' as const,
          isCustom: false,
          value: '',
        },
      ];
    });

    const customParameters = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.templateId, templateId),
          eq(LabReportTemplateParametersModel.labId, labId),
          eq(LabReportTemplateParametersModel.createdBy, userId),
          eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
          eq(LabReportTemplateParametersModel.isCustom, true),
          eq(LabReportTemplateParametersModel.isActive, true)
        )
      );

    const mergedCustomParameters = customParameters.map((parameter) => ({
      parameterId: parameter.id,
      sectionName: parameter.sectionName ?? null,
      parameterName: parameter.parameterName,
      originalParameterName: parameter.parameterName,
      unit: parameter.unit ?? null,
      referenceRange: parameter.referenceRange ?? null,
      inputType: parameter.inputType,
      sortOrder: parameter.sortOrder,
      isRequired: parameter.isRequired,
      sourceType: 'CUSTOM' as const,
      isCustom: true,
      value: '',
    }));

    return [...mergedDefaults, ...mergedCustomParameters].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.parameterName.localeCompare(right.parameterName)
    );
  }

  // Listing for the "Manage Fields" UI. Unlike getMergedTemplateParameters
  // (which powers result entry and therefore omits hidden fields), this returns
  // EVERY parameter — including hidden ones — with their override/hidden state,
  // so the frontend can render Override / Hide / Unhide / Reset for each row.
  private static async getManageableParameters(
    trx: DbTransaction,
    templateId: string,
    labId: string,
    userId: string
  ) {
    const defaultParameters = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.templateId, templateId),
          eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
          eq(LabReportTemplateParametersModel.isCustom, false),
          eq(LabReportTemplateParametersModel.isActive, true),
          isNull(LabReportTemplateParametersModel.labId)
        )
      );

    const defaultParameterIds = defaultParameters.map(
      (parameter) => parameter.id
    );
    const overrideParameters = defaultParameterIds.length
      ? await trx
          .select()
          .from(LabReportTemplateParametersModel)
          .where(
            and(
              eq(LabReportTemplateParametersModel.labId, labId),
              eq(LabReportTemplateParametersModel.createdBy, userId),
              eq(LabReportTemplateParametersModel.templateId, templateId),
              eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
              eq(LabReportTemplateParametersModel.isCustom, false),
              eq(LabReportTemplateParametersModel.isActive, true),
              inArray(
                LabReportTemplateParametersModel.baseParameterId,
                defaultParameterIds
              )
            )
          )
      : [];

    const overrideByParameterId = new Map(
      overrideParameters
        .filter((override) => override.baseParameterId)
        .map((override) => [override.baseParameterId, override])
    );

    const mergedDefaults = defaultParameters.map((parameter) => {
      const override = overrideByParameterId.get(parameter.id);
      const hasOverride = Boolean(
        override &&
        (override.parameterName !== parameter.parameterName ||
          (override.unit ?? null) !== (parameter.unit ?? null) ||
          (override.referenceRange ?? null) !==
            (parameter.referenceRange ?? null) ||
          override.inputType !== parameter.inputType ||
          (override.sectionName ?? null) !== (parameter.sectionName ?? null) ||
          override.sortOrder !== parameter.sortOrder ||
          override.isRequired !== parameter.isRequired)
      );

      return {
        parameterId: parameter.id,
        templateId: parameter.templateId,
        sectionName: override?.sectionName ?? parameter.sectionName ?? null,
        parameterName: override?.parameterName ?? parameter.parameterName,
        originalParameterName: parameter.parameterName,
        unit: override?.unit ?? parameter.unit ?? null,
        referenceRange:
          override?.referenceRange ?? parameter.referenceRange ?? null,
        inputType: override?.inputType ?? parameter.inputType,
        sortOrder: override?.sortOrder ?? parameter.sortOrder,
        isRequired: override?.isRequired ?? parameter.isRequired,
        sourceType: 'DEFAULT' as const,
        isCustom: false,
        isHidden: override?.isHidden ?? false,
        hasOverride,
        isDefault: true,
        canOverride: true,
        canHide: true,
        canEdit: false,
        canDelete: false,
      };
    });

    const customParameters = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.templateId, templateId),
          eq(LabReportTemplateParametersModel.labId, labId),
          eq(LabReportTemplateParametersModel.createdBy, userId),
          eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
          eq(LabReportTemplateParametersModel.isCustom, true),
          eq(LabReportTemplateParametersModel.isActive, true)
        )
      );

    const mergedCustomParameters = customParameters.map((parameter) => ({
      parameterId: parameter.id,
      templateId: parameter.templateId,
      sectionName: parameter.sectionName ?? null,
      parameterName: parameter.parameterName,
      originalParameterName: parameter.parameterName,
      unit: parameter.unit ?? null,
      referenceRange: parameter.referenceRange ?? null,
      inputType: parameter.inputType,
      sortOrder: parameter.sortOrder,
      isRequired: parameter.isRequired,
      sourceType: 'CUSTOM' as const,
      isCustom: true,
      isHidden: false,
      hasOverride: false,
      isDefault: false,
      canOverride: false,
      canHide: false,
      canEdit: true,
      canDelete: true,
    }));

    return [...mergedDefaults, ...mergedCustomParameters].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.parameterName.localeCompare(right.parameterName)
    );
  }

  static async getManageableTemplateParameters(
    templateId: string,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);
      const template = await this.getActiveTemplateById(trx, templateId, labId);
      const parameters = await this.getManageableParameters(
        trx,
        templateId,
        labId,
        context.userId
      );

      return {
        templateId: template.id,
        templateName: template.name,
        templateCode: template.code,
        sampleType: template.sampleType,
        parameters,
      };
    });
  }

  private static async validateAndBuildValueRows(
    trx: DbTransaction,
    templateId: string,
    resultId: string,
    status: LabResultStatus,
    values: ResultValueInput[],
    context: LabResultContext
  ) {
    const labId = this.requireLabId(context);
    const parameterIds = values.map((item) => item.parameterId);
    const uniqueParameterIds = Array.from(new Set(parameterIds));

    if (uniqueParameterIds.length !== parameterIds.length) {
      throw new HttpError(400, 'Duplicate parameter values are not allowed');
    }

    const mergedParameters = await this.getMergedTemplateParameters(
      trx,
      templateId,
      labId,
      context.userId
    );
    const parameterById = new Map(
      mergedParameters.map((parameter) => [parameter.parameterId, parameter])
    );

    if (
      uniqueParameterIds.some((parameterId) => !parameterById.has(parameterId))
    ) {
      throw new HttpError(
        400,
        'One or more parameters are not available for this lab template'
      );
    }

    if (status === 'Completed') {
      const valueByParameterId = new Map(
        values.map((item) => [item.parameterId, item.value.trim()])
      );

      const missingRequiredParameter = mergedParameters.find((parameter) => {
        if (!parameter.isRequired) return false;

        const value = valueByParameterId.get(parameter.parameterId);
        return value === undefined || value === '';
      });

      if (missingRequiredParameter) {
        throw new HttpError(
          400,
          `${missingRequiredParameter.parameterName} is required`
        );
      }
    }

    return values.map((item) => {
      const parameter = parameterById.get(item.parameterId);

      if (!parameter) {
        throw new HttpError(400, 'Invalid parameter value');
      }

      return {
        resultId,
        parameterId: parameter.parameterId,
        parameterNameSnapshot:
          parameter.originalParameterName ?? parameter.parameterName,
        displayNameSnapshot: parameter.parameterName,
        value: item.value.trim(),
        sectionNameSnapshot: parameter.sectionName,
        unitSnapshot: parameter.unit,
        referenceRangeSnapshot: parameter.referenceRange,
        inputTypeSnapshot: parameter.inputType,
        sortOrderSnapshot: parameter.sortOrder,
        isRequiredSnapshot: parameter.isRequired,
        sourceTypeSnapshot: parameter.sourceType,
        isCustomSnapshot: parameter.isCustom,
        flag: this.calculateFlag(item.value, parameter.referenceRange),
      };
    });
  }

  private static async getResultRecord(
    trx: DbTransaction,
    resultId: string,
    context: LabResultContext
  ) {
    await this.assertLabAccess(trx, context);

    const patientUser = alias(UserModel, 'lab_saved_result_patient_user');
    const doctorUser = alias(UserModel, 'lab_saved_result_doctor_user');
    const enteredByUser = alias(UserModel, 'lab_saved_result_entered_by_user');
    const verifiedByUser = alias(
      UserModel,
      'lab_saved_result_verified_by_user'
    );

    const [record] = await trx
      .select({
        result: LabOrderResultsModel,
        template: LabReportTemplatesModel,
        appointmentTest: LabOrderModel,
        appointmentId: LabOrderModel.appointmentId,
        appointmentDate: sql<Date>`coalesce(${AppointmentModel.appointmentDate}, ${LabOrderModel.createdAt})`,
        appointmentTime: AppointmentModel.appointmentTime,
        tokenNo: AppointmentModel.tokenNo,
        clinicId: ClinicModel.id,
        clinicName: ClinicModel.clinicName,
        clinicAddress: ClinicModel.clinicAddress,
        clinicLocation: ClinicModel.clinicLocation,
        patientId: patientUser.id,
        patientName: sql<
          string | null
        >`coalesce(${patientUser.name}, ${IndependentPatientModel.name})`,
        patientEmail: patientUser.email,
        patientMobile: sql<
          string | null
        >`coalesce(${patientUser.mobile}, ${IndependentPatientModel.mobile})`,
        doctorId: doctorUser.id,
        doctorName: sql<
          string | null
        >`coalesce(${doctorUser.name}, ${IndependentPatientModel.doctorName})`,
        testId: TestCatalogModel.id,
        testName: TestCatalogModel.name,
        testCategory: TestCatalogModel.category,
        enteredByName: enteredByUser.name,
        verifiedByName: verifiedByUser.name,
        assignedLabId: UserLabAssignmentsModel.labId,
        labName: LabsModel.name,
        labAddress: LabsModel.address,
        labContactNumber: LabsModel.contactNo,
      })
      .from(LabOrderResultsModel)
      .innerJoin(
        LabReportTemplatesModel,
        eq(LabOrderResultsModel.templateId, LabReportTemplatesModel.id)
      )
      .innerJoin(
        LabOrderModel,
        eq(LabOrderResultsModel.appointmentTestId, LabOrderModel.id)
      )
      .leftJoin(
        AppointmentModel,
        eq(LabOrderModel.appointmentId, AppointmentModel.id)
      )
      .innerJoin(
        TestCatalogModel,
        eq(LabOrderModel.testId, TestCatalogModel.id)
      )
      .innerJoin(ClinicModel, eq(LabOrderModel.clinicId, ClinicModel.id))
      .leftJoin(patientUser, eq(LabOrderModel.patientId, patientUser.id))
      .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
      .leftJoin(
        IndependentPatientModel,
        eq(LabOrderModel.independentPatientId, IndependentPatientModel.id)
      )
      .leftJoin(
        enteredByUser,
        eq(LabOrderResultsModel.enteredBy, enteredByUser.id)
      )
      .leftJoin(
        verifiedByUser,
        eq(LabOrderResultsModel.verifiedBy, verifiedByUser.id)
      )
      .leftJoin(
        UserLabAssignmentsModel,
        and(
          eq(LabOrderModel.labAssistantId, UserLabAssignmentsModel.userId),
          eq(UserLabAssignmentsModel.clinicId, context.clinicId)
        )
      )
      .leftJoin(LabsModel, eq(LabsModel.id, UserLabAssignmentsModel.labId))
      .where(
        and(
          eq(LabOrderResultsModel.id, resultId),
          eq(LabOrderModel.clinicId, context.clinicId)
        )
      )
      .limit(1);

    if (!record) {
      throw new HttpError(404, 'Lab result not found');
    }

    if (
      context.userRole === 'Lab_Assistant' &&
      context.labId &&
      record.appointmentTest.labAssistantId &&
      record.assignedLabId !== context.labId
    ) {
      throw new HttpError(403, 'Lab result belongs to another lab');
    }

    return record;
  }

  private static async getResultValues(trx: DbTransaction, resultId: string) {
    return await trx
      .select({
        id: LabOrderResultValuesModel.id,
        parameterId: LabOrderResultValuesModel.parameterId,
        parameterName: sql<string>`COALESCE(${LabOrderResultValuesModel.displayNameSnapshot}, ${LabOrderResultValuesModel.parameterNameSnapshot})`,
        displayName: LabOrderResultValuesModel.displayNameSnapshot,
        originalParameterName: LabOrderResultValuesModel.parameterNameSnapshot,
        value: LabOrderResultValuesModel.value,
        sectionName: LabOrderResultValuesModel.sectionNameSnapshot,
        unit: LabOrderResultValuesModel.unitSnapshot,
        referenceRange: LabOrderResultValuesModel.referenceRangeSnapshot,
        inputType: LabOrderResultValuesModel.inputTypeSnapshot,
        sortOrder: LabOrderResultValuesModel.sortOrderSnapshot,
        isRequired: LabOrderResultValuesModel.isRequiredSnapshot,
        sourceType: LabOrderResultValuesModel.sourceTypeSnapshot,
        isCustom: LabOrderResultValuesModel.isCustomSnapshot,
        flag: LabOrderResultValuesModel.flag,
        createdAt: LabOrderResultValuesModel.createdAt,
        updatedAt: LabOrderResultValuesModel.updatedAt,
      })
      .from(LabOrderResultValuesModel)
      .where(eq(LabOrderResultValuesModel.resultId, resultId))
      .orderBy(
        asc(LabOrderResultValuesModel.sortOrderSnapshot),
        asc(LabOrderResultValuesModel.parameterNameSnapshot)
      );
  }

  private static canUseReportFile(status: LabResultStatus) {
    return status === 'Completed' || status === 'Verified';
  }

  private static buildReportActions(
    resultId: string,
    status: LabResultStatus,
    reportPdf: string | null
  ) {
    const canUseReport = this.canUseReportFile(status);

    return {
      canDownload: canUseReport,
      downloadApiUrl: canUseReport
        ? `/api/v1/lab/results/${resultId}/report`
        : null,
      downloadUrl: reportPdf,
      canUpload: canUseReport,
      uploadUrl: canUseReport
        ? `/api/v1/lab/results/${resultId}/report-upload`
        : null,
      uploadField: 'reportPdf',
      allowedUploadFormats: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      currentFileUrl: reportPdf,
    };
  }

  private static formatReportDate(value: Date | string | null | undefined) {
    if (!value) return '';

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(date);
  }

  private static buildLabReportPdfData(
    reportData: ReturnType<typeof LabResultService.formatSavedResult>,
    generatedAt: Date
  ) {
    return {
      labResult: {
        id: reportData.id,
        status: reportData.status,
        remarks: reportData.remarks ?? '',
        verifiedAt: this.formatReportDate(reportData.verifiedAt),
      },
      clinic: {
        name: reportData.lab.name || reportData.clinic.name || '',
        address: [
          reportData.lab.address || reportData.clinic.address || '',
          reportData.lab.contactNumber
            ? `(Contact: ${reportData.lab.contactNumber})`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
        clinicLocation: reportData.clinic.clinicLocation ?? '',
      },
      patient: {
        name: reportData.patient?.name ?? '',
        email: reportData.patient?.email ?? '',
        mobile: reportData.patient?.mobile ?? '',
      },
      doctor: {
        name: reportData.doctor?.name ?? '',
      },
      test: {
        name: reportData.order.test.name,
        category: reportData.order.test.category ?? '',
      },
      appointment: {
        date: this.formatReportDate(reportData.order.appointmentDate),
        time: reportData.order.appointmentTime ?? '',
        tokenNo: reportData.order.tokenNo ?? '',
      },
      template: {
        name: reportData.template.name,
        code: reportData.template.code,
        sampleType: reportData.template.sampleType,
      },
      values: reportData.values.map((value) => ({
        parameterName: value.parameterName,
        value: value.value,
        unit: value.unit ?? '',
        referenceRange: value.referenceRange ?? '',
        flag: value.flag,
      })),
      generatedAt: this.formatReportDate(generatedAt),
    };
  }

  private static shouldGenerateReportPdf(
    record: Awaited<ReturnType<typeof LabResultService.getResultRecord>>,
    templateUpdatedAt?: Date | null
  ) {
    if (!record.appointmentTest.reportPdf) return true;
    if (!record.appointmentTest.updatedAt) return true;

    if (record.result.updatedAt > record.appointmentTest.updatedAt) return true;

    if (
      templateUpdatedAt &&
      templateUpdatedAt > record.appointmentTest.updatedAt
    ) {
      return true;
    }

    return false;
  }

  private static isS3CredentialError(error: unknown) {
    if (!error || typeof error !== 'object') return false;

    const name = 'name' in error ? String(error.name) : '';
    const message = 'message' in error ? String(error.message) : '';

    return (
      name === 'InvalidToken' ||
      message.toLowerCase().includes('provided token') ||
      message.toLowerCase().includes('invalid token')
    );
  }

  private static formatSavedResult(
    record: Awaited<ReturnType<typeof LabResultService.getResultRecord>>,
    values: Awaited<ReturnType<typeof LabResultService.getResultValues>>
  ) {
    return {
      id: record.result.id,
      labOrderId: record.result.labOrderId,
      appointmentTestId: record.result.appointmentTestId,
      status: record.result.status,
      remarks: record.result.remarks,
      enteredBy: record.result.enteredBy
        ? {
            id: record.result.enteredBy,
            name: record.enteredByName,
          }
        : null,
      verifiedBy: record.result.verifiedBy
        ? {
            id: record.result.verifiedBy,
            name: record.verifiedByName,
          }
        : null,
      verifiedAt: record.result.verifiedAt,
      createdAt: record.result.createdAt,
      updatedAt: record.result.updatedAt,
      template: {
        id: record.template.id,
        name: record.template.name,
        code: record.template.code,
        sampleType: record.template.sampleType,
      },
      order: {
        id: record.appointmentTest.id,
        appointmentId: record.appointmentId,
        appointmentDate: record.appointmentDate,
        appointmentTime: record.appointmentTime,
        tokenNo: record.tokenNo,
        workflowStatus: record.appointmentTest.workflowStatus,
        sampleStatus: record.appointmentTest.sampleStatus,
        reportStatus: record.appointmentTest.reportStatus,
        reportPdf: record.appointmentTest.reportPdf,
        test: {
          id: record.testId,
          name: record.testName,
          category: record.testCategory,
        },
      },
      clinic: {
        id: record.clinicId,
        name: record.clinicName,
        address: record.clinicAddress,
        clinicLocation: record.clinicLocation,
      },
      lab: {
        name: record.labName ?? null,
        address: record.labAddress ?? null,
        contactNumber: record.labContactNumber ?? null,
      },
      patient:
        record.patientName || record.patientMobile
          ? {
              id: record.patientId ?? null,
              name: record.patientName,
              email: record.patientEmail,
              mobile: record.patientMobile,
            }
          : null,
      doctor:
        record.doctorId || record.doctorName
          ? {
              id: record.doctorId ?? null,
              name: record.doctorName,
            }
          : null,
      values,
      reportActions: this.buildReportActions(
        record.result.id,
        record.result.status,
        record.appointmentTest.reportPdf
      ),
    };
  }

  static async getActiveReportTemplates(context?: LabResultContext) {
    const labId = context?.labId;

    return await database
      .select({
        id: LabReportTemplatesModel.id,
        labId: LabReportTemplatesModel.labId,
        name: LabReportTemplatesModel.name,
        code: LabReportTemplatesModel.code,
        sampleType: LabReportTemplatesModel.sampleType,
      })
      .from(LabReportTemplatesModel)
      .where(
        and(
          eq(LabReportTemplatesModel.isActive, true),
          labId
            ? or(
                eq(LabReportTemplatesModel.labId, labId),
                isNull(LabReportTemplatesModel.labId)
              )
            : isNull(LabReportTemplatesModel.labId)
        )
      )
      .orderBy(
        asc(LabReportTemplatesModel.name),
        sql`CASE WHEN ${LabReportTemplatesModel.labId} IS NULL THEN 1 ELSE 0 END`
      );
  }

  private static async getActiveTemplateById(
    trx: DbTransaction,
    templateId: string,
    labId?: string
  ) {
    const [template] = await trx
      .select()
      .from(LabReportTemplatesModel)
      .where(
        and(
          eq(LabReportTemplatesModel.id, templateId),
          eq(LabReportTemplatesModel.isActive, true),
          labId
            ? or(
                eq(LabReportTemplatesModel.labId, labId),
                isNull(LabReportTemplatesModel.labId)
              )
            : isNull(LabReportTemplatesModel.labId)
        )
      )
      .limit(1);

    if (!template) {
      throw new HttpError(404, 'Report template not found');
    }

    return template;
  }

  private static async getDefaultParameterForOverride(
    trx: DbTransaction,
    parameterId: string,
    templateId: string
  ) {
    const [parameter] = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.id, parameterId),
          eq(LabReportTemplateParametersModel.templateId, templateId),
          eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
          eq(LabReportTemplateParametersModel.isCustom, false),
          isNull(LabReportTemplateParametersModel.labId)
        )
      )
      .limit(1);

    if (!parameter) {
      throw new HttpError(404, 'Default report parameter not found');
    }

    return parameter;
  }

  // Resolve a default parameter by id alone (the parameter carries its own
  // templateId). Used by hide/unhide/reset where templateId is optional in the
  // body; when supplied it is validated against the parameter's real template.
  private static async getDefaultParameterById(
    trx: DbTransaction,
    parameterId: string,
    expectedTemplateId?: string
  ) {
    const [parameter] = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(LabReportTemplateParametersModel.id, parameterId),
          eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
          eq(LabReportTemplateParametersModel.isCustom, false),
          isNull(LabReportTemplateParametersModel.labId)
        )
      )
      .limit(1);

    if (!parameter) {
      throw new HttpError(404, 'Default report parameter not found');
    }

    if (expectedTemplateId && expectedTemplateId !== parameter.templateId) {
      throw new HttpError(400, 'templateId does not match parameter');
    }

    return parameter;
  }

  private static formatDefaultFieldOverride(
    baseParameter: LabReportTemplateParameterRow,
    override: LabReportTemplateParameterRow
  ) {
    return {
      id: override.id,
      labId: override.labId,
      templateId: override.templateId,
      parameterId: baseParameter.id,
      displayNameOverride:
        override.parameterName !== baseParameter.parameterName
          ? override.parameterName
          : null,
      unitOverride:
        (override.unit ?? null) !== (baseParameter.unit ?? null)
          ? override.unit
          : null,
      referenceRangeOverride:
        (override.referenceRange ?? null) !==
        (baseParameter.referenceRange ?? null)
          ? override.referenceRange
          : null,
      inputTypeOverride:
        override.inputType !== baseParameter.inputType
          ? override.inputType
          : null,
      sectionNameOverride:
        (override.sectionName ?? null) !== (baseParameter.sectionName ?? null)
          ? override.sectionName
          : null,
      sortOrderOverride:
        override.sortOrder !== baseParameter.sortOrder
          ? override.sortOrder
          : null,
      isRequiredOverride:
        override.isRequired !== baseParameter.isRequired
          ? override.isRequired
          : null,
      isHidden: override.isHidden,
      isActive: override.isActive,
      createdBy: override.createdBy,
      updatedBy: override.updatedBy,
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    };
  }

  private static async upsertDefaultFieldOverride(
    trx: DbTransaction,
    payload: {
      labId: string;
      baseParameter: LabReportTemplateParameterRow;
      userId: string;
      values: DefaultFieldOverrideValues;
    }
  ) {
    const now = new Date();
    const hasValue = (key: keyof DefaultFieldOverrideValues) =>
      Object.prototype.hasOwnProperty.call(payload.values, key);

    const [existingOverride] = await trx
      .select()
      .from(LabReportTemplateParametersModel)
      .where(
        and(
          eq(
            LabReportTemplateParametersModel.templateId,
            payload.baseParameter.templateId
          ),
          eq(LabReportTemplateParametersModel.labId, payload.labId),
          eq(LabReportTemplateParametersModel.createdBy, payload.userId),
          eq(
            LabReportTemplateParametersModel.baseParameterId,
            payload.baseParameter.id
          ),
          eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
          eq(LabReportTemplateParametersModel.isCustom, false)
        )
      )
      .limit(1);

    const currentValues = existingOverride?.isActive
      ? existingOverride
      : payload.baseParameter;

    const overrideValues = {
      sectionName: hasValue('sectionNameOverride')
        ? (payload.values.sectionNameOverride ??
          payload.baseParameter.sectionName)
        : currentValues.sectionName,
      parameterName: hasValue('displayNameOverride')
        ? (payload.values.displayNameOverride ??
          payload.baseParameter.parameterName)
        : currentValues.parameterName,
      unit: hasValue('unitOverride')
        ? (payload.values.unitOverride ?? payload.baseParameter.unit)
        : currentValues.unit,
      referenceRange: hasValue('referenceRangeOverride')
        ? (payload.values.referenceRangeOverride ??
          payload.baseParameter.referenceRange)
        : currentValues.referenceRange,
      inputType: hasValue('inputTypeOverride')
        ? (payload.values.inputTypeOverride ?? payload.baseParameter.inputType)
        : currentValues.inputType,
      sortOrder: hasValue('sortOrderOverride')
        ? (payload.values.sortOrderOverride ?? payload.baseParameter.sortOrder)
        : currentValues.sortOrder,
      isRequired: hasValue('isRequiredOverride')
        ? (payload.values.isRequiredOverride ??
          payload.baseParameter.isRequired)
        : currentValues.isRequired,
      isHidden: hasValue('isHidden')
        ? (payload.values.isHidden ?? false)
        : existingOverride?.isActive
          ? existingOverride.isHidden
          : false,
      isActive: payload.values.isActive ?? true,
    };

    if (existingOverride) {
      const [updatedOverride] = await trx
        .update(LabReportTemplateParametersModel)
        .set({
          ...overrideValues,
          updatedBy: payload.userId,
          updatedAt: now,
        })
        .where(eq(LabReportTemplateParametersModel.id, existingOverride.id))
        .returning();

      return this.formatDefaultFieldOverride(
        payload.baseParameter,
        updatedOverride
      );
    }

    const [createdOverride] = await trx
      .insert(LabReportTemplateParametersModel)
      .values({
        labId: payload.labId,
        templateId: payload.baseParameter.templateId,
        baseParameterId: payload.baseParameter.id,
        ...overrideValues,
        sourceType: 'DEFAULT',
        isCustom: false,
        createdBy: payload.userId,
        updatedBy: payload.userId,
      })
      .returning();

    return this.formatDefaultFieldOverride(
      payload.baseParameter,
      createdOverride
    );
  }

  static async addCustomField(
    templateId: string,
    payload: AddLabCustomFieldInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);
      await this.getActiveTemplateById(trx, templateId, labId);

      const [existingCustomField] = await trx
        .select()
        .from(LabReportTemplateParametersModel)
        .where(
          and(
            eq(LabReportTemplateParametersModel.templateId, templateId),
            eq(LabReportTemplateParametersModel.labId, labId),
            eq(LabReportTemplateParametersModel.createdBy, context.userId),
            eq(
              LabReportTemplateParametersModel.parameterName,
              payload.parameterName
            ),
            eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
            eq(LabReportTemplateParametersModel.isCustom, true)
          )
        )
        .limit(1);

      if (existingCustomField) {
        const [updatedField] = await trx
          .update(LabReportTemplateParametersModel)
          .set({
            sectionName: payload.sectionName,
            unit: payload.unit,
            referenceRange: payload.referenceRange,
            inputType: payload.inputType,
            sortOrder: payload.sortOrder,
            isRequired: payload.isRequired,
            isActive: true,
            updatedBy: context.userId,
            updatedAt: new Date(),
          })
          .where(
            eq(LabReportTemplateParametersModel.id, existingCustomField.id)
          )
          .returning();

        return updatedField;
      }

      const [field] = await trx
        .insert(LabReportTemplateParametersModel)
        .values({
          templateId,
          labId,
          sectionName: payload.sectionName,
          parameterName: payload.parameterName,
          unit: payload.unit,
          referenceRange: payload.referenceRange,
          inputType: payload.inputType,
          sortOrder: payload.sortOrder,
          isRequired: payload.isRequired,
          isActive: true,
          sourceType: 'CUSTOM',
          isCustom: true,
          createdBy: context.userId,
          updatedBy: context.userId,
        })
        .returning();

      return field;
    });
  }

  static async updateCustomField(
    fieldId: string,
    payload: UpdateLabCustomFieldInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);

      const [field] = await trx
        .select()
        .from(LabReportTemplateParametersModel)
        .where(
          and(
            eq(LabReportTemplateParametersModel.id, fieldId),
            eq(LabReportTemplateParametersModel.labId, labId),
            eq(LabReportTemplateParametersModel.createdBy, context.userId),
            eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
            eq(LabReportTemplateParametersModel.isCustom, true)
          )
        )
        .limit(1);

      if (!field) {
        throw new HttpError(404, 'Custom field not found');
      }

      if (payload.parameterName) {
        const [duplicate] = await trx
          .select({ id: LabReportTemplateParametersModel.id })
          .from(LabReportTemplateParametersModel)
          .where(
            and(
              eq(LabReportTemplateParametersModel.templateId, field.templateId),
              eq(LabReportTemplateParametersModel.labId, labId),
              eq(LabReportTemplateParametersModel.createdBy, context.userId),
              eq(
                LabReportTemplateParametersModel.parameterName,
                payload.parameterName
              ),
              eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
              ne(LabReportTemplateParametersModel.id, fieldId)
            )
          )
          .limit(1);

        if (duplicate) {
          throw new HttpError(409, 'Custom field name already exists');
        }
      }

      const [updatedField] = await trx
        .update(LabReportTemplateParametersModel)
        .set({
          ...payload,
          updatedBy: context.userId,
          updatedAt: new Date(),
        })
        .where(eq(LabReportTemplateParametersModel.id, fieldId))
        .returning();

      return updatedField;
    });
  }

  static async deleteCustomField(fieldId: string, context: LabResultContext) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);

      const [field] = await trx
        .select()
        .from(LabReportTemplateParametersModel)
        .where(
          and(
            eq(LabReportTemplateParametersModel.id, fieldId),
            eq(LabReportTemplateParametersModel.labId, labId),
            eq(LabReportTemplateParametersModel.createdBy, context.userId),
            eq(LabReportTemplateParametersModel.sourceType, 'CUSTOM'),
            eq(LabReportTemplateParametersModel.isCustom, true)
          )
        )
        .limit(1);

      if (!field) {
        throw new HttpError(404, 'Custom field not found');
      }

      const [deletedField] = await trx
        .update(LabReportTemplateParametersModel)
        .set({
          isActive: false,
          updatedBy: context.userId,
          updatedAt: new Date(),
        })
        .where(eq(LabReportTemplateParametersModel.id, fieldId))
        .returning();

      return deletedField;
    });
  }

  static async overrideDefaultField(
    parameterId: string,
    payload: OverrideLabDefaultFieldInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);
      await this.getActiveTemplateById(trx, payload.templateId, labId);
      const parameter = await this.getDefaultParameterForOverride(
        trx,
        parameterId,
        payload.templateId
      );

      return await this.upsertDefaultFieldOverride(trx, {
        labId,
        baseParameter: parameter,
        userId: context.userId,
        values: {
          displayNameOverride: payload.displayNameOverride,
          unitOverride: payload.unitOverride,
          referenceRangeOverride: payload.referenceRangeOverride,
          inputTypeOverride: payload.inputTypeOverride,
          sectionNameOverride: payload.sectionNameOverride,
          sortOrderOverride: payload.sortOrderOverride,
          isRequiredOverride: payload.isRequiredOverride,
          isActive: true,
        },
      });
    });
  }

  static async hideDefaultField(
    parameterId: string,
    payload: HideLabDefaultFieldInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);
      const parameter = await this.getDefaultParameterById(
        trx,
        parameterId,
        payload.templateId
      );

      return await this.upsertDefaultFieldOverride(trx, {
        labId,
        baseParameter: parameter,
        userId: context.userId,
        values: {
          isHidden: payload.isHidden,
          isActive: true,
        },
      });
    });
  }

  static async unhideDefaultField(
    parameterId: string,
    payload: UnhideLabDefaultFieldInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);
      const parameter = await this.getDefaultParameterById(
        trx,
        parameterId,
        payload.templateId
      );

      return await this.upsertDefaultFieldOverride(trx, {
        labId,
        baseParameter: parameter,
        userId: context.userId,
        values: {
          isHidden: false,
          isActive: true,
        },
      });
    });
  }

  static async resetDefaultFieldOverride(
    parameterId: string,
    payload: ResetLabDefaultFieldOverrideInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      this.assertCanManageFields(context);
      const labId = this.requireLabId(context);

      const parameter = await this.getDefaultParameterById(
        trx,
        parameterId,
        payload.templateId
      );

      const [override] = await trx
        .select()
        .from(LabReportTemplateParametersModel)
        .where(
          and(
            eq(LabReportTemplateParametersModel.labId, labId),
            eq(LabReportTemplateParametersModel.createdBy, context.userId),
            eq(LabReportTemplateParametersModel.baseParameterId, parameterId),
            eq(LabReportTemplateParametersModel.sourceType, 'DEFAULT'),
            eq(LabReportTemplateParametersModel.isCustom, false)
          )
        )
        .limit(1);

      if (!override) {
        return { parameterId, reset: true };
      }

      const [resetOverride] = await trx
        .update(LabReportTemplateParametersModel)
        .set({
          sectionName: parameter.sectionName,
          parameterName: parameter.parameterName,
          unit: parameter.unit,
          referenceRange: parameter.referenceRange,
          inputType: parameter.inputType,
          sortOrder: parameter.sortOrder,
          isRequired: parameter.isRequired,
          isActive: false,
          isHidden: false,
          updatedBy: context.userId,
          updatedAt: new Date(),
        })
        .where(eq(LabReportTemplateParametersModel.id, override.id))
        .returning();

      return this.formatDefaultFieldOverride(parameter, resetOverride);
    });
  }

  static async getResultTemplate(
    labOrderId: string,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      let resolvedAppointmentTestId = labOrderId;

      const [appointmentTestExists] = await trx
        .select({ id: LabOrderModel.id })
        .from(LabOrderModel)
        .where(
          and(
            eq(LabOrderModel.id, labOrderId),
            eq(LabOrderModel.clinicId, context.clinicId)
          )
        )
        .limit(1);

      if (!appointmentTestExists) {
        const [savedResult] = await trx
          .select({ appointmentTestId: LabOrderResultsModel.appointmentTestId })
          .from(LabOrderResultsModel)
          .where(eq(LabOrderResultsModel.id, labOrderId))
          .limit(1);

        if (savedResult) {
          resolvedAppointmentTestId = savedResult.appointmentTestId;
        } else {
          throw new HttpError(404, 'Lab order or appointment test not found');
        }
      }

      const order = await this.getScopedLabOrder(
        trx,
        resolvedAppointmentTestId,
        context
      );
      this.ensureSampleReady(order);

      let resolvedLabId =
        context.userRole === 'Lab_Assistant'
          ? context.labId
          : (order.assignedLabId ?? context.labId);

      if (!resolvedLabId) {
        const [fallbackLab] = await trx
          .select({ id: LabsModel.id })
          .from(LabsModel)
          .where(
            and(
              eq(LabsModel.clinicId, context.clinicId),
              isNull(LabsModel.deletedAt)
            )
          )
          .limit(1);

        if (fallbackLab) {
          resolvedLabId = fallbackLab.id;
        }
      }

      if (!resolvedLabId) {
        throw new HttpError(400, 'Lab context is required');
      }

      if (context.userRole === 'Lab_Assistant') {
        if (!context.labId) {
          throw new HttpError(400, 'Lab context is required');
        }
        if (resolvedLabId !== context.labId) {
          throw new HttpError(403, 'Lab order belongs to another lab');
        }
      }

      const lab = await this.getLabIdentity(
        trx,
        resolvedLabId,
        context.clinicId
      );

      const template = await this.getTemplateForOrder(
        trx,
        {
          testName: order.testName,
          testCategory: order.testCategory,
        },
        resolvedLabId
      );

      const [existingResult] = await trx
        .select({
          id: LabOrderResultsModel.id,
          status: LabOrderResultsModel.status,
          remarks: LabOrderResultsModel.remarks,
          enteredBy: LabOrderResultsModel.enteredBy,
          verifiedBy: LabOrderResultsModel.verifiedBy,
          verifiedAt: LabOrderResultsModel.verifiedAt,
          createdAt: LabOrderResultsModel.createdAt,
          updatedAt: LabOrderResultsModel.updatedAt,
        })
        .from(LabOrderResultsModel)
        .where(
          and(
            eq(LabOrderResultsModel.labOrderId, resolvedAppointmentTestId),
            eq(
              LabOrderResultsModel.appointmentTestId,
              order.appointmentTest.id
            ),
            eq(LabOrderResultsModel.templateId, template.id)
          )
        )
        .limit(1);

      // Resolve the userId for parameter overrides:
      // - Lab_Assistant: use their own userId (they own the overrides)
      // - Doctor/Admin: use the assigned lab assistant on the order, falling
      //   back to the user who entered the result, so they see the same
      //   overridden parameter values (e.g. referenceRange) as the lab side.
      const parameterUserId = this.resolveParameterUserId(
        context,
        order.appointmentTest.labAssistantId,
        existingResult?.enteredBy
      );

      const parameters = await this.getMergedTemplateParameters(
        trx,
        template.id,
        resolvedLabId,
        parameterUserId
      );

      const savedValues = existingResult
        ? await this.getResultValues(trx, existingResult.id)
        : [];
      const valueByParameterId = new Map(
        savedValues.map((value) => [value.parameterId, value.value])
      );

      return {
        labOrderId: resolvedAppointmentTestId,
        appointmentTestId: order.appointmentTest.id,
        templateId: template.id,
        templateName: template.name,
        templateCode: template.code,
        sampleType: template.sampleType,
        result: existingResult
          ? {
              id: existingResult.id,
              status: existingResult.status,
              remarks: existingResult.remarks,
              enteredBy: existingResult.enteredBy,
              verifiedBy: existingResult.verifiedBy,
              verifiedAt: existingResult.verifiedAt,
              createdAt: existingResult.createdAt,
              updatedAt: existingResult.updatedAt,
            }
          : null,
        test: {
          id: order.testId,
          name: order.testName,
          category: order.testCategory,
        },
        patient:
          order.patientName || order.patientMobile
            ? {
                id: order.patientId ?? null,
                name: order.patientName,
                age: order.patientAge,
                dob: order.patientDob,
                gender: order.patientGender,
                mobile: order.patientMobile,
                email: order.patientEmail,
              }
            : null,
        lab,
        parameters: parameters.map((parameter) => ({
          ...parameter,
          value: valueByParameterId.get(parameter.parameterId) ?? '',
        })),
      };
    });
  }

  static async saveResult(
    labOrderId: string,
    payload: SaveLabResultInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      const appointmentTestId = payload.appointmentTestId ?? labOrderId;

      if (appointmentTestId !== labOrderId) {
        throw new HttpError(
          400,
          'appointmentTestId must match labOrderId for this lab order'
        );
      }

      const order = await this.getScopedLabOrder(trx, labOrderId, context);
      this.ensureSampleReady(order);
      const labId = this.resolveOrderLabId(order, context);
      await this.getLabIdentity(trx, labId, context.clinicId);
      const parameterContext = {
        ...context,
        labId,
        userId: this.resolveParameterUserId(
          context,
          order.appointmentTest.labAssistantId
        ),
      };

      await this.validateTemplateMatchesOrder(
        trx,
        payload.templateId,
        {
          testName: order.testName,
          testCategory: order.testCategory,
        },
        labId
      );

      const [existingResult] = await trx
        .select()
        .from(LabOrderResultsModel)
        .where(
          and(
            eq(LabOrderResultsModel.labOrderId, labOrderId),
            eq(LabOrderResultsModel.appointmentTestId, appointmentTestId),
            eq(LabOrderResultsModel.templateId, payload.templateId)
          )
        )
        .limit(1);

      if (existingResult?.status === 'Verified') {
        throw new HttpError(409, 'Verified result cannot be updated');
      }

      const now = new Date();
      const status = payload.status ?? 'Completed';

      const [result] = existingResult
        ? await trx
            .update(LabOrderResultsModel)
            .set({
              status,
              enteredBy: context.userId,
              remarks: payload.remarks,
              updatedAt: now,
            })
            .where(eq(LabOrderResultsModel.id, existingResult.id))
            .returning()
        : await trx
            .insert(LabOrderResultsModel)
            .values({
              labOrderId,
              appointmentTestId,
              templateId: payload.templateId,
              status,
              enteredBy: context.userId,
              remarks: payload.remarks,
            })
            .returning();

      const valueRows = await this.validateAndBuildValueRows(
        trx,
        payload.templateId,
        result.id,
        result.status,
        payload.values,
        parameterContext
      );

      await trx
        .delete(LabOrderResultValuesModel)
        .where(eq(LabOrderResultValuesModel.resultId, result.id));

      if (valueRows.length) {
        await trx.insert(LabOrderResultValuesModel).values(valueRows);
      }

      if (status === 'Completed') {
        await trx
          .update(LabOrderModel)
          .set({
            workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
            sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
            reportStatus: 'Completed',
            readyForReportAt: now,
            updatedAt: now,
          })
          .where(eq(LabOrderModel.id, appointmentTestId));

        await trx
          .update(LabSamplesModel)
          .set({
            status: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
            resultVerifiedAt: now,
            reportReadyAt: now,
            updatedAt: now,
          })
          .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

        const [existingCompletedEvent] = await trx
          .select({ id: LabOrderTrackingEventModel.id })
          .from(LabOrderTrackingEventModel)
          .where(
            and(
              eq(
                LabOrderTrackingEventModel.appointmentTestId,
                appointmentTestId
              ),
              eq(
                LabOrderTrackingEventModel.eventType,
                APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED
              )
            )
          )
          .limit(1);

        if (!existingCompletedEvent) {
          await trx.insert(LabOrderTrackingEventModel).values({
            clinicId: order.clinicId,
            labId: labId,
            appointmentTestId: appointmentTestId,
            eventType: APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED,
            title: 'Test completed',
            description: 'Lab result saved and completed.',
            actorUserId: context.userId,
            createdAt: now,
          });
        }
      }

      const values = await this.getResultValues(trx, result.id);
      const savedRecord = await this.getResultRecord(trx, result.id, context);

      return this.formatSavedResult(savedRecord, values);
    });
  }

  static async getSavedResult(resultId: string, context: LabResultContext) {
    return await database.transaction(async (trx) => {
      const record = await this.getResultRecord(trx, resultId, context);
      const values = await this.getResultValues(trx, resultId);

      return this.formatSavedResult(record, values);
    });
  }

  static async updateResult(
    resultId: string,
    payload: UpdateLabResultInput,
    context: LabResultContext
  ) {
    return await database.transaction(async (trx) => {
      const record = await this.getResultRecord(trx, resultId, context);

      if (record.result.status === 'Verified') {
        throw new HttpError(409, 'Verified result cannot be updated');
      }

      const nextStatus = payload.status ?? record.result.status;
      const now = new Date();
      const labId = this.resolveOrderLabId(record, context);
      await this.getLabIdentity(trx, labId, context.clinicId);
      const parameterContext = {
        ...context,
        labId,
        userId: this.resolveParameterUserId(
          context,
          record.appointmentTest.labAssistantId,
          record.result.enteredBy
        ),
      };

      if (payload.values) {
        const valueRows = await this.validateAndBuildValueRows(
          trx,
          record.result.templateId,
          resultId,
          nextStatus,
          payload.values,
          parameterContext
        );

        await trx
          .delete(LabOrderResultValuesModel)
          .where(eq(LabOrderResultValuesModel.resultId, resultId));

        if (valueRows.length) {
          await trx.insert(LabOrderResultValuesModel).values(valueRows);
        }
      }

      await trx
        .update(LabOrderResultsModel)
        .set({
          status: nextStatus,
          remarks: payload.remarks ?? record.result.remarks,
          updatedAt: now,
        })
        .where(eq(LabOrderResultsModel.id, resultId));

      if (nextStatus === 'Completed') {
        const appointmentTestId = record.result.appointmentTestId;

        await trx
          .update(LabOrderModel)
          .set({
            workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
            sampleStatus: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
            reportStatus: 'Completed',
            readyForReportAt: now,
            updatedAt: now,
          })
          .where(eq(LabOrderModel.id, appointmentTestId));

        await trx
          .update(LabSamplesModel)
          .set({
            status: APPOINTMENT_TEST_SAMPLE_STATUS.COMPLETED,
            resultVerifiedAt: now,
            reportReadyAt: now,
            updatedAt: now,
          })
          .where(eq(LabSamplesModel.appointmentTestId, appointmentTestId));

        if (labId) {
          const [existingCompletedEvent] = await trx
            .select({ id: LabOrderTrackingEventModel.id })
            .from(LabOrderTrackingEventModel)
            .where(
              and(
                eq(
                  LabOrderTrackingEventModel.appointmentTestId,
                  appointmentTestId
                ),
                eq(
                  LabOrderTrackingEventModel.eventType,
                  APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED
                )
              )
            )
            .limit(1);

          if (!existingCompletedEvent) {
            await trx.insert(LabOrderTrackingEventModel).values({
              clinicId: record.clinicId,
              labId: labId,
              appointmentTestId: appointmentTestId,
              eventType: APPOINTMENT_TEST_TRACKING_EVENT.COMPLETED,
              title: 'Test completed',
              description: 'Lab result saved and completed.',
              actorUserId: context.userId,
              createdAt: now,
            });
          }
        }
      }

      const updatedRecord = await this.getResultRecord(trx, resultId, context);
      const values = await this.getResultValues(trx, resultId);

      return this.formatSavedResult(updatedRecord, values);
    });
  }

  static async verifyResult(resultId: string, context: LabResultContext) {
    const verified = await database.transaction(async (trx) => {
      if (
        !['Admin', 'Doctor', 'Lab_Assistant', 'Super_Admin'].includes(
          context.userRole ?? ''
        )
      ) {
        throw new HttpError(403, 'User is not authorized to verify result');
      }

      const record = await this.getResultRecord(trx, resultId, context);

      if (record.result.status === 'Verified') {
        throw new HttpError(409, 'Result is already verified');
      }

      const [valueCount] = await trx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(LabOrderResultValuesModel)
        .where(eq(LabOrderResultValuesModel.resultId, resultId));

      if (Number(valueCount?.count ?? 0) === 0) {
        throw new HttpError(400, 'Result cannot be verified without values');
      }

      const now = new Date();

      await trx
        .update(LabOrderResultsModel)
        .set({
          status: 'Verified',
          verifiedBy: context.userId,
          verifiedAt: now,
          updatedAt: now,
        })
        .where(eq(LabOrderResultsModel.id, resultId));

      await trx
        .update(LabOrderModel)
        .set({
          reportStatus: 'Completed',
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
          updatedAt: now,
        })
        .where(eq(LabOrderModel.id, record.result.appointmentTestId));

      const updatedRecord = await this.getResultRecord(trx, resultId, context);
      const values = await this.getResultValues(trx, resultId);

      return this.formatSavedResult(updatedRecord, values);
    });

    // The report is now finalized — the ordering doctor's encounter screen
    // and the lab worklist both previously only learned this on a refresh.
    signalLabChange(
      {
        clinicId: verified.clinic.id,
        labId: context.labId,
        appointmentId: verified.order.appointmentId,
        doctorId: verified.doctor?.id ?? null,
      },
      'lab.result_published'
    );

    return verified;
  }

  static async uploadReportFile(
    resultId: string,
    reportFileUrl: string | null | undefined,
    context: LabResultContext
  ) {
    if (!reportFileUrl) {
      throw new HttpError(400, 'Report file is required');
    }

    let notifyPatient: {
      patientId: string | null;
      clinicId: string | null;
      labId: string | null;
      patientName: string;
      testName: string;
    } | null = null;

    const saved = await database.transaction(async (trx) => {
      const record = await this.getResultRecord(trx, resultId, context);

      if (!this.canUseReportFile(record.result.status)) {
        throw new HttpError(
          400,
          'Report upload is available only after result completion'
        );
      }

      const oldReportFileUrl = record.appointmentTest.reportPdf;
      const now = new Date();

      await trx
        .update(LabOrderModel)
        .set({
          reportPdf: reportFileUrl,
          reportStatus: 'Completed',
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
          updatedAt: now,
        })
        .where(eq(LabOrderModel.id, record.result.appointmentTestId));

      if (oldReportFileUrl && oldReportFileUrl !== reportFileUrl) {
        await deleteFromS3(oldReportFileUrl).catch(() => undefined);
      }

      const updatedRecord = await this.getResultRecord(trx, resultId, context);
      const values = await this.getResultValues(trx, resultId);

      notifyPatient = {
        patientId: updatedRecord.patientId,
        clinicId: updatedRecord.clinicId,
        labId: updatedRecord.assignedLabId ?? context.labId ?? null,
        patientName: updatedRecord.patientName || 'there',
        testName: updatedRecord.testName || 'your test',
      };

      return {
        ...this.formatSavedResult(updatedRecord, values),
        uploadedReport: {
          url: reportFileUrl,
          uploadedAt: now,
        },
      };
    });

    // Post-commit, fire-and-forget: the report row must be committed before the
    // patient is told it is ready, and the send must not hold the transaction.
    if (notifyPatient) {
      void LabNotificationService.sendReportReady({
        ...(notifyPatient as {
          patientId: string | null;
          clinicId: string | null;
          labId: string | null;
          patientName: string;
          testName: string;
        }),
        reportUrl: reportFileUrl,
      });
    }

    return saved;
  }

  static async getReport(resultId: string, context: LabResultContext) {
    const { record, values } = await database.transaction(async (trx) => {
      const record = await this.getResultRecord(trx, resultId, context);

      if (!this.canUseReportFile(record.result.status)) {
        throw new HttpError(
          400,
          'Report is viewable only after result completion'
        );
      }

      const values = await this.getResultValues(trx, resultId);

      return { record, values };
    });

    const reportData = this.formatSavedResult(record, values);
    let pdfUrl = record.appointmentTest.reportPdf;
    let generatedAt = record.appointmentTest.updatedAt ?? new Date();

    let labId = context.labId || record.assignedLabId || record.template.labId;

    if (!labId && record.clinicId) {
      const [clinicLab] = await database
        .select({ id: LabsModel.id })
        .from(LabsModel)
        .where(
          and(
            eq(LabsModel.clinicId, record.clinicId),
            isNull(LabsModel.deletedAt)
          )
        )
        .limit(1);

      labId = clinicLab?.id;
    }

    if (labId) {
      const [labDetails] = await database
        .select({
          name: LabsModel.name,
          address: LabsModel.address,
          contactNumber: LabsModel.contactNo,
        })
        .from(LabsModel)
        .where(eq(LabsModel.id, labId))
        .limit(1);

      if (labDetails) {
        reportData.lab = labDetails;
      }
    }

    let templateConfig: {
      fontFamily: string;
      primaryFont: string;
      colors: {
        color1: string;
        color2: string;
        color3: string;
        color4: string;
        color5: string;
        color6: string;
        color7: string;
        color8: string;
        color9: string;
        color10: string;
      };
    } | null = null;
    let templateHtml = labReportTemplate1;
    let templateUpdatedAt: Date | null = null;

    if (labId) {
      const [savedTemplate] = await database
        .select()
        .from(LabReportTemplateModel)
        .where(eq(LabReportTemplateModel.labId, labId))
        .limit(1);

      if (savedTemplate) {
        templateUpdatedAt = savedTemplate.updatedAt;
        templateConfig = {
          fontFamily: savedTemplate.fontFamily,
          primaryFont: savedTemplate.fontFamily.split(',')[0].trim(),
          colors: {
            color1: savedTemplate.color1,
            color2: savedTemplate.color2,
            color3: savedTemplate.color3,
            color4: savedTemplate.color4,
            color5: savedTemplate.color5,
            color6: savedTemplate.color6,
            color7: savedTemplate.color7,
            color8: savedTemplate.color8,
            color9: savedTemplate.color9,
            color10: savedTemplate.color10,
          },
        };

        switch (savedTemplate.templateName) {
          case 'template1':
            templateHtml = labReportTemplate1;
            break;
          case 'template2':
            templateHtml = labReportTemplate2;
            break;
          case 'template3':
            templateHtml = labReportTemplate3;
            break;
          case 'template4':
            templateHtml = labReportTemplate4;
            break;
          default:
            templateHtml = labReportTemplate1;
        }
      }
    }

    if (!templateConfig) {
      templateConfig = {
        fontFamily: 'Inter, sans-serif',
        primaryFont: 'Inter',
        colors: {
          color1: '#0F766E',
          color2: '#ECFDF5',
          color3: '#172033',
          color4: '#526078',
          color5: '#DBE3EA',
          color6: '#B22222',
          color7: '#F9F9F9',
          color8: '#FFFFFF',
          color9: '#000000',
          color10: '#856404',
        },
      };
    }

    if (this.shouldGenerateReportPdf(record, templateUpdatedAt)) {
      generatedAt = new Date();
      try {
        pdfUrl = await generateAndUploadPdf(
          templateHtml,
          {
            ...this.buildLabReportPdfData(reportData, generatedAt),
            templateConfig,
          },
          'lab_reports',
          record.appointmentTest.reportPdf,
          record.clinicId
        );
      } catch (error) {
        if (this.isS3CredentialError(error)) {
          throw new HttpError(
            502,
            'Lab report PDF upload failed because AWS S3 credentials are invalid or expired. Refresh AWS credentials and keep AWS_SESSION_TOKEN on one line.'
          );
        }

        throw error;
      }

      await database
        .update(LabOrderModel)
        .set({
          reportPdf: pdfUrl,
          reportStatus: 'Completed',
          workflowStatus: APPOINTMENT_TEST_WORKFLOW_STATUS.COMPLETED,
          updatedAt: generatedAt,
        })
        .where(eq(LabOrderModel.id, record.result.appointmentTestId));
    }

    // The caller opens this immediately, so it gets the document TTL rather
    // than the 12h the response signer gives imagery. These field names are on
    // the signer's skip list precisely so this stays the only signature.
    const signedPdfUrl = pdfUrl
      ? ((await signS3Url(pdfUrl, { expiresIn: DOCUMENT_TTL_SECONDS })) ?? null)
      : null;

    return {
      resultId,
      reportGenerated: Boolean(pdfUrl),
      pdfUrl: signedPdfUrl,
      downloadUrl: signedPdfUrl,
      generatedAt,
      uploadUrl: `/api/v1/lab/results/${resultId}/report-upload`,
      uploadField: 'reportPdf',
      allowedUploadFormats: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      reportData: {
        ...reportData,
        reportActions: this.buildReportActions(
          resultId,
          record.result.status,
          signedPdfUrl
        ),
      },
    };
  }
}
