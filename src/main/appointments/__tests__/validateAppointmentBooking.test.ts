import { AppointmentService } from '../services/appointment.service';
import { AppointmentModel } from '../models/appointment.model';
import { UserModel } from '../../users/models/user.model';
import {
  ClinicAvailability,
  ClinicAvailabilityBreak,
  ClinicDateAvailability,
  ClinicServiceModel,
} from '../../clinic/models/clinic.model';
import { ClinicCancellationPolicyModel } from '../../cancellation-policy/models/cancellationPolicy.model';
import { TokenSessionService } from '../../appointment-engine/services/tokenSession.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { PaymentReservationService } from '../services/paymentReservation.service';

jest.mock('../services/paymentReservation.service', () => ({
  PaymentReservationService: {
    getActiveLocksForDate: jest.fn().mockResolvedValue([]),
    filterExpiredPendingAppointments: jest
      .fn()
      .mockImplementation(async (rows) => rows),
  },
}));

const DOCTOR_ID = '65a8df2d-60fa-4e71-88df-b59f3dbd9821';
const PATIENT_ID = '77ce9842-88f1-4fb2-b7e1-88b1d8f583e7';
const OTHER_PATIENT = '11111111-2222-3333-4444-555555555555';
const CLINIC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FUTURE_DATE = '2099-06-15';

type Rows = Record<string, unknown>[];

/**
 * Dispatches on the table passed to `.from()` rather than on call order, so a
 * query being added, removed or reordered cannot silently feed a test wrong rows.
 */
function makeTx(tables: Map<unknown, Rows>) {
  return {
    select: jest.fn(() => {
      const chain: Record<string, unknown> = {};
      let rows: Rows = [];
      chain.from = jest.fn((table: unknown) => {
        rows = tables.get(table) ?? [];
        return chain;
      });
      for (const m of [
        'leftJoin',
        'innerJoin',
        'where',
        'orderBy',
        'limit',
        'offset',
        '$dynamic',
      ]) {
        chain[m] = jest.fn(() => chain);
      }
      chain.then = (resolve: (v: Rows) => unknown) => resolve(rows);
      return chain;
    }),
  };
}

// `status`, not `userStatus`: the service aliases the column in its projection.
const activeUsers = [
  { id: DOCTOR_ID, status: 'Active', userType: 'Doctor' },
  { id: PATIENT_ID, status: 'Active', userType: 'Patient' },
];

const tokenAvailability = {
  id: 'avail-1',
  dayOfWeek: 'monday',
  isAvailable: true,
  noOfPatients: 4,
  slotMinutes: 15,
};

const slotAvailability = {
  id: 'avail-1',
  dayOfWeek: 'monday',
  isAvailable: true,
  noOfPatients: null,
  slotMinutes: 20,
};

/** Builds the table map every case starts from; pass overrides per test. */
function tablesFor(overrides: {
  availability?: Rows;
  appointments?: Rows;
  breaks?: Rows;
  service?: Rows;
  policy?: Rows;
  users?: Rows;
}) {
  return new Map<unknown, Rows>([
    [UserModel, overrides.users ?? activeUsers],
    [ClinicAvailability, overrides.availability ?? [tokenAvailability]],
    [AppointmentModel, overrides.appointments ?? []],
    [ClinicAvailabilityBreak, overrides.breaks ?? []],
    [ClinicDateAvailability, []],
    [ClinicServiceModel, overrides.service ?? []],
    [ClinicCancellationPolicyModel, overrides.policy ?? [{ id: 'policy-1' }]],
  ]);
}

const basePayload = {
  patientId: PATIENT_ID,
  doctorId: DOCTOR_ID,
  appointmentDate: FUTURE_DATE,
  appointmentType: 'Consultation',
};

const validate = (payload: object, tables: Map<unknown, Rows>) =>
  AppointmentService.validateAppointmentBooking(
    PATIENT_ID,
    CLINIC_ID,
    payload as never,
    PATIENT_ID,
    makeTx(tables) as never
  );

/** Token mode: stubs the shift resolver these tests are not exercising. */
function stubSession(sessionIndex = 1, capacity = 4, totalSessions = 1) {
  jest.spyOn(TokenSessionService, 'resolve').mockResolvedValue({
    sessionIndex,
    start: 540,
    end: 720,
    sessionStart: sessionIndex === 1 ? '09:00' : '17:00',
    capacity,
    totalSessions,
  });
}

/** Slot mode: two shifts, 09:00-12:00 and 17:00-20:00. */
function stubSegments() {
  jest.spyOn(ScheduleShiftService, 'resolveDaySegments').mockResolvedValue({
    source: 'weekly',
    slotMinutes: 20,
    stepMinutes: 20,
    segments: [
      { start: 540, end: 720 },
      { start: 1020, end: 1200 },
    ],
  });
}

const appt = (
  tokenNo: number | null,
  sessionIndex: number | null,
  patientId = OTHER_PATIENT
) => ({
  id: `appt-${tokenNo}-${sessionIndex}`,
  tokenNo,
  sessionIndex,
  patientId,
  doctorId: DOCTOR_ID,
  appointmentStatus: 'Confirmed',
  appointmentTime: null,
  appointmentDurationMinutes: null,
  paymentMode: 'Cash',
  paymentStatus: 'Paid',
  appointmentDate: new Date(FUTURE_DATE),
});

beforeEach(() => {
  jest.clearAllMocks();
  (
    PaymentReservationService.getActiveLocksForDate as jest.Mock
  ).mockResolvedValue([]);
  (
    PaymentReservationService.filterExpiredPendingAppointments as jest.Mock
  ).mockImplementation(async (rows) => rows);
});

afterEach(() => jest.restoreAllMocks());

describe('validateAppointmentBooking — token mode', () => {
  it('assigns token 1 on an empty day', async () => {
    stubSession();
    const result = await validate(basePayload, tablesFor({}));

    expect(result.finalTokenNo).toBe(1);
    expect(result.finalSessionIndex).toBe(1);
  });

  it('assigns the next free token when 1 and 2 are taken', async () => {
    stubSession();
    const result = await validate(
      basePayload,
      tablesFor({ appointments: [appt(1, 1), appt(2, 1)] })
    );

    expect(result.finalTokenNo).toBe(3);
  });

  it('fills a gap rather than appending', async () => {
    stubSession();
    const result = await validate(
      basePayload,
      tablesFor({ appointments: [appt(1, 1), appt(3, 1)] })
    );

    expect(result.finalTokenNo).toBe(2);
  });

  // Numbering restarts per shift: the evening must not continue the morning run.
  it('restarts at 1 in session 2 even when session 1 is full', async () => {
    stubSession(2, 4, 2);
    const result = await validate(
      { ...basePayload, sessionIndex: 2 },
      tablesFor({
        appointments: [appt(1, 1), appt(2, 1), appt(3, 1), appt(4, 1)],
      })
    );

    expect(result.finalTokenNo).toBe(1);
    expect(result.finalSessionIndex).toBe(2);
  });

  // Guards the SQL->JS filter swap: rows predating shift-wise numbering carry a
  // null session and must still occupy their number in session 1.
  it('counts a null sessionIndex row as session 1', async () => {
    stubSession();
    const result = await validate(
      basePayload,
      tablesFor({ appointments: [appt(1, null), appt(2, null)] })
    );

    expect(result.finalTokenNo).toBe(3);
  });

  it('ignores a null sessionIndex row when booking session 2', async () => {
    stubSession(2, 4, 2);
    const result = await validate(
      { ...basePayload, sessionIndex: 2 },
      tablesFor({ appointments: [appt(1, null)] })
    );

    expect(result.finalTokenNo).toBe(1);
  });

  it('names the session when a multi-session day is full', async () => {
    stubSession(1, 2, 2);
    await expect(
      validate(
        basePayload,
        tablesFor({ appointments: [appt(1, 1), appt(2, 1)] })
      )
    ).rejects.toThrow('No tokens available in this session (09:00)');
  });

  it('uses the plain message when the day has one session', async () => {
    stubSession(1, 2, 1);
    await expect(
      validate(
        basePayload,
        tablesFor({ appointments: [appt(1, 1), appt(2, 1)] })
      )
    ).rejects.toThrow('No tokens available for this date');
  });

  it('rejects an explicitly requested token that is taken', async () => {
    stubSession();
    await expect(
      validate(
        { ...basePayload, tokenNo: 2 },
        tablesFor({ appointments: [appt(2, 1)] })
      )
    ).rejects.toThrow('Token 2 is already booked');
  });

  it("treats another patient's Redis hold in this session as taken", async () => {
    stubSession();
    (
      PaymentReservationService.getActiveLocksForDate as jest.Mock
    ).mockResolvedValue([
      {
        slotOrToken: 1,
        sessionIndex: 1,
        value: JSON.stringify({ patientId: OTHER_PATIENT }),
      },
    ]);

    const result = await validate(basePayload, tablesFor({}));
    expect(result.finalTokenNo).toBe(2);
  });

  it('ignores a Redis hold belonging to a different session', async () => {
    stubSession();
    (
      PaymentReservationService.getActiveLocksForDate as jest.Mock
    ).mockResolvedValue([
      {
        slotOrToken: 1,
        sessionIndex: 2,
        value: JSON.stringify({ patientId: OTHER_PATIENT }),
      },
    ]);

    const result = await validate(basePayload, tablesFor({}));
    expect(result.finalTokenNo).toBe(1);
  });

  it("ignores this patient's own hold, so a checkout retry still resolves", async () => {
    stubSession();
    (
      PaymentReservationService.getActiveLocksForDate as jest.Mock
    ).mockResolvedValue([
      {
        slotOrToken: 1,
        sessionIndex: 1,
        value: JSON.stringify({ patientId: PATIENT_ID }),
      },
    ]);

    const result = await validate(basePayload, tablesFor({}));
    expect(result.finalTokenNo).toBe(1);
  });
});

describe('validateAppointmentBooking — slot mode', () => {
  const slotTables = (overrides: Parameters<typeof tablesFor>[0] = {}) =>
    tablesFor({ availability: [slotAvailability], ...overrides });

  it('requires appointmentTime', async () => {
    stubSegments();
    await expect(validate(basePayload, slotTables())).rejects.toThrow(
      'appointmentTime is required'
    );
  });

  it('resolves the session from the time itself', async () => {
    stubSegments();
    const result = await validate(
      { ...basePayload, appointmentTime: '17:15' },
      slotTables()
    );

    expect(result.finalSessionIndex).toBe(2);
  });

  it('rejects a time that falls inside a break', async () => {
    stubSegments();
    await expect(
      validate(
        { ...basePayload, appointmentTime: '13:10' },
        slotTables({
          breaks: [
            { startTime: '13:00', endTime: '14:00', breakType: 'Lunch' },
          ],
        })
      )
    ).rejects.toThrow('falls during break');
  });

  it('rejects a duration that runs into a break', async () => {
    stubSegments();
    await expect(
      validate(
        {
          ...basePayload,
          appointmentTime: '12:45',
          appointmentDurationMinutes: '30',
        },
        slotTables({
          breaks: [
            { startTime: '13:00', endTime: '14:00', breakType: 'Lunch' },
          ],
        })
      )
    ).rejects.toThrow('causes overlap with break');
  });

  // "0" is truthy as a string; it means "not stated", not a zero-length visit.
  it('falls back to slotMinutes when duration is "0"', async () => {
    stubSegments();
    const result = await validate(
      {
        ...basePayload,
        appointmentTime: '10:00',
        appointmentDurationMinutes: '0',
      },
      slotTables()
    );

    expect(result.duration).toBe(20);
  });

  // `coreRest` is spread straight into the insert, so a raw "0" here would
  // store an appointment with no duration at all.
  it.each([['0'], ['abc'], ['-5'], ['']])(
    'never persists %p as a duration',
    async (raw) => {
      stubSegments();
      const result = await validate(
        {
          ...basePayload,
          appointmentTime: '10:00',
          appointmentDurationMinutes: raw,
        },
        slotTables()
      );

      expect(result.coreRest.appointmentDurationMinutes).toBeNull();
    }
  );

  // Token days skip the slot-mode branch entirely — the leak's other path.
  it('does not persist a raw "0" on a token booking either', async () => {
    stubSession();
    const result = await validate(
      { ...basePayload, appointmentDurationMinutes: '0' },
      tablesFor({})
    );

    expect(result.coreRest.appointmentDurationMinutes).toBeNull();
  });

  it('rejects a booking that overlaps another patient appointment', async () => {
    stubSegments();
    await expect(
      validate(
        { ...basePayload, appointmentTime: '10:30' },
        slotTables({
          appointments: [
            {
              ...appt(null, 1),
              appointmentTime: '10:00',
              appointmentDurationMinutes: '60',
            },
          ],
        })
      )
    ).rejects.toThrow('overlaps an existing appointment (10:00 - 11:00)');
  });

  it('allows a booking that starts exactly when another ends', async () => {
    stubSegments();
    const result = await validate(
      { ...basePayload, appointmentTime: '11:00' },
      slotTables({
        appointments: [
          {
            ...appt(null, 1),
            appointmentTime: '10:00',
            appointmentDurationMinutes: '60',
          },
        ],
      })
    );

    expect(result.finalAppointmentTime).toBe('11:00');
  });

  // A stored null means "use the clinic's slot size", so the gap it occupies
  // is slotMinutes, not zero.
  it('uses slotMinutes for an existing row with no stored duration', async () => {
    stubSegments();
    await expect(
      validate(
        { ...basePayload, appointmentTime: '10:10' },
        slotTables({
          appointments: [{ ...appt(null, 1), appointmentTime: '10:00' }],
        })
      )
    ).rejects.toThrow('overlaps an existing appointment (10:00 - 10:20)');
  });

  it('ignores token rows, which have no time to overlap', async () => {
    stubSegments();
    const result = await validate(
      { ...basePayload, appointmentTime: '10:00' },
      slotTables({ appointments: [appt(3, 1)] })
    );

    expect(result.finalAppointmentTime).toBe('10:00');
  });

  it('persists a chosen duration on a token booking', async () => {
    stubSession();
    const result = await validate(
      { ...basePayload, appointmentDurationMinutes: '45' },
      tablesFor({})
    );

    expect(result.coreRest.appointmentDurationMinutes).toBe('45');
  });

  it('persists a duration the caller actually chose', async () => {
    stubSegments();
    const result = await validate(
      {
        ...basePayload,
        appointmentTime: '10:00',
        appointmentDurationMinutes: '45',
      },
      slotTables()
    );

    expect(result.duration).toBe(45);
    expect(result.coreRest.appointmentDurationMinutes).toBe('45');
  });
});

describe('validateAppointmentBooking — shared guards', () => {
  it('rejects a past date', async () => {
    await expect(
      validate({ ...basePayload, appointmentDate: '2000-01-01' }, tablesFor({}))
    ).rejects.toThrow('Appointment date cannot be in the past');
  });

  it('rejects a blocked patient with 403', async () => {
    await expect(
      validate(
        basePayload,
        tablesFor({
          users: [
            activeUsers[0],
            { id: PATIENT_ID, status: 'Blocked', userType: 'Patient' },
          ],
        })
      )
    ).rejects.toThrow('Patient account is blocked');
  });

  it('rejects when the clinic is closed that day', async () => {
    await expect(
      validate(
        basePayload,
        tablesFor({
          availability: [{ ...tokenAvailability, isAvailable: false }],
        })
      )
    ).rejects.toThrow('Clinic is not available');
  });

  it('rejects a second booking for the same patient that day', async () => {
    stubSession();
    await expect(
      validate(
        basePayload,
        tablesFor({ appointments: [appt(1, 1, PATIENT_ID)] })
      )
    ).rejects.toThrow('Patient already has an appointment');
  });

  it('allows a booking when the only row belongs to another patient', async () => {
    stubSession();
    const result = await validate(
      basePayload,
      tablesFor({ appointments: [appt(1, 1, OTHER_PATIENT)] })
    );

    expect(result.finalTokenNo).toBe(2);
  });

  // Batching the reads must not let a later guard pre-empt an earlier one.
  it('reports the closed clinic, not the duplicate, when both apply', async () => {
    await expect(
      validate(
        basePayload,
        tablesFor({
          availability: [{ ...tokenAvailability, isAvailable: false }],
          appointments: [appt(1, 1, PATIENT_ID)],
        })
      )
    ).rejects.toThrow('Clinic is not available');
  });

  it('returns undefined activePolicy when the clinic has none', async () => {
    stubSession();
    const result = await validate(basePayload, tablesFor({ policy: [] }));

    expect(result.activePolicy).toBeUndefined();
  });

  it('deduces walk_in when a receptionist books', async () => {
    stubSession();
    const receptionist = '99999999-9999-9999-9999-999999999999';
    const result = await AppointmentService.validateAppointmentBooking(
      PATIENT_ID,
      CLINIC_ID,
      basePayload as never,
      receptionist,
      makeTx(
        tablesFor({
          users: [
            ...activeUsers,
            {
              id: receptionist,
              userStatus: 'Active',
              userType: 'Receptionist',
            },
          ],
        })
      ) as never
    );

    expect(result.deducedBookingSource).toBe('walk_in');
  });

  it('deduces mobile_app when the patient books for themselves', async () => {
    stubSession();
    const result = await validate(basePayload, tablesFor({}));

    expect(result.deducedBookingSource).toBe('mobile_app');
  });
});
