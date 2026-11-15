import { generalPhysician } from './generalPhysician';
import { pediatrician } from './pediatrician';
import { gynecologist } from './gynecologist';
import { dermatologist } from './dermatologist';
import { orthopedicDoctor } from './orthopedicDoctor';
import { entSpecialist } from './entSpecialist';
import { cardiologist } from './cardiologist';
import { dentist } from './dentist';
import { ophthalmologist } from './ophthalmologist';
import { fertilitySpecialist } from './fertilitySpecialist';
import { gastroenterologist } from './gastroenterologist';
import { generalSurgeon } from './generalSurgeon';
import { neurologist } from './neurologist';
import { plasticSurgeon } from './plasticSurgeon';
import { pulmonologist } from './pulmonologist';
import { psychologist } from './psychologist';
import { urologist } from './urologist';
import { psychiatrist } from './psychiatrist';
import { physiotherapist } from './physiotherapist';
import { dietitianNutritionist } from './dietitianNutritionist';
import { ayurvedicDoctor } from './ayurvedicDoctor';
import { homeopathicDoctor } from './homeopathicDoctor';
import { emergencyMedicineSpecialist } from './emergencyMedicineSpecialist';
import { speechTherapist } from './speechTherapist';
import { vascularSpecialist } from './vascularSpecialist';
import { anesthesiologist } from './anesthesiologist';
import { rheumatologist } from './rheumatologist';
import { nephrologist } from './nephrologist';
import { endocrinologist } from './endocrinologist';
import { oncologist } from './oncologist';
import { geriatrician } from './geriatrician';
import { hematologist } from './hematologist';
import { immunologist } from './immunologist';

/** Prescription lists and section order per specialty, one file each. */
export const DOCTOR_SPECIALTY_CONFIG = {
  'General Physician': generalPhysician,
  Pediatrician: pediatrician,
  Gynecologist: gynecologist,
  Dermatologist: dermatologist,
  'Orthopedic Doctor': orthopedicDoctor,
  'ENT Specialist': entSpecialist,
  Cardiologist: cardiologist,
  Dentist: dentist,
  Ophthalmologist: ophthalmologist,
  'Fertility Specialist': fertilitySpecialist,
  Gastroenterologist: gastroenterologist,
  'General Surgeon': generalSurgeon,
  Neurologist: neurologist,
  'Plastic Surgeon': plasticSurgeon,
  Pulmonologist: pulmonologist,
  Psychologist: psychologist,
  Urologist: urologist,
  Psychiatrist: psychiatrist,
  Physiotherapist: physiotherapist,
  'Dietitian / Nutritionist': dietitianNutritionist,
  'Ayurvedic Doctor': ayurvedicDoctor,
  'Homeopathic Doctor': homeopathicDoctor,
  'Emergency Medicine Specialist': emergencyMedicineSpecialist,
  'Speech Therapist': speechTherapist,
  'Vascular Specialist': vascularSpecialist,
  Anesthesiologist: anesthesiologist,
  Rheumatologist: rheumatologist,
  Nephrologist: nephrologist,
  Endocrinologist: endocrinologist,
  Oncologist: oncologist,
  Geriatrician: geriatrician,
  Hematologist: hematologist,
  Immunologist: immunologist,
} as const;
