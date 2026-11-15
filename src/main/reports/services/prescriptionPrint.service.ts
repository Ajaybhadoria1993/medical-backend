/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { ExaminationService } from '../../examination';
import { reportCardTemplate1 } from '../../../htmltamplates/report_card1';
import { reportCardTemplate2 } from '../../../htmltamplates/report_card2';
import { reportCardTemplate3 } from '../../../htmltamplates/report_card3';
import { reportCardTemplate4 } from '../../../htmltamplates/report_card4';
import { reportCardTemplate5 } from '../../../htmltamplates/report_card5';
import { reportCardTemplate6 } from '../../../htmltamplates/report_card6';
import { HttpError } from '../../../middlewear/errorHandler';
import logger from '../../../utils/logger';
import {
  buildAppDownloadUrl,
  buildAppQrDataUrl,
} from '../../../utils/qr.utils';
import { broadcastPrescriptionPdfReadyToAppointmentRoom } from '../../../utils/notification.utils';
import {
  notifyPrescriptionPdfGenerationStarted,
  notifyPrescriptionPdfReady,
} from '../../../utils/notificationHelpers';
import {
  generateAndUploadPdf,
  renderTemplateToPdf,
} from '../../../utils/pdf.utils';
import { AppointmentClinicalModel } from '../../appointments/models/appointmentClinical.model';
import { AppointmentModel } from '../../appointments/models/appointment.model';
import { ClinicSymptomModel } from '../../clinic/models/clinic-symptom.model';
import {
  ClinicAssignModel,
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicModel,
} from '../../clinic/models/clinic.model';
import { DoctorQualificationModel } from '../../doctor/models/doctor.model';
import { doctorManualTemplateModel } from '../../doctor/models/doctorManualTemplate.model';
import { doctorTemplateModel } from '../../doctor/models/doctorTemplate.model';
import { MedicineModel } from '../../medicine/models/medicine.model';
import { LabOrderModel } from '../../test/models/labOrder.model';
import { TestCatalogModel } from '../../test/models/testCatalog.model';
import { UserModel } from '../../users/models/user.model';
import { UserProfessionalModel } from '../../users/models/userProfessional.model';
import { UserProfileModel } from '../../users/models/userProfile.model';
import {
  PrescriptionModel,
  PrescriptionTemplateModel,
  ReportCardModel,
} from '../models/reports.model';
import { QuickPrintTemplateModel } from '../../quick-print-templates/models/quickPrintTemplate.model';
import { QuickPrintTemplateService } from '../../quick-print-templates/services/quickPrintTemplate.service';
import {
  buildQuickPrintLayoutTemplate,
  DEFAULT_QUICK_PRINT_LAYOUT,
} from '../../quick-print-templates/templates/layoutRenderer';
import type { TemplateUsage } from '../../quick-print-templates/schemas/quickPrintTemplate.schemas';
import { AppointmentRegistrationService } from '../../appointments/services/appointmentRegistration.service';
import { prescriptionPlans } from '../../treatmentPlan';
import { PrescriptionTemplateDto } from '../schemas/report.schemas';
import { buildFontUrl, getPrimaryFont } from '../../../utils/fontConfig.utils';
import { DEFAULT_TEMPLATE_CONFIG } from '../utils/prescriptionSample.utils';
import {
  PRESCRIPTION_SECTION_DEFAULTS,
  PrescriptionSectionConfig,
  PrescriptionSectionService,
} from './prescriptionSection.service';
import { PrescriptionTranslationService } from './prescriptionTranslation.service';
import { toPrescriptionLanguage } from '../utils/prescriptionLanguages.utils';
import {
  doctorDegreeLine,
  type DegreeRow,
} from '../../../utils/qualificationCatalog';
import type { PrescriptionLanguage } from '../types/prescriptionTranslation.types';
import type { PrintTreatmentPlan } from '../types/prescriptionPrint.types';
import { DEFAULT_TEMPLATE6_COLORS } from '../utils/prescriptionSample.utils';

// Header text: the 3 highest degrees, lowest first — the same line every screen shows.
const formatQualifications = (
  rows: DegreeRow[],
  fallback?: string | null
): string => doctorDegreeLine(rows, fallback, 3);

// 409: the prescription exists but its appointment day is over.

/** Printing a prescription: which template and sections, the preview context, building and rendering the PDF. */
export class PrescriptionPrintService {
  static resolvePatientAge(
    age?: number | string | null,
    dob?: string | null
  ): string {
    if (age !== null && age !== undefined && String(age).trim() !== '') {
      return String(age);
    }
    if (!dob) return '';

    const born = new Date(dob);
    if (Number.isNaN(born.getTime())) return '';

    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    const monthDiff = now.getMonth() - born.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) {
      years -= 1;
    }

    return years >= 0 && years < 150 ? String(years) : '';
  }

  static async getCurrentTemplateInfo(doctorId: string) {
    try {
      const [manualTemplate, dbTemplate, namedTemplate] = await Promise.all([
        database
          .select({
            templateHtml: doctorManualTemplateModel.templateHtml,
            updatedAt: doctorManualTemplateModel.updatedAt,
          })
          .from(doctorManualTemplateModel)
          .where(eq(doctorManualTemplateModel.doctorId, doctorId))
          .orderBy(desc(doctorManualTemplateModel.updatedAt))
          .limit(1)
          .then((results) =>
            results[0]
              ? {
                  type: 'manual',
                  name: 'Manual Template',
                  updatedAt: results[0].updatedAt,
                  hasContent: !!results[0].templateHtml,
                }
              : null
          ),

        database
          .select({
            templateHtml: doctorTemplateModel.templateHtml,
            updatedAt: doctorTemplateModel.updatedAt,
          })
          .from(doctorTemplateModel)
          .where(eq(doctorTemplateModel.doctorId, doctorId))
          .orderBy(desc(doctorTemplateModel.updatedAt))
          .limit(1)
          .then((results) =>
            results[0]
              ? {
                  type: 'doctor_html',
                  name: 'Doctor HTML Template',
                  updatedAt: results[0].updatedAt,
                  hasContent: !!results[0].templateHtml,
                }
              : null
          ),

        database
          .select({
            templateName: PrescriptionTemplateModel.templateName,
            updatedAt: PrescriptionTemplateModel.updatedAt,
          })
          .from(PrescriptionTemplateModel)
          .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
          .orderBy(desc(PrescriptionTemplateModel.updatedAt))
          .limit(1)
          .then((results) =>
            results[0]
              ? {
                  type: 'prescription',
                  name: `Prescription Template (${results[0].templateName})`,
                  templateName: results[0].templateName,
                  updatedAt: results[0].updatedAt,
                  hasContent: true,
                }
              : null
          ),
      ]);

      const availableTemplates = [
        manualTemplate,
        dbTemplate,
        namedTemplate,
      ].filter((t): t is NonNullable<typeof t> => t !== null && t.hasContent);

      if (availableTemplates.length === 0) {
        return {
          usingTemplate: 'Default Template',
          templateType: 'default',
          templateName: 'Template 6',
          message: 'No custom template found, using default template6',
        };
      }

      const latestTemplate = availableTemplates.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      })[0];

      if (latestTemplate.type === 'manual') {
        return {
          usingTemplate: 'Manual Scanner',
          templateType: 'manual',
          updatedAt: latestTemplate.updatedAt,
          message: 'Using manually uploaded template',
        };
      } else if (latestTemplate.type === 'doctor_html') {
        return {
          usingTemplate: 'Prescription Scanner',
          templateType: 'doctor_html',
          updatedAt: latestTemplate.updatedAt,
          message: 'Using custom HTML template from doctor template',
        };
      } else if (latestTemplate.type === 'prescription') {
        return {
          usingTemplate: 'Prescription Templates',
          templateType: 'prescription',
          templateName: (latestTemplate as any).templateName,
          updatedAt: latestTemplate.updatedAt,
          message: `Using prescription template: ${(latestTemplate as any).templateName}`,
        };
      }

      return {
        usingTemplate: 'Default Template',
        templateType: 'default',
        templateName: 'Template 6',
        message: 'Using default template6',
      };
    } catch {
      throw new HttpError(500, 'Failed to fetch current template information');
    }
  }

  /** The appointment's doctor and printable registration number, so the live preview matches the PDF. */
  static async getAppointmentPreviewInfo(
    appointmentId: string,
    clinicId: string
  ): Promise<{
    doctorId: string | null;
    registrationNo: string;
    appointmentDate: string;
    token: string;
    symptoms: { name: string }[];
    treatmentPlans: PrintTreatmentPlan[];
  }> {
    const empty = {
      doctorId: null,
      registrationNo: '',
      appointmentDate: '',
      token: '',
      symptoms: [],
      treatmentPlans: [],
    };
    try {
      const [row] = await database
        .select({
          patientId: AppointmentModel.patientId,
          doctorId: AppointmentModel.doctorId,
          registrationNo: AppointmentModel.registrationNo,
          appointmentDate: AppointmentModel.appointmentDate,
          tokenNo: AppointmentModel.tokenNo,
          clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
        })
        .from(AppointmentModel)
        .leftJoin(
          AppointmentClinicalModel,
          eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
        )
        .where(
          and(
            eq(AppointmentModel.id, appointmentId),
            eq(AppointmentModel.clinicId, clinicId)
          )
        )
        .limit(1);
      if (!row) return empty;

      // Same symptoms and plans the saved PDF prints.
      const [symptoms, treatmentPlans] = await Promise.all([
        row.clinicSymptomIds?.length
          ? database
              .select({ name: ClinicSymptomModel.name })
              .from(ClinicSymptomModel)
              .where(inArray(ClinicSymptomModel.id, row.clinicSymptomIds))
          : Promise.resolve([]),
        row.patientId
          ? PrescriptionPrintService.treatmentPlansForPrint(
              clinicId,
              row.patientId,
              appointmentId
            )
          : Promise.resolve([]),
      ]);
      return {
        treatmentPlans,
        doctorId: row.doctorId ?? null,
        registrationNo: AppointmentRegistrationService.format(
          row.registrationNo
        ),
        appointmentDate: row.appointmentDate
          ? PrescriptionPrintService.formatPrescriptionDate(row.appointmentDate)
          : '',
        token: row.tokenNo ? String(row.tokenNo) : '',
        symptoms,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Resolves the doctor's ACTIVE template (same "latest updatedAt wins" logic as
   * the real PDF generation) and returns the ready-to-render HTML + config.
   * Used by the live preview so the preview matches the final prescription exactly.
   */
  static async getResolvedTemplateForPreview(
    doctorId: string,
    /** Live medicine list, so the preview reflows exactly as the PDF does. */
    medicineRows: Array<{ hasComposition: boolean }> = [],
    /** Blocks this visit filled in, so a switched-off one still previews. */
    filledBlockIds: string[] = [],
    /** Switches being changed right now (settings or Preview), used in place of the saved ones. */
    unsavedSections: PrescriptionSectionConfig | null = null,
    /** Print uses Quick Print and share the prescription template, unless the doctor chose one design for both. */
    purpose: 'print' | 'share' = 'share'
  ): Promise<{
    templateHtml: string;
    templateConfig: {
      fontFamily: string;
      primaryFont: string;
      fontUrl: string;
      colors: Record<string, string>;
    };
    isQuickPrint: boolean;
    elementConfig: any;
    /** The doctor's "what prints" switches: all apply to a named template, only the offs to Quick Print. */
    sectionConfig: PrescriptionSectionConfig | null;
  }> {
    const defaultConfig = DEFAULT_TEMPLATE_CONFIG;

    try {
      const [manual, dbHtml, named, quick] = await Promise.all([
        database
          .select({
            templateHtml: doctorManualTemplateModel.templateHtml,
            updatedAt: doctorManualTemplateModel.updatedAt,
          })
          .from(doctorManualTemplateModel)
          .where(eq(doctorManualTemplateModel.doctorId, doctorId))
          .orderBy(desc(doctorManualTemplateModel.updatedAt))
          .limit(1)
          .then((r) =>
            r[0]?.templateHtml ? { ...r[0], kind: 'html' as const } : null
          ),

        database
          .select({
            templateHtml: doctorTemplateModel.templateHtml,
            updatedAt: doctorTemplateModel.updatedAt,
          })
          .from(doctorTemplateModel)
          .where(eq(doctorTemplateModel.doctorId, doctorId))
          .orderBy(desc(doctorTemplateModel.updatedAt))
          .limit(1)
          .then((r) =>
            r[0]?.templateHtml ? { ...r[0], kind: 'html' as const } : null
          ),

        database
          .select()
          .from(PrescriptionTemplateModel)
          .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
          .orderBy(desc(PrescriptionTemplateModel.updatedAt))
          .limit(1)
          .then((r) => (r[0] ? { ...r[0], kind: 'named' as const } : null)),

        database
          .select({
            selectedTemplate: QuickPrintTemplateModel.selectedTemplate,
            elementConfig: QuickPrintTemplateModel.elementConfig,
            updatedAt: QuickPrintTemplateModel.updatedAt,
          })
          .from(QuickPrintTemplateModel)
          .where(eq(QuickPrintTemplateModel.doctorId, doctorId))
          .limit(1)
          .then((r) =>
            r[0]?.selectedTemplate ? { ...r[0], kind: 'quick' as const } : null
          ),
      ]);

      const quickConfig = quick?.elementConfig as
        | { templateUsage?: TemplateUsage; usageOnly?: boolean }
        | null
        | undefined;
      const usage = quickConfig?.templateUsage ?? 'separate';
      // No saved design (none, or a settings-only row): Quick Print still prints, in its default layout.
      const quickDesign =
        quick && !quickConfig?.usageOnly
          ? quick
          : {
              kind: 'quick' as const,
              selectedTemplate: 'compact-medicine-slip',
              updatedAt: null,
              elementConfig: {
                ...(quickConfig ?? {}),
                blockLayout: DEFAULT_QUICK_PRINT_LAYOUT,
              },
            };
      const useQuick =
        purpose === 'print' ? usage !== 'prescription' : usage === 'quickPrint';

      const candidates = useQuick
        ? [quickDesign]
        : [manual, dbHtml, named].filter(
            (t): t is NonNullable<typeof t> => t !== null
          );

      if (candidates.length === 0) {
        return {
          templateHtml: reportCardTemplate6,
          templateConfig: {
            ...defaultConfig,
            colors: DEFAULT_TEMPLATE6_COLORS,
          },
          isQuickPrint: false,
          elementConfig: null,
          sectionConfig: unsavedSections,
        };
      }

      const winner = candidates.sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      })[0] as any;

      if (winner.kind === 'html') {
        return {
          templateHtml: winner.templateHtml,
          templateConfig: defaultConfig,
          isQuickPrint: false,
          elementConfig: null,
          sectionConfig: null,
        };
      }

      if (winner.kind === 'quick') {
        // A saved designer layout wins over the canned template here for the
        // same reason it does when the PDF is generated: it carries the
        // doctor's actual block positions. Previewing the canned flow template
        // instead showed a page that did not match what would print.
        const elementConfig = (winner.elementConfig as any) || {};
        const sections = unsavedSections ?? named?.sectionConfig ?? null;
        const designerTemplate = buildQuickPrintLayoutTemplate({
          blockLayout: elementConfig.blockLayout,
          pageSize: elementConfig.pageSize,
          tableStyle: elementConfig.tableStyle,
          layoutMode: elementConfig.layoutMode,
          design: elementConfig.design,
          bottomMarginMm: elementConfig.bottomMarginMm,
          textScale: elementConfig.textScale,
          medicineRows,
          filledBlockIds,
          hiddenBlockIds: PrescriptionSectionService.hiddenBlockIds(sections),
          hiddenSections: PrescriptionSectionService.switchedOffKeys(sections),
        });

        return {
          templateHtml:
            designerTemplate ??
            QuickPrintTemplateService.getTemplateHtml(winner.selectedTemplate),
          templateConfig: defaultConfig,
          isQuickPrint: true,
          elementConfig: winner.elementConfig,
          sectionConfig: sections,
        };
      }

      // named
      const fontFamily = winner.fontFamily || 'Inter, sans-serif';
      const colors = {
        color1: winner.color1 || '#0A6C74',
        color2: winner.color2 || '#EBFCF4',
        color3: winner.color3 || '#333333',
        color4: winner.color4 || '#666666',
        color5: winner.color5 || '#e0e0e0',
        color6: winner.color6 || '#b22222',
        color7: winner.color7 || '#f9f9f9',
        color8: winner.color8 || '#ffffff',
        color9: winner.color9 || '#000000',
        color10: winner.color10 || '#856404',
      };
      const namedMap: Record<string, string> = {
        template1: reportCardTemplate1,
        template2: reportCardTemplate2,
        template3: reportCardTemplate3,
        template4: reportCardTemplate4,
        template5: reportCardTemplate5,
        template6: reportCardTemplate6,
      };
      return {
        templateHtml: namedMap[winner.templateName] || reportCardTemplate6,
        templateConfig: {
          fontFamily,
          primaryFont: getPrimaryFont(fontFamily),
          fontUrl: buildFontUrl(fontFamily),
          colors,
        },
        isQuickPrint: false,
        elementConfig: null,
        sectionConfig: unsavedSections ?? winner.sectionConfig ?? null,
      };
    } catch (error) {
      logger.error('getResolvedTemplateForPreview error:', error);
      return {
        templateHtml: reportCardTemplate6,
        templateConfig: { ...defaultConfig, colors: DEFAULT_TEMPLATE6_COLORS },
        isQuickPrint: false,
        elementConfig: null,
        sectionConfig: null,
      };
    }
  }

  static async upsertTemplate(doctorId: string, data: PrescriptionTemplateDto) {
    try {
      const existingTemplate = await database
        .select()
        .from(PrescriptionTemplateModel)
        .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
        .limit(1);

      let result;

      if (existingTemplate && existingTemplate.length > 0) {
        const updated = await database
          .update(PrescriptionTemplateModel)
          .set({
            templateName: data.templateName,
            fontFamily: data.fontFamily,
            color1: data.color1,
            color2: data.color2,
            color3: data.color3,
            color4: data.color4,
            color5: data.color5,
            color6: data.color6,
            color7: data.color7,
            color8: data.color8,
            color9: data.color9,
            color10: data.color10,
            // Absent key = "colours only" save; keep the stored sections.
            ...(data.sectionConfig
              ? { sectionConfig: data.sectionConfig }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
          .returning();

        result = {
          action: 'updated' as const,
          template: updated[0],
        };
      } else {
        const inserted = await database
          .insert(PrescriptionTemplateModel)
          .values({
            doctorId,
            templateName: data.templateName,
            fontFamily: data.fontFamily,
            color1: data.color1,
            color2: data.color2,
            color3: data.color3,
            color4: data.color4,
            color5: data.color5,
            color6: data.color6,
            color7: data.color7,
            color8: data.color8,
            color9: data.color9,
            color10: data.color10,
            sectionConfig: data.sectionConfig ?? PRESCRIPTION_SECTION_DEFAULTS,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        result = {
          action: 'created' as const,
          template: inserted[0],
        };
      }

      // When doctor explicitly selects a named template, backdate other
      // template sources so the named template wins the "most recent" check
      // during PDF generation. This ensures user intent is respected.
      const pastDate = new Date('2000-01-01T00:00:00.000Z');

      await Promise.allSettled([
        database
          .update(doctorTemplateModel)
          .set({ updatedAt: pastDate })
          .where(eq(doctorTemplateModel.doctorId, doctorId)),
        database
          .update(doctorManualTemplateModel)
          .set({ updatedAt: pastDate })
          .where(eq(doctorManualTemplateModel.doctorId, doctorId)),
      ]);

      return result;
    } catch {
      throw new HttpError(500, 'Failed to save prescription template');
    }
  }

  static async getTemplate(doctorId: string) {
    try {
      const [template] = await database
        .select()
        .from(PrescriptionTemplateModel)
        .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
        .limit(1);

      if (!template) return null;

      // Always hand back a complete flag set: the settings screen renders a
      // toggle per section and a missing key would render as "off" against a
      // template that actually prints the section.
      return {
        ...template,
        sectionConfig: PrescriptionSectionService.derive(
          template.sectionConfig
        ),
      };
    } catch {
      throw new HttpError(500, 'Failed to fetch prescription template');
    }
  }

  /** Saves only the switches and never `updatedAt`: bumping it would make this row the active template. */
  static async saveSectionConfig(
    doctorId: string,
    sectionConfig: PrescriptionSectionConfig
  ) {
    const [updated] = await database
      .update(PrescriptionTemplateModel)
      .set({ sectionConfig })
      .where(eq(PrescriptionTemplateModel.doctorId, doctorId))
      .returning({ sectionConfig: PrescriptionTemplateModel.sectionConfig });

    // ponytail: doctor_id isn't unique, so two first-ever saves racing can insert twice; add a unique index if seen.
    const [saved] = updated
      ? [updated]
      : await database
          .insert(PrescriptionTemplateModel)
          .values({
            doctorId,
            // No design yet: the default layout, undated so it never outranks Quick Print or an upload.
            templateName: 'template6',
            fontFamily: 'Inter, sans-serif',
            ...DEFAULT_TEMPLATE6_COLORS,
            sectionConfig,
            updatedAt: null,
          })
          .returning({
            sectionConfig: PrescriptionTemplateModel.sectionConfig,
          });

    return {
      sectionConfig: PrescriptionSectionService.derive(saved.sectionConfig),
    };
  }

  /** A doctor's saved switches, complete over the defaults even before they've saved any. */
  static async getSectionConfig(doctorId: string) {
    const template = await PrescriptionPrintService.getTemplate(doctorId);
    return {
      sectionConfig:
        template?.sectionConfig ?? PrescriptionSectionService.derive(null),
    };
  }

  /**
   * Builds a real-time preview context for the given doctor:
   * the doctor's current clinic and profile (fetched live from the DB).
   * Patient data and prescription records are supplied as dummy values by
   * the preview controller. Returns null fields when nothing is found so the
   * controller can fall back to placeholder data.
   */
  static async getDoctorPreviewContext(doctorId: string) {
    // Independent reads; run together, they cost one database round trip.
    const [doctor, qualifications, assignedClinic] = await Promise.all([
      database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          qualification: UserProfessionalModel.qualification,
          speciality: UserProfessionalModel.speciality,
          registrationNumber: UserProfessionalModel.registrationNumber,
        })
        .from(UserModel)
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(eq(UserModel.id, doctorId))
        .limit(1)
        .then((r) => r[0]),
      database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, doctorId)),
      // Clinic the doctor is assigned to, else (below) the clinic they own.
      database
        .select({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          State: ClinicModel.State,
          City: ClinicModel.City,
          ZipCode: ClinicModel.ZipCode,
          clinicLogo: ClinicModel.clinicLogo,
          Tagline: ClinicModel.Tagline,
        })
        .from(ClinicModel)
        .innerJoin(
          ClinicAssignModel,
          eq(ClinicAssignModel.clinicId, ClinicModel.id)
        )
        .where(eq(ClinicAssignModel.userId, doctorId))
        .limit(1)
        .then((r) => r[0]),
    ]);

    const clinic =
      assignedClinic ??
      (await database
        .select({
          id: ClinicModel.id,
          clinicName: ClinicModel.clinicName,
          clinicAddress: ClinicModel.clinicAddress,
          clinicLocation: ClinicModel.clinicLocation,
          clinicPhone: ClinicModel.clinicPhone,
          State: ClinicModel.State,
          City: ClinicModel.City,
          ZipCode: ClinicModel.ZipCode,
          clinicLogo: ClinicModel.clinicLogo,
          Tagline: ClinicModel.Tagline,
        })
        .from(ClinicModel)
        .where(eq(ClinicModel.userId, doctorId))
        .limit(1)
        .then((r) => r[0]));

    // Consultation timings (live), grouped for compact display
    let availability: any[] = [];
    let groupedAvailability: any[] = [];
    if (clinic?.id) {
      availability =
        await PrescriptionPrintService.getFormattedClinicAvailability(
          doctorId,
          clinic.id
        );
      groupedAvailability =
        PrescriptionPrintService.groupAvailability(availability);
    }

    return {
      clinic: clinic
        ? {
            name: clinic.clinicName || '',
            address: clinic.clinicAddress || '',
            clinicLocation: clinic.clinicLocation || '',
            city: clinic.City || '',
            state: clinic.State || '',
            zipcode: clinic.ZipCode ? String(clinic.ZipCode) : '',
            phone: clinic.clinicPhone || '',
            logo: clinic.clinicLogo || '',
            tagline: clinic.Tagline || '',
          }
        : null,
      doctor: doctor
        ? {
            name: doctor.name || '',
            email: doctor.email || '',
            qualification: formatQualifications(
              qualifications,
              doctor.qualification
            ),
            speciality: doctor.speciality || '',
            registrationNumber: doctor.registrationNumber || '',
            availability,
            groupedAvailability,
          }
        : null,
    };
  }

  static async getFormattedClinicAvailability(
    doctorId: string,
    clinicId: string
  ): Promise<any[]> {
    try {
      const availability = await database
        .select()
        .from(ClinicAvailability)
        .where(
          and(
            eq(ClinicAvailability.doctorId, doctorId),
            eq(ClinicAvailability.clinicId, clinicId)
          )
        );

      const daysOrder = [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ];
      const shortDays = ['Mon', 'Tues', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

      const availabilityMap = new Map();
      availability.forEach((item) => {
        availabilityMap.set(item.dayOfWeek, item);
      });

      const availabilityIds = availability
        .map((item) => item?.id)
        .filter((id) => id) as string[];

      const availabilityBreaks = availabilityIds.length
        ? await database
            .select()
            .from(ClinicAvailabilityBreak)
            .where(
              and(
                inArray(
                  ClinicAvailabilityBreak.clinicAvailabilityId,
                  availabilityIds
                ),
                eq(ClinicAvailabilityBreak.status, true)
              )
            )
        : [];

      const breaksByAvailability = new Map<string, any[]>();
      availabilityBreaks.forEach((b) => {
        const key = b.clinicAvailabilityId;
        if (!breaksByAvailability.has(key)) {
          breaksByAvailability.set(key, []);
        }
        breaksByAvailability.get(key)?.push(b);
      });

      const parseTimeToMinutes = (
        time: string | null | undefined
      ): number | null => {
        if (!time) return null;
        const s = String(time).trim();

        const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
        if (ampmMatch) {
          let h = Number(ampmMatch[1]);
          const m = Number(ampmMatch[2]);
          const meridiem = ampmMatch[3].toUpperCase();
          if (Number.isNaN(h) || Number.isNaN(m)) return null;
          if (meridiem === 'AM') {
            if (h === 12) h = 0;
          } else if (h !== 12) {
            h += 12;
          }
          return h * 60 + m;
        }

        const plainMatch = s.match(/^(\d{1,2}):(\d{2})$/);
        if (plainMatch) {
          const h = Number(plainMatch[1]);
          const m = Number(plainMatch[2]);
          if (Number.isNaN(h) || Number.isNaN(m)) return null;
          return h * 60 + m;
        }

        return null;
      };

      const formatTimeForDisplay = (
        time: string | null | undefined
      ): string => {
        if (!time) return '';
        const s = String(time).trim();
        const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
        if (ampmMatch) {
          const h = Number(ampmMatch[1]);
          const m = ampmMatch[2];
          const meridiem = ampmMatch[3].toUpperCase();
          return `${h}:${m} ${meridiem}`;
        }

        const plainMatch = s.match(/^(\d{1,2}):(\d{2})$/);
        if (plainMatch) {
          let h = Number(plainMatch[1]);
          const m = plainMatch[2];
          if (Number.isNaN(h)) return s;
          const period = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          const hPadded = h.toString().padStart(2, '0');
          return `${hPadded}:${m} ${period}`;
        }

        return s;
      };

      const calculateShifts = (
        availStart: string | null | undefined,
        availEnd: string | null | undefined,
        rawBreaks: { startTime?: string | null; endTime?: string | null }[]
      ): string[] => {
        if (!availStart || !availEnd) return [];

        const availStartMin = parseTimeToMinutes(availStart);
        const availEndMin = parseTimeToMinutes(availEnd);

        if (
          availStartMin === null ||
          availEndMin === null ||
          availStartMin >= availEndMin
        ) {
          return [];
        }

        const validBreaks = rawBreaks
          .map((b) => {
            if (!b.startTime || !b.endTime) return null;
            const start = parseTimeToMinutes(b.startTime);
            const end = parseTimeToMinutes(b.endTime);
            if (start === null || end === null || start >= end) return null;
            return {
              start: Math.max(start, availStartMin),
              end: Math.min(end, availEndMin),
            };
          })
          .filter((b): b is { start: number; end: number } => Boolean(b))
          .filter((b) => b.end > availStartMin && b.start < availEndMin)
          .sort((a, b) => a.start - b.start);

        // merge overlapping breaks
        const merged = [] as { start: number; end: number }[];
        for (const b of validBreaks) {
          if (merged.length === 0) {
            merged.push({ ...b });
            continue;
          }
          const last = merged[merged.length - 1];
          if (b.start <= last.end) {
            last.end = Math.max(last.end, b.end);
          } else {
            merged.push({ ...b });
          }
        }

        const shifts: string[] = [];
        let currentStart = availStartMin;

        for (const br of merged) {
          if (currentStart < br.start) {
            shifts.push(
              `${formatTimeForDisplay(
                `${Math.floor(currentStart / 60)
                  .toString()
                  .padStart(2, '0')}:${(currentStart % 60)
                  .toString()
                  .padStart(2, '0')}`
              )} - ${formatTimeForDisplay(
                `${Math.floor(br.start / 60)
                  .toString()
                  .padStart(2, '0')}:${(br.start % 60)
                  .toString()
                  .padStart(2, '0')}`
              )}`
            );
          }
          currentStart = Math.max(currentStart, br.end);
        }

        if (currentStart < availEndMin) {
          shifts.push(
            `${formatTimeForDisplay(
              `${Math.floor(currentStart / 60)
                .toString()
                .padStart(2, '0')}:${(currentStart % 60)
                .toString()
                .padStart(2, '0')}`
            )} - ${formatTimeForDisplay(
              `${Math.floor(availEndMin / 60)
                .toString()
                .padStart(2, '0')}:${(availEndMin % 60)
                .toString()
                .padStart(2, '0')}`
            )}`
          );
        }

        return shifts;
      };

      const formattedDays = daysOrder.map((fullDay, index) => {
        const avail = availabilityMap.get(fullDay);
        const shortDay = shortDays[index];

        if (!avail || !avail.isAvailable) {
          return {
            day: shortDay,
            startTime: null,
            endTime: null,
            isAvailable: false,
            display: `${shortDay} - Off`,
          };
        }

        if (avail.startTime && avail.endTime) {
          const breakRows = breaksByAvailability.get(avail.id) || [];
          const rowBreaks = [...breakRows];
          if (avail.breaksStart && avail.breaksEnd) {
            rowBreaks.push({
              startTime: avail.breaksStart,
              endTime: avail.breaksEnd,
            });
          }

          const shifts = calculateShifts(
            avail.startTime,
            avail.endTime,
            rowBreaks
          );
          const startTimeFormatted = formatTimeForDisplay(avail.startTime);
          const endTimeFormatted = formatTimeForDisplay(avail.endTime);

          return {
            day: shortDay,
            startTime: startTimeFormatted,
            endTime: endTimeFormatted,
            isAvailable: true,
            display:
              shifts.length > 0
                ? shifts.join('<br/>')
                : `${startTimeFormatted} - ${endTimeFormatted}`,
          };
        }

        return {
          day: shortDay,
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: `${shortDay} - Off`,
        };
      });

      return formattedDays;
    } catch {
      return [
        {
          day: 'Mon',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Mon - Off',
        },
        {
          day: 'Tues',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Tues - Off',
        },
        {
          day: 'Wed',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Wed - Off',
        },
        {
          day: 'Thur',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Thur - Off',
        },
        {
          day: 'Fri',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Fri - Off',
        },
        {
          day: 'Sat',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Sat - Off',
        },
        {
          day: 'Sun',
          startTime: null,
          endTime: null,
          isAvailable: false,
          display: 'Sun - Off',
        },
      ];
    }
  }

  /**
   * Groups consecutive days with the same schedule into ranges.
   * e.g., "Mon - Fri" with shifts S1/S2 instead of one line per day. `shifts` carries
   * each shift on its own, labelled only when there are two or more.
   */
  static groupAvailability(
    availability: {
      day: string;
      isAvailable: boolean;
      display: string;
    }[]
  ): {
    days: string;
    isAvailable: boolean;
    display: string;
    shifts: { label: string; time: string }[];
  }[] {
    if (!availability || availability.length === 0) return [];

    // Normalize display for comparison: strip the day prefix from "Off" displays
    const getScheduleKey = (entry: {
      isAvailable: boolean;
      display: string;
    }) => {
      if (!entry.isAvailable) return 'OFF';
      return entry.display;
    };

    const groups: {
      days: string[];
      isAvailable: boolean;
      display: string;
      key: string;
    }[] = [];

    for (const entry of availability) {
      const key = getScheduleKey(entry);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.key === key) {
        lastGroup.days.push(entry.day);
      } else {
        groups.push({
          days: [entry.day],
          isAvailable: entry.isAvailable,
          display: entry.isAvailable ? entry.display : 'Off',
          key,
        });
      }
    }

    // Runs with the same hours share one line, so a mid-week day off gives "Mon - Wed, Fri - Sun".
    const merged = new Map<
      string,
      { runs: string[]; isAvailable: boolean; display: string }
    >();
    for (const group of groups) {
      const run =
        group.days.length > 1
          ? `${group.days[0]} - ${group.days[group.days.length - 1]}`
          : group.days[0];
      const existing = merged.get(group.key);
      if (existing) existing.runs.push(run);
      else
        merged.set(group.key, {
          runs: [run],
          isAvailable: group.isAvailable,
          display: group.display,
        });
    }

    // Two or more shifts get S1/S2 labels so a split day doesn't read as one block.
    const toShifts = (display: string) => {
      const times = display.split('<br/>');
      return times.map((time, i) => ({
        label: times.length > 1 ? `S${i + 1}` : '',
        time,
      }));
    };

    // Off groups are dropped: no template prints them, and an all-off week then hides the section.
    return [...merged.values()]
      .filter((group) => group.isAvailable)
      .map((group) => ({
        days: group.runs.join(', '),
        isAvailable: group.isAvailable,
        display: group.display,
        shifts: toShifts(group.display),
      }));
  }

  /** `15-Mar-2024`. Shared so every prescription path formats dates alike. */
  static formatPrescriptionDate(date: string | Date): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  /** `10:30 AM` from a `HH:mm` clock value. */
  static formatPrescriptionTime(time: string): string {
    if (!time) return '';

    const parts = time.split(':');
    if (parts.length < 2) return time;

    let hours = parseInt(parts[0]);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${hours}:${parts[1]} ${ampm}`;
  }

  /** A saved prescription rendered on demand in any language; never uploaded or stored. */
  static async renderPrescriptionPdf(
    reportCardId: string,
    clinicId: string,
    lang: PrescriptionLanguage,
    purpose: 'print' | 'share' = 'share'
  ): Promise<Buffer> {
    const input = await PrescriptionPrintService.buildPrescriptionPdfInput(
      reportCardId,
      purpose
    );
    // Another clinic's prescription is indistinguishable from a missing one.
    if (!input || input.appointment.clinicId !== clinicId) {
      throw new HttpError(404, 'Prescription not found');
    }

    const { templateHtml } = input.resolvedTemplate;
    const i18n =
      lang === 'en'
        ? undefined
        : await PrescriptionTranslationService.buildI18n(
            templateHtml,
            input.pdfData,
            lang,
            { clinicId, doctorId: input.doctorId },
            (
              await PrescriptionTranslationService.doctorSettings(
                input.doctorId
              )
            ).style
          );
    return renderTemplateToPdf(templateHtml, { ...input.pdfData, i18n });
  }

  /**
   * Everything a saved prescription renders from, loaded by report card id.
   * Shared by regeneratePdf and the on-demand PDF so both print the same data.
   */
  static async buildPrescriptionPdfInput(
    reportCardId: string,
    purpose: 'print' | 'share' = 'share'
  ) {
    const [reportCard] = await database
      .select({
        ...getTableColumns(ReportCardModel),
        additionalInformation: ExaminationService.findingsColumn(
          ReportCardModel.appointmentId,
          ReportCardModel.additionalInformation
        ),
      })
      .from(ReportCardModel)
      .where(eq(ReportCardModel.id, reportCardId))
      .limit(1);

    if (!reportCard) return null;

    const [appointment] = await database
      .select({
        id: AppointmentModel.id,
        appointmentType: AppointmentModel.appointmentType,
        appointmentDate: AppointmentModel.appointmentDate,
        appointmentTime: AppointmentModel.appointmentTime,
        appointmentStatus: AppointmentModel.appointmentStatus,
        tokenNo: AppointmentModel.tokenNo,
        registrationNo: AppointmentModel.registrationNo,
        clinicId: AppointmentModel.clinicId,
        patientId: AppointmentModel.patientId,
        doctorId: AppointmentModel.doctorId,
        clinicServiceId: AppointmentModel.clinicServiceId,
        clinicSymptomIds: AppointmentClinicalModel.clinicSymptomIds,
        vitals: AppointmentClinicalModel.vitals,
      })
      .from(AppointmentModel)
      .leftJoin(
        AppointmentClinicalModel,
        eq(AppointmentModel.id, AppointmentClinicalModel.appointmentId)
      )
      .where(eq(AppointmentModel.id, reportCard.appointmentId))
      .limit(1);

    if (!appointment) return null;

    if (appointment.doctorId === null) return null;

    // Independent reads; run together, they cost one database round trip.
    const [
      [clinic],
      [doctor],
      [patient],
      qualifications,
      prescriptions,
      tests,
      symptoms,
      availability,
      footerNotes,
      qrCode,
      treatmentPlans,
    ] = await Promise.all([
      database
        .select()
        .from(ClinicModel)
        .where(eq(ClinicModel.id, appointment.clinicId))
        .limit(1),
      database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          qualification: UserProfessionalModel.qualification,
          speciality: UserProfessionalModel.speciality,
          registrationNumber: UserProfessionalModel.registrationNumber,
        })
        .from(UserModel)
        .leftJoin(
          UserProfessionalModel,
          eq(UserProfessionalModel.userId, UserModel.id)
        )
        .where(eq(UserModel.id, appointment.doctorId))
        .limit(1),
      database
        .select({
          id: UserModel.id,
          name: UserModel.name,
          email: UserModel.email,
          mobile: UserModel.mobile,
          age: UserProfileModel.age,
          dob: UserProfileModel.dob,
          gender: UserProfileModel.gender,
          address: UserProfileModel.address,
        })
        .from(UserModel)
        .leftJoin(UserProfileModel, eq(UserProfileModel.userId, UserModel.id))
        .where(eq(UserModel.id, reportCard.petientId))
        .limit(1),
      database
        .select()
        .from(DoctorQualificationModel)
        .where(eq(DoctorQualificationModel.userId, appointment.doctorId)),
      database
        .select({
          // Same trim as the create-path query above — only what
          // `prescriptions.map(...)` below reads.
          medicineName: PrescriptionModel.medicineName,
          composition: PrescriptionModel.composition,
          strength: PrescriptionModel.strength,
          dosage: PrescriptionModel.dosage,
          frequency: PrescriptionModel.frequency,
          duration: PrescriptionModel.duration,
          notes: PrescriptionModel.notes,
          form: MedicineModel.form,
        })
        .from(PrescriptionModel)
        .leftJoin(
          MedicineModel,
          eq(PrescriptionModel.medicineId, MedicineModel.id)
        )
        .where(eq(PrescriptionModel.reportCardId, reportCardId)),
      // Tests ordered at this visit, same lookup the prescription page uses.
      database
        .select({ name: TestCatalogModel.name })
        .from(LabOrderModel)
        .innerJoin(
          TestCatalogModel,
          eq(LabOrderModel.testId, TestCatalogModel.id)
        )
        .where(eq(LabOrderModel.appointmentId, appointment.id))
        .orderBy(desc(LabOrderModel.createdAt)),
      appointment.clinicSymptomIds && appointment.clinicSymptomIds.length > 0
        ? database
            .select({
              id: ClinicSymptomModel.id,
              name: ClinicSymptomModel.name,
              description: ClinicSymptomModel.description,
            })
            .from(ClinicSymptomModel)
            .where(inArray(ClinicSymptomModel.id, appointment.clinicSymptomIds))
        : Promise.resolve([] as any[]),
      // Same hours the saved PDF prints, so translated and downloaded copies match it.
      PrescriptionPrintService.getFormattedClinicAvailability(
        appointment.doctorId,
        appointment.clinicId
      ),
      QuickPrintTemplateService.getFooterNotes(appointment.doctorId),
      buildAppQrDataUrl(),
      PrescriptionPrintService.treatmentPlansForPrint(
        appointment.clinicId,
        reportCard.petientId,
        appointment.id
      ),
    ]);
    const testNames = [...new Set(tests.map((t) => t.name).filter(Boolean))];

    const vitals = (appointment.vitals || {}) as {
      bpSys?: number;
      bpDia?: number;
      fbs?: number;
      ppbs?: number;
      rbs?: number;
      pulse?: number;
      spo2?: number;
      respiratoryRate?: number;
      temperatureC?: number;
      heightCm?: number;
      weightKg?: number;
      bmi?: number;
    };
    let vitalsCount = 0;

    if (vitals.bpSys && vitals.bpDia) vitalsCount++;
    if (vitals.fbs) vitalsCount++;
    if (vitals.ppbs) vitalsCount++;
    if (vitals.rbs) vitalsCount++;
    if (vitals.pulse) vitalsCount++;
    if (vitals.spo2) vitalsCount++;
    if (vitals.respiratoryRate) vitalsCount++;
    if (vitals.temperatureC) vitalsCount++;
    if (vitals.heightCm) vitalsCount++;
    if (vitals.weightKg) vitalsCount++;
    if (vitals.bmi) vitalsCount++;

    // An edit regenerates with the same template and section visibility the first save used.
    const resolvedTemplate =
      await PrescriptionPrintService.getResolvedTemplateForPreview(
        appointment.doctorId,
        prescriptions.map((rx: any) => ({
          hasComposition: Boolean(rx.composition),
        })),
        // Filled-in blocks print even when switched off in the layout, same as the live preview.
        [
          vitalsCount > 0 && 'vitals',
          (reportCard.finalDiagnosis || reportCard.provisionalDiagnosis) &&
            'diagnosis',
          reportCard.preDiagnosis && 'preDiagnosis',
          reportCard.advice && 'advice',
          reportCard.followUpDate && 'followUp',
          testNames.length > 0 && 'tests',
          (reportCard.allergies as string[] | null)?.length && 'allergies',
          (reportCard.habits as string[] | null)?.length && 'habits',
          reportCard.clinicalNotes && 'clinicalNotes',
          symptoms.length > 0 && 'chiefComplaints',
        ].filter((id): id is string => typeof id === 'string'),
        null,
        purpose
      );

    const editTemplateConfig = resolvedTemplate.templateConfig;
    const editElements = resolvedTemplate.isQuickPrint
      ? PrescriptionSectionService.applySwitchedOff(
          QuickPrintTemplateService.deriveElements(
            resolvedTemplate.elementConfig || {}
          ),
          resolvedTemplate.sectionConfig
        )
      : {
          ...QuickPrintTemplateService.DEFAULT_ELEMENTS,
          ...PrescriptionSectionService.derive(
            resolvedTemplate.sectionConfig ?? null
          ),
        };

    const pdfData = {
      templateConfig: editTemplateConfig,
      footerNotes,
      config: {
        fontFamily: editTemplateConfig.fontFamily,
        primaryFont: editTemplateConfig.primaryFont,
        accentColor: '#333333',
        elements: editElements,
      },
      clinic: {
        name: clinic?.clinicName || '',
        address: clinic?.clinicAddress || '',
        clinicLocation: clinic?.clinicLocation || '',
        city: clinic?.City || '',
        state: clinic?.State || '',
        // `zip_code` is an integer column — templates and the clinicAddress
        // helper expect text.
        zipcode: clinic?.ZipCode != null ? String(clinic.ZipCode) : '',
        phone: clinic?.clinicPhone || '',
        logo: clinic?.clinicLogo || '',
        tagline: clinic?.Tagline || '',
      },
      watermarkLogo: clinic?.clinicLogo || '', // Using clinic logo as watermark by default
      doctor: {
        name: doctor?.name || '',
        email: doctor?.email || '',
        qualification: formatQualifications(
          qualifications,
          doctor?.qualification
        ),
        speciality: doctor?.speciality || '',
        registrationNumber: doctor?.registrationNumber || '',
        availability,
        groupedAvailability:
          PrescriptionPrintService.groupAvailability(availability),
      },
      patient: {
        name: patient?.name || '',
        age: PrescriptionPrintService.resolvePatientAge(
          patient?.age,
          patient?.dob
        ),
        gender: patient?.gender || '',
        address: patient?.address || '',
        uhid: '',
        mobile: patient?.mobile || '',
      },
      reportId: reportCardId,
      // PNG data URI — templates must render it with {{{qrCode}}}.
      qrCode,
      appDownloadUrl: buildAppDownloadUrl(),
      reportDate: new Date(reportCard.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      vitals: vitals,
      vitalsCount: vitalsCount,
      vitalsMoreThanOne: vitalsCount > 0,
      symptoms: symptoms,
      diagnosis:
        reportCard.finalDiagnosis || reportCard.provisionalDiagnosis || '',
      prescriptions: prescriptions.map((p: any) => ({
        medicineName: p.medicineName,
        form: p.form || '',
        strength: p.strength || '',
        composition: p.composition,
        dosage: p.dosage,
        frequency: p.frequency,
        duration: p.duration,
        notes: p.notes || '',
      })),
      advice: reportCard.advice || '',
      preDiagnosis: reportCard.preDiagnosis || '',
      additionalInformation: reportCard.additionalInformation || null,
      followUpDate: reportCard.followUpDate
        ? PrescriptionPrintService.formatPrescriptionDate(
            reportCard.followUpDate
          )
        : '',
      // Fields the create path supplies; templates silently skip anything missing.
      provisionalDiagnosis: reportCard.provisionalDiagnosis || '',
      dietarySuggestion: reportCard.clinicalNotes || '',
      habits: reportCard.habits || '',
      allergies: reportCard.allergies || '',
      surgerySuggested: reportCard.surgerySuggested || '',
      comorbidities: reportCard.comorbidities || [],
      // The calendar stores YYYY-MM-DD; print like every other date, raw if unparseable.
      visitingDays: ((reportCard.visitingDays || []) as string[])
        .map(
          (day) => PrescriptionPrintService.formatPrescriptionDate(day) || day
        )
        .filter(Boolean),
      visitingNotes: reportCard.visitingNotes || '',
      appointmentDate: appointment.appointmentDate
        ? PrescriptionPrintService.formatPrescriptionDate(
            appointment.appointmentDate
          )
        : '',
      appointmentTime: appointment.appointmentTime
        ? PrescriptionPrintService.formatPrescriptionTime(
            appointment.appointmentTime
          )
        : '',
      visitDate: appointment.appointmentDate
        ? PrescriptionPrintService.formatPrescriptionDate(
            appointment.appointmentDate
          )
        : '',
      token: appointment.tokenNo || '',
      registrationNo: AppointmentRegistrationService.format(
        appointment.registrationNo
      ),
      hasTests: testNames.length > 0,
      testNames: testNames.join(', '),
      treatmentPlans,
    };

    return {
      appointment,
      doctorId: appointment.doctorId,
      patient,
      resolvedTemplate,
      pdfData,
      printLanguage: toPrescriptionLanguage(reportCard.printLanguage),
    };
  }

  /** Plans suggested at this visit, ready for TREATMENT_PLAN_HTML. A lookup failure prints the
   *  prescription without them rather than failing it. */
  static async treatmentPlansForPrint(
    clinicId: string,
    patientId: string,
    appointmentId: string
  ): Promise<PrintTreatmentPlan[]> {
    try {
      const plans = await prescriptionPlans(clinicId, patientId, appointmentId);
      return plans.map((plan) => {
        const option = plan.optionLabel
          ? ` — Option ${plan.optionLabel}${plan.optionName ? `: ${plan.optionName}` : ''}`
          : '';
        return {
          title: `${plan.title}${option}`,
          status: plan.status
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' '),
          // Each gap counts from the visit before, so "when" reads relative to it.
          steps: plan.steps.map((step, i) => ({
            n: i + 1,
            name: step.name,
            when:
              i === 0
                ? 'Start'
                : step.gapDays === 0
                  ? 'Same day'
                  : `After ${step.gapDays} ${step.gapDays === 1 ? 'day' : 'days'}`,
          })),
        };
      });
    } catch (error) {
      logger.warn('Treatment plans for prescription failed', error);
      return [];
    }
  }

  /** Regenerates and re-uploads a saved prescription's PDF after an edit. */
  static async regeneratePdf(
    reportCardId: string,
    pickedLanguage?: PrescriptionLanguage,
    // Passed by the save path, which has already loaded it for the SMS.
    preloaded?: Awaited<
      ReturnType<typeof PrescriptionPrintService.buildPrescriptionPdfInput>
    >
  ) {
    try {
      const input =
        preloaded ??
        (await PrescriptionPrintService.buildPrescriptionPdfInput(
          reportCardId
        ));
      if (!input) return;
      const {
        appointment,
        doctorId,
        patient,
        resolvedTemplate,
        pdfData,
        printLanguage,
      } = input;

      // notify start of regeneration
      if (patient?.id) {
        notifyPrescriptionPdfGenerationStarted(
          patient.id,
          reportCardId,
          appointment.id
        ).catch((err) => {
          logger.warn('notify start regeneration failed', err);
        });
      }

      const [existingReport] = await database
        .select({ prescriptionPdf: ReportCardModel.prescriptionPdf })
        .from(ReportCardModel)
        .where(eq(ReportCardModel.id, reportCardId));

      const i18n = await PrescriptionTranslationService.forDoctor(
        resolvedTemplate.templateHtml,
        pdfData,
        doctorId,
        appointment.clinicId,
        pickedLanguage ?? printLanguage
      );

      const pdfUrl = await generateAndUploadPdf(
        resolvedTemplate.templateHtml,
        { ...pdfData, i18n },
        'prescriptions',
        existingReport?.prescriptionPdf,
        appointment.clinicId
      );

      await database
        .update(ReportCardModel)
        .set({ prescriptionPdf: pdfUrl })
        .where(eq(ReportCardModel.id, reportCardId));

      broadcastPrescriptionPdfReadyToAppointmentRoom({
        appointmentId: appointment.id,
        reportId: reportCardId,
        pdfUrl,
      }).catch((err) => {
        logger.warn('Socket broadcast prescription pdf ready failed', err);
      });

      if (patient?.id) {
        notifyPrescriptionPdfReady(
          patient.id,
          reportCardId,
          pdfUrl,
          appointment.id
        ).catch((err) => {
          logger.warn('notify regenerated pdf ready failed', err);
        });
      }
    } catch (error) {
      logger.error('Failed to regenerate prescription PDF:', error);
    }
  }
}
