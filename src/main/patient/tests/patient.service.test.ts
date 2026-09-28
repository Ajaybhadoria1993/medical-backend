import { PatientService } from '../services/patient.service';
import { patientBookingSchema } from '../schemas/patient.schemas';
import { database } from '../../../configurations/dbConnection';
import { AppointmentService } from '../../appointments/services/appointment.service';
import { DoctorServices } from '../../doctor/services/doctor.service';
import {
  createRazorpaySplitOrder,
  createRazorpayAppointmentOrder,
  verifyRazorpayPayment,
} from '../../../utils/razorpay';
import { envConfig } from '../../../utils/envConfig';

jest.mock('../../../configurations/dbConnection');
jest.mock('../../../utils/logger');
jest.mock('../../appointments/services/appointment.service');
jest.mock('../../../utils/razorpay');
jest.mock('../../../utils/notificationHelpers');
jest.mock('../../../utils/appointmentRealtime');
jest.mock(
  '../../cancellation-policy/services/policyEvaluation.service',
  () => ({
    PolicyEvaluationService: {
      evaluateReschedule: jest.fn().mockResolvedValue({ allowed: true }),
    },
  })
);

jest.mock('../../appointments/services/paymentReservation.service', () => {
  const { sql } = require('drizzle-orm');
  return {
    PaymentReservationService: {
      buildActiveAppointmentFilter: jest.fn().mockReturnValue(sql`1=1`),
      // Returns whether the hold was acquired; false means someone else has it.
      createLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      verifyLatePayment: jest.fn().mockResolvedValue(undefined),
      cleanupExpired: jest.fn().mockResolvedValue(undefined),
    },
  };
});

describe('PatientService.searchDirectory Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      '$dynamic',
      'orderBy',
      'limit',
      'offset',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  it('should successfully search the directory and calculate proximity distance when lat/lng are provided', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const mockData = [
      {
        doctor: {
          id: 'doctor-1',
          name: 'Dr. Smith',
          totalLikes: 0,
          averageRating: '4.50',
          reviewCount: 12,
        },
        clinic: { id: 'clinic-1', clinicName: 'Healthy Care' },
        distance: 4.5,
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices = [
      {
        id: 's-1',
        clinicId: 'clinic-1',
        serviceName: 'Consultation',
        price: 500,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
    ];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [
        {
          start: `${todayStr}T10:00:00`,
          end: `${todayStr}T10:30:00`,
          status: 'available',
        },
      ],
    });

    const result = await PatientService.searchDirectory({
      search: 'Smith',
      speciality: 'Cardiologist',
      latitude: 19.076,
      longitude: 72.8777,
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
      date: '2026-06-16',
    });

    expect(database.select).toHaveBeenCalledTimes(3);
    expect(result.data[0].nextAvailableSlot).toEqual({
      date: todayStr,
      time: '10:00 AM',
      endTime: '10:30 AM',
      start: `${todayStr}T10:00:00`,
      end: `${todayStr}T10:30:00`,
      availableTokens: null,
      totalTokens: null,
    });
    expect(result.data[0].clinic.services).toEqual(mockServices);
  });

  it('should search the directory without distance field when lat/lng are not provided', async () => {
    const mockData = [
      {
        doctor: {
          id: 'doctor-2',
          name: 'Dr. Jones',
          totalLikes: 0,
          averageRating: '4.20',
          reviewCount: 8,
        },
        clinic: { id: 'clinic-2', clinicName: 'Wellness Clinic' },
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices: any[] = [];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });

    const result = await PatientService.searchDirectory({
      search: 'Jones',
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalledTimes(3);
    expect(result.data[0].nextAvailableSlot).toBeNull();
    expect(result.data[0].clinic.services).toEqual(mockServices);
  });

  it('should successfully search the directory and filter by city when city is provided', async () => {
    const mockData = [
      {
        doctor: {
          id: 'doctor-3',
          name: 'Dr. Adams',
          totalLikes: 0,
          averageRating: '4.80',
          reviewCount: 5,
        },
        clinic: { id: 'clinic-3', clinicName: 'City Clinic', city: 'Mumbai' },
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices: any[] = [];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });

    const result = await PatientService.searchDirectory({
      city: 'Mumbai',
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalledTimes(3);
    expect(result.data[0].clinic.city).toEqual('Mumbai');
  });

  it('should successfully search the directory and combine city and proximity filters using an OR condition when both are provided', async () => {
    const mockData = [
      {
        doctor: {
          id: 'doctor-3-or',
          name: 'Dr. ProximityOrCity',
          totalLikes: 0,
          averageRating: '4.80',
          reviewCount: 5,
        },
        clinic: { id: 'clinic-3-or', clinicName: 'Or Clinic', city: 'Mumbai' },
        distance: 8.5,
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices: any[] = [];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });

    const result = await PatientService.searchDirectory({
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalledTimes(3);
    expect(result.data[0].clinic.city).toEqual('Mumbai');
    expect(result.data[0].distance).toEqual(8.5);
  });

  it('should filter search results by availability and correctly paginate in-memory when available=true is passed', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const mockData = [
      {
        doctor: {
          id: 'doctor-1',
          name: 'Dr. Available',
          totalLikes: 0,
          averageRating: '4.80',
          reviewCount: 15,
        },
        clinic: { id: 'clinic-1', clinicName: 'Active Care' },
      },
      {
        doctor: {
          id: 'doctor-2',
          name: 'Dr. Busy',
          totalLikes: 0,
          averageRating: '3.90',
          reviewCount: 5,
        },
        clinic: { id: 'clinic-2', clinicName: 'Busy Clinic' },
      },
    ];
    const mockServices = [
      {
        id: 's-1',
        clinicId: 'clinic-1',
        serviceName: 'Consultation',
        price: 500,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
    ];

    const dataChain = createChain(mockData);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(serviceChain);

    // Doctor 1 has available slots
    // Doctor 2 has no slots
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockImplementation(async (clinicId, query, params) => {
      if (params.doctorId === 'doctor-1') {
        return {
          slots: [
            {
              start: `${todayStr}T14:30:00`,
              end: `${todayStr}T15:00:00`,
              status: 'available',
            },
          ],
        };
      }
      return { slots: [] };
    });

    const result = await PatientService.searchDirectory({
      available: true,
      date: todayStr,
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].doctor.id).toBe('doctor-1');
    expect(result.data[0].nextAvailableSlot).toEqual({
      date: todayStr,
      time: '2:30 PM',
      endTime: '3:00 PM',
      start: `${todayStr}T14:30:00`,
      end: `${todayStr}T15:00:00`,
      availableTokens: null,
      totalTokens: null,
    });
    expect(result.data[0].clinic.services).toEqual(mockServices);
    expect(result.pagination.totalRecords).toBe(1);
  });

  it('should return token capacity and auto-assigned token details for token-based slots', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const mockData = [
      {
        doctor: {
          id: 'doctor-1',
          name: 'Dr. Token',
          totalLikes: 0,
          averageRating: '4.70',
          reviewCount: 18,
        },
        clinic: { id: 'clinic-1', clinicName: 'Token Care' },
        distance: 2.0,
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices = [
      {
        id: 's-1',
        clinicId: 'clinic-1',
        serviceName: 'Consultation',
        price: 500,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
    ];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [
        {
          start: `${todayStr}T09:00:00`,
          end: `${todayStr}T13:00:00`,
          totalTokens: 30,
          availableTokens: 25,
          status: 'available',
        },
      ],
    });

    const result = await PatientService.searchDirectory({
      search: 'Token',
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(result.data[0].nextAvailableSlot).toEqual({
      date: todayStr,
      time: '9:00 AM',
      endTime: '1:00 PM',
      start: `${todayStr}T09:00:00`,
      end: `${todayStr}T13:00:00`,
      availableTokens: 25,
      totalTokens: 30,
    });
  });

  it('should include totalLikes in select and order query by totalLikes descending and distance ascending', async () => {
    const mockData = [
      {
        doctor: {
          id: 'doctor-liked',
          name: 'Dr. Liked',
          totalLikes: 25,
          averageRating: '4.90',
          reviewCount: 32,
        },
        clinic: { id: 'clinic-1', clinicName: 'Care Center' },
        distance: 1.2,
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices: any[] = [];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });

    const result = await PatientService.searchDirectory({
      search: 'Liked',
      latitude: 19.076,
      longitude: 72.8777,
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalled();
    expect(dataChain.orderBy).toHaveBeenCalled();
    expect(result.data[0].doctor.totalLikes).toBe(25);
  });

  it('should successfully search the directory using tokenized multi-word combined search matching doctor and clinic names', async () => {
    const mockData = [
      {
        doctor: {
          id: 'doctor-combined',
          name: 'Dr. John Doe',
          totalLikes: 5,
          averageRating: '4.80',
          reviewCount: 10,
        },
        clinic: { id: 'clinic-combined', clinicName: 'Super Care Clinic' },
        distance: 3.0,
      },
    ];
    const mockCount = [{ count: 1 }];
    const mockServices: any[] = [];

    const dataChain = createChain(mockData);
    const countChain = createChain(mockCount);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(dataChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(serviceChain);

    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });

    const result = await PatientService.searchDirectory({
      search: 'John Super',
      radius: 10,
      pageNumber: '1',
      pageSize: '10',
    });

    expect(database.select).toHaveBeenCalled();
    expect(result.data[0].doctor.name).toBe('Dr. John Doe');
    expect(result.data[0].clinic.clinicName).toBe('Super Care Clinic');
  });
});

describe('PatientService.getDoctorPublicProfile Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      '$dynamic',
      'orderBy',
      'limit',
      'offset',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  it('should fetch doctor public profile, clinics, qualifications and active services, and group services by clinic', async () => {
    const mockDoctor = {
      id: 'doctor-1',
      name: 'Dr. John Doe',
      gender: 'Male',
      profileImage: 'doctor.jpg',
      qualification: 'MBBS',
      yearsOfExperience: 10,
      speciality: 'General Medicine',
      specialization: ['Diabetes Care'],
      registrationNumber: 'REG123',
      isVerified: true,
      about: 'Highly experienced doctor',
      averageRating: '4.60',
      reviewCount: 20,
    };

    const mockQualifications = [
      {
        id: 'q-1',
        userId: 'doctor-1',
        degree: 'MBBS',
        college: 'Medical College',
        year: '2015',
      },
    ];

    const mockClinics = [
      { id: 'clinic-1', clinicName: 'Clinic One' },
      { id: 'clinic-2', clinicName: 'Clinic Two' },
    ];

    const mockServices = [
      {
        id: 's-1',
        clinicId: 'clinic-1',
        serviceName: 'Consultation',
        price: 500,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
      {
        id: 's-2',
        clinicId: 'clinic-1',
        serviceName: 'Follow Up',
        price: 300,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
    ];

    const mockPatientCount = [{ count: 5 }];
    const mockFavorite = [{ id: 'fav-1' }];

    const profileChain = createChain([mockDoctor]);
    const qualificationChain = createChain(mockQualifications);
    const clinicChain = createChain(mockClinics);
    const serviceChain = createChain(mockServices);
    const countChain = createChain(mockPatientCount);
    const favoriteChain = createChain(mockFavorite);

    (database.select as jest.Mock)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(qualificationChain)
      .mockReturnValueOnce(clinicChain)
      .mockReturnValueOnce(serviceChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(favoriteChain);

    const mockAvailability = [
      {
        dayOfWeek: 'Monday',
        startTime: '09:00 AM',
        endTime: '06:00 PM',
        isAvailable: true,
        breaks: [{ startTime: '01:00 PM', endTime: '02:00 PM' }],
      },
    ];
    const availabilitySpy = jest
      .spyOn(DoctorServices, 'getDoctorAvailability')
      .mockResolvedValue(mockAvailability as any);

    const result = await PatientService.getDoctorPublicProfile(
      'doctor-1',
      'patient-1'
    );

    expect(database.select).toHaveBeenCalledTimes(6);
    expect(availabilitySpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ...mockDoctor,
      qualifications: mockQualifications,
      clinics: [
        {
          ...mockClinics[0],
          onlineBookingEnabled: false,
          maxAdvanceBookingDays: 7,
          payOnlineEnabled: false,
          payAtClinicEnabled: false,
          showClinicNumber: true,
          services: [mockServices[0], mockServices[1]],
          timings: [
            {
              dayOfWeek: 'Monday',
              startTime: '09:00 AM',
              endTime: '06:00 PM',
              isAvailable: true,
              breaks: [{ startTime: '01:00 PM', endTime: '02:00 PM' }],
            },
          ],
        },
        {
          ...mockClinics[1],
          onlineBookingEnabled: false,
          maxAdvanceBookingDays: 7,
          payOnlineEnabled: false,
          payAtClinicEnabled: false,
          showClinicNumber: true,
          services: [],
          timings: [
            {
              dayOfWeek: 'Monday',
              startTime: '09:00 AM',
              endTime: '06:00 PM',
              isAvailable: true,
              breaks: [{ startTime: '01:00 PM', endTime: '02:00 PM' }],
            },
          ],
        },
      ],
      totalPatients: 5,
      isFavorite: true,
    });
  });

  it('should throw an error if doctor profile is not found', async () => {
    const profileChain = createChain([]);

    (database.select as jest.Mock).mockReturnValueOnce(profileChain);

    await expect(
      PatientService.getDoctorPublicProfile('non-existent-doctor')
    ).rejects.toThrow('Doctor profile not found or inactive');
  });

  it('should filter out clinics without public_booking_page when audience is web', async () => {
    const mockDoctor = {
      id: 'doctor-1',
      name: 'Dr. John Doe',
      gender: 'Male',
      profileImage: 'doctor.jpg',
      qualification: 'MBBS',
      yearsOfExperience: 10,
      speciality: 'General Medicine',
      specialization: ['Diabetes Care'],
      registrationNumber: 'REG123',
      isVerified: true,
      about: 'Highly experienced doctor',
      averageRating: '4.60',
      reviewCount: 20,
    };

    const mockQualifications = [
      {
        id: 'q-1',
        userId: 'doctor-1',
        degree: 'MBBS',
        college: 'Medical College',
        year: '2015',
      },
    ];

    const mockClinics = [
      { id: 'clinic-1', clinicName: 'Clinic One (Basic)' },
      { id: 'clinic-2', clinicName: 'Clinic Two (Free)' },
    ];

    const mockServices = [
      {
        id: 's-1',
        clinicId: 'clinic-1',
        serviceName: 'Consultation',
        price: 500,
        currency: 'INR',
        additionalServices: 'None',
        durationDays: 30,
      },
    ];

    const mockPatientCount = [{ count: 5 }];

    const profileChain = createChain([mockDoctor]);
    const qualificationChain = createChain(mockQualifications);
    const clinicChain = createChain(mockClinics);
    const serviceChain = createChain(mockServices);
    const countChain = createChain(mockPatientCount);

    (database.select as jest.Mock)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(qualificationChain)
      .mockReturnValueOnce(clinicChain)
      .mockReturnValueOnce(serviceChain)
      .mockReturnValueOnce(countChain);

    jest.spyOn(DoctorServices, 'getDoctorAvailability').mockResolvedValue([]);
    const {
      LimitationService,
    } = require('../../subscription/services/limitation.service');
    jest
      .spyOn(LimitationService, 'isFeatureEnabled')
      .mockImplementation(async (clinicId: any) => {
        if (clinicId === 'clinic-1') return { allowed: true };
        return { allowed: false, message: 'Disabled on Free plan' };
      });

    const result = await PatientService.getDoctorPublicProfile(
      'doctor-1',
      undefined,
      { audience: 'web' }
    );

    expect(result.clinics).toHaveLength(1);
    expect(result.clinics[0].id).toBe('clinic-1');
  });

  it('should throw 404 when audience is web and doctor has no clinics with public_booking_page enabled (Option A)', async () => {
    const mockDoctor = {
      id: 'doctor-1',
      name: 'Dr. John Doe',
      gender: 'Male',
      profileImage: 'doctor.jpg',
      qualification: 'MBBS',
      yearsOfExperience: 10,
      speciality: 'General Medicine',
      specialization: ['Diabetes Care'],
      registrationNumber: 'REG123',
      isVerified: true,
      about: 'Highly experienced doctor',
      averageRating: '4.60',
      reviewCount: 20,
    };

    const mockQualifications: any[] = [];
    const mockClinics = [{ id: 'clinic-free', clinicName: 'Free Clinic' }];
    const mockServices: any[] = [];

    const profileChain = createChain([mockDoctor]);
    const qualificationChain = createChain(mockQualifications);
    const clinicChain = createChain(mockClinics);
    const serviceChain = createChain(mockServices);

    (database.select as jest.Mock)
      .mockReturnValueOnce(profileChain)
      .mockReturnValueOnce(qualificationChain)
      .mockReturnValueOnce(clinicChain)
      .mockReturnValueOnce(serviceChain);

    const {
      LimitationService,
    } = require('../../subscription/services/limitation.service');
    jest
      .spyOn(LimitationService, 'isFeatureEnabled')
      .mockResolvedValue({ allowed: false, message: 'Disabled on Free plan' });

    await expect(
      PatientService.getDoctorPublicProfile('doctor-1', undefined, {
        audience: 'web',
      })
    ).rejects.toThrow('Doctor profile not found or inactive');
  });
});

describe('PatientService.getDoctorPublicSlots Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty slots list if the requested date is in the past', async () => {
    const now = new Date();
    const istDateParts = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/');
    const istToday = new Date(
      `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}T00:00:00Z`
    );
    const yesterday = new Date(istToday);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const result = await PatientService.getDoctorPublicSlots('doctor-1', {
      date: yesterdayStr,
      clinicId: 'clinic-1',
    });

    expect(result).toEqual({ slots: [] });
    expect(AppointmentService.getAvailableSlotsForDate).not.toHaveBeenCalled();
  });

  it('should pass current IST time as time filter when the requested date is today', async () => {
    const now = new Date();
    const istDateParts = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/');
    const istTodayStr = `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}`;

    const expectedTime = now.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });

    const mockSlotsResult = {
      slots: [
        {
          start: `${istTodayStr}T10:00:00`,
          end: `${istTodayStr}T10:30:00`,
          source: 'availability',
          status: 'available',
        },
      ],
    };
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue(mockSlotsResult);

    const result = await PatientService.getDoctorPublicSlots('doctor-1', {
      date: istTodayStr,
      clinicId: 'clinic-1',
    });

    expect(AppointmentService.getAvailableSlotsForDate).toHaveBeenCalledWith(
      'clinic-1',
      {
        date: istTodayStr,
        time: expectedTime,
      },
      { doctorId: 'doctor-1' }
    );
    expect(result).toEqual(mockSlotsResult);
  });

  it('should call slots service without time filter if requested date is in the future', async () => {
    const now = new Date();
    const istDateParts = now
      .toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      .split('/');
    const istToday = new Date(
      `${istDateParts[2]}-${istDateParts[1]}-${istDateParts[0]}T00:00:00Z`
    );
    const tomorrow = new Date(istToday);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const mockSlotsResult = {
      slots: [
        {
          start: `${tomorrowStr}T10:00:00`,
          end: `${tomorrowStr}T10:30:00`,
          source: 'availability',
          status: 'available',
        },
      ],
    };
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue(mockSlotsResult);

    const result = await PatientService.getDoctorPublicSlots('doctor-1', {
      date: tomorrowStr,
      clinicId: 'clinic-1',
    });

    expect(AppointmentService.getAvailableSlotsForDate).toHaveBeenCalledWith(
      'clinic-1',
      {
        date: tomorrowStr,
        time: undefined,
      },
      { doctorId: 'doctor-1' }
    );
    expect(result).toEqual(mockSlotsResult);
  });
});

describe('PatientService.bookPatientAppointment & verifyAppointmentPayment Route Tests', () => {
  const createUpdateChain = () => {
    const chain: any = {};
    const methods = ['set', 'where'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(chain);
    return chain;
  };

  const createDeleteChain = () => {
    const chain: any = {};
    const methods = ['where'];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(chain);
    return chain;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (database.update as jest.Mock).mockReturnValue(createUpdateChain());
    (database.delete as jest.Mock).mockReturnValue(createDeleteChain());
  });

  const createChain = (finalValue: any) => {
    const chain: any = {};
    const methods = [
      'from',
      'where',
      'limit',
      'select',
      'orderBy',
      'leftJoin',
      'innerJoin',
    ];
    methods.forEach((method) => {
      chain[method] = jest.fn().mockImplementation(() => chain);
    });
    chain.then = (resolve: any) => resolve(finalValue);
    return chain;
  };

  const mockOnlineBookingEnabled = () => {
    const mockClinicSettings = [
      {
        onlineBookingEnabled: true,
        payOnlineEnabled: true,
        payAtClinicEnabled: true,
      },
    ];
    const mockClinicAssign = [
      { onlineBookingEnabled: true, maxAdvanceBookingDays: 7 },
    ];
    (database.select as jest.Mock)
      .mockReturnValueOnce(createChain(mockClinicSettings))
      .mockReturnValueOnce(createChain(mockClinicAssign));
  };

  describe('bookPatientAppointment', () => {
    it('should throw 400 error if clinic has not enabled online booking', async () => {
      const mockClinicSettings = [{ onlineBookingEnabled: false }];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockClinicSettings)
      );

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: '2026-06-20',
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'razorpay',
          price: '500',
        })
      ).rejects.toThrow('Online booking is not enabled for this clinic.');
    });

    it('should throw 400 error if the doctor has not enabled online booking at this clinic', async () => {
      const mockClinicSettings = [
        {
          onlineBookingEnabled: true,
          payOnlineEnabled: true,
          payAtClinicEnabled: true,
        },
      ];
      const mockClinicAssign = [{ onlineBookingEnabled: false }];
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockClinicSettings))
        .mockReturnValueOnce(createChain(mockClinicAssign));

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: '2026-06-20',
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'razorpay',
          price: '500',
        })
      ).rejects.toThrow('This doctor is not accepting online bookings.');
    });

    it("should throw 400 error if the requested date is beyond the doctor's max advance booking days", async () => {
      const mockClinicSettings = [
        {
          onlineBookingEnabled: true,
          payOnlineEnabled: true,
          payAtClinicEnabled: true,
        },
      ];
      const mockClinicAssign = [
        { onlineBookingEnabled: true, maxAdvanceBookingDays: 5 },
      ];
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockClinicSettings))
        .mockReturnValueOnce(createChain(mockClinicAssign));

      const farFutureDate = new Date();
      farFutureDate.setDate(farFutureDate.getDate() + 30);
      const farFutureDateStr = farFutureDate.toISOString().split('T')[0];

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: farFutureDateStr,
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'razorpay',
          price: '500',
        })
      ).rejects.toThrow(
        'This doctor only accepts online bookings up to 5 day(s) in advance.'
      );
    });

    it('should throw 400 error if paying online but clinic has disabled Pay Online', async () => {
      const mockClinicSettings = [
        {
          onlineBookingEnabled: true,
          payOnlineEnabled: false,
          payAtClinicEnabled: true,
        },
      ];
      const mockClinicAssign = [{ onlineBookingEnabled: true }];
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockClinicSettings))
        .mockReturnValueOnce(createChain(mockClinicAssign));

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: '2026-06-20',
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'razorpay',
          price: '500',
        })
      ).rejects.toThrow('Online payment is not available for this clinic.');
    });

    it('should throw 400 error if paying at clinic but clinic has disabled Pay at Clinic', async () => {
      const mockClinicSettings = [
        {
          onlineBookingEnabled: true,
          payOnlineEnabled: true,
          payAtClinicEnabled: false,
        },
      ];
      const mockClinicAssign = [{ onlineBookingEnabled: true }];
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockClinicSettings))
        .mockReturnValueOnce(createChain(mockClinicAssign));

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: '2026-06-20',
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'Pay Later',
          price: '500',
        })
      ).rejects.toThrow('Pay at clinic is not available; please pay online.');
    });

    it('should throw 400 error if ENABLE_RAZORPAY_ROUTE is true and clinic Route status is not ACTIVE', async () => {
      envConfig.ENABLE_RAZORPAY_ROUTE = true;
      mockOnlineBookingEnabled();
      const mockClinic = [
        { id: 'clinic-123', razorpayAccountId: null, routeStatus: 'INACTIVE' },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockClinic)
      );

      await expect(
        PatientService.bookPatientAppointment('user-123', {
          doctorId: 'doctor-123',
          clinicId: 'clinic-123',
          clinicServiceId: 'service-123',
          appointmentDate: '2026-06-20',
          appointmentTime: '10:00 AM',
          patientId: 'user-123',
          paymentMode: 'razorpay',
          price: '500',
        })
      ).rejects.toThrow('Online payment is not enabled for this clinic.');
    });

    it('should succeed and create split order if ENABLE_RAZORPAY_ROUTE is true and clinic Route status is ACTIVE', async () => {
      envConfig.ENABLE_RAZORPAY_ROUTE = true;
      mockOnlineBookingEnabled();
      const mockClinic = [
        {
          id: 'clinic-123',
          razorpayAccountId: 'acc_123',
          routeStatus: 'ACTIVE',
        },
      ];
      const mockCommission = [
        { commissionType: 'percentage', commissionValue: '10.00' },
      ];
      const mockAppointment = { id: 'apt-123', patientId: 'user-123' };

      // Mock database calls: Clinic selection, Commission selection, Family links check (bypassed if patientId === userId)
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockClinic))
        .mockReturnValueOnce(createChain(mockCommission));

      // Mock AppointmentService.createAppointment
      (AppointmentService.createAppointment as jest.Mock).mockResolvedValue(
        mockAppointment
      );

      // Mock Razorpay split order creation
      (createRazorpaySplitOrder as jest.Mock).mockResolvedValue({
        id: 'order_123',
        amount: 50000,
        currency: 'INR',
      });

      const result = await PatientService.bookPatientAppointment('user-123', {
        doctorId: 'doctor-123',
        clinicId: 'clinic-123',
        clinicServiceId: 'service-123',
        appointmentDate: '2026-06-20',
        appointmentTime: '10:00 AM',
        patientId: 'user-123',
        paymentMode: 'razorpay',
        price: '500',
      });

      expect(createRazorpaySplitOrder).toHaveBeenCalledWith(
        500,
        'acc_123',
        450, // 500 - 10% commission platform fee
        'apt-123',
        'clinic-123',
        'user-123'
      );
      expect(result.requiresPayment).toBe(true);
      expect(result.paymentDetails?.orderId).toBe('order_123');
    });

    it('should succeed and create regular order if ENABLE_RAZORPAY_ROUTE is false, even if clinic Route status is not ACTIVE', async () => {
      envConfig.ENABLE_RAZORPAY_ROUTE = false;
      mockOnlineBookingEnabled();
      const mockClinic = [
        {
          id: 'clinic-123',
          razorpayAccountId: null,
          routeStatus: 'INACTIVE',
        },
      ];
      const mockAppointment = { id: 'apt-123', patientId: 'user-123' };

      // Mock database calls
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockClinic)
      );

      // Mock AppointmentService.createAppointment
      (AppointmentService.createAppointment as jest.Mock).mockResolvedValue(
        mockAppointment
      );

      // Mock Razorpay regular order creation
      (createRazorpayAppointmentOrder as jest.Mock).mockResolvedValue({
        id: 'order_regular_123',
        amount: 50000,
        currency: 'INR',
      });

      const result = await PatientService.bookPatientAppointment('user-123', {
        doctorId: 'doctor-123',
        clinicId: 'clinic-123',
        clinicServiceId: 'service-123',
        appointmentDate: '2026-06-20',
        appointmentTime: '10:00 AM',
        patientId: 'user-123',
        paymentMode: 'razorpay',
        price: '500',
      });

      expect(createRazorpayAppointmentOrder).toHaveBeenCalledWith(
        500,
        'apt-123',
        'clinic-123',
        'user-123'
      );
      expect(result.requiresPayment).toBe(true);
      expect(result.paymentDetails?.orderId).toBe('order_regular_123');
    });

    it('should set paymentStatus to Pending when paymentMode is Pay Later', async () => {
      mockOnlineBookingEnabled();
      const mockClinic = [
        {
          id: 'clinic-123',
          razorpayAccountId: null,
          routeStatus: 'INACTIVE',
        },
      ];
      const mockAppointment = { id: 'apt-123', patientId: 'user-123' };

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockClinic)
      );

      (AppointmentService.createAppointment as jest.Mock).mockResolvedValue(
        mockAppointment
      );

      await PatientService.bookPatientAppointment('user-123', {
        doctorId: 'doctor-123',
        clinicId: 'clinic-123',
        clinicServiceId: 'service-123',
        appointmentDate: '2026-06-20',
        appointmentTime: '10:00 AM',
        patientId: 'user-123',
        paymentMode: 'Pay Later',
        price: '500',
      });

      expect(AppointmentService.createAppointment).toHaveBeenCalledWith(
        'user-123',
        'clinic-123',
        expect.objectContaining({
          paymentMode: 'Pay Later',
          paymentStatus: 'Pending',
        }),
        'user-123'
      );
    });
    // Manual token selection has been removed from patientBookingSchema
  });

  describe('verifyAppointmentPayment', () => {
    it('should verify payment successfully and confirm the appointment', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Pending',
        },
      ];
      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppointment)) // for verifyAppointmentPayment select
        .mockReturnValueOnce(createChain(mockAppointment)); // for confirmPaymentAndAppoint select

      (verifyRazorpayPayment as jest.Mock).mockReturnValue(true);

      // Mock transaction executer
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            update: jest.fn().mockImplementation(() => mockTx),
            set: jest.fn().mockImplementation(() => mockTx),
            where: jest.fn().mockImplementation(() => mockTx),
            insert: jest.fn().mockImplementation(() => mockTx),
            values: jest.fn().mockImplementation(() => mockTx),
            delete: jest.fn().mockImplementation(() => mockTx),
          };
          return await callback(mockTx);
        }
      );

      const result = await PatientService.verifyAppointmentPayment('user-123', {
        appointmentId: 'apt-123',
        orderId: 'order_123',
        paymentId: 'pay_123',
        signature: 'sig_123',
      });

      expect(verifyRazorpayPayment).toHaveBeenCalledWith(
        'order_123',
        'pay_123',
        'sig_123'
      );
      expect(result.success).toBe(true);
    });

    it('should throw 400 error on invalid signature', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Pending',
        },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppointment)
      );
      (verifyRazorpayPayment as jest.Mock).mockReturnValue(false);

      await expect(
        PatientService.verifyAppointmentPayment('user-123', {
          appointmentId: 'apt-123',
          orderId: 'order_123',
          paymentId: 'pay_123',
          signature: 'sig_123',
        })
      ).rejects.toThrow('Invalid payment signature');
    });
  });

  describe('confirmPaymentAndAppoint', () => {
    it('should process payment successfully', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Pending',
          price: '500',
          paymentStatus: 'Pending',
        },
      ];

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppointment)
      );

      const mockTx = {
        update: jest.fn().mockImplementation(() => mockTx),
        set: jest.fn().mockImplementation(() => mockTx),
        where: jest.fn().mockImplementation(() => mockTx),
        insert: jest.fn().mockImplementation(() => mockTx),
        values: jest.fn().mockImplementation(() => mockTx),
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback(mockTx);
        }
      );

      const result = await PatientService.confirmPaymentAndAppoint(
        'apt-123',
        'pay_123',
        'user-123'
      );
      expect(result.success).toBe(true);
    });

    it('should return already paid if paymentStatus is Paid', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Pending',
          price: '500',
          paymentStatus: 'Paid',
        },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppointment)
      );

      const result = await PatientService.confirmPaymentAndAppoint(
        'apt-123',
        'pay_123',
        'user-123'
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Already paid');
    });
  });

  describe('handlePaymentFailure', () => {
    it('should cancel appointment successfully on failure', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          appointmentStatus: 'Pending',
        },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppointment)
      );

      const mockTx = {
        update: jest.fn().mockImplementation(() => mockTx),
        set: jest.fn().mockImplementation(() => mockTx),
        where: jest.fn().mockImplementation(() => mockTx),
        insert: jest.fn().mockImplementation(() => mockTx),
        values: jest.fn().mockImplementation(() => mockTx),
      };

      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return await callback(mockTx);
        }
      );

      const result = await PatientService.handlePaymentFailure(
        'apt-123',
        'pay_123',
        'user-123'
      );
      expect(result.success).toBe(true);
    });

    it('should return already cancelled if status is Cancelled', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          appointmentStatus: 'Cancelled',
        },
      ];
      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockAppointment)
      );

      const result = await PatientService.handlePaymentFailure(
        'apt-123',
        'pay_123',
        'user-123'
      );
      expect(result.message).toBe('Already cancelled');
    });
  });

  describe('PatientService.toggleDoctorFavorite Unit Tests', () => {
    const createInsertChain = () => {
      const chain: any = {};
      const methods = ['values'];
      methods.forEach((method) => {
        chain[method] = jest.fn().mockImplementation(() => chain);
      });
      chain.then = (resolve: any) => resolve(chain);
      return chain;
    };

    beforeEach(() => {
      (database.insert as jest.Mock).mockReturnValue(createInsertChain());
    });

    it('should add to favorites if not already favorited', async () => {
      const mockDoctor = [{ id: 'doctor-1' }];
      const mockExisting: any[] = [];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockDoctor))
        .mockReturnValueOnce(createChain(mockExisting));

      const result = await PatientService.toggleDoctorFavorite(
        'patient-1',
        'doctor-1'
      );

      expect(result).toEqual({ isFavorite: true });
      expect(database.insert).toHaveBeenCalled();
    });

    it('should remove from favorites if already favorited', async () => {
      const mockDoctor = [{ id: 'doctor-1' }];
      const mockExisting = [{ id: 'fav-1' }];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockDoctor))
        .mockReturnValueOnce(createChain(mockExisting));

      const result = await PatientService.toggleDoctorFavorite(
        'patient-1',
        'doctor-1'
      );

      expect(result).toEqual({ isFavorite: false });
      expect(database.delete).toHaveBeenCalled();
    });

    it('should throw 404 error if doctor does not exist', async () => {
      const mockDoctor: any[] = [];

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockDoctor)
      );

      await expect(
        PatientService.toggleDoctorFavorite('patient-1', 'non-existent-doctor')
      ).rejects.toThrow('Doctor not found or inactive');
    });
  });

  describe('PatientService.getPatientAppointmentDetail Unit Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should retrieve appointment details including review if it exists', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'user-123',
          clinicId: 'clinic-123',
        },
      ];
      const mockDetails = {
        id: 'user-123',
        name: 'John Doe',
        appointment: {
          id: 'apt-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Completed',
        },
        review: {
          id: 'rev-123',
          rating: 5,
          reviewText: 'Great!',
        },
      };

      const mockClinicInfo = [
        {
          id: 'clinic-123',
          clinicName: 'Healthy Care',
          clinicAddress: '123 Main Road',
          clinicPhone: '0222640001',
          clinicLogo: 'logo.png',
          latitude: 19.076,
          longitude: 72.877,
          onlineBookingEnabledAssign: true,
          onlineBookingEnabledSettings: true,
          maxAdvanceBookingDays: 7,
          payOnlineEnabled: true,
          payAtClinicEnabled: false,
          showClinicNumber: true,
        },
      ];

      const mockLabReports = [
        {
          id: 'lab-order-123',
          uniqueTestId: 'TEST-001',
          reportStatus: 'Completed',
          paymentStatus: 'paid',
          price: 100,
          reportPdf: 'report.pdf',
          workflowStatus: 'Verified',
          sampleStatus: 'Collected',
          createdAt: new Date(),
          updatedAt: new Date(),
          test: {
            id: 'test-123',
            name: 'Blood Test',
            category: 'General',
          },
        },
      ];

      const mockLabResults = [
        {
          id: 'result-123',
          appointmentTestId: 'lab-order-123',
          status: 'Completed',
          remarks: 'All good',
          verifiedAt: new Date(),
          createdAt: new Date(),
        },
      ];

      const mockLabResultValues = [
        {
          id: 'val-123',
          resultId: 'result-123',
          parameterId: 'param-123',
          parameterName: 'WBC',
          value: '5000',
          unit: 'cumm',
          referenceRange: '4000-11000',
          flag: 'Normal',
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppointment))
        .mockReturnValueOnce(createChain(mockClinicInfo))
        .mockReturnValueOnce(createChain(mockLabReports))
        .mockReturnValueOnce(createChain(mockLabResults))
        .mockReturnValueOnce(createChain(mockLabResultValues))
        .mockReturnValueOnce(createChain([]));
      (AppointmentService.getAppointment as jest.Mock).mockResolvedValue(
        mockDetails
      );

      const result = await PatientService.getPatientAppointmentDetail(
        'user-123',
        'apt-123'
      );

      expect(result).toBeDefined();
      expect(result.appointment.clinicId).toBe('clinic-123');
      expect(result.clinic.latitude).toBe(19.076);
      expect(result.clinic.longitude).toBe(72.877);
      expect(result.review).toEqual({
        id: 'rev-123',
        rating: 5,
        reviewText: 'Great!',
      });
      expect(result.labReports).toBeDefined();
      expect(result.labReports.length).toBe(1);
      expect(result.labReports[0].id).toBe('lab-order-123');
      expect(result.labReports[0].result).toBeDefined();
      expect(result.labReports[0].result.id).toBe('result-123');
      expect(result.labReports[0].result.values[0].value).toBe('5000');
      expect(result.primaryPatient).toBeNull();
    });

    it('should retrieve appointment details including primaryPatient if patient is a family member', async () => {
      const mockAppointment = [
        {
          id: 'apt-123',
          patientId: 'dependent-123',
          clinicId: 'clinic-123',
        },
      ];
      const mockDetails = {
        id: 'dependent-123',
        name: 'Jane Doe',
        appointment: {
          id: 'apt-123',
          clinicId: 'clinic-123',
          appointmentStatus: 'Upcoming',
        },
      };

      const mockClinicInfo = [
        {
          id: 'clinic-123',
          clinicName: 'Healthy Care',
          clinicAddress: '123 Main Road',
          clinicPhone: '0222640001',
          clinicLogo: 'logo.png',
          onlineBookingEnabledAssign: true,
          onlineBookingEnabledSettings: true,
          maxAdvanceBookingDays: 7,
          payOnlineEnabled: true,
          payAtClinicEnabled: false,
          showClinicNumber: true,
        },
      ];

      const mockPrimaryLink = [
        {
          id: 'primary-123',
          name: 'John Doe',
        },
      ];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockAppointment))
        .mockReturnValueOnce(createChain([{ id: 'link-1' }])) // Ownership link verification
        .mockReturnValueOnce(createChain(mockClinicInfo))
        .mockReturnValueOnce(createChain([])) // Empty lab reports
        .mockReturnValueOnce(createChain(mockPrimaryLink)); // Family link query
      (AppointmentService.getAppointment as jest.Mock).mockResolvedValue(
        mockDetails
      );

      const result = await PatientService.getPatientAppointmentDetail(
        'user-123', // requesting user (primary user)
        'apt-123'
      );

      expect(result).toBeDefined();
      expect(result.primaryPatient).toEqual({
        id: 'primary-123',
        name: 'John Doe',
      });
    });
  });

  describe('PatientService.listPatientAppointments Unit Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should query with upcomingOnly filter and exclude past appointments', async () => {
      const mockAppointments = [
        {
          id: 'apt-1',
          appointmentDate: new Date(),
          appointmentTime: '10:00 AM',
          appointmentStatus: 'Confirmed',
        },
      ];

      (database.select as jest.Mock).mockReturnValue(
        createChain(mockAppointments)
      );

      const result = await PatientService.listPatientAppointments(
        'user-123',
        'patient-123',
        {
          pageNumber: '1',
          pageSize: '10',
          upcomingOnly: true,
        }
      );

      expect(result).toBeDefined();
    });

    it('should query with pastOnly filter and exclude future appointments', async () => {
      const mockAppointments = [
        {
          id: 'apt-2',
          appointmentDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          appointmentTime: '10:00 AM',
          appointmentStatus: 'Confirmed',
        },
      ];

      (database.select as jest.Mock).mockReturnValue(
        createChain(mockAppointments)
      );

      const result = await PatientService.listPatientAppointments(
        'user-123',
        'patient-123',
        {
          pageNumber: '1',
          pageSize: '10',
          pastOnly: true,
        }
      );

      expect(result).toBeDefined();
    });

    it('should apply asc order on appointmentDate and appointmentTime when sortBy is appointmentDate and sortOrder is asc', async () => {
      const mockAppointments = [
        {
          id: 'apt-1',
          appointmentDate: new Date(),
          appointmentTime: '10:00 AM',
          appointmentStatus: 'Confirmed',
        },
      ];

      const chain = createChain(mockAppointments);
      (database.select as jest.Mock).mockReturnValue(chain);

      await PatientService.listPatientAppointments('user-123', 'patient-123', {
        pageNumber: '1',
        pageSize: '10',
        sortBy: 'appointmentDate',
        sortOrder: 'asc',
      });

      expect(database.select).toHaveBeenCalled();
      expect(chain.orderBy).toHaveBeenCalled();
    });

    it('should apply desc order on createdAt when sortBy is createdAt and sortOrder is desc', async () => {
      const mockAppointments = [
        {
          id: 'apt-1',
          appointmentDate: new Date(),
          appointmentTime: '10:00 AM',
          appointmentStatus: 'Confirmed',
        },
      ];

      const chain = createChain(mockAppointments);
      (database.select as jest.Mock).mockReturnValue(chain);

      await PatientService.listPatientAppointments('user-123', 'patient-123', {
        pageNumber: '1',
        pageSize: '10',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(database.select).toHaveBeenCalled();
      expect(chain.orderBy).toHaveBeenCalled();
    });
  });

  describe('PatientService.listFavoriteDoctors Unit Tests', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const createChain = (finalValue: any) => {
      const chain: any = {};
      const methods = [
        'from',
        'leftJoin',
        'innerJoin',
        'where',
        '$dynamic',
        'orderBy',
        'limit',
        'offset',
      ];
      methods.forEach((method) => {
        chain[method] = jest.fn().mockImplementation(() => chain);
      });
      chain.then = (resolve: any) => resolve(finalValue);
      return chain;
    };

    it('should successfully retrieve favorite doctors with pagination info and nextAvailableSlot', async () => {
      const mockFavorite = [{ doctorId: 'doctor-1' }];
      const mockCount = [{ count: 1 }];
      const mockProfile = {
        id: 'doctor-1',
        name: 'Dr. John Doe',
        isFavorite: true,
        clinics: [{ id: 'clinic-1' }, { id: 'clinic-2' }],
      };
      const mockSlot1 = {
        date: '2026-06-21',
        time: '11:00 AM',
        endTime: '11:30 AM',
        start: '2026-06-21T11:00:00',
        end: '2026-06-21T11:30:00',
      };
      const mockSlot2 = {
        date: '2026-06-20',
        time: '10:00 AM',
        endTime: '10:30 AM',
        start: '2026-06-20T10:00:00',
        end: '2026-06-20T10:30:00',
      };

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockFavorite))
        .mockReturnValueOnce(createChain(mockCount));

      const spyProfile = jest
        .spyOn(PatientService, 'getDoctorPublicProfile')
        .mockResolvedValue(mockProfile as any);

      const spySlot = jest
        .spyOn(PatientService, 'getDoctorNextAvailableSlot')
        .mockImplementation(async (doctorId, clinicId) => {
          if (clinicId === 'clinic-1') return mockSlot1;
          if (clinicId === 'clinic-2') return mockSlot2;
          return null;
        });

      const result = await PatientService.listFavoriteDoctors('patient-1', {
        pageNumber: '1',
        pageSize: '10',
      });

      expect(result.data).toEqual([
        {
          ...mockProfile,
          nextAvailableSlot: mockSlot2, // clinic-2 has the earlier slot
        },
      ]);
      expect(result.pagination).toEqual({
        totalRecords: 1,
        totalPages: 1,
        pageNumber: 1,
        pageSize: 10,
      });
      expect(spyProfile).toHaveBeenCalledWith('doctor-1', 'patient-1');
      expect(spySlot).toHaveBeenCalledWith(
        'doctor-1',
        'clinic-1',
        expect.any(String)
      );
      expect(spySlot).toHaveBeenCalledWith(
        'doctor-1',
        'clinic-2',
        expect.any(String)
      );
    });

    it('should return empty list when there are no favorites', async () => {
      const mockFavorite: any[] = [];
      const mockCount = [{ count: 0 }];

      (database.select as jest.Mock)
        .mockReturnValueOnce(createChain(mockFavorite))
        .mockReturnValueOnce(createChain(mockCount));

      const result = await PatientService.listFavoriteDoctors('patient-1', {
        pageNumber: '1',
        pageSize: '10',
      });

      expect(result.data).toEqual([]);
      expect(result.pagination).toEqual({
        totalRecords: 0,
        totalPages: 0,
        pageNumber: 1,
        pageSize: 10,
      });
    });
  });

  describe('PatientService.uploadPatientLabReport Unit Tests', () => {
    it('should throw 404 error if lab order is not found', async () => {
      // Mock transaction executer returning empty order
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            select: jest.fn().mockImplementation(() => createChain([])),
          };
          return await callback(mockTx);
        }
      );

      await expect(
        PatientService.uploadPatientLabReport(
          'user-123',
          'order-123-uuid',
          'http://s3-report.pdf'
        )
      ).rejects.toThrow('Lab order not found');
    });

    it('should throw 403 error if patientId does not match userId and family link does not exist', async () => {
      const mockOrder = [
        {
          order: {
            id: 'order-123-uuid',
            patientId: 'patient-456-uuid',
            clinicId: 'clinic-123-uuid',
            doctorId: 'doctor-123-uuid',
            appointmentId: 'apt-123-uuid',
            reportPdf: null,
          },
          testName: 'CBC',
        },
      ];

      // Mock transaction executer returning order on first select, and empty array on second select
      let selectCallCount = 0;
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            select: jest.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) {
                return createChain(mockOrder);
              }
              return createChain([]);
            }),
          };
          return await callback(mockTx);
        }
      );

      await expect(
        PatientService.uploadPatientLabReport(
          'user-123',
          'order-123-uuid',
          'http://s3-report.pdf'
        )
      ).rejects.toThrow('Access denied.');
    });

    it('should successfully upload report PDF and mark order as completed and external', async () => {
      const mockOrder = [
        {
          order: {
            id: 'order-123-uuid',
            patientId: 'patient-123-uuid',
            clinicId: 'clinic-123-uuid',
            doctorId: 'doctor-123-uuid',
            appointmentId: 'apt-123-uuid',
            reportPdf: null,
          },
          testName: 'CBC',
        },
      ];

      const mockUpdatedOrder = {
        id: 'order-123-uuid',
        patientId: 'patient-123-uuid',
        reportPdf: 'http://s3-report.pdf',
        reportStatus: 'Completed',
        isExternalLabReport: true,
      };

      const mockPatientUser = [
        { id: 'patient-123-uuid', name: 'Patient One', userType: 'Patient' },
      ];

      // Mock transaction execution
      let selectCallCount = 0;
      (database.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          const mockTx = {
            select: jest.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) {
                return createChain(mockOrder);
              }
              return createChain(mockPatientUser);
            }),
            update: jest.fn().mockImplementation(() => {
              const mockUpdateChain = {
                set: jest.fn().mockImplementation(() => mockUpdateChain),
                where: jest.fn().mockImplementation(() => mockUpdateChain),
                returning: jest
                  .fn()
                  .mockImplementation(() => [mockUpdatedOrder]),
              };
              return mockUpdateChain;
            }),
            insert: jest.fn().mockImplementation(() => {
              const mockInsertChain = {
                values: jest.fn().mockImplementation(() => mockInsertChain),
                returning: jest.fn().mockImplementation(() => []),
              };
              return mockInsertChain;
            }),
          };
          return await callback(mockTx);
        }
      );

      const result = await PatientService.uploadPatientLabReport(
        'patient-123-uuid',
        'order-123-uuid',
        'http://s3-report.pdf'
      );

      expect(result).toEqual(mockUpdatedOrder);
    });
  });

  describe('PatientService.rescheduleAppointment Unit Tests', () => {
    const createChain = (finalValue: any) => {
      const chain: any = {};
      const methods = ['select', 'from', 'where', 'limit', 'insert', 'values'];
      methods.forEach((method) => {
        chain[method] = jest.fn().mockImplementation(() => chain);
      });
      chain.then = (resolve: any) => resolve(finalValue);
      return chain;
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should fail if the appointment does not exist', async () => {
      (database.select as jest.Mock).mockReturnValue(createChain([]));

      await expect(
        PatientService.rescheduleAppointment('user-1', 'appt-1', {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
        })
      ).rejects.toThrow('Appointment not found.');
    });

    it('should fail if the patient does not own the appointment and is not linked', async () => {
      const mockAppt = {
        id: 'appt-1',
        patientId: 'user-2',
        clinicId: 'clinic-1',
        appointmentStatus: 'Confirmed',
      };
      const apptChain = createChain([mockAppt]);
      const linkChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(linkChain);

      await expect(
        PatientService.rescheduleAppointment('user-1', 'appt-1', {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
        })
      ).rejects.toThrow('Access denied');
    });

    it('should fail if the appointment is in a terminal status', async () => {
      const mockAppt = {
        id: 'appt-1',
        patientId: 'user-1',
        clinicId: 'clinic-1',
        appointmentStatus: 'Completed',
      };
      (database.select as jest.Mock).mockReturnValue(createChain([mockAppt]));

      await expect(
        PatientService.rescheduleAppointment('user-1', 'appt-1', {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
        })
      ).rejects.toThrow(
        "Appointment in state 'Completed' cannot be rescheduled"
      );
    });

    it('should successfully reschedule appointment if ownership and policies are valid', async () => {
      const mockAppt = {
        id: 'appt-1',
        patientId: 'user-1',
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        appointmentStatus: 'Confirmed',
      };
      const apptChain = createChain([mockAppt]);
      const availChain = createChain([]);
      const insertChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(availChain);
      (database.insert as jest.Mock).mockReturnValue(insertChain);
      (AppointmentService.updateAppointment as jest.Mock).mockResolvedValue({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
      });

      const result = await PatientService.rescheduleAppointment(
        'user-1',
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          comments: 'Need a different time slot',
        }
      );

      expect(database.select).toHaveBeenCalled();
      expect(AppointmentService.updateAppointment).toHaveBeenCalledWith(
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          reasionForReSchedule: 'Need a different time slot',
          appointmentStatus: 'Pending',
          tokenNo: undefined,
        },
        'user-1',
        'Patient'
      );
      expect(database.insert).toHaveBeenCalled();
      expect(result).toEqual({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
      });
    });

    it('should successfully reschedule a token-based appointment and assign the next available token', async () => {
      const mockAppt = {
        id: 'appt-1',
        patientId: 'user-1',
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        appointmentStatus: 'Confirmed',
      };
      const mockAvailability = {
        noOfPatients: 10,
      };
      const mockBookedTokens = [{ tokenNo: 1 }, { tokenNo: 2 }];

      const apptChain = createChain([mockAppt]);
      const availChain = createChain([mockAvailability]);
      const bookedChain = createChain(mockBookedTokens);
      const insertChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(availChain)
        .mockReturnValueOnce(bookedChain);
      (database.insert as jest.Mock).mockReturnValue(insertChain);
      (AppointmentService.updateAppointment as jest.Mock).mockResolvedValue({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
        tokenNo: 3,
      });

      const result = await PatientService.rescheduleAppointment(
        'user-1',
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          comments: 'Need a different day',
        }
      );

      expect(AppointmentService.updateAppointment).toHaveBeenCalledWith(
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          reasionForReSchedule: 'Need a different day',
          appointmentStatus: 'Pending',
          tokenNo: 3,
        },
        'user-1',
        'Patient'
      );
      expect(result).toEqual({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
        tokenNo: 3,
      });
    });

    it('should successfully reschedule gap-filling token-based appointment automatically allocating the first free token', async () => {
      const mockAppt = {
        id: 'appt-1',
        patientId: 'user-1',
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        appointmentStatus: 'Confirmed',
      };
      const mockAvailability = {
        noOfPatients: 10,
      };
      // Gaps exist in the tokens: token 3 is free while 1, 2, 4 are booked
      const mockBookedTokens = [{ tokenNo: 1 }, { tokenNo: 2 }, { tokenNo: 4 }];

      const apptChain = createChain([mockAppt]);
      const availChain = createChain([mockAvailability]);
      const bookedChain = createChain(mockBookedTokens);
      const insertChain = createChain([]);

      (database.select as jest.Mock)
        .mockReturnValueOnce(apptChain)
        .mockReturnValueOnce(availChain)
        .mockReturnValueOnce(bookedChain);
      (database.insert as jest.Mock).mockReturnValue(insertChain);
      (AppointmentService.updateAppointment as jest.Mock).mockResolvedValue({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
        tokenNo: 3,
      });

      const result = await PatientService.rescheduleAppointment(
        'user-1',
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          comments: 'Check gap-filling',
        }
      );

      expect(AppointmentService.updateAppointment).toHaveBeenCalledWith(
        'appt-1',
        {
          appointmentDate: '2026-08-16',
          appointmentTime: '10:00',
          reasionForReSchedule: 'Check gap-filling',
          appointmentStatus: 'Pending',
          tokenNo: 3,
        },
        'user-1',
        'Patient'
      );
      expect(result).toEqual({
        id: 'appt-1',
        appointmentDate: new Date('2026-08-16'),
        appointmentTime: '10:00',
        tokenNo: 3,
      });
    });
  });

  describe('PatientService.getPatientAppointmentInvoiceData Unit Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should compute billing details correctly with convenience fee and GST', async () => {
      const mockRecord = [
        {
          appointment: {
            id: 'apt-inv-1',
            appointmentDate: new Date('2026-09-03'),
            appointmentTime: '10:00 AM',
            appointmentType: 'Consultation',
            tokenNo: 1,
          },
          service: {
            id: 'svc-1',
            serviceName: 'General Consultation',
            price: '200.00',
            currency: 'INR',
          },
          payment: {
            id: 'pay-uuid-1234-5678',
            paymentMode: 'Online',
            paymentStatus: 'Paid',
            price: '204.72',
            primaryServicePrice: '200.00',
            convenienceFee: '4.00',
            gstAmount: '0.72',
            platformCommission: '10.00',
            pgFee: '4.00',
            transactionId: 'txn_12345',
            createdAt: new Date('2026-09-03T10:00:00Z'),
          },
          clinic: {
            clinicName: 'MediSetu Clinic',
            Tagline: 'Caring for you',
            clinicAddress: '123 Health Ave',
            clinicPhone: '9876543210',
            City: 'Mumbai',
            State: 'Maharashtra',
            ZipCode: '400001',
            clinicLogo: 'logo.png',
          },
          patient: {
            name: 'Jane Doe',
            mobile: '9876543210',
          },
          patientProfile: {
            gender: 'Female',
            age: 30,
          },
          doctor: {
            name: 'Dr. Smith',
          },
          doctorProfessional: {
            speciality: 'Cardiologist',
            licenseNumber: 'DOC12345',
          },
        },
      ];

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockRecord)
      );

      const invoice =
        await PatientService.getPatientAppointmentInvoiceData('apt-inv-1');

      expect(invoice).toBeDefined();
      expect(invoice.billing.consultationFee).toBe(200);
      expect(invoice.billing.platformFee).toBe(4);
      expect(invoice.billing.platformFeeGst).toBe(0.72);
      expect(invoice.billing.tax).toBe(0.72);
      expect(invoice.billing.totalAmount).toBe(204.72);
      expect(invoice.billing.subtotal).toBe(200);
    });

    it('should compute totalAmount dynamically if payment.price was base price', async () => {
      const mockRecord = [
        {
          appointment: {
            id: 'apt-inv-2',
            appointmentDate: new Date('2026-09-03'),
            appointmentTime: '11:00 AM',
            appointmentType: 'Consultation',
            tokenNo: 2,
          },
          service: null,
          payment: {
            id: 'pay-uuid-5678',
            paymentMode: 'Online',
            paymentStatus: 'Paid',
            price: '200.00',
            primaryServicePrice: '200.00',
            convenienceFee: '4.00',
            gstAmount: '0.72',
            platformCommission: '10.00',
            pgFee: '4.00',
            transactionId: 'txn_67890',
            createdAt: new Date('2026-09-03T11:00:00Z'),
          },
          clinic: {
            clinicName: 'MediSetu Clinic',
            Tagline: null,
            clinicAddress: null,
            clinicPhone: null,
            City: null,
            State: null,
            ZipCode: null,
            clinicLogo: null,
          },
          patient: {
            name: 'John Doe',
            mobile: '9123456780',
          },
          patientProfile: null,
          doctor: {
            name: 'Dr. Adams',
          },
          doctorProfessional: null,
        },
      ];

      (database.select as jest.Mock).mockReturnValueOnce(
        createChain(mockRecord)
      );

      const invoice =
        await PatientService.getPatientAppointmentInvoiceData('apt-inv-2');

      expect(invoice).toBeDefined();
      expect(invoice.billing.consultationFee).toBe(200);
      expect(invoice.billing.platformFee).toBe(4);
      expect(invoice.billing.platformFeeGst).toBe(0.72);
      expect(invoice.billing.totalAmount).toBe(204.72);
    });
  });

  describe('patientBookingSchema & paymentGateway resolution', () => {
    it('should parse paymentMode as Online and preserve paymentGateway when provided', () => {
      const parsed = patientBookingSchema.parse({
        doctorId: '123e4567-e89b-12d3-a456-426614174000',
        clinicId: '123e4567-e89b-12d3-a456-426614174001',
        clinicServiceId: '123e4567-e89b-12d3-a456-426614174002',
        appointmentDate: '2026-09-30',
        patientId: '123e4567-e89b-12d3-a456-426614174003',
        paymentMode: 'razorpay',
        paymentGateway: 'cashfree',
      });

      expect(parsed.paymentMode).toBe('Online');
      expect(parsed.paymentGateway).toBe('cashfree');
    });
  });
});
