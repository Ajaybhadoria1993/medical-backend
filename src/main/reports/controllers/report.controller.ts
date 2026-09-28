import { Request, Response } from 'express';
import handlebars from 'handlebars';
import { asyncHandler, HttpError } from '../../../middlewear/errorHandler';
import {
  DEFAULT_TEMPLATE6_COLORS,
  ReportService,
} from '../services/report.service';
import {
  prescriptionLanguageSchema,
  prescriptionSectionConfigSchema,
  PrescriptionSectionsBodyDto,
  PrescriptionSectionsParamsDto,
  PrescriptionPdfParamsDto,
  PrescriptionPdfQueryDto,
  prescriptionTemplateSchema,
  TranslationIdParamsDto,
  TranslationListQueryDto,
  TranslationSettingsBodyDto,
  TranslationUpdateBodyDto,
} from '../schemas/report.schemas';
import { PrescriptionTranslationService } from '../services/prescriptionTranslation.service';
import { reportCardTemplate1 } from '../../../htmltamplates/report_card1';
import { reportCardTemplate4 } from '../../../htmltamplates/report_card4';
import { reportCardTemplate3 } from '../../../htmltamplates/report_card3';
import { reportCardTemplate2 } from '../../../htmltamplates/report_card2';
import { reportCardTemplate5 } from '../../../htmltamplates/report_card5';
import { reportCardTemplate6 } from '../../../htmltamplates/report_card6';
import { buildFontUrl, getPrimaryFont } from '../../../utils/fontConfig.utils';
import {
  buildAppDownloadUrl,
  buildAppQrDataUrl,
} from '../../../utils/qr.utils';
import '../../../utils/handlebarsHelpers';
import { sendOk } from '../../../utils/response.utils';
import {
  PrescriptionSectionConfig,
  PrescriptionSectionService,
} from '../services/prescriptionSection.service';
import { layoutSectionKeys } from '../../quick-print-templates/templates/layoutRenderer';

export const createReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.validatedBody;

    const result = await ReportService.craeteReport(payload);
    res.status(201).json({ success: true, result });
  }
);

export const updateReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      params: { reportId: rawReportId },
      user: { id: userId },
      validatedBody: payload,
    } = req;
    const reportId = rawReportId as string;
    const result = await ReportService.updateRport(userId, reportId, payload);
    res.status(201).json({ success: true, result });
  }
);

export const getAllClinicReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.validatedParams.petientId;
    const clinicId = req.clinicId;
    const result = await ReportService.getALlReport(userId, clinicId);
    res.status(201).json({ success: true, result });
  }
);
export const getReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const reportId = req.validatedParams.reportId;
    const clinicId = req.clinicId;
    const result = await ReportService.getReport(reportId, clinicId);
    res.status(201).json({ success: true, result });
  }
);
export const createPatientReportCardController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedBody } = req;
    const adminId = req.user?.id;
    const result = await ReportService.createPatientReportCard(
      validatedBody,
      adminId
    );
    if (!result) {
      return res
        .status(400)
        .json({ success: false, message: 'Failed to create report card' });
    }
    res
      .status(201)
      .json({ success: true, message: 'Report card created', result });
  }
);

export const getCurrentTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user.id;

    const templateInfo = await ReportService.getCurrentTemplateInfo(doctorId);

    res.status(200).json({
      success: true,
      data: templateInfo,
    });
  }
);

export const getFavouritePrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.params.doctorId as string;
    const clinicId = req.clinicId;
    const result = await ReportService.getFavouritePrescription(
      doctorId,
      clinicId
    );

    res.status(200).json({
      success: true,
      message: 'Favourite prescriptions retrieved successfully',
      data: result,
    });
  }
);

export const deleteFavouritePrescriptionController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams;
    const doctorId = req.user?.id;

    if (!doctorId) {
      throw new HttpError(401, 'Unauthorized - Doctor ID not found');
    }

    const result = await ReportService.deleteFavouritePrescription(
      id,
      doctorId
    );

    res.status(200).json({
      success: true,
      message: 'Favourite prescription deleted successfully',
      data: result,
    });
  }
);

export const updatePatientReportCardController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedBody, validatedQuery } = req;
    const result = await ReportService.updatePatientReportCard(
      validatedQuery,
      validatedBody
    );
    if (!result) {
      return res
        .status(400)
        .json({ success: false, message: 'Failed to update report card' });
    }
    res
      .status(201)
      .json({ success: true, message: 'Report card updated', result });
  }
);

export const upsertPrescriptionTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user?.id;
    const validatedBody = prescriptionTemplateSchema.parse(req.body);

    const result = await ReportService.upsertTemplate(doctorId!, validatedBody);

    res.status(200).json({
      success: true,
      message: 'Prescription template saved successfully',
      data: result,
    });
  }
);

export const getPrescriptionTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = req.user?.id;

    const template = await ReportService.getTemplate(doctorId!);

    res.status(200).json({
      success: true,
      data: template || {
        // template6 is "Clinical Card", the layout the picker leads with —
        // keep this in step with the first entry of the frontend template list.
        message: 'No custom template found, using default template6',
        defaultTemplate: 'template6',
        defaultColors: DEFAULT_TEMPLATE6_COLORS,
        defaultFontFamily: 'Inter, sans-serif',
      },
    });
  }
);

/**
 * The section catalogue the settings screen renders its toggles from. Served
 * by the backend so a section added here appears in the UI without a frontend
 * release, and so labels can never drift from the keys the templates guard on.
 */
export const getPrescriptionTemplateSectionsController = asyncHandler(
  async (_req: Request, res: Response) => {
    sendOk(
      res,
      'Prescription sections fetched successfully',
      PrescriptionSectionService.getCatalogue()
    );
  }
);

/** A doctor's saved "what prints" switches, for the workspace Preview. */
export const getPrescriptionSectionsConfigController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams as PrescriptionSectionsParamsDto;
    await PrescriptionSectionService.assertCanManage(
      doctorId,
      req.user,
      req.clinicId as string
    );
    const result = await ReportService.getSectionConfig(doctorId);
    sendOk(res, 'Prescription sections fetched successfully', result);
  }
);

/** Saves only the doctor's "what prints" switches — the workspace Preview's shortcut to the settings. */
export const savePrescriptionSectionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { doctorId } = req.validatedParams as PrescriptionSectionsParamsDto;
    const { sectionConfig } = req.validatedBody as PrescriptionSectionsBodyDto;
    await PrescriptionSectionService.assertCanManage(
      doctorId,
      req.user,
      req.clinicId as string
    );
    const result = await ReportService.saveSectionConfig(
      doctorId,
      sectionConfig
    );
    sendOk(res, 'Prescription sections saved successfully', result);
  }
);

export const getPreviewPrescriptionTemplateController = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      templateName,
      colors,
      fontFamily,
      appointmentId,
      prescriptions: userPrescriptions,
      patient: userPatient,
      diagnosis: userDiagnosis,
      advice: userAdvice,
      preDiagnosis: userPreDiagnosis,
      followUpDate: userFollowUp,
      vitals: userVitals,
      additionalInformation: userAdditionalInformation,
      previewDetail,
    } = req.body;

    const language = prescriptionLanguageSchema
      .optional()
      .safeParse(req.body?.language);
    if (!language.success) {
      throw new HttpError(400, 'Unsupported prescription language');
    }

    // Resolve the template against the appointment's own doctor when available,
    // so the preview matches the final PDF even for admin-managed appointments.
    // Falls back to the logged-in user otherwise.
    const appointmentInfo = appointmentId
      ? await ReportService.getAppointmentPreviewInfo(String(appointmentId))
      : null;
    const doctorId = appointmentInfo?.doctorId || req.user?.id;

    // Live clinic + doctor data for the resolved doctor (patient/records stay dummy)
    const previewContext = doctorId
      ? await ReportService.getDoctorPreviewContext(doctorId)
      : null;

    let templateHtml = '';
    // templateConfig used by named/prescription templates
    let resolvedTemplateConfig: {
      fontFamily: string;
      primaryFont: string;
      fontUrl: string;
      colors: any;
    } = {
      fontFamily: fontFamily || 'Inter, sans-serif',
      primaryFont: getPrimaryFont(fontFamily),
      fontUrl: buildFontUrl(fontFamily),
      colors,
    };
    let isQuickPrint = false;
    let elementConfig: any = null;
    // Switches the doctor is changing right now, from the settings page or the workspace Preview.
    const postedSections = prescriptionSectionConfigSchema
      .nullish()
      .safeParse(req.body?.sectionConfig);
    if (!postedSections.success) {
      throw new HttpError(400, 'Invalid prescription section settings');
    }
    let sectionConfig: PrescriptionSectionConfig | null =
      postedSections.data ?? null;

    if (templateName) {
      // Settings page: preview a SPECIFIC template being designed.
      switch (templateName) {
        case 'template1':
          templateHtml = reportCardTemplate1;
          break;
        case 'template2':
          templateHtml = reportCardTemplate2;
          break;
        case 'template3':
          templateHtml = reportCardTemplate3;
          break;
        case 'template4':
          templateHtml = reportCardTemplate4;
          break;
        case 'template5':
          templateHtml = reportCardTemplate5;
          break;
        case 'template6':
          templateHtml = reportCardTemplate6;
          break;
        default:
          templateHtml = reportCardTemplate6;
      }

      // Designing a template but not editing the toggles (e.g. picking a
      // colour): show it with the doctor's saved sections, not the defaults.
      if (!sectionConfig && doctorId) {
        const saved = await ReportService.getTemplate(doctorId);
        sectionConfig = saved?.sectionConfig ?? null;
      }
    } else if (doctorId) {
      // Live workspace preview: use the doctor's ACTUAL selected template
      // (prescription / quick-print / html) — same logic as final PDF.
      // Mirrors `filledBlockIds` in the PDF path: a block the doctor switched
      // off still previews when this visit filled it in.
      const previewVitals =
        userVitals && typeof userVitals === 'object'
          ? (userVitals as Record<string, unknown>)
          : {};
      const previewHasVitals = [
        previewVitals.bpSys && previewVitals.bpDia,
        previewVitals.fbs,
        previewVitals.ppbs,
        previewVitals.rbs,
        previewVitals.pulse,
        previewVitals.spo2,
        previewVitals.temperatureC,
        previewVitals.heightCm,
        previewVitals.weightKg,
        previewVitals.bmi,
      ].some(Boolean);

      const previewFilledBlockIds = [
        previewHasVitals && 'vitals',
        userDiagnosis && 'diagnosis',
        userPreDiagnosis && 'preDiagnosis',
        userAdvice && 'advice',
        userFollowUp && 'followUp',
      ].filter((id): id is string => Boolean(id));

      const resolved = await ReportService.getResolvedTemplateForPreview(
        doctorId,
        // Same row metrics the PDF measures, so the table reflows identically.
        (Array.isArray(userPrescriptions) ? userPrescriptions : []).map(
          (p: any) => ({
            hasComposition: Boolean(p?.composition),
          })
        ),
        previewFilledBlockIds,
        sectionConfig
      );
      templateHtml = resolved.templateHtml;
      resolvedTemplateConfig = resolved.templateConfig;
      isQuickPrint = resolved.isQuickPrint;
      elementConfig = resolved.elementConfig;
      sectionConfig = resolved.sectionConfig;
    } else {
      templateHtml = reportCardTemplate6;
    }

    // Sample data for preview. The QR is the same app link the PDF carries, so
    // the preview shows the real, scannable code rather than a stand-in.
    const sampleData = {
      qrCode: await buildAppQrDataUrl(),
      appDownloadUrl: buildAppDownloadUrl(),
      clinic: {
        name: 'My Clinic',
        address: '12-B, Medical Street, Vijay Nagar',
        city: 'Indore',
        state: 'Madhya Pradesh',
        zipcode: '452010',
        phone: '9876543210',
        logo: 'https://res.cloudinary.com/ddzkedas8/image/upload/v1773045466/image_rx09np.png',
        tagline: 'Your Health, Our Priority',
      },
      doctor: {
        name: 'Udit Chouhan',
        email: 'udit.chouhan@ims.com',
        qualification: 'MBBS, MD',
        speciality: 'General Physician',
        registrationNumber: 'DVGCS456123612',
        availability: [
          {
            day: 'Mon',
            isAvailable: true,
            startTime: '09:00 AM',
            endTime: '05:00 PM',
          },
          {
            day: 'Tue',
            isAvailable: true,
            startTime: '09:00 AM',
            endTime: '05:00 PM',
          },
          {
            day: 'Wed',
            isAvailable: true,
            startTime: '09:00 AM',
            endTime: '05:00 PM',
          },
          {
            day: 'Thu',
            isAvailable: true,
            startTime: '09:00 AM',
            endTime: '05:00 PM',
          },
          {
            day: 'Fri',
            isAvailable: true,
            startTime: '09:00 AM',
            endTime: '05:00 PM',
          },
          { day: 'Sat', isAvailable: false, startTime: '', endTime: '' },
          { day: 'Sun', isAvailable: false, startTime: '', endTime: '' },
        ],
        groupedAvailability: [
          {
            days: 'Mon - Fri',
            isAvailable: true,
            display: '09:00 AM - 05:00 PM',
          },
          { days: 'Sat - Sun', isAvailable: false, display: 'Off' },
        ],
      },
      patient: {
        name: 'Amrendra Kumar',
        age: '35',
        gender: 'Male',
        address: '789 Health City, Palasia, Indore',
      },
      appointmentDate: '15-Mar-2024',
      appointmentTime: '10:30 AM',
      token: '20',
      // A sample in the settings preview; the live preview shows the visit's own number.
      registrationNo: templateName
        ? '00125'
        : (appointmentInfo?.registrationNo ?? ''),
      symptoms: [{ name: 'Headache' }, { name: 'Fever' }, { name: 'Cough' }],
      hasTests: 2,
      testNames: 'CBC, Vitamin B12',
      diagnosis: 'Viral Fever, Respiratory Tract Infection',
      habits: ['Smoking', 'Tobacco'],
      allergies: ['Dust', 'Syrup'],
      visitingDays: ['10-Mar-2026', '16-Mar-2026'],
      visitingNotes: 'To checkup of health condition',
      surgerySuggested: ['Mole Removal', 'Suturing Wounds'],
      vitalsMoreThanOne: true,
      vitals: {
        bpSys: 120,
        bpDia: 80,
        fbs: 95,
        ppbs: 140,
        rbs: 110,
        pulse: 72,
        spo2: 98,
        temperatureC: 98.6,
        weightKg: 70,
        heightCm: 170,
        bmi: 24.2,
      },
      prescriptions: [
        {
          medicineName: 'Paracip 500',
          form: 'Tablet',
          composition: 'Paracetamol',
          strength: '500 mg',
          dosage: '2 tablet',
          frequency: '1-0-1',
          duration: '5 days',
          notes: 'After Food',
        },
        {
          medicineName: 'Asthakind',
          form: 'Syrup',
          composition: 'Chlorpheniramine + Codeine',
          strength: 'Syrup',
          dosage: '1 spoon',
          frequency: '1-0-1',
          duration: '3 days',
          notes: 'Shake well before use',
        },
      ],
      advice:
        'Take adequate rest. Drink plenty of warm water. Avoid cold food items. Follow up in 3 days if symptoms persist.',
      preDiagnosis: 'Suspected viral fever, pending confirmation.',
      dietarySuggestion: 'Please drink orange juice twice a day.',
      followUpDate: '18-Mar-2024',
      additionalInformation: {
        'Tooth-1': 'Cavity',
        'Tooth-2': 'Cleaning required',
      },
    };

    // Replace dummy clinic/doctor with the doctor's real, current data when found.
    // Patient data and prescription records intentionally remain dummy.
    if (previewContext?.clinic) {
      sampleData.clinic = {
        ...sampleData.clinic,
        ...previewContext.clinic,
        // keep a placeholder logo if the clinic has none, so preview isn't blank
        logo: previewContext.clinic.logo || sampleData.clinic.logo,
      };
    }
    if (previewContext?.doctor) {
      sampleData.doctor = {
        ...sampleData.doctor,
        ...previewContext.doctor,
        availability: previewContext.doctor.availability?.length
          ? previewContext.doctor.availability
          : sampleData.doctor.availability,
        groupedAvailability: previewContext.doctor.groupedAvailability?.length
          ? previewContext.doctor.groupedAvailability
          : sampleData.doctor.groupedAvailability,
      };
    }

    // Render with Handlebars (identical to real PDF generation) so the
    // preview matches the generated prescription exactly. Handlebars handles
    // all #if / #each / #unless blocks, so no manual tag stripping is needed.

    // LIVE MODE: a real prescription is being written (appointment context or
    // live data passed). Prescriptions are sensitive — NEVER show dummy patient,
    // diagnosis, medicines, vitals, advice, symptoms, etc. Only show what the
    // doctor has actually entered; everything else stays blank.
    const isLivePreview = !templateName;

    if (isLivePreview) {
      const todayStr = new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      const cleanVitals =
        userVitals && typeof userVitals === 'object' ? userVitals : {};
      const cleanVitalsCount = [
        (cleanVitals as any).bpSys && (cleanVitals as any).bpDia,
        (cleanVitals as any).fbs,
        (cleanVitals as any).ppbs,
        (cleanVitals as any).rbs,
        (cleanVitals as any).pulse,
        (cleanVitals as any).spo2,
        (cleanVitals as any).temperatureC,
        (cleanVitals as any).heightCm,
        (cleanVitals as any).weightKg,
        (cleanVitals as any).bmi,
      ].filter(Boolean).length;

      sampleData.patient = {
        name: userPatient?.name || '',
        age: userPatient?.age || '',
        gender: userPatient?.gender || '',
        address: userPatient?.address || '',
        ...(userPatient?.mobile ? { mobile: userPatient.mobile } : {}),
      } as any;

      (sampleData as any).prescriptions =
        Array.isArray(userPrescriptions) && userPrescriptions.length > 0
          ? userPrescriptions
          : [];
      (sampleData as any).diagnosis = userDiagnosis || '';
      (sampleData as any).provisionalDiagnosis = userDiagnosis || '';
      (sampleData as any).advice = userAdvice || '';
      (sampleData as any).preDiagnosis = userPreDiagnosis || '';
      (sampleData as any).dietarySuggestion = '';
      (sampleData as any).followUpDate = userFollowUp || '';
      (sampleData as any).additionalInformation =
        userAdditionalInformation &&
        typeof userAdditionalInformation === 'object'
          ? userAdditionalInformation
          : {};
      (sampleData as any).vitals = cleanVitals;
      (sampleData as any).vitalsMoreThanOne = cleanVitalsCount > 0;
      (sampleData as any).symptoms = [];
      (sampleData as any).habits = [];
      (sampleData as any).allergies = [];
      (sampleData as any).surgerySuggested = [];
      (sampleData as any).visitingDays = [];
      (sampleData as any).visitingNotes = '';
      (sampleData as any).hasTests = false;
      (sampleData as any).testNames = '';
      (sampleData as any).appointmentDate = todayStr;
      (sampleData as any).appointmentTime = '';
      (sampleData as any).token = '';
    }

    /**
     * The template picker previews a *typical* visit, not a maximal one.
     *
     * The full sample fills every optional section so each layout can be
     * compared fairly, but that overstates what a doctor usually prints and
     * runs past one A4 page. Sections cleared here are the ones most visits
     * leave empty; the templates already hide an empty section, so this shows
     * the same page a real prescription of this shape would produce.
     *
     * Opt-in: only a caller asking for 'standard' gets the trim, so the
     * existing full preview stays the default for every other caller.
     */
    if (!isLivePreview && previewDetail === 'standard') {
      (sampleData as any).habits = [];
      (sampleData as any).surgerySuggested = [];
      (sampleData as any).additionalInformation = {};
      (sampleData as any).dietarySuggestion = '';
      (sampleData as any).visitingDays = [];
      (sampleData as any).visitingNotes = '';
      (sampleData as any).preDiagnosis = '';
    }

    // Build quick-print element visibility config (for {{config.elements.showXxx}})
    const defaultElements = {
      showClinicHeader: true,
      showClinicLogo: true,
      showPatientName: true,
      showPatientUhid: true,
      showPatientAge: true,
      showPatientGender: true,
      showPatientMobile: true,
      showPatientAddress: false,
      showVisitDate: true,
      // Clinical sections the templates gate on; absent, they never printed.
      showChiefComplaints: true,
      showVitals: true,
      showAllergies: true,
      showDiagnosis: true,
      showMedicineTable: true,
      showMedicineComposition: true,
      showMedicineQuantity: false,
      showMedicineInstructions: true,
      showTests: true,
      showClinicalNotes: true,
      showAdvice: true,
      showPreDiagnosis: true,
      showFollowUp: true,
      showDoctorName: true,
      showDoctorQualification: true,
      showDoctorRegistration: false,
      showDoctorSignature: true,
      showQrCode: false,
      showFooter: true,
    };

    let elements: Record<string, boolean> = defaultElements;
    if (isQuickPrint && elementConfig) {
      if (Array.isArray(elementConfig.blockLayout)) {
        const blockMap: Record<string, boolean> = {};
        for (const block of elementConfig.blockLayout) {
          if (block.id && typeof block.visible === 'boolean') {
            blockMap[block.id] = block.visible;
          }
        }
        // Spread first: a key missing from this literal reads as `undefined`
        // and silently drops its section. Mirrors QuickPrintTemplateService.
        elements = {
          ...defaultElements,
          showClinicHeader: blockMap['clinicHeader'] ?? true,
          showClinicLogo: blockMap['clinicHeader'] ?? true,
          showPatientName: blockMap['patientInfo'] ?? true,
          showPatientUhid: blockMap['patientInfo'] ?? true,
          showPatientAge: blockMap['patientInfo'] ?? true,
          showPatientGender: blockMap['patientInfo'] ?? true,
          showPatientMobile: blockMap['patientInfo'] ?? true,
          showPatientAddress: false,
          showVisitDate: blockMap['visitDate'] ?? true,
          showChiefComplaints: blockMap['chiefComplaints'] ?? true,
          showVitals: blockMap['vitals'] ?? true,
          showAllergies: blockMap['allergies'] ?? true,
          showDiagnosis: blockMap['diagnosis'] ?? true,
          showMedicineTable: blockMap['medicineTable'] ?? true,
          showMedicineComposition: true,
          showMedicineQuantity: false,
          showMedicineInstructions: true,
          showTests: blockMap['tests'] ?? true,
          showClinicalNotes: blockMap['clinicalNotes'] ?? true,
          showPreDiagnosis: blockMap['preDiagnosis'] ?? true,
          showAdvice: blockMap['advice'] ?? false,
          showFollowUp: blockMap['followUp'] ?? true,
          showDoctorName: blockMap['doctorSignature'] ?? true,
          showDoctorQualification: blockMap['doctorSignature'] ?? true,
          showDoctorRegistration: false,
          showDoctorSignature: blockMap['doctorSignature'] ?? true,
          showQrCode: false,
          showFooter: true,
        };
      } else if (elementConfig.showPatientName !== undefined) {
        elements = { ...defaultElements, ...elementConfig, showFooter: true };
      }
      // Quick Print keeps its own layout; only the doctor's switched-off sections apply.
      elements = PrescriptionSectionService.applySwitchedOff(
        elements,
        sectionConfig
      );
    } else {
      // Named prescription template: the doctor's own section toggles decide
      // what prints. Layered over the quick-print defaults so keys only that
      // family uses (UHID, mobile, quantity) keep their existing behaviour.
      elements = {
        ...defaultElements,
        ...PrescriptionSectionService.derive(sectionConfig),
      };
    }

    const previewData = {
      templateConfig: resolvedTemplateConfig,
      config: {
        fontFamily: resolvedTemplateConfig.fontFamily,
        primaryFont: resolvedTemplateConfig.primaryFont,
        accentColor: '#333333',
        elements,
      },
      watermarkLogo: sampleData.clinic.logo,
      ...sampleData,
      // Aliases / extra fields quick-print templates rely on
      visitDate: (sampleData as any).appointmentDate,
      patient: isLivePreview
        ? {
            // Live prescription: only real, entered patient data — no dummies
            ...sampleData.patient,
            uhid: (sampleData as any).patient?.uhid || '',
            mobile: (sampleData as any).patient?.mobile || '',
          }
        : {
            // Design/settings preview: dummy sample is fine
            ...sampleData.patient,
            uhid: (sampleData as any).patient?.uhid || 'A7060',
            mobile: (sampleData as any).patient?.mobile || '9876543210',
          },
    };

    // requireClinicForLanguage sets req.clinicId for a language; requireAuth guarantees a doctor.
    const i18n =
      language.data && language.data !== 'en'
        ? await PrescriptionTranslationService.buildI18n(
            templateHtml,
            previewData,
            language.data,
            { clinicId: req.clinicId as string, doctorId: doctorId as string },
            (
              await PrescriptionTranslationService.doctorSettings(
                doctorId as string
              )
            ).style
          )
        : undefined;
    const finalHtml = handlebars.compile(templateHtml)({
      ...previewData,
      i18n,
    });

    // The switches this template can act on, so the Preview hides the ones it would ignore.
    const printableSections = [
      ...new Set([
        ...PrescriptionSectionService.templateSectionKeys(templateHtml),
        ...(isQuickPrint ? layoutSectionKeys(elementConfig?.blockLayout) : []),
      ]),
    ];

    res.json({ success: true, html: finalHtml, printableSections });
  }
);

/** A saved prescription as a PDF in any language, rendered on demand and never stored. */
export const getPrescriptionPdfController = asyncHandler(
  async (req: Request, res: Response) => {
    const { reportId } = req.validatedParams as PrescriptionPdfParamsDto;
    const { lang } = req.validatedQuery as PrescriptionPdfQueryDto;
    const pdf = await ReportService.renderPrescriptionPdf(
      reportId,
      req.clinicId as string,
      lang
    );

    // A binary body, so the JSON envelope helpers don't apply.
    res.type('application/pdf').send(pdf);
  }
);

/** The signed-in doctor's translation memory for one language, for the Translations tab. */
export const getTranslationsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { lang, status, pageNumber, pageSize } =
      req.validatedQuery as TranslationListQueryDto;
    const result = await PrescriptionTranslationService.listForDoctor(
      { clinicId: req.clinicId as string, doctorId: req.user.id },
      lang,
      status,
      pageNumber,
      pageSize
    );
    return sendOk(res, 'Translations fetched successfully', result);
  }
);

/** A doctor's correction to one of their own phrases; it always wins over a machine translation. */
export const updateTranslationController = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.validatedParams as TranslationIdParamsDto;
    const { translatedText } = req.validatedBody as TranslationUpdateBodyDto;
    const result = await PrescriptionTranslationService.saveManual(
      { clinicId: req.clinicId as string, doctorId: req.user.id },
      id,
      translatedText
    );
    return sendOk(res, 'Translation saved', result);
  }
);

/** The signed-in doctor's print language and style, shown at the top of the Translations tab. */
export const getTranslationSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await PrescriptionTranslationService.getDoctorSettings(
      req.user.id
    );
    return sendOk(res, 'Translation settings fetched successfully', result);
  }
);

export const updateTranslationSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { language, printStyle } =
      req.validatedBody as TranslationSettingsBodyDto;
    const result = await PrescriptionTranslationService.saveDoctorSettings(
      req.user.id,
      language,
      printStyle
    );
    return sendOk(res, 'Translation settings saved', result);
  }
);

/** The languages a prescription can print in right now, for every language picker. */
export const getTranslationLanguagesController = asyncHandler(
  async (_req: Request, res: Response) => {
    return sendOk(
      res,
      'Prescription languages fetched successfully',
      PrescriptionTranslationService.availableLanguages()
    );
  }
);

export const getAppoinmentsPrescriptionsReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedParams, validatedQuery, clinicId } = req;
    const result = await ReportService.getAppoinmentsPrescriptionsReport(
      validatedParams,
      validatedQuery,
      clinicId
    );
    if (!result) {
      return res
        .status(400)
        .json({ success: false, message: 'Failed to get report card' });
    }
    res
      .status(201)
      .json({ success: true, message: 'Report card retrieved', result });
  }
);
export const getReportCardController = asyncHandler(
  async (req: Request, res: Response) => {
    const { validatedQuery, clinicId } = req;
    const result = await ReportService.getReportCard(validatedQuery, clinicId);
    res
      .status(201)
      .json({ success: true, message: 'Report card retrieved', result });
  }
);
