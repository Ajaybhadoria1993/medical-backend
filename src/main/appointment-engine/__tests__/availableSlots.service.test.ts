/**
 * Unit tests for AvailableSlotsService — the custom-slot-aware "what can be
 * booked" answer behind `GET /appointments/available-slots`.
 *
 * This is the service that decides whether a slot is offered at all, so a
 * wrong answer here is either a double booking or a slot nobody can book. It
 * overlays `slot_config` / `extra_slots` overrides and off-grid appointments
 * on top of the legacy generator, and each of those layers is exercised below.
 *
 * Every collaborator is mocked: the point is the overlay logic, not the SQL.
 */

const selectMock = jest.fn();

jest.mock('../../../configurations/dbConnection', () => ({
  database: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

jest.mock('../../appointments/services/appointment.service', () => ({
  AppointmentService: {
    getAvailableSlotsForDate: jest.fn(),
    minutesToIso: (date: string, minutes: number) =>
      `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
        minutes % 60
      ).padStart(2, '0')}:00`,
  },
}));

jest.mock('../services/scheduleShift.service', () => ({
  ScheduleShiftService: { resolveDaySegments: jest.fn() },
  toHHMM: (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60
    ).padStart(2, '0')}`,
}));

jest.mock('../services/slotConfig.service', () => ({
  SlotConfigService: { findOverrideRow: jest.fn() },
  DEFAULT_SLOT_MINUTES: 30,
}));

jest.mock('../services/missedSlotDismissal.service', () => ({
  MissedSlotDismissalService: { getDismissedSlots: jest.fn() },
}));

import { AvailableSlotsService } from '../services/availableSlots.service';
import { AppointmentService } from '../../appointments/services/appointment.service';
import { ScheduleShiftService } from '../services/scheduleShift.service';
import { SlotConfigService } from '../services/slotConfig.service';
import { MissedSlotDismissalService } from '../services/missedSlotDismissal.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

const iso = (minutes: number) =>
  `${DATE}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60
  ).padStart(2, '0')}:00`;

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** A plain available cell from the legacy generator. */
const availableSlot = (from: string, to: string) => ({
  start: iso(at(from)),
  end: iso(at(to)),
  clinicAvailabilityId: 'avail-1',
  source: 'availability',
  status: 'available',
});

/** A booked cell as the legacy generator returns it. */
const bookedSlot = (from: string, to: string, appointmentId: string) => ({
  start: iso(at(from)),
  end: iso(at(to)),
  clinicAvailabilityId: 'avail-1',
  source: 'appointment',
  status: 'booked',
  appointmentId,
  appointmentStatus: 'Upcoming',
  patientId: 'patient-1',
});

/** Queues the rows `fetchDayAppointments` should return. */
const appointmentRows = (rows: unknown[]) => {
  selectMock.mockReturnValue({
    from: () => ({ where: () => Promise.resolve(rows) }),
  });
};

const times = (slots: { start: string }[]) =>
  slots.map((s) => s.start.split('T')[1].slice(0, 5));

beforeEach(() => {
  jest.clearAllMocks();
  appointmentRows([]);
  (MissedSlotDismissalService.getDismissedSlots as jest.Mock).mockResolvedValue(
    new Set()
  );
  (SlotConfigService.findOverrideRow as jest.Mock).mockResolvedValue(null);
  (ScheduleShiftService.resolveDaySegments as jest.Mock).mockResolvedValue(
    null
  );
});

describe('with no overrides in play', () => {
  it("passes the generator's slots straight through", async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30'), availableSlot('09:30', '10:00')],
      shifts: ['09:00-14:00'],
    });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(times(result.slots)).toEqual(['09:00', '09:30']);
    // `shifts` is the client's session grouping — dropping it collapsed a
    // two-sitting day into one on the booking screen.
    expect(result.shifts).toEqual(['09:00-14:00']);
  });

  it('returns slots in chronological order', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('11:00', '11:30'), availableSlot('09:00', '09:30')],
    });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(times(result.slots)).toEqual(['09:00', '11:00']);
  });
});

describe('extra slots after a session ends', () => {
  const withExtraSlots = (override: Record<string, unknown>) => {
    (ScheduleShiftService.resolveDaySegments as jest.Mock).mockResolvedValue({
      segments: [{ start: at('09:00'), end: at('10:00') }],
      slotMinutes: 30,
      stepMinutes: 0,
    });
    (SlotConfigService.findOverrideRow as jest.Mock).mockImplementation(
      (_c, _d, _dt, _s, kind) => (kind === 'extra_slots' ? override : null)
    );
  };

  it('appends them after the session end, not inside it', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30')],
    });
    withExtraSlots({ numberOfSlots: 2, slotMinutes: 30, stepMinutes: 0 });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // Session ends 10:00, so the extras start there.
    expect(times(result.slots)).toEqual(['09:00', '10:00', '10:30']);
    expect(result.slots.filter((s) => s.isExtra)).toHaveLength(2);
  });

  it('honours stepMinutes as a gap between extra cells', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });
    withExtraSlots({ numberOfSlots: 2, slotMinutes: 20, stepMinutes: 10 });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // 10:00-10:20, then a 10-minute gap, so the next opens at 10:30.
    expect(times(result.slots)).toEqual(['10:00', '10:30']);
  });

  it('shows an extra cell as booked when an appointment already sits in it', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [],
    });
    withExtraSlots({ numberOfSlots: 1, slotMinutes: 30, stepMinutes: 0 });
    appointmentRows([
      {
        id: 'appt-walkin',
        patientId: 'patient-9',
        appointmentTime: '10:00',
        appointmentDurationMinutes: '30',
        appointmentStatus: 'Confirmed',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // Offering this as free is a double booking, which is the failure this
    // whole overlay exists to prevent.
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].status).toBe('Confirmed');
    expect(result.slots[0].appointmentId).toBe('appt-walkin');
    expect(result.slots[0].isExtra).toBe(true);
  });

  it('adds nothing when the override has no slots', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30')],
    });
    withExtraSlots({ numberOfSlots: 0, slotMinutes: 30, stepMinutes: 0 });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(times(result.slots)).toEqual(['09:00']);
  });
});

describe('off-grid appointments', () => {
  beforeEach(() => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30')],
    });
  });

  it('surfaces a booking that sits outside every session window', async () => {
    appointmentRows([
      {
        id: 'appt-custom',
        patientId: 'patient-3',
        appointmentTime: '13:00',
        appointmentDurationMinutes: '15',
        appointmentStatus: 'Upcoming',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // Without this the default generator hides it, and staff see a free
    // afternoon the doctor is not actually free for.
    const offGrid = result.slots.find((s) => s.isOffGrid);
    expect(offGrid?.appointmentId).toBe('appt-custom');
    expect(times(result.slots)).toEqual(['09:00', '13:00']);
  });

  it('does not duplicate a booking the grid already shows', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [bookedSlot('09:00', '09:30', 'appt-1')],
    });
    appointmentRows([
      {
        id: 'appt-1',
        patientId: 'patient-1',
        appointmentTime: '09:00',
        appointmentDurationMinutes: '30',
        appointmentStatus: 'Upcoming',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].isOffGrid).toBeUndefined();
  });

  it('ignores a token booking, which has no time to place', async () => {
    appointmentRows([
      {
        id: 'appt-token',
        patientId: 'patient-4',
        appointmentTime: null,
        appointmentDurationMinutes: '30',
        appointmentStatus: 'Upcoming',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(times(result.slots)).toEqual(['09:00']);
  });
});

describe('dismissed missed slots', () => {
  it('drops an available slot that was dismissed', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30'), availableSlot('09:30', '10:00')],
    });
    (
      MissedSlotDismissalService.getDismissedSlots as jest.Mock
    ).mockResolvedValue(new Set(['09:00']));

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(times(result.slots)).toEqual(['09:30']);
  });

  it('never drops a booked slot, only an offerable one', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [bookedSlot('09:00', '09:30', 'appt-1')],
    });
    (
      MissedSlotDismissalService.getDismissedSlots as jest.Mock
    ).mockResolvedValue(new Set(['09:00']));
    appointmentRows([
      {
        id: 'appt-1',
        patientId: 'patient-1',
        appointmentTime: '09:00',
        appointmentDurationMinutes: '30',
        appointmentStatus: 'Upcoming',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // Dismissing a slot must never hide a real patient's appointment.
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].appointmentId).toBe('appt-1');
  });
});

describe('a slot_config override on a session', () => {
  const withSlotConfig = (override: Record<string, unknown>) => {
    (ScheduleShiftService.resolveDaySegments as jest.Mock).mockResolvedValue({
      segments: [{ start: at('09:00'), end: at('10:00') }],
      slotMinutes: 30,
      stepMinutes: 0,
    });
    (SlotConfigService.findOverrideRow as jest.Mock).mockImplementation(
      (_c, _d, _dt, _s, kind) => (kind === 'slot_config' ? override : null)
    );
  };

  it('rebuilds the session grid at the overridden slot length', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [availableSlot('09:00', '09:30'), availableSlot('09:30', '10:00')],
    });
    withSlotConfig({
      noOfPatients: null,
      slotMinutes: 20,
      stepMinutes: 0,
      numberOfSlots: null,
    });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // A 60-minute session at 20 minutes a slot is three cells, not two.
    expect(times(result.slots)).toEqual(['09:00', '09:20', '09:40']);
    expect(result.slots.every((s) => s.isCustomized)).toBe(true);
  });

  it('keeps a real booking inside the rebuilt window', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [
        bookedSlot('09:00', '09:30', 'appt-1'),
        availableSlot('09:30', '10:00'),
      ],
    });
    withSlotConfig({
      noOfPatients: null,
      slotMinutes: 30,
      stepMinutes: 0,
      numberOfSlots: null,
    });
    appointmentRows([
      {
        id: 'appt-1',
        patientId: 'patient-1',
        appointmentTime: '09:00',
        appointmentDurationMinutes: '30',
        appointmentStatus: 'Upcoming',
      },
    ]);

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    // Resizing a grid must not erase somebody's appointment.
    const booked = result.slots.find((s) => s.appointmentId === 'appt-1');
    expect(booked).toBeDefined();
    expect(booked?.isCustomized).toBeUndefined();
  });

  it('resizes token capacity while keeping booked tokens', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [
        {
          ...availableSlot('09:00', '10:00'),
          totalTokens: 2,
          availableTokens: 1,
          tokens: [
            { tokenNo: 1, status: 'booked' },
            { tokenNo: 2, status: 'available' },
          ],
        },
      ],
    });
    withSlotConfig({
      noOfPatients: 4,
      slotMinutes: null,
      stepMinutes: null,
      numberOfSlots: null,
    });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    expect(result.slots).toHaveLength(1);
    const slot = result.slots[0];
    expect(slot.totalTokens).toBe(4);
    // One token is already taken, so three remain bookable.
    expect(slot.availableTokens).toBe(3);
    expect(slot.tokens?.[0]).toEqual({ tokenNo: 1, status: 'booked' });
    expect(slot.tokens).toHaveLength(4);
  });

  it('keeps a token booked above capacity without spending a number on it', async () => {
    (
      AppointmentService.getAvailableSlotsForDate as jest.Mock
    ).mockResolvedValue({
      slots: [
        {
          ...availableSlot('09:00', '10:00'),
          totalTokens: 2,
          availableTokens: 1,
          tokens: [
            { tokenNo: 1, status: 'booked' },
            { tokenNo: 2, status: 'available' },
            // An emergency override booked past the day's limit.
            { tokenNo: 23, status: 'booked', isExtra: true },
          ],
        },
      ],
    });
    withSlotConfig({
      noOfPatients: 4,
      slotMinutes: null,
      stepMinutes: null,
      numberOfSlots: null,
    });

    const result = await AvailableSlotsService.getAvailableSlots(
      CLINIC,
      DOCTOR,
      DATE
    );

    const slot = result.slots[0];
    // Counting 23 as in range would drop token 2, the next patient's number.
    expect(slot.availableTokens).toBe(3);
    expect(slot.tokens?.map((t) => t.tokenNo)).toEqual([1, 2, 3, 4, 23]);
  });
});
