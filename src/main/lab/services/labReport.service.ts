import { and, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import handlebars from 'handlebars';
import { buildObjectKey } from '../../../configurations/s3/keys';
import { s3ObjectUrl, uploadBufferToS3 } from '../../../configurations/s3';
import { withEnvPrefix } from '../../../configurations/s3/client';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import {
  generateAndUploadPdf,
  renderTemplateToPdf,
} from '../../../utils/pdf.utils';
import { buildReportQrDataUrl } from '../../../utils/qr.utils';
import { signStoredFilesDeep } from '../../files/services/fileUrl.service';
import { UserModel } from '../../users/models/user.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import {
  LabTestResultParameterModel,
  LabUpdatedReportModel,
  LabUpdatedTestModel,
  LabUpdatedResultModel,
} from '../models/labUpdated.model';
import { logLabOrderActivity } from '../utils/labUpdatedActivity';
import { LabsModel } from '../models/lab.model';
import { labReportTemplate1 } from '../reportTemplate/labReportTemplate1';
import { labReportTemplate2 } from '../reportTemplate/labReportTemplate2';
import type {
  PreviewLabReportInput,
  UpsertLabUpdatedReportInput,
} from '../schemas/labReport.schemas';
import { LabCatalogContext, verifyLabAccess } from './labCatalog.service';

export const DEFAULT_LAB_REPORT_COLORS = {
  color1: '#0F5CB8',
  color2: '#EAF3FF',
  color3: '#173B70',
  color4: '#4D78A8',
  color5: '#C9DDF3',
};

type LabReportContext = LabCatalogContext;

type GenerateLabReportOptions = {
  skipAssignmentCheck?: boolean;
  logActivity?: boolean;
  reportPdfUrls?: Map<string, string>;
  reportQrCodes?: Map<string, string>;
  signAssets?: boolean;
};

const getDefaultReport = (labId: string) => ({
  id: null,
  labId,
  templateName: 'labReportTemplate1',
  ...DEFAULT_LAB_REPORT_COLORS,
  isDefault: true,
});

const REPORT_TEMPLATES: Record<string, string> = {
  labReportTemplate1,
  labReportTemplate2,
};

const getReportTemplate = (templateName: string) => {
  const template = REPORT_TEMPLATES[templateName];
  if (!template) {
    throw new HttpError(
      404,
      `Lab report template '${templateName}' was not found`
    );
  }
  return template;
};

const formatReferringDoctorName = (
  name: string | null | undefined,
  fallback = '-'
) => {
  const trimmedName = name?.trim();
  if (!trimmedName) return fallback;

  return /^dr\.?\s+/i.test(trimmedName) ? trimmedName : `Dr. ${trimmedName}`;
};

const ALLOWED_RICH_TEXT_TAGS = new Set([
  'div',
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
]);

const sanitizeRichText = (value: string | null | undefined) => {
  if (!value?.trim()) return null;

  return value
    .replace(
      /<\s*(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      ''
    )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*\/?\s*([a-z0-9]+)(?:\s[^>]*)?>/gi, (tag, tagName: string) => {
      const normalizedTagName = tagName.toLowerCase();
      if (!ALLOWED_RICH_TEXT_TAGS.has(normalizedTagName)) return '';

      return tag.trim().startsWith('</')
        ? `</${normalizedTagName}>`
        : `<${normalizedTagName}>`;
    });
};

export class LabReportService {
  static async previewReport(payload: PreviewLabReportInput) {
    const template = getReportTemplate(payload.templateName);
    const compile = handlebars.compile(template);
    const previewReportPdf =
      payload.templateName === 'labReportTemplate2'
        ? 'https://example.com/lab-report-preview.pdf'
        : '';
    const previewReportQrCode = previewReportPdf
      ? await buildReportQrDataUrl(previewReportPdf)
      : '';

    return compile({
      lab: {
        name: 'Chouhan Lab & Diagnostic Center',
        address: '123 Vijay Nagar, Indore (M.P.)',
        contactNo: '+91 9876543210',
        email: 'info@chouhanlabs.com',
      },
      colors: {
        color1: payload.color1 ?? DEFAULT_LAB_REPORT_COLORS.color1,
        color2: payload.color2 ?? DEFAULT_LAB_REPORT_COLORS.color2,
        color3: payload.color3 ?? DEFAULT_LAB_REPORT_COLORS.color3,
        color4: payload.color4 ?? DEFAULT_LAB_REPORT_COLORS.color4,
        color5: payload.color5 ?? DEFAULT_LAB_REPORT_COLORS.color5,
      },
      patient: {
        name: 'Anuj Bhadoriya',
        mobile: '+91 9784563210',
        gender: 'Male',
        age: '28 years',
      },
      referringDoctorName: 'Dr. Gulshan Songara',
      reportDate: new Date().toLocaleDateString('en-IN'),
      reportPdf: previewReportPdf,
      reportQrCode: previewReportQrCode,
      tests: [
        {
          testName: 'Complete Blood Count',
          testCode: 'CBC-001',
          comments:
            'This preview description demonstrates how a laboratory test description appears in the generated report. It explains that the displayed test uses sample information only and does not represent a real patient result. The description can contain clinical context, specimen details, preparation instructions, interpretation guidance, limitations, and other notes needed by the laboratory. Long descriptions are included here to confirm spacing, wrapping, typography, and color behavior inside the selected report layout. Users can review the complete visual presentation before saving their report configuration. Replace this sample text with meaningful test-specific content when the final laboratory workflow is implemented in clinical practice.',
          interpretation:
            "<p>Interpret the result with the patient's clinical findings.</p><ul><li>Example interpretation item</li><li>Example follow-up item</li></ul>",
          notes: '<p>Example laboratory note.</p>',
          parameters: [
            {
              parameterName: 'Hemoglobin',
              resultValue: '14.2',
              referenceRange: '13.0 - 17.0',
              unit: 'g/dL',
              isRequired: true,
            },
            {
              parameterName: 'Red Blood Cell Count',
              resultValue: '4.85',
              referenceRange: '4.5 - 5.5',
              unit: 'million/uL',
              isRequired: true,
            },
            {
              parameterName: 'Total Leukocyte Count',
              resultValue: '7,200',
              referenceRange: '4,000 - 11,000',
              unit: '/uL',
              isRequired: true,
            },
            {
              parameterName: 'Platelet Count',
              resultValue: '245,000',
              referenceRange: '150,000 - 450,000',
              unit: '/uL',
              isRequired: true,
            },
            {
              parameterName: 'Hematocrit',
              resultValue: '43.1',
              referenceRange: '40 - 48',
              unit: '%',
              isRequired: true,
            },
            {
              parameterName: 'Mean Corpuscular Volume',
              resultValue: '88.9',
              referenceRange: '80 - 100',
              unit: 'fL',
              isRequired: true,
            },
            {
              parameterName: 'Mean Corpuscular Hemoglobin',
              resultValue: '29.3',
              referenceRange: '27 - 33',
              unit: 'pg',
              isRequired: true,
            },
            {
              parameterName: 'Mean Corpuscular Hemoglobin Concentration',
              resultValue: '33.0',
              referenceRange: '32 - 36',
              unit: 'g/dL',
              isRequired: true,
            },
            {
              parameterName: 'Neutrophils',
              resultValue: '58',
              referenceRange: '40 - 75',
              unit: '%',
              isRequired: true,
            },
            {
              parameterName: 'Lymphocytes',
              resultValue: '34',
              referenceRange: '20 - 45',
              unit: '%',
              isRequired: true,
            },
          ],
        },
        {
          testName: 'Liver Function Test',
          testCode: 'LFT-001',
          comments:
            'This preview description demonstrates how a laboratory test description appears in the generated report. It explains that the displayed test uses sample information only and does not represent a real patient result. The description can contain clinical context, specimen details, preparation instructions, interpretation guidance, limitations, and other notes needed by the laboratory. Long descriptions are included here to confirm spacing, wrapping, typography, and color behavior inside the selected report layout. Users can review the complete visual presentation before saving their report configuration. Replace this sample text with meaningful test-specific content when the final laboratory workflow is implemented in clinical practice.',
          interpretation: null,
          notes: null,
          parameters: [
            {
              parameterName: 'Alanine Transaminase',
              resultValue: '28',
              referenceRange: '7 - 56',
              unit: 'U/L',
              isRequired: true,
            },
            {
              parameterName: 'Aspartate Transaminase',
              resultValue: '24',
              referenceRange: '10 - 40',
              unit: 'U/L',
              isRequired: true,
            },
            {
              parameterName: 'Alkaline Phosphatase',
              resultValue: '92',
              referenceRange: '44 - 147',
              unit: 'U/L',
              isRequired: true,
            },
            {
              parameterName: 'Total Bilirubin',
              resultValue: '0.8',
              referenceRange: '0.1 - 1.2',
              unit: 'mg/dL',
              isRequired: true,
            },
            {
              parameterName: 'Direct Bilirubin',
              resultValue: '0.2',
              referenceRange: '0.0 - 0.3',
              unit: 'mg/dL',
              isRequired: true,
            },
            {
              parameterName: 'Albumin',
              resultValue: '4.3',
              referenceRange: '3.5 - 5.0',
              unit: 'g/dL',
              isRequired: true,
            },
            {
              parameterName: 'Total Protein',
              resultValue: '7.1',
              referenceRange: '6.0 - 8.3',
              unit: 'g/dL',
              isRequired: true,
            },
            {
              parameterName: 'Gamma Glutamyl Transferase',
              resultValue: '31',
              referenceRange: '9 - 48',
              unit: 'U/L',
              isRequired: true,
            },
            {
              parameterName: 'Globulin',
              resultValue: '2.8',
              referenceRange: '2.0 - 3.5',
              unit: 'g/dL',
              isRequired: true,
            },
            {
              parameterName: 'Albumin Globulin Ratio',
              resultValue: '1.5',
              referenceRange: '1.0 - 2.5',
              unit: 'ratio',
              isRequired: true,
            },
          ],
        },
      ],
    });
  }

  static async getReportConfiguration(context: LabReportContext) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const [report] = await trx
        .select()
        .from(LabUpdatedReportModel)
        .where(eq(LabUpdatedReportModel.labId, context.labId))
        .limit(1);

      return report
        ? { ...report, isDefault: false }
        : getDefaultReport(context.labId);
    });
  }

  static async upsertReportConfiguration(
    payload: UpsertLabUpdatedReportInput,
    context: LabReportContext
  ) {
    return await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);
      const [existing] = await trx
        .select()
        .from(LabUpdatedReportModel)
        .where(eq(LabUpdatedReportModel.labId, context.labId))
        .limit(1);
      const now = new Date();
      const values = {
        labId: context.labId,
        templateName:
          payload.templateName ??
          existing?.templateName ??
          'labReportTemplate1',
        color1:
          payload.color1 ??
          existing?.color1 ??
          DEFAULT_LAB_REPORT_COLORS.color1,
        color2:
          payload.color2 ??
          existing?.color2 ??
          DEFAULT_LAB_REPORT_COLORS.color2,
        color3:
          payload.color3 ??
          existing?.color3 ??
          DEFAULT_LAB_REPORT_COLORS.color3,
        color4:
          payload.color4 ??
          existing?.color4 ??
          DEFAULT_LAB_REPORT_COLORS.color4,
        color5:
          payload.color5 ??
          existing?.color5 ??
          DEFAULT_LAB_REPORT_COLORS.color5,
        updatedAt: now,
      };

      if (existing) {
        const [updated] = await trx
          .update(LabUpdatedReportModel)
          .set(values)
          .where(eq(LabUpdatedReportModel.id, existing.id))
          .returning();
        return { ...updated, isDefault: false };
      }

      const [created] = await trx
        .insert(LabUpdatedReportModel)
        .values({ ...values, createdAt: now })
        .returning();
      return { ...created, isDefault: false };
    });
  }

  static async generateReportsForOrders(
    labOrderIds: string[],
    context: LabReportContext,
    options: GenerateLabReportOptions = {}
  ) {
    return await database.transaction(async (trx) => {
      if (!options.skipAssignmentCheck) {
        await verifyLabAccess(trx, context);
      }
      const uniqueOrderIds = Array.from(new Set(labOrderIds));
      const [lab] = await trx
        .select({
          id: LabsModel.id,
          name: LabsModel.name,
          address: LabsModel.address,
          contactNo: LabsModel.contactNo,
          email: LabsModel.email,
          logo: LabsModel.logo,
          gstNumber: LabsModel.gstNumber,
          reportFooter: LabsModel.reportFooter,
        })
        .from(LabsModel)
        .where(eq(LabsModel.id, context.labId))
        .limit(1);

      if (!lab) throw new HttpError(404, 'Lab not found');

      const doctorUser = alias(UserModel, 'lab_report_doctor_user');
      const orders = await trx
        .select({
          labOrderId: LabOrderModel.id,
          reportPdf: LabOrderModel.reportPdf,
          patientId: LabOrderModel.patientId,
          testId: LabUpdatedTestModel.id,
          testName: LabUpdatedTestModel.testName,
          testCode: LabUpdatedTestModel.testCode,
          comments: LabUpdatedTestModel.comments,
          interpretation: LabUpdatedTestModel.interpretation,
          notes: LabUpdatedTestModel.notes,
          patientName: UserModel.name,
          patientMobile: UserModel.mobile,
          patientGender: UserProfileModel.gender,
          patientAge: UserProfileModel.age,
          referringDoctorName: LabOrderModel.referringDoctorName,
          doctorName: doctorUser.name,
        })
        .from(LabOrderModel)
        .innerJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .leftJoin(UserModel, eq(LabOrderModel.patientId, UserModel.id))
        .leftJoin(doctorUser, eq(LabOrderModel.doctorId, doctorUser.id))
        .leftJoin(
          UserProfileModel,
          eq(LabOrderModel.patientId, UserProfileModel.userId)
        )
        .where(
          and(
            inArray(LabOrderModel.id, uniqueOrderIds),
            eq(LabUpdatedTestModel.labId, context.labId)
          )
        );

      if (orders.length !== uniqueOrderIds.length) {
        throw new HttpError(
          404,
          'One or more lab orders were not found for this lab'
        );
      }

      const testIds = Array.from(new Set(orders.map((order) => order.testId)));
      const parameters = await trx
        .select({
          id: LabTestResultParameterModel.id,
          testId: LabTestResultParameterModel.testId,
          parameterName: LabTestResultParameterModel.parameterName,
          unit: LabTestResultParameterModel.unit,
          referenceRange: LabTestResultParameterModel.referenceRange,
          isRequired: LabTestResultParameterModel.isRequired,
        })
        .from(LabTestResultParameterModel)
        .where(
          and(
            inArray(LabTestResultParameterModel.testId, testIds),
            eq(LabTestResultParameterModel.isActive, true)
          )
        );
      const resultValues = await trx
        .select({
          labOrderId: LabUpdatedResultModel.labOrderId,
          parameterId: LabUpdatedResultModel.parameterId,
          resultValue: LabUpdatedResultModel.resultValue,
        })
        .from(LabUpdatedResultModel)
        .where(inArray(LabUpdatedResultModel.labOrderId, uniqueOrderIds));

      const parameterByTestId = new Map<string, typeof parameters>();
      for (const parameter of parameters) {
        const items = parameterByTestId.get(parameter.testId) ?? [];
        items.push(parameter);
        parameterByTestId.set(parameter.testId, items);
      }
      const valueByKey = new Map(
        resultValues.map((value) => [
          `${value.labOrderId}:${value.parameterId}`,
          value.resultValue,
        ])
      );

      const orderReports = orders.map((order) => {
        const orderParameters = (parameterByTestId.get(order.testId) ?? []).map(
          (parameter) => ({
            parameterName: parameter.parameterName,
            resultValue:
              valueByKey.get(`${order.labOrderId}:${parameter.id}`) ?? null,
            referenceRange: parameter.referenceRange ?? '-',
            unit: parameter.unit ?? '-',
            isRequired: parameter.isRequired,
          })
        );
        const hasSavedValue = resultValues.some(
          (value) => value.labOrderId === order.labOrderId
        );
        if (!hasSavedValue) {
          throw new HttpError(
            400,
            `No result values are saved for lab order ${order.labOrderId}`
          );
        }
        const missingRequired = orderParameters.some(
          (parameter) =>
            parameter.isRequired && !String(parameter.resultValue ?? '').trim()
        );
        if (missingRequired) {
          throw new HttpError(
            400,
            `Required result values are incomplete for lab order ${order.labOrderId}`
          );
        }
        return {
          ...order,
          comments: sanitizeRichText(order.comments),
          interpretation: sanitizeRichText(order.interpretation),
          notes: sanitizeRichText(order.notes),
          parameters: orderParameters,
        };
      });

      const [savedReport] = await trx
        .select()
        .from(LabUpdatedReportModel)
        .where(eq(LabUpdatedReportModel.labId, context.labId))
        .limit(1);
      const report = savedReport ?? getDefaultReport(context.labId);
      const template = getReportTemplate(report.templateName);
      const compile = handlebars.compile(template);
      const grouped = new Map<string, typeof orderReports>();
      for (const order of orderReports) {
        const key = order.patientId ?? `order:${order.labOrderId}`;
        const items = grouped.get(key) ?? [];
        items.push(order);
        grouped.set(key, items);
      }

      const reportLab = options.signAssets
        ? ((await signStoredFilesDeep(lab)) as typeof lab)
        : lab;

      const reports = await Promise.all(
        Array.from(grouped.values()).map(async (patientOrders) => {
          const first = patientOrders[0];
          const reportGroupKey = first.patientId ?? `order:${first.labOrderId}`;
          const reportPdf =
            options.reportPdfUrls?.get(reportGroupKey) ?? first.reportPdf ?? '';
          const configuredQrCode = options.reportQrCodes?.get(reportGroupKey);
          const reportQrCode =
            configuredQrCode ??
            (report.templateName === 'labReportTemplate2' && reportPdf
              ? await buildReportQrDataUrl(reportPdf)
              : '');
          const html = compile({
            lab: reportLab,
            colors: report,
            patient: {
              name: first.patientName ?? 'Patient',
              mobile: first.patientMobile ?? '-',
              gender: first.patientGender ?? '-',
              age: first.patientAge ?? '-',
            },
            referringDoctorName: formatReferringDoctorName(
              first.referringDoctorName || first.doctorName
            ),
            reportDate: new Date().toLocaleDateString('en-IN'),
            reportPdf,
            reportQrCode,
            tests: patientOrders,
          });
          return {
            patientId: first.patientId,
            labOrderIds: patientOrders.map((order) => order.labOrderId),
            html,
          };
        })
      );

      if (options.logActivity) {
        const createdAt = new Date();
        for (const labOrderId of uniqueOrderIds) {
          await logLabOrderActivity(trx, {
            labId: context.labId,
            labOrderId,
            activity: 'Report Generated',
            performedBy: context.userId,
            createdAt,
          });
        }
      }

      return {
        templateName: report.templateName,
        reports,
      };
    });
  }

  static async generateAndUploadReportsForOrders(
    labOrderIds: string[],
    context: LabReportContext
  ) {
    const uniqueOrderIds = Array.from(new Set(labOrderIds));
    const generated = await this.generateReportsForOrders(
      uniqueOrderIds,
      context
    );

    const [lab] = await database
      .select({ clinicId: LabsModel.clinicId })
      .from(LabsModel)
      .where(eq(LabsModel.id, context.labId))
      .limit(1);

    if (!lab) throw new HttpError(404, 'Lab not found');

    const reports: Array<{
      patientId: string | null;
      labOrderIds: string[];
      reportPdf: string;
    }> = [];

    if (generated.templateName === 'labReportTemplate2') {
      const reportPdfUrls = new Map<string, string>();
      const reportQrCodes = new Map<string, string>();
      const reportObjectKeys = new Map<string, string>();

      for (const report of generated.reports) {
        const reportGroupKey =
          report.patientId ?? `order:${report.labOrderIds[0]}`;
        const objectKey = buildObjectKey(
          { clinicId: lab.clinicId },
          'lab-reports',
          'document.pdf'
        );
        const reportPdf = s3ObjectUrl(withEnvPrefix(objectKey));

        reportObjectKeys.set(reportGroupKey, objectKey);
        reportPdfUrls.set(reportGroupKey, reportPdf);
        reportQrCodes.set(
          reportGroupKey,
          await buildReportQrDataUrl(reportPdf)
        );
      }

      // The object key is created before rendering, so the QR points to the
      // final PDF URL even though the PDF is uploaded only once.
      const generatedWithQr = await this.generateReportsForOrders(
        uniqueOrderIds,
        context,
        {
          skipAssignmentCheck: true,
          reportPdfUrls,
          reportQrCodes,
          signAssets: true,
        }
      );

      for (const report of generatedWithQr.reports) {
        const reportGroupKey =
          report.patientId ?? `order:${report.labOrderIds[0]}`;
        const objectKey = reportObjectKeys.get(reportGroupKey);
        const reportPdf = reportPdfUrls.get(reportGroupKey);

        if (!objectKey || !reportPdf) {
          throw new HttpError(500, 'Failed to prepare lab report PDF upload');
        }

        const pdfBuffer = await renderTemplateToPdf(report.html, {});
        await uploadBufferToS3(pdfBuffer, objectKey, 'application/pdf');

        reports.push({
          patientId: report.patientId,
          labOrderIds: report.labOrderIds,
          reportPdf,
        });
      }
    } else {
      for (const report of generated.reports) {
        const reportPdf = await generateAndUploadPdf(
          report.html,
          {},
          'lab-reports',
          null,
          lab.clinicId
        );

        reports.push({
          patientId: report.patientId,
          labOrderIds: report.labOrderIds,
          reportPdf,
        });
      }
    }

    await database.transaction(async (trx) => {
      await verifyLabAccess(trx, context);

      const scopedOrders = await trx
        .select({ id: LabOrderModel.id })
        .from(LabOrderModel)
        .innerJoin(
          LabUpdatedTestModel,
          eq(LabOrderModel.labUpdatedTestId, LabUpdatedTestModel.id)
        )
        .where(
          and(
            inArray(LabOrderModel.id, uniqueOrderIds),
            eq(LabUpdatedTestModel.labId, context.labId)
          )
        );

      if (scopedOrders.length !== uniqueOrderIds.length) {
        throw new HttpError(
          404,
          'One or more lab orders were not found for this lab'
        );
      }

      for (const report of reports) {
        await trx
          .update(LabOrderModel)
          .set({ reportPdf: report.reportPdf, updatedAt: new Date() })
          .where(inArray(LabOrderModel.id, report.labOrderIds));
      }
    });

    return {
      templateName: generated.templateName,
      reports,
      reportPdfs: reports.map((report) => report.reportPdf),
    };
  }
}
