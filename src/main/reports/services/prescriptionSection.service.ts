import { HttpError } from '../../../middlewear/errorHandler';
import { isDoctorAssignedToClinic } from '../../../utils/clinicOwnership';

/** One toggle as the settings screen renders it. */
export type PrescriptionSectionDefinition = {
  /** `showXxx` key, matching the Handlebars guard in the templates. */
  key: PrescriptionSectionKey;
  /** Plain-clinic-language label — rendered verbatim in the UI. */
  label: string;
  /** Why a doctor would turn it off; shown as the toggle's hint. */
  description: string;
  /**
   * Locked sections are rendered read-only: a prescription without the
   * patient's name, the medicines or the prescriber is not a prescription.
   */
  locked?: boolean;
};

export type PrescriptionSectionGroup = {
  id: string;
  label: string;
  sections: PrescriptionSectionDefinition[];
};

export type PrescriptionSectionKey =
  | 'showClinicHeader'
  | 'showClinicLogo'
  | 'showClinicTagline'
  | 'showClinicAddress'
  | 'showClinicPhone'
  | 'showPatientName'
  | 'showPatientAge'
  | 'showPatientGender'
  | 'showPatientAddress'
  | 'showVisitDate'
  | 'showToken'
  | 'showChiefComplaints'
  | 'showVitals'
  | 'showAllergies'
  | 'showHabits'
  | 'showDiagnosis'
  | 'showPreDiagnosis'
  | 'showRxSymbol'
  | 'showMedicineTable'
  | 'showMedicineComposition'
  | 'showMedicineStrength'
  | 'showMedicineInstructions'
  | 'showTests'
  | 'showAdvice'
  | 'showDietarySuggestion'
  | 'showSurgerySuggested'
  | 'showClinicalNotes'
  | 'showAdditionalInformation'
  | 'showFollowUp'
  | 'showVisitingDays'
  | 'showDoctorName'
  | 'showDoctorQualification'
  | 'showDoctorSpeciality'
  | 'showDoctorRegistration'
  | 'showDoctorSignature'
  | 'showConsultationHours'
  | 'showQrCode'
  | 'showFooter';

export type PrescriptionSectionConfig = Partial<
  Record<PrescriptionSectionKey, boolean>
>;

/**
 * Grouped catalogue. Order here is the order the settings screen shows, so it
 * follows the prescription top-to-bottom rather than the key names.
 */
export const PRESCRIPTION_SECTION_GROUPS: PrescriptionSectionGroup[] = [
  {
    id: 'header',
    label: 'Clinic header',
    sections: [
      {
        key: 'showClinicHeader',
        label: 'Clinic header band',
        description:
          'The whole header strip. Turn off when printing on pre-printed letterhead.',
      },
      {
        key: 'showClinicLogo',
        label: 'Clinic logo',
        description:
          'Your clinic logo, where the chosen design has room for it.',
      },
      {
        key: 'showClinicTagline',
        label: 'Clinic tagline',
        description: 'The short line under the clinic name.',
      },
      {
        key: 'showClinicAddress',
        label: 'Clinic address',
        description: 'Street, city, state and PIN code.',
      },
      {
        key: 'showClinicPhone',
        label: 'Clinic phone number',
        description: 'The reception number patients should call back on.',
      },
    ],
  },
  {
    id: 'patient',
    label: 'Patient details',
    sections: [
      {
        key: 'showPatientName',
        label: 'Patient name',
        description: 'Always printed — a prescription must name the patient.',
        locked: true,
      },
      {
        key: 'showPatientAge',
        label: 'Age',
        description: 'Needed for dose checking at the pharmacy.',
      },
      {
        key: 'showPatientGender',
        label: 'Gender',
        description: 'Patient gender.',
      },
      {
        key: 'showPatientAddress',
        label: 'Patient address',
        description: 'The address on file. Prints only when one is recorded.',
      },
      {
        key: 'showVisitDate',
        label: 'Visit date',
        description: 'The consultation date.',
      },
      {
        key: 'showToken',
        label: 'Token number',
        description: 'The queue token for this visit, when one was issued.',
      },
    ],
  },
  {
    id: 'clinical',
    label: 'Clinical findings',
    sections: [
      {
        key: 'showChiefComplaints',
        label: 'Chief complaints',
        description: 'The symptoms recorded for this visit (C/O).',
      },
      {
        key: 'showVitals',
        label: 'Vitals',
        description: 'BP, pulse, SpO₂, temperature, weight, height and BMI.',
      },
      {
        key: 'showAllergies',
        label: 'Allergies',
        description:
          'The patient’s recorded allergies. Keep this on unless you print them elsewhere.',
      },
      {
        key: 'showHabits',
        label: 'Habits',
        description: 'Recorded habits such as smoking or alcohol.',
      },
      {
        key: 'showDiagnosis',
        label: 'Diagnosis',
        description: 'Your recorded diagnosis for this visit.',
      },
      {
        key: 'showPreDiagnosis',
        label: 'Pre-Diagnosis',
        description:
          'Preliminary impression recorded before the final diagnosis.',
      },
      {
        key: 'showClinicalNotes',
        label: 'Visit notes',
        description: 'Free-text notes recorded during the consultation.',
      },
    ],
  },
  {
    id: 'medicines',
    label: 'Medicines',
    sections: [
      {
        key: 'showRxSymbol',
        label: 'Rx symbol',
        description: 'The ℞ mark above the medicine list.',
      },
      {
        key: 'showMedicineTable',
        label: 'Medicine list',
        description: 'Always printed — this is the prescription itself.',
        locked: true,
      },
      {
        key: 'showMedicineStrength',
        label: 'Strength',
        description:
          'The strength printed under each medicine name (e.g. 650 mg).',
      },
      {
        key: 'showMedicineComposition',
        label: 'Composition / salt',
        description:
          'The generic composition, which lets a pharmacist substitute correctly.',
      },
      {
        key: 'showMedicineInstructions',
        label: 'Instructions column',
        description: 'The per-medicine instruction text.',
      },
    ],
  },
  {
    id: 'plan',
    label: 'Plan and advice',
    sections: [
      {
        key: 'showTests',
        label: 'Investigations advised',
        description: 'Lab tests ordered at this visit.',
      },
      {
        key: 'showAdvice',
        label: 'Advice',
        description: 'General advice text.',
      },
      {
        key: 'showDietarySuggestion',
        label: 'Dietary suggestion',
        description: 'Diet advice recorded for this visit.',
      },
      {
        key: 'showSurgerySuggested',
        label: 'Surgery suggested',
        description: 'Any surgical procedure you have recommended.',
      },
      {
        key: 'showAdditionalInformation',
        label: 'Additional information',
        description:
          'The extra fields your speciality records, such as the dental chart.',
      },
      {
        key: 'showFollowUp',
        label: 'Next visit date',
        description: 'The follow-up date given to the patient.',
      },
      {
        key: 'showVisitingDays',
        label: 'Visiting days',
        description:
          'The dates you asked the patient to come back on, e.g. for dressings or injections.',
      },
    ],
  },
  {
    id: 'footer',
    label: 'Prescriber and footer',
    sections: [
      {
        key: 'showDoctorName',
        label: 'Doctor name',
        description:
          'Always printed — a prescription must name the prescriber.',
        locked: true,
      },
      {
        key: 'showDoctorQualification',
        label: 'Qualification',
        description: 'Your degrees, as recorded on your profile.',
      },
      {
        key: 'showDoctorSpeciality',
        label: 'Speciality',
        description: 'Your speciality, as recorded on your profile.',
      },
      {
        key: 'showDoctorRegistration',
        label: 'Registration number',
        description:
          'Your medical council registration number. Required in some states.',
      },
      {
        key: 'showDoctorSignature',
        label: 'Signature area',
        description: 'The signature block at the end of the prescription.',
      },
      {
        key: 'showConsultationHours',
        label: 'Consultation hours',
        description: 'Your weekly availability strip.',
      },
      {
        key: 'showQrCode',
        label: 'QR code',
        description:
          'A scannable link that opens this prescription in the app.',
      },
      {
        key: 'showFooter',
        label: 'Footer strip',
        description:
          'Always printed — carries the patient safety notice and Powered by Infinity Medisetu.',
        locked: true,
      },
    ],
  },
];

/**
 * Shipped defaults — what a doctor who has never opened the settings screen
 * gets, and the fallback for any key added after they last saved.
 *
 * Everything clinically recorded prints by default: a doctor noticing a missing
 * detail on a printed prescription is a far worse failure than one noticing an
 * extra line they can switch off. The only exception is the QR code, which
 * carries no clinical information (it links to the app) and is off unless asked
 * for. Sections whose data is empty for a visit still collapse on their own —
 * every one is additionally guarded by its own `{{#if}}` on the value.
 */
export const PRESCRIPTION_SECTION_DEFAULTS: Record<
  PrescriptionSectionKey,
  boolean
> = {
  showClinicHeader: true,
  showClinicLogo: true,
  showClinicTagline: true,
  showClinicAddress: true,
  showClinicPhone: true,
  showPatientName: true,
  showPatientAge: true,
  showPatientGender: true,
  showPatientAddress: true,
  showVisitDate: true,
  showToken: true,
  showChiefComplaints: true,
  showVitals: true,
  showAllergies: true,
  showHabits: true,
  showDiagnosis: true,
  showPreDiagnosis: true,
  showRxSymbol: true,
  showMedicineTable: true,
  showMedicineComposition: true,
  showMedicineStrength: true,
  showMedicineInstructions: true,
  showTests: true,
  showAdvice: true,
  showDietarySuggestion: true,
  showSurgerySuggested: true,
  showClinicalNotes: true,
  showAdditionalInformation: true,
  showFollowUp: true,
  showVisitingDays: true,
  showDoctorName: true,
  showDoctorQualification: true,
  showDoctorSpeciality: true,
  showDoctorRegistration: true,
  showDoctorSignature: true,
  showConsultationHours: true,
  showQrCode: false,
  showFooter: true,
};

/**
 * One-click starting points, so the common cases never require reading 37
 * switches. `hiddenKeys` is applied over `PRESCRIPTION_SECTION_DEFAULTS` —
 * expressed as "what this preset removes" rather than a full flag set, so a
 * section added later joins every preset as visible by default.
 */
export const PRESCRIPTION_SECTION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  hiddenKeys: PrescriptionSectionKey[];
}> = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'Everything you recorded at the visit. A good default.',
    hiddenKeys: [],
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Medicines and the essentials only — fits a short visit.',
    hiddenKeys: [
      'showClinicTagline',
      'showHabits',
      'showVitals',
      'showClinicalNotes',
      'showDietarySuggestion',
      'showSurgerySuggested',
      'showAdditionalInformation',
      'showConsultationHours',
      'showDoctorSpeciality',
    ],
  },
  {
    id: 'letterhead',
    label: 'Pre-printed letterhead',
    description:
      'Drops the clinic header — for printing on your own stationery.',
    hiddenKeys: [
      'showClinicHeader',
      'showClinicLogo',
      'showClinicTagline',
      'showClinicAddress',
      'showClinicPhone',
      'showConsultationHours',
    ],
  },
];

/** Sections a doctor cannot switch off, derived from the catalogue. */
export const LOCKED_PRESCRIPTION_SECTIONS: PrescriptionSectionKey[] =
  PRESCRIPTION_SECTION_GROUPS.flatMap((group) =>
    group.sections.filter((s) => s.locked).map((s) => s.key)
  );

/** Quick Print designer block each switch controls. Blocks carrying a locked section are left out. */
const SECTION_BLOCK_IDS: Partial<Record<PrescriptionSectionKey, string>> = {
  showClinicHeader: 'clinicHeader',
  showVisitDate: 'visitDate',
  showChiefComplaints: 'chiefComplaints',
  showVitals: 'vitals',
  showAllergies: 'allergies',
  showPreDiagnosis: 'preDiagnosis',
  showDiagnosis: 'diagnosis',
  showRxSymbol: 'rxSymbol',
  showTests: 'tests',
  showClinicalNotes: 'clinicalNotes',
  showAdvice: 'advice',
  showFollowUp: 'followUp',
  showHabits: 'habits',
};

export class PrescriptionSectionService {
  static readonly DEFAULTS = PRESCRIPTION_SECTION_DEFAULTS;
  static readonly GROUPS = PRESCRIPTION_SECTION_GROUPS;

  /**
   * Merge a stored config over the shipped defaults.
   *
   * Every key is optional in storage: a row written before a section shipped
   * simply lacks it, and must fall back to the default rather than render as
   * `undefined` (which Handlebars treats as false and would silently drop the
   * section from every prescription).
   *
   * Locked sections are forced on regardless of what was stored, so a bad
   * payload can never produce a prescription with no patient or no medicines.
   */
  static derive(
    rawConfig: PrescriptionSectionConfig | null | undefined
  ): Record<PrescriptionSectionKey, boolean> {
    const stored = rawConfig ?? {};
    const resolved = { ...PRESCRIPTION_SECTION_DEFAULTS };

    for (const key of Object.keys(resolved) as PrescriptionSectionKey[]) {
      const value = stored[key];
      if (typeof value === 'boolean') resolved[key] = value;
    }

    for (const key of LOCKED_PRESCRIPTION_SECTIONS) resolved[key] = true;

    return resolved;
  }

  /** The catalogue plus defaults, as the settings screen consumes it. */
  static getCatalogue() {
    return {
      groups: PRESCRIPTION_SECTION_GROUPS,
      defaults: PRESCRIPTION_SECTION_DEFAULTS,
      lockedKeys: LOCKED_PRESCRIPTION_SECTIONS,
      // Resolved to full flag sets here rather than in the browser, so the
      // settings screen can compare a preset against the doctor's current
      // choices without re-deriving the merge rules.
      presets: PRESCRIPTION_SECTION_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        config: PrescriptionSectionService.derive(
          Object.fromEntries(
            preset.hiddenKeys.map((key) => [key, false])
          ) as PrescriptionSectionConfig
        ),
      })),
    };
  }

  /** Switches a template actually guards on, read from its own `config.elements.showXxx` checks so it can't drift. */
  static templateSectionKeys(templateHtml: string): PrescriptionSectionKey[] {
    const found = new Set(
      [...templateHtml.matchAll(/config\.elements\.(show[A-Za-z]+)/g)].map(
        (match) => match[1]
      )
    );
    return (
      Object.keys(PRESCRIPTION_SECTION_DEFAULTS) as PrescriptionSectionKey[]
    ).filter((key) => found.has(key));
  }

  /** Sections switched off from their default; locked ones can't be. This is all Quick Print honours. */
  static switchedOffKeys(
    config: PrescriptionSectionConfig | null | undefined
  ): PrescriptionSectionKey[] {
    return (
      Object.keys(PRESCRIPTION_SECTION_DEFAULTS) as PrescriptionSectionKey[]
    ).filter(
      (key) =>
        config?.[key] === false &&
        PRESCRIPTION_SECTION_DEFAULTS[key] &&
        !LOCKED_PRESCRIPTION_SECTIONS.includes(key)
    );
  }

  /** Quick Print keeps its own layout and drops only the sections switched off. */
  static applySwitchedOff<T extends Record<string, boolean>>(
    elements: T,
    config: PrescriptionSectionConfig | null | undefined
  ): T {
    const result: Record<string, boolean> = { ...elements };
    for (const key of PrescriptionSectionService.switchedOffKeys(config)) {
      result[key] = false;
    }
    return result as T;
  }

  /** Designer blocks of the sections switched off; they never print, even when the visit filled them in. */
  static hiddenBlockIds(
    config: PrescriptionSectionConfig | null | undefined
  ): string[] {
    return PrescriptionSectionService.switchedOffKeys(config)
      .map((key) => SECTION_BLOCK_IDS[key])
      .filter((blockId): blockId is string => Boolean(blockId));
  }

  /** Your own switches, or a doctor's in your clinic when you're its admin. Anyone else's reads as not found. */
  static async assertCanManage(
    doctorId: string,
    user: { id: string; userType?: string },
    clinicId: string
  ): Promise<void> {
    if (doctorId === user.id) return;
    const isClinicAdmin =
      user.userType === 'Admin' &&
      (await isDoctorAssignedToClinic(doctorId, clinicId));
    if (!isClinicAdmin) throw new HttpError(404, 'Doctor not found');
  }
}
