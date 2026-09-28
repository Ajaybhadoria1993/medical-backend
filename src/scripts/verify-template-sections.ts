/**
 * Verifies the per-doctor section toggles across all six named prescription
 * templates (`htmltamplates/report_card1..6.ts`).
 *
 * Run: `npx tsx src/scripts/verify-template-sections.ts`
 *
 * Checks, per template:
 *  - it compiles with every section on and with every section off (an
 *    unbalanced `{{#if}}` fails here rather than at PDF-generation time);
 *  - locked sections (patient name, medicines, prescriber) still print even
 *    when the config asks for everything to be hidden;
 *  - each toggle actually removes its content — a section wired to the wrong
 *    flag, or not wired at all, shows up as a marker still present when off.
 */
import handlebars from 'handlebars';
import { reportCardTemplate1 } from '../htmltamplates/report_card1';
import { reportCardTemplate2 } from '../htmltamplates/report_card2';
import { reportCardTemplate3 } from '../htmltamplates/report_card3';
import { reportCardTemplate4 } from '../htmltamplates/report_card4';
import { reportCardTemplate5 } from '../htmltamplates/report_card5';
import { reportCardTemplate6 } from '../htmltamplates/report_card6';
import {
  PrescriptionSectionKey,
  PrescriptionSectionService,
} from '../main/reports/services/prescriptionSection.service';
import '../utils/handlebarsHelpers';

const TEMPLATES: Array<[string, string]> = [
  ['template1', reportCardTemplate1],
  ['template2', reportCardTemplate2],
  ['template3', reportCardTemplate3],
  ['template4', reportCardTemplate4],
  ['template5', reportCardTemplate5],
  ['template6', reportCardTemplate6],
];

/** Distinctive values, so a marker found in the output can only come from its own field. */
const buildData = (elements: Record<string, boolean>) => ({
  config: { elements },
  templateConfig: {
    fontFamily: 'Inter, sans-serif',
    primaryFont: 'Inter',
    fontUrl: '',
    colors: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`color${i + 1}`, '#123456'])
    ),
  },
  clinic: {
    name: 'CLINICNAME',
    tagline: 'CLINICTAGLINE',
    address: 'CLINICADDRESS',
    city: 'CITYVAL',
    state: 'STATEVAL',
    zipcode: '452010',
    phone: 'CLINICPHONE',
    logo: 'https://example.test/logo.png',
  },
  doctor: {
    name: 'DOCTORNAME',
    speciality: 'DOCSPECIALITY',
    qualification: 'DOCQUALIFICATION',
    registrationNumber: 'DOCREGNUMBER',
    email: 'doctor@example.test',
    availability: [{ day: 'Mon', isAvailable: true, display: 'AVAILDISPLAY' }],
    groupedAvailability: [
      { days: 'Mon', isAvailable: true, display: 'AVAILDISPLAY' },
    ],
  },
  patient: {
    name: 'PATIENTNAME',
    age: 30,
    gender: 'GENDERVAL',
    address: 'PATIENTADDRESS',
    uhid: 'UHIDVAL',
    mobile: 'MOBILEVAL',
  },
  appointmentDate: 'VISITDATEVAL',
  appointmentTime: '10:00 AM',
  visitDate: 'VISITDATEVAL',
  token: 'TOKENVAL',
  followUpDate: 'FOLLOWUPDATE',
  visitingNotes: 'VISITNOTESVAL',
  diagnosis: 'DIAGNOSISVAL',
  provisionalDiagnosis: 'DIAGNOSISVAL',
  hasTests: true,
  testNames: 'TESTNAMESVAL',
  advice: 'ADVICEVAL',
  dietarySuggestion: 'DIETARYVAL',
  surgerySuggested: ['SURGERYVAL'],
  symptoms: [{ name: 'SYMPTOMVAL' }],
  habits: ['HABITVAL'],
  allergies: ['ALLERGYVAL'],
  visitingDays: ['VISITDAYVAL'],
  vitals: {
    bpSys: 120,
    bpDia: 80,
    fbs: 95,
    ppbs: 140,
    rbs: 110,
    pulse: 72,
    spo2: 98,
    temperatureC: 37,
    weightKg: 70,
    heightCm: 170,
    bmi: 24.2,
  },
  vitalsMoreThanOne: true,
  qrCode: 'data:image/png;base64,QRCODEVAL',
  additionalInformation: { ADDINFOKEY: 'ADDINFOVAL' },
  prescriptions: [
    {
      medicineName: 'MEDNAME',
      strength: 'STRENGTHVAL',
      composition: 'COMPOSITIONVAL',
      dosage: 'DOSAGEVAL',
      frequency: 'FREQVAL',
      duration: 'DURATIONVAL',
      notes: 'INSTRUCTIONVAL',
      form: 'Tablet',
      quantity: 10,
    },
  ],
  watermarkLogo: 'https://example.test/logo.png',
});

/** Content that must disappear when its section is switched off. */
const MARKERS: Partial<Record<PrescriptionSectionKey, string>> = {
  showClinicTagline: 'CLINICTAGLINE',
  showClinicPhone: 'CLINICPHONE',
  showDoctorRegistration: 'DOCREGNUMBER',
  showDoctorSpeciality: 'DOCSPECIALITY',
  showChiefComplaints: 'SYMPTOMVAL',
  showAllergies: 'ALLERGYVAL',
  showDiagnosis: 'DIAGNOSISVAL',
  showClinicalNotes: 'VISITNOTESVAL',
  showTests: 'TESTNAMESVAL',
  showAdvice: 'ADVICEVAL',
  showFollowUp: 'FOLLOWUPDATE',
  showAdditionalInformation: 'ADDINFOVAL',
  showMedicineComposition: 'COMPOSITIONVAL',
  showMedicineStrength: 'STRENGTHVAL',
  showMedicineInstructions: 'INSTRUCTIONVAL',
  showConsultationHours: 'AVAILDISPLAY',
  showPatientAddress: 'PATIENTADDRESS',
  showVisitingDays: 'VISITDAYVAL',
};

/** Content that must survive even an all-off config. */
const LOCKED_MARKERS = ['PATIENTNAME', 'MEDNAME', 'DOCTORNAME'];

const run = () => {
  const allOn = PrescriptionSectionService.derive({});
  const allOff = PrescriptionSectionService.derive(
    Object.fromEntries(Object.keys(allOn).map((key) => [key, false])) as Record<
      PrescriptionSectionKey,
      boolean
    >
  );

  let failures = 0;

  for (const [name, template] of TEMPLATES) {
    let onHtml: string;
    let offHtml: string;

    try {
      onHtml = handlebars.compile(template)(buildData(allOn));
      offHtml = handlebars.compile(template)(buildData(allOff));
    } catch (error) {
      console.error(`FAIL ${name}: ${(error as Error).message}`);
      failures++;
      continue;
    }

    for (const marker of LOCKED_MARKERS) {
      if (!offHtml.includes(marker)) {
        console.error(
          `FAIL ${name}: locked content "${marker}" disappeared with all sections off`
        );
        failures++;
      }
    }

    for (const [key, marker] of Object.entries(MARKERS)) {
      if (onHtml.includes(marker) && offHtml.includes(marker)) {
        console.error(
          `FAIL ${name}: "${marker}" still printed with ${key} off — section not wired to its flag`
        );
        failures++;
      }
    }

    console.info(
      `ok   ${name}  on=${onHtml.length}b  off=${offHtml.length}b  (-${
        onHtml.length - offHtml.length
      }b)`
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }

  console.info('\nAll templates honour the section toggles.');
};

run();
