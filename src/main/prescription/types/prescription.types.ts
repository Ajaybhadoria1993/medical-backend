import { z } from 'zod';

/**
 * Reusable Validators
 */
const NonEmptyString = z.string().trim().min(1);
const OptionalString = z.string().trim().optional();

/**
 * Scan Input (with enforcement)
 */
export const ScanInputSchema = z
  .object({
    imageBase64: OptionalString,
    imageUrl: z.url().optional(),
  })
  .refine((data) => data.imageBase64 || data.imageUrl, {
    message: 'At least one input source is required: imageBase64 or imageUrl',
  });

export type ScanInput = z.infer<typeof ScanInputSchema>;

/**
 * Shared Schemas
 */
const AvailabilitySchema = z.object({
  day: NonEmptyString,
  isAvailable: z.boolean(),
  display: OptionalString,
});

const PatientSchema = z.object({
  name: OptionalString,
  age: z.number().int().min(0).max(120).optional(),
  gender: z
    .enum(['male', 'female', 'other', 'Male', 'Female', 'Other'])
    .optional(),
  address: OptionalString,
});

const DoctorSchema = z.object({
  name: OptionalString,
  speciality: OptionalString,
  qualification: OptionalString,
  email: z.string().email().min(10).max(80).optional(),
  registrationNumber: OptionalString,
  availability: z.array(AvailabilitySchema).optional(),
});

const ClinicSchema = z.object({
  logo: OptionalString,
  name: OptionalString,
  tagline: OptionalString,
  address: OptionalString,
  city: OptionalString,
  state: OptionalString,
  zipcode: OptionalString,
  phone: OptionalString,
});

const SymptomSchema = z.object({
  name: NonEmptyString,
});

const VitalsSchema = z
  .object({
    bpSys: z.number().int().min(50).max(250).optional(),
    bpDia: z.number().int().min(30).max(150).optional(),
    fbs: z.number().int().min(20).max(600).optional(),
    ppbs: z.number().int().min(20).max(800).optional(),
    rbs: z.number().int().min(20).max(800).optional(),
    pulse: z.number().int().min(30).max(200).optional(),
    spo2: z.number().min(50).max(100).optional(),
    temperatureC: z.number().min(30).max(45).optional(),
    weightKg: z.number().min(1).max(300).optional(),
    heightCm: z.number().min(30).max(300).optional(),
    bmi: z.number().min(5).max(100).optional(),
  })
  .strict();

const PrescriptionItemSchema = z.object({
  medicineName: NonEmptyString,
  strength: OptionalString,
  dosage: OptionalString,
  frequency: OptionalString,
  duration: OptionalString,
  notes: OptionalString,
});

const MedicineSchema = z.object({
  name: NonEmptyString,
  strength: OptionalString,
  dosage: OptionalString,
  frequency: OptionalString,
  duration: OptionalString,
  notes: OptionalString,
});

/**
 * Template Config (Strict Color Governance)
 */
const TemplateColorsSchema = z
  .object({
    color1: OptionalString,
    color2: OptionalString,
    color3: OptionalString,
    color4: OptionalString,
    color5: OptionalString,
    color6: OptionalString,
    color7: OptionalString,
    color8: OptionalString,
    color9: OptionalString,
    color10: OptionalString,
  })
  .strict();

const TemplateConfigSchema = z
  .object({
    primaryFont: OptionalString,
    fontFamily: OptionalString,
    colors: TemplateColorsSchema.optional(),
  })
  .strict();

/**
 * Date Handling (ISO-safe)
 */
const DateString = z.string().trim().min(1).optional();

/**
 * Core Prescription Schema
 */
export const PrescriptionDataSchema = z
  .object({
    patient: PatientSchema.optional(),
    doctor: DoctorSchema.optional(),
    clinic: ClinicSchema.optional(),

    doctorName: OptionalString,
    patientName: OptionalString,
    patientAge: OptionalString,

    visitDate: DateString,
    appointmentDate: DateString,
    appointmentTime: OptionalString,
    token: OptionalString,
    followUpDate: DateString,

    symptoms: z.array(SymptomSchema).optional(),
    diagnosis: OptionalString,

    habits: z.array(NonEmptyString).optional(),
    allergies: z.array(NonEmptyString).optional(),

    visitingDays: z.array(NonEmptyString).optional(),

    surgerySuggested: z.array(NonEmptyString).optional(),

    hasTests: z.boolean().optional(),
    testNames: OptionalString,

    vitalsMoreThanOne: z.boolean().optional(),
    vitals: VitalsSchema.optional(),

    prescriptions: z.array(PrescriptionItemSchema).optional(),
    medicines: z.array(MedicineSchema).optional(),

    advice: OptionalString,
    dietarySuggestion: OptionalString,

    templateConfig: TemplateConfigSchema.optional(),
  })
  .strict(); // prevents hallucinated keys (LLM safety)

export type PrescriptionData = z.infer<typeof PrescriptionDataSchema>;

/**
 * HTML Template Schema
 */
export const HtmlTemplateResultSchema = z
  .object({
    html: NonEmptyString,
  })
  .strict();

export type HtmlTemplateResult = z.infer<typeof HtmlTemplateResultSchema>;

/**
 * Final Output Schema
 */
export const ScanOutputSchema = z
  .object({
    template: NonEmptyString,
  })
  .strict();

export type ScanOutput = z.infer<typeof ScanOutputSchema>;
