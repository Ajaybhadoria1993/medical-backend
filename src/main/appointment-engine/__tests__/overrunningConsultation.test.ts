/**
 * Unit tests for a consultation that has overrun.
 *
 * The bug these exist for: while a doctor was mid-consultation, the projection
 * was built from scheduled times alone. A doctor still on the 13:00 patient at
 * 15:46 produced a timeline of 13:00 → 13:30 → 14:00 …, so every waiting
 * patient was told zero delay, "not running late", and a minutes-until-seen
 * that assumed four consultations would finish in fourteen minutes.
 *
 * The clock-based branch only ran when *nobody* was being served — precisely
 * the case where a delay is least visible from the data, and most obvious to
 * everyone sitting in the waiting room.
 */

// 15:46 IST — the doctor is long past the 13:00 slot they are still working on.
const mockNowHoursMinutes = { hours: 15, minutes: 46 };

jest.mock('../../../utils/istDateTime', () => {
  const actual = jest.requireActual('../../../utils/istDateTime');
  return {
    ...actual,
    getISTHoursMinutes: () => mockNowHoursMinutes,
  };
});

/**
 * Who is in the room, as the Redis pointer the engine actually reads.
 *
 * These tests originally said "in the room" by giving the patient
 * `appointmentStatus: 'Confirmed'`. That convention was deliberately retired
 * when the queue moved into the appointment engine — reception calling a
 * patient in is a pointer, not a booking confirmation — so the status alone
 * stopped putting anyone in the room and the overrun these tests exist for was
 * never detected. The scenario is unchanged; only how it is expressed is.
 */
jest.mock('../services/queueHoldStore.service', () => ({
  // Reception's promotions, which the projection now walks in the same order.
  getNextAppointmentIds: jest.fn().mockResolvedValue([]),
  getCurrentAppointmentId: jest.fn().mockResolvedValue('a'),
  getHeldAppointments: jest.fn().mockResolvedValue(new Map()),
  // Null: the overrun here is derived from the clock against 'a''s scheduled
  // slot, not from a recorded real start time.
  getConsultationStartedAt: jest.fn().mockResolvedValue(null),
  getConsultationEndedAt: jest.fn().mockResolvedValue(null),
}));

import { DelayTrackerService } from '../services/delayTracker.service';
import { SessionOverrideService } from '../services/sessionOverride.service';
import { ConsultationDurationService } from '../services/consultationDuration.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-19';

type Appt = {
  id: string;
  patientId: string;
  appointmentStatus: string;
  appointmentTime: string | null;
  tokenNo: number | null;
  appointmentDurationMinutes: string | null;
};

function appt(over: Partial<Appt> & { id: string }): Appt {
  return {
    patientId: `p-${over.id}`,
    appointmentStatus: 'Upcoming',
    appointmentTime: null,
    tokenNo: null,
    appointmentDurationMinutes: null,
    ...over,
  };
}

function buildService(appointments: Appt[]) {
  const service = new DelayTrackerService();

  jest.spyOn(service as any, 'fetchDailyQueue').mockResolvedValue(appointments);
  jest.spyOn(service as any, 'resolveDayConfig').mockResolvedValue({
    slotMinutes: 30,
    sessionStartMinutes: 9 * 60,
    breaks: [],
  });
  jest.spyOn(service as any, 'storeInRedis').mockResolvedValue(undefined);
  jest.spyOn(SessionOverrideService, 'getActiveMinutes').mockResolvedValue(0);
  jest
    .spyOn(ConsultationDurationService, 'resolveForDoctor')
    .mockResolvedValue({ minutes: null, basis: 'slot', sampleSize: 0 });

  return service;
}

beforeEach(() => {
  mockNowHoursMinutes.hours = 15;
  mockNowHoursMinutes.minutes = 46;
});

afterEach(() => jest.restoreAllMocks());

describe('a consultation running long', () => {
  /** The reported payload: 13:00 still in the room at 15:46, four behind it. */
  const overrunningQueue = () => [
    appt({
      id: 'a',
      appointmentTime: '13:00',
      appointmentStatus: 'Confirmed',
    }),
    appt({ id: 'b', appointmentTime: '14:00' }),
    appt({ id: 'c', appointmentTime: '14:30' }),
    appt({ id: 'd', appointmentTime: '15:00' }),
    appt({ id: 'e', appointmentTime: '16:00' }),
  ];

  it('does not project anyone into the past', async () => {
    const service = buildService(overrunningQueue());
    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Everyone still waiting must be projected at or after 15:46. Before the
    // fix, 'b' was projected at 14:00 — half an hour before the doctor even
    // finished the patient in front of them.
    const waiting = out.appointments.filter(
      (a) => a.status !== 'In Consultation'
    );
    for (const entry of waiting) {
      const [h, m] = entry.projectedStartTime.split(':').map(Number);
      expect(h * 60 + m).toBeGreaterThanOrEqual(15 * 60 + 46);
    }
  });

  it('reports a real delay for the patients behind', async () => {
    const service = buildService(overrunningQueue());
    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 'b' was booked at 14:00 and cannot start before 15:46 — 106 minutes late.
    const b = out.appointments.find((a) => a.appointmentId === 'b')!;
    expect(b.estimatedWaitMinutes).toBe(106);

    // The queue as a whole is late, not "on time".
    expect(out.cumulativeDelayMinutes).toBeGreaterThan(0);
  });

  it('cascades the overrun to the end of the queue', async () => {
    const service = buildService(overrunningQueue());
    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // 15:46 + 30 (b) + 30 (c) + 30 (d) = 17:16 for the 16:00 appointment,
    // i.e. 76 minutes late — not the zero it previously reported.
    const e = out.appointments.find((a) => a.appointmentId === 'e')!;
    expect(e.projectedStartTime).toBe('17:16');
    expect(e.estimatedWaitMinutes).toBe(76);
  });

  it('leaves the patient in the room projected at their real start', async () => {
    const service = buildService(overrunningQueue());
    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    // Their start genuinely is in the past — that is what "in consultation"
    // means, and moving it to now would claim they had not been seen yet.
    const a = out.appointments.find((a) => a.appointmentId === 'a')!;
    expect(a.projectedStartTime).toBe('13:00');
    expect(a.estimatedWaitMinutes).toBe(0);
  });

  it('leaves an on-schedule queue untouched', async () => {
    // The guard must not invent a delay for a doctor who is running to time.
    mockNowHoursMinutes.hours = 13;
    mockNowHoursMinutes.minutes = 5;

    const service = buildService([
      appt({
        id: 'a',
        appointmentTime: '13:00',
        appointmentStatus: 'Confirmed',
      }),
      appt({ id: 'b', appointmentTime: '13:30' }),
      appt({ id: 'c', appointmentTime: '14:00' }),
    ]);

    const out = await service.recalculate(CLINIC, DOCTOR, DATE);

    expect(out.appointments.map((a) => a.estimatedWaitMinutes)).toEqual([
      0, 0, 0,
    ]);
    expect(out.cumulativeDelayMinutes).toBe(0);
  });
});
