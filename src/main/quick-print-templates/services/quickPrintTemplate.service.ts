import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { QuickPrintTemplateModel } from '../models/quickPrintTemplate.model';
import type { SaveQuickPrintTemplateDto } from '../schemas/quickPrintTemplate.schemas';
import handlebars from 'handlebars';
import { quickPrintTemplate1 } from '../templates/compact-medicine-slip';
import { quickPrintTemplate2 } from '../templates/standard-medicine-sheet';
import { quickPrintTemplate3 } from '../templates/minimal-prescription';
import { quickPrintTemplate4 } from '../templates/pharmacy-copy';
import { quickPrintTemplate5 } from '../templates/detailed-prescription';
import { quickPrintTemplate6 } from '../templates/clinic-branded';
import '../../../utils/handlebarsHelpers';

// Register custom Handlebars helpers
handlebars.registerHelper('firstLetter', (str: string) => {
  return str ? str.charAt(0).toUpperCase() : 'M';
});

export class QuickPrintTemplateService {
  /**
   * Get the doctor's quick print template configuration.
   */
  static async getSelectedTemplate(doctorId: string) {
    const [result] = await database
      .select()
      .from(QuickPrintTemplateModel)
      .where(eq(QuickPrintTemplateModel.doctorId, doctorId))
      .limit(1);

    return result ?? null;
  }

  /**
   * Save (upsert) the doctor's quick print template configuration.
   */
  static async saveSelectedTemplate(
    doctorId: string,
    data: SaveQuickPrintTemplateDto
  ) {
    const existing = await this.getSelectedTemplate(doctorId);

    const payload: any = {
      selectedTemplate: data.selectedTemplate,
      updatedAt: new Date(),
    };
    if (data.fontFamily) payload.fontFamily = data.fontFamily;
    if (data.accentColor) payload.accentColor = data.accentColor;
    if (data.elementConfig) payload.elementConfig = data.elementConfig;

    if (existing) {
      const [updated] = await database
        .update(QuickPrintTemplateModel)
        .set(payload)
        .where(eq(QuickPrintTemplateModel.doctorId, doctorId))
        .returning();

      return { action: 'updated' as const, template: updated };
    }

    const [inserted] = await database
      .insert(QuickPrintTemplateModel)
      .values({ doctorId, ...payload })
      .returning();

    return { action: 'created' as const, template: inserted };
  }

  /**
   * Visibility flags consumed by the quick-print Handlebars templates
   * (`{{#if config.elements.showXxx}}`).
   */
  static readonly DEFAULT_ELEMENTS = {
    showClinicHeader: true,
    showClinicLogo: true,
    showPatientName: true,
    showPatientUhid: true,
    showPatientAge: true,
    showPatientGender: true,
    showPatientMobile: true,
    showPatientAddress: false,
    showVisitDate: true,
    showChiefComplaints: false,
    showVitals: false,
    showAllergies: false,
    showDiagnosis: true,
    showMedicineTable: true,
    showMedicineComposition: true,
    showMedicineQuantity: false,
    showMedicineInstructions: true,
    showTests: false,
    showClinicalNotes: false,
    showAdvice: true,
    showFollowUp: true,
    showDoctorName: true,
    showDoctorQualification: true,
    showDoctorRegistration: false,
    showDoctorSignature: true,
    showQrCode: false,
    showFooter: true,
  };

  /**
   * Translate a stored `elementConfig` into element visibility flags. The
   * designer saves a `blockLayout` array (drag-and-drop blocks); older configs
   * stored `showXxx` booleans directly. Blocks added after a doctor last saved
   * are absent from their layout, so those fall back to the default flag.
   *
   * Shared by the preview renderer and the real prescription PDF render in
   * `reports` so both stay in sync.
   */
  static deriveElements(
    rawConfig: any
  ): typeof QuickPrintTemplateService.DEFAULT_ELEMENTS {
    const defaults = this.DEFAULT_ELEMENTS;

    if (rawConfig?.blockLayout && Array.isArray(rawConfig.blockLayout)) {
      const blockMap: Record<string, boolean> = {};
      for (const block of rawConfig.blockLayout) {
        if (block?.id && typeof block.visible === 'boolean') {
          blockMap[block.id] = block.visible;
        }
      }

      return {
        ...defaults,
        showClinicHeader: blockMap['clinicHeader'] ?? defaults.showClinicHeader,
        showClinicLogo: blockMap['clinicHeader'] ?? defaults.showClinicLogo,
        showPatientName: blockMap['patientInfo'] ?? defaults.showPatientName,
        showPatientUhid: blockMap['patientInfo'] ?? defaults.showPatientUhid,
        showPatientAge: blockMap['patientInfo'] ?? defaults.showPatientAge,
        showPatientGender:
          blockMap['patientInfo'] ?? defaults.showPatientGender,
        showPatientMobile:
          blockMap['patientInfo'] ?? defaults.showPatientMobile,
        showVisitDate: blockMap['visitDate'] ?? defaults.showVisitDate,
        showChiefComplaints:
          blockMap['chiefComplaints'] ?? defaults.showChiefComplaints,
        showVitals: blockMap['vitals'] ?? defaults.showVitals,
        showAllergies: blockMap['allergies'] ?? defaults.showAllergies,
        showDiagnosis: blockMap['diagnosis'] ?? defaults.showDiagnosis,
        showMedicineTable:
          blockMap['medicineTable'] ?? defaults.showMedicineTable,
        showTests: blockMap['tests'] ?? defaults.showTests,
        showClinicalNotes:
          blockMap['clinicalNotes'] ?? defaults.showClinicalNotes,
        showAdvice: blockMap['advice'] ?? false,
        showFollowUp: blockMap['followUp'] ?? defaults.showFollowUp,
        showDoctorName: blockMap['doctorSignature'] ?? defaults.showDoctorName,
        showDoctorQualification:
          blockMap['doctorSignature'] ?? defaults.showDoctorQualification,
        showDoctorSignature:
          blockMap['doctorSignature'] ?? defaults.showDoctorSignature,
        // The footer carries the safety notice, so no layout can hide it.
        showFooter: true,
      };
    }

    if (rawConfig?.showPatientName !== undefined) {
      return { ...defaults, ...rawConfig, showFooter: true };
    }

    return defaults;
  }

  /**
   * Get the raw Handlebars HTML for a given template ID.
   */
  static getTemplateHtml(templateId: string): string {
    switch (templateId) {
      case 'compact-medicine-slip':
        return quickPrintTemplate1;
      case 'standard-medicine-sheet':
        return quickPrintTemplate2;
      case 'minimal-prescription':
        return quickPrintTemplate3;
      case 'pharmacy-copy':
        return quickPrintTemplate4;
      case 'detailed-prescription':
        return quickPrintTemplate5;
      case 'clinic-branded':
        return quickPrintTemplate6;
      default:
        return quickPrintTemplate1;
    }
  }

  /**
   * Render a quick print template preview with sample data + doctor's real
   * clinic/doctor info. Uses the same Handlebars approach as the main
   * prescription templates.
   */
  static renderPreview(
    templateId: string,
    config: {
      fontFamily?: string;
      accentColor?: string;
      elementConfig?: any;
    },
    context?: { clinic?: any; doctor?: any }
  ): string {
    const templateHtml = this.getTemplateHtml(templateId);

    const elements = this.deriveElements(config.elementConfig || {});

    const sampleData = {
      config: {
        fontFamily: config.fontFamily || 'Inter, sans-serif',
        primaryFont: (config.fontFamily || 'Inter').split(',')[0].trim(),
        accentColor: config.accentColor || '#333333',
        elements,
      },
      clinic: context?.clinic || {
        name: 'Medisetu Clinic',
        address: '123 Health Street, Medical Complex',
        phone: '+91 98765 43210',
        logo: '',
      },
      doctor: context?.doctor || {
        name: 'Dr. Meetesh Agrawal',
        qualification: 'MD (SKIN & VD)',
        registrationNumber: 'MP-12345',
        speciality: 'Dermatology',
      },
      patient: {
        name: 'Mrs. Triveni Panda',
        uhid: 'A7060',
        age: '75',
        gender: 'Female',
        mobile: '9691958656',
        address: '456 Patient Road, City',
      },
      visitDate: '04-Jul-2026',
      symptoms: [
        { name: 'Itching over both arms' },
        { name: 'Dry scaly patches (3 weeks)' },
      ],
      vitals: {
        bpSys: 128,
        bpDia: 82,
        fbs: 95,
        ppbs: 140,
        rbs: 110,
        pulse: 78,
        spo2: 98,
        temperatureC: 36.9,
        heightCm: 163,
        weightKg: 64,
        bmi: 24.1,
      },
      vitalsMoreThanOne: true,
      allergies: 'Sulfa drugs, Dust',
      diagnosis: '?PSORIASIS, ?ECZEMA',
      hasTests: true,
      testNames: 'CBC, LFT, Skin Biopsy, Vitamin D3',
      dietarySuggestion:
        'Lesions improving since last visit. Continue topical therapy.',
      prescriptions: [
        {
          medicineName: 'TAB. DEFCORT 12MG',
          composition: 'DEFLAZACORT 12 MG',
          dosage: '1 — 0 — 0',
          frequency: 'After Breakfast',
          duration: '10 Days',
          quantity: '10',
          notes: 'Take after meals',
        },
        {
          medicineName: 'CRM. MAXFEEL CREAM 200 GMS',
          composition: '',
          dosage: 'Apply locally',
          frequency: '3-4 Times/Day',
          duration: '15 Days',
          quantity: '1',
          notes: 'Apply on affected area',
        },
      ],
      advice: 'Avoid direct sunlight. Keep skin moisturized.',
      followUpDate: '19-Jul-2026',
    };

    const compiled = handlebars.compile(templateHtml);
    return compiled(sampleData);
  }
}
