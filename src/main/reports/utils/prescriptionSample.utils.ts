import { buildFontUrl } from '../../../utils/fontConfig.utils';

/** Colours and font every custom (HTML) template prints with; named templates bring their own. */
export const DEFAULT_TEMPLATE_CONFIG = {
  fontFamily: 'Inter, sans-serif',
  primaryFont: 'Inter',
  fontUrl: buildFontUrl('Inter, sans-serif'),
  colors: {
    color1: '#0A6C74',
    color2: '#EBFCF4',
    color3: '#333333',
    color4: '#666666',
    color5: '#e0e0e0',
    color6: '#b22222',
    color7: '#f9f9f9',
    color8: '#ffffff',
    color9: '#000000',
    color10: '#856404',
  },
};

export const DEFAULT_TEMPLATE6_COLORS = {
  color1: '#1E3A5F',
  color2: '#EFF4FA',
  color3: '#333333',
  color4: '#666666',
  color5: '#e0e0e0',
  color6: '#b22222',
  color7: '#f9f9f9',
  color8: '#ffffff',
  color9: '#000000',
  color10: '#0F5C8C',
};

const WEEKDAY = {
  isAvailable: true,
  startTime: '09:00 AM',
  endTime: '05:00 PM',
};
const OFF = { isAvailable: false, startTime: '', endTime: '' };

/** The one sample visit every template preview fills in; a fresh copy each call, so callers may edit it. */
export const buildPrescriptionSample = () => ({
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
    email: 'udit.chouhan@example.com',
    qualification: 'MBBS, MD',
    speciality: 'General Physician',
    registrationNumber: 'DVGCS456123612',
    availability: [
      { day: 'Mon', ...WEEKDAY },
      { day: 'Tue', ...WEEKDAY },
      { day: 'Wed', ...WEEKDAY },
      { day: 'Thu', ...WEEKDAY },
      { day: 'Fri', ...WEEKDAY },
      { day: 'Sat', ...OFF },
      { day: 'Sun', ...OFF },
    ],
    groupedAvailability: [
      {
        days: 'Mon - Fri',
        isAvailable: true,
        display: '09:00 AM - 05:00 PM',
        shifts: [{ label: '', time: '09:00 AM - 05:00 PM' }],
      },
      {
        days: 'Sat - Sun',
        isAvailable: false,
        display: 'Off',
        shifts: [] as { label: string; time: string }[],
      },
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
  symptoms: [{ name: 'Headache' }, { name: 'Fever' }, { name: 'Cough' }],
  hasTests: 2,
  testNames: 'CBC, Vitamin B12',
  diagnosis: 'Viral Fever, Respiratory Tract Infection',
  habits: ['Smoking', 'Tobacco'],
  allergies: ['Dust', 'Syrup'],
  visitingDays: ['10-Mar-2026', '16-Mar-2026'],
  visitingNotes: 'To checkup of health condition',
  surgerySuggested: ['Mole Removal', 'Suturing Wounds'],
  treatmentPlans: [
    {
      title: 'Acne Treatment Course',
      status: 'Proposed',
      steps: [
        { n: 1, name: 'Chemical peel', when: 'Start' },
        { n: 2, name: 'Review and second peel', when: 'After 14 days' },
        { n: 3, name: 'Final review', when: 'After 28 days' },
      ],
    },
  ],
  vitalsMoreThanOne: true,
  vitals: {
    bpSys: 120,
    bpDia: 80,
    fbs: 95,
    ppbs: 140,
    rbs: 110,
    pulse: 72,
    spo2: 98,
    respiratoryRate: 18,
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
  } as Record<string, string>,
});
