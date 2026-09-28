// Unit tests for AppointmentDetailsService — GET /appointments/:appointmentId/details.
// Covers access rules, which fields are selected, and the covered-visit lookup.

const selectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

jest.mock('../../../utils/logger');

jest.mock('../../permissions/services/staffScope.service', () => ({
  StaffScopeService: { assertDoctorAllowed: jest.fn() },
}));

jest.mock('../services/appointmentMultipleService.service', () => ({
  AppointmentMultipleServiceService: { listByAppointmentId: jest.fn() },
}));

import { HttpError } from '../../../middlewear/errorHandler';
import { StaffScopeService } from '../../permissions/services/staffScope.service';
import { AppointmentDetailsService } from '../services/appointmentDetails.service';
import { AppointmentMultipleServiceService } from '../services/appointmentMultipleService.service';

type Call = { method: string; args: any[] };

const APPOINTMENT = 'appt-1';
const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const PATIENT = 'patient-1';

const receptionist = {
  id: 'rec-1',
  userType: 'Receptionist',
  clinicId: CLINIC,
};
const admin = { id: 'admin-1', userType: 'Admin', clinicId: CLINIC };
const ownDoctor = { id: DOCTOR, userType: 'Doctor' };

const scopeRow = { doctorId: DOCTOR, clinicId: CLINIC };

/** Chainable query stub: records every call and resolves to `rows` when awaited. */
const queryReturning = (rows: unknown) => {
  const calls: Call[] = [];
  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve(rows);
        }
        if (prop === 'calls') return calls;
        return (...args: any[]) => {
          calls.push({ method: String(prop), args });
          return chain;
        };
      },
    }
  );
  return chain;
};

/** One result per select() call, in call order; any further call returns []. */
const queueSelects = (...results: unknown[]) => {
  const chains = results.map(queryReturning);
  chains.forEach((chain) => selectMock.mockImplementationOnce(() => chain));
  return chains;
};

const argsOf = (chain: any, method: string) =>
  (chain.calls as Call[]).filter((c) => c.method === method).map((c) => c.args);

/** True when a Drizzle condition tree binds `needle` as a value. */
const bindsValue = (node: any, needle: unknown, depth = 0): boolean => {
  if (depth > 10 || node == null) return false;
  if (node === needle) return true;
  if (Array.isArray(node)) {
    return node.some((item) => bindsValue(item, needle, depth + 1));
  }
  if (typeof node !== 'object') return false;
  return ['value', 'queryChunks', 'left', 'right', 'conditions'].some((key) =>
    bindsValue(node[key], needle, depth + 1)
  );
};

const selectedFields = (callIndex: number) =>
  selectMock.mock.calls[callIndex][0] as Record<string, any>;

const appointmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: APPOINTMENT,
  patientId: PATIENT,
  doctorId: DOCTOR,
  clinicId: CLINIC,
  appointmentDate: new Date('2026-09-10T06:00:00.000Z'),
  appointmentTime: '10:00',
  appointmentType: 'Consultation',
  appointmentNotes: null,
  appointmentStatus: 'Confirmed',
  reReasonForCancellation: null,
  reasionForReSchedule: null,
  tokenNo: null,
  sessionIndex: null,
  clinicServiceId: null,
  vitals: null,
  referrals: null,
  consentNotes: null,
  consentFile: null,
  commonSymptoms: [],
  clinicSymptomIds: [],
  bookingSource: 'walk_in',
  dayStartTime: null,
  dayEndTime: null,
  paymentMode: 'Cash',
  paymentStatus: 'Paid',
  price: '500.00',
  primaryServicePrice: '500.00',
  paymentNotes: null,
  refundMode: null,
  refundedAmount: null,
  refundNotes: null,
  ...overrides,
});

const detailsRow = (appointmentOverrides: Record<string, unknown> = {}) => ({
  patient: {
    id: PATIENT,
    name: 'Raj',
    mobile: '9999999999',
    email: null,
    gender: 'Male',
    age: 36,
    dob: null,
    profileImage: null,
    address: '5 Park Rd, Indore, Madhya Pradesh',
  },
  appointment: appointmentRow(appointmentOverrides),
  doctor: {
    id: DOCTOR,
    name: 'Dr. Sharma',
    email: 'doctor@clinic.test',
    mobile: '8888888888',
    speciality: 'General Physician',
    profileImage: null,
  },
});

const getDetails = (user: {
  id: string;
  userType: string;
  clinicId?: string;
}) => AppointmentDetailsService.getDetails(APPOINTMENT, user);

const failureOf = (user: { id: string; userType: string; clinicId?: string }) =>
  getDetails(user).catch(
    (error: unknown) => error as HttpError
  ) as Promise<HttpError>;

describe('AppointmentDetailsService.getDetails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectMock.mockReset();
    selectMock.mockImplementation(() => queryReturning([]));
    (StaffScopeService.assertDoctorAllowed as jest.Mock).mockResolvedValue(
      undefined
    );
    (
      AppointmentMultipleServiceService.listByAppointmentId as jest.Mock
    ).mockResolvedValue([]);
  });

  describe('access', () => {
    it('returns 404 when the appointment does not exist', async () => {
      queueSelects([]);

      const error = await failureOf(receptionist);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe('Appointment not found');
      expect(selectMock).toHaveBeenCalledTimes(1);
      expect(StaffScopeService.assertDoctorAllowed).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a receptionist from another clinic',
        { id: 'rec-2', userType: 'Receptionist', clinicId: 'clinic-2' },
      ],
      [
        'an admin from another clinic',
        { id: 'admin-2', userType: 'Admin', clinicId: 'clinic-2' },
      ],
      [
        'an admin with no clinic in the token',
        { id: 'admin-3', userType: 'Admin' },
      ],
      [
        'a doctor who is not on the appointment',
        { id: 'doctor-2', userType: 'Doctor', clinicId: CLINIC },
      ],
      [
        'a role without appointment access',
        { id: 'pharm-1', userType: 'Pharmacist', clinicId: CLINIC },
      ],
    ])('refuses %s with 403 before loading details', async (_label, user) => {
      queueSelects([scopeRow]);

      const error = await failureOf(user);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe(
        'You do not have permission to access this appointment'
      );
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('allows a receptionist of the same clinic and checks staff scope with the token clinic', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await expect(getDetails(receptionist)).resolves.toBeDefined();

      expect(StaffScopeService.assertDoctorAllowed).toHaveBeenCalledWith(
        receptionist,
        CLINIC,
        DOCTOR
      );
    });

    it('allows an admin of the same clinic', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await expect(getDetails(admin)).resolves.toBeDefined();
    });

    it('allows the appointment own doctor without a clinic scope check', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await expect(getDetails(ownDoctor)).resolves.toBeDefined();

      expect(StaffScopeService.assertDoctorAllowed).not.toHaveBeenCalled();
    });

    it('stops when staff scope rejects the doctor', async () => {
      queueSelects([scopeRow]);
      (
        StaffScopeService.assertDoctorAllowed as jest.Mock
      ).mockRejectedValueOnce(
        new HttpError(403, 'Not assigned to this doctor')
      );

      const error = await failureOf(receptionist);

      expect(error.message).toBe('Not assigned to this doctor');
      expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the details row is missing after access passes', async () => {
      queueSelects([scopeRow], []);

      const error = await failureOf(receptionist);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe('Appointment not found');
    });
  });

  describe('response', () => {
    it('nests the patient, drops clinicSymptomIds and includes add-on services', async () => {
      const row = detailsRow();
      const services = [
        { id: 'svc-row-1', serviceName: 'Dressing', price: 200 },
      ];
      queueSelects([scopeRow], [row]);
      (
        AppointmentMultipleServiceService.listByAppointmentId as jest.Mock
      ).mockResolvedValueOnce(services);

      const result = await getDetails(receptionist);

      expect(result.patient).toEqual(row.patient);
      expect(result.doctor).toEqual(row.doctor);
      expect(result.appointment).not.toHaveProperty('clinicSymptomIds');
      expect(result.appointment.coveredBy).toBeNull();
      expect(result.additionalServices).toEqual(services);
      expect(result.manualPrescription).toBeNull();
      expect(result.clinicService).toBeNull();
      expect(result.symptoms).toEqual([]);
      expect(
        AppointmentMultipleServiceService.listByAppointmentId
      ).toHaveBeenCalledWith(APPOINTMENT);
    });

    it('selects only the patient fields the page reads, with one address line', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await getDetails(receptionist);

      const fields = selectedFields(1);
      expect(Object.keys(fields)).toEqual(['patient', 'appointment', 'doctor']);
      expect(Object.keys(fields.patient).sort()).toEqual(
        [
          'address',
          'age',
          'dob',
          'email',
          'gender',
          'id',
          'mobile',
          'name',
          'profileImage',
        ].sort()
      );
    });

    it('never selects the payment gateway payload or split address fields', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await getDetails(receptionist);

      const fields = selectedFields(1);
      for (const hidden of [
        'gatewayResponse',
        'transactionId',
        'gatewayOrderId',
      ]) {
        expect(fields.appointment).not.toHaveProperty(hidden);
      }
      for (const hidden of [
        'alternateMobile',
        'city',
        'state',
        'zipCode',
        'status',
      ]) {
        expect(fields.patient).not.toHaveProperty(hidden);
      }
    });

    it('filters both the scope and the details query by appointment id', async () => {
      const [scopeQuery, detailsQuery] = queueSelects(
        [scopeRow],
        [detailsRow()]
      );

      await getDetails(receptionist);

      expect(bindsValue(argsOf(scopeQuery, 'where'), APPOINTMENT)).toBe(true);
      expect(bindsValue(argsOf(detailsQuery, 'where'), APPOINTMENT)).toBe(true);
    });

    it('skips the service and symptom lookups when the appointment has none', async () => {
      queueSelects([scopeRow], [detailsRow()]);

      await getDetails(receptionist);

      // scope + details + manual prescription only
      expect(selectMock).toHaveBeenCalledTimes(3);
    });

    it('loads the clinic service and symptom names when referenced', async () => {
      const service = {
        id: 'svc-1',
        serviceName: 'General consultation',
        price: 500,
        currency: 'INR',
        durationDays: 10,
        additionalServices: '',
      };
      const symptoms = [{ id: 'sym-1', name: 'Fever' }];
      const chains = queueSelects(
        [scopeRow],
        [detailsRow({ clinicServiceId: 'svc-1', clinicSymptomIds: ['sym-1'] })],
        [],
        [service],
        symptoms
      );

      const result = await getDetails(receptionist);

      expect(result.clinicService).toEqual(service);
      expect(result.symptoms).toEqual(symptoms);
      expect(bindsValue(argsOf(chains[3], 'where'), 'svc-1')).toBe(true);
      expect(Object.keys(selectedFields(4)).sort()).toEqual(['id', 'name']);
    });

    it('returns the first manual prescription when one exists', async () => {
      const manual = {
        id: 'mp-1',
        doctorManualPrescription: 'https://files.test/rx.png',
      };
      queueSelects([scopeRow], [detailsRow()], [manual]);

      const result = await getDetails(receptionist);

      expect(result.manualPrescription).toEqual(manual);
    });
  });

  describe('coveredBy', () => {
    const coveredVisit = {
      paymentMode: null,
      paymentStatus: 'Already Paid',
      clinicServiceId: 'svc-1',
    };

    it('does not look for a covering visit when the appointment has its own payment', async () => {
      queueSelects(
        [scopeRow],
        [detailsRow({ clinicServiceId: 'svc-1' })],
        [],
        [{ durationDays: 10 }]
      );

      const result = await getDetails(receptionist);

      expect(result.appointment.coveredBy).toBeNull();
      // scope + details + manual prescription + service
      expect(selectMock).toHaveBeenCalledTimes(4);
    });

    it('finds the paid visit this one falls under and computes its validity', async () => {
      const payingVisit = {
        appointmentId: 'appt-0',
        appointmentDate: new Date('2026-09-05T06:00:00.000Z'),
        paymentMode: 'Cash',
        amount: '500.00',
      };
      const chains = queueSelects(
        [scopeRow],
        [detailsRow(coveredVisit)],
        [],
        [{ durationDays: 10 }],
        [payingVisit]
      );

      const result = await getDetails(receptionist);

      expect(result.appointment.coveredBy).toEqual({
        ...payingVisit,
        validTill: '2026-09-15',
      });
      const where = argsOf(chains[4], 'where');
      for (const value of [CLINIC, PATIENT, DOCTOR, 'svc-1', APPOINTMENT]) {
        expect(bindsValue(where, value)).toBe(true);
      }
    });

    it('leaves validTill null when the service has no duration', async () => {
      queueSelects(
        [scopeRow],
        [detailsRow(coveredVisit)],
        [],
        [{ durationDays: null }],
        [
          {
            appointmentId: 'appt-0',
            appointmentDate: new Date('2026-09-05T06:00:00.000Z'),
            paymentMode: 'Cash',
            amount: '500.00',
          },
        ]
      );

      const result = await getDetails(receptionist);

      expect(result.appointment.coveredBy).toMatchObject({ validTill: null });
    });

    it('returns null when no earlier paid visit exists', async () => {
      queueSelects(
        [scopeRow],
        [detailsRow(coveredVisit)],
        [],
        [{ durationDays: 10 }],
        []
      );

      const result = await getDetails(receptionist);

      expect(result.appointment.coveredBy).toBeNull();
    });
  });
});
