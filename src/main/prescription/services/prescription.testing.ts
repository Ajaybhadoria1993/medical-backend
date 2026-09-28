import { sampleTemplate } from '../templates/prescription.template';
import type { PrescriptionData, ScanOutput } from '../types/prescription.types';

const TESTING_ENABLED = process.env.TESTING?.trim().toLowerCase() === 'true';

const TESTING_PRESCRIPTION_DATA = {
  patient: {
    name: 'Amit Sharma',
    age: 34,
    gender: 'Male',
    address: '12 Lake View Road, Kolkata',
  },
  doctor: {
    name: 'Priya Mehta',
    speciality: 'General Physician',
    qualification: 'MBBS, MD (General Medicine)',
    email: 'dr.priya.mehta@example.com',
    registrationNumber: 'WBMC-2026-01984',
    availability: [
      {
        day: 'Mon',
        isAvailable: true,
        display: '10:00 AM - 1:00 PM',
      },
      {
        day: 'Tue',
        isAvailable: true,
        display: '10:00 AM - 1:00 PM',
      },
      {
        day: 'Wed',
        isAvailable: true,
        display: '5:00 PM - 8:00 PM',
      },
      {
        day: 'Thu',
        isAvailable: true,
        display: '10:00 AM - 1:00 PM',
      },
      {
        day: 'Fri',
        isAvailable: true,
        display: '10:00 AM - 1:00 PM',
      },
      {
        day: 'Sat',
        isAvailable: false,
        display: ' ',
      },
      {
        day: 'Sun',
        isAvailable: false,
        display: ' ',
      },
    ],
  },
  clinic: {
    logo: 'https://res.cloudinary.com/ddzkedas8/image/upload/v1773045466/image_rx09np.png',
    name: 'Sunrise Health Clinic',
    tagline: 'Care with compassion',
    address: '45 Park Street',
    city: 'Kolkata',
    state: 'West Bengal',
    zipcode: '700016',
    phone: '+91 98765 43210',
  },
  appointmentDate: '18 Mar 2026',
  appointmentTime: '11:30 AM',
  token: 'A-27',
  followUpDate: '25-Mar-2026',
  symptoms: [{ name: 'Fever' }, { name: 'Headache' }, { name: 'Body ache' }],
  diagnosis: 'Viral fever',
  habits: ['Occasional smoking', 'Late-night meals'],
  visitingDays: ['01-Apr-2026', '05-Apr-2026'],
  surgerySuggested: ['Mole Removal', 'Hernia Repair'],
  allergies: ['Penicillin', 'Dust'],
  hasTests: true,
  testNames: 'CBC, CRP, Dengue NS1',
  vitalsMoreThanOne: true,
  vitals: {
    bpSys: 120,
    bpDia: 80,
    fbs: 95,
    ppbs: 140,
    rbs: 110,
    pulse: 78,
    spo2: 98,
    temperatureC: 37.8,
    weightKg: 72,
    heightCm: 175,
    bmi: 23.5,
  },
  prescriptions: [
    {
      medicineName: 'Paracetamol',
      strength: '650 mg',
      dosage: '1 tablet',
      frequency: '3 times a day',
      duration: '5 days',
      notes: 'After food',
    },
    {
      medicineName: 'Pantoprazole',
      strength: '40 mg',
      dosage: '1 tablet',
      frequency: 'Once daily',
      duration: '5 days',
      notes: 'Before breakfast',
    },
  ],
  advice:
    'Drink plenty of fluids, take adequate rest, and monitor temperature twice daily.',
  dietarySuggestion: 'Soft diet, coconut water, soup, and fresh fruits.',
} satisfies PrescriptionData;

const TESTING_SCAN_OUTPUT = {
  template: sampleTemplate().html,
} satisfies ScanOutput;

export const isTestingModeEnabled = () => TESTING_ENABLED;

export const getTestingScanOutput = (): ScanOutput =>
  structuredClone(TESTING_SCAN_OUTPUT);

export const getDummyPrescriptionData = (): PrescriptionData =>
  structuredClone(TESTING_PRESCRIPTION_DATA);
