/**
 * Unit tests for ScheduleShiftService.plan — the decision half of "the doctor
 * is two hours late, move the day".
 *
 * `plan` is what both the confirm dialog and the write consume, so everything
 * that could send a patient to the wrong time is decided here: how far each
 * appointment moves, which ones are deliberately left alone, and when a shift
 * has to be refused outright rather than quietly mangled.
 */

jest.mock('../services/queueHoldStore.service', () => ({
  // Reception's promotions, which the projection now walks in the same order.
  getNextAppointmentIds: jest.fn().mockResolvedValue([]),
  getCurrentAppointmentId: jest.fn().mockResolvedValue(null),
}));

import { HttpError } from '../../../middlewear/errorHandler';
import {
  MOVABLE_STATUSES,
  ScheduleShiftService,
} from '../services/scheduleShift.service';
import { getCurrentAppointmentId } from '../services/queueHoldStore.service';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14'; // a Friday

type Row = {
  id: string;
  patientId: string;
  appointmentTime: string | null;
  tokenNo: number | null;
};

const row = (id: string, appointmentTime: string | null): Row => ({
  id,
  patientId: `p-${id}`,
  appointmentTime,
  tokenNo: appointmentTime === null ? 1 : null,
});

/**
 * A drizzle-shaped executor that hands back queued results in order.
 *
 * `plan` issues its reads in a fixed sequence — appointments, then the day's
 * availability — so a FIFO queue is enough to stand in for the database
 * without pulling one up for a unit test.
 */
function fakeExecutor(results: unknown[][]) {
  const queue = [...results];
  const next = () => Promise.resolve(queue.shift() ?? []);

  const executor = {
    select: () => ({
      from: () => ({
        where: () => next(),
      }),
    }),
  };

  return executor as never;
}

/** Appointments, then: no date-specific row, a 09:00–14:00 weekly day, no breaks. */
const withWeeklyDay = (appointments: Row[]) =>
  fakeExecutor([
    appointments,
    [], // clinic_date_availability — none, so the weekly template is used
    [
      {
        id: 'avail-1',
        isAvailable: true,
        noOfPatients: null,
        startTime: '09:00',
        endTime: '14:00',
        breaksStart: null,
        breaksEnd: null,
        slotMinutes: 30,
        stepMinutes: 0,
      },
    ],
    [], // no break rows
  ]);

beforeEach(() => {
  (getCurrentAppointmentId as jest.Mock).mockResolvedValue(null);
});

describe('ScheduleShiftService.plan', () => {
  it('moves every remaining appointment by the delay, in order', async () => {
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      120,
      withWeeklyDay([
        row('a', '09:30'),
        row('b', '10:00'),
        row('c', '10:30'),
        row('d', '11:00'),
      ])
    );

    // The worked example from the requirement, end to end.
    expect(plan.appointments.map((a) => [a.from, a.to])).toEqual([
      ['09:30', '11:30'],
      ['10:00', '12:00'],
      ['10:30', '12:30'],
      ['11:00', '13:00'],
    ]);
  });

  it('preserves the running order regardless of the order rows arrive in', async () => {
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      30,
      withWeeklyDay([row('c', '10:30'), row('a', '09:30'), row('b', '10:00')])
    );

    expect(plan.appointments.map((a) => a.appointmentId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(plan.appointments.map((a) => a.to)).toEqual([
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('leaves the consultation in progress where it is', async () => {
    (getCurrentAppointmentId as jest.Mock).mockResolvedValue('b');

    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      120,
      withWeeklyDay([row('a', '09:30'), row('b', '10:00'), row('c', '10:30')])
    );

    expect(plan.appointments.map((a) => a.appointmentId)).toEqual(['a', 'c']);
    expect(plan.skipped).toEqual([
      { appointmentId: 'b', reason: 'in_consultation' },
    ]);
  });

  it('skips token rows, which have no clock time to slide', async () => {
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      60,
      withWeeklyDay([row('a', '09:30'), row('t', null)])
    );

    expect(plan.appointments).toHaveLength(1);
    expect(plan.skipped).toEqual([{ appointmentId: 't', reason: 'no_time' }]);
  });

  it('leaves an appointment that cannot move behind rather than refusing', async () => {
    // 21:00 + 4h has nowhere to go. That used to abort the whole shift, so a
    // single late-evening walk-in made the day unshiftable for everyone else —
    // "Extend hours" refused outright instead of moving the appointments it
    // could. It is now skipped and reported, like a token row or the
    // consultation in progress.
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      240,
      withWeeklyDay([row('a', '21:00')])
    );

    expect(plan.appointments).toEqual([]);
    expect(plan.skipped).toEqual([
      { appointmentId: 'a', reason: 'past_end_of_day' },
    ]);
  });

  it('moves the day back when the delay is corrected downwards', async () => {
    // Reception announced 120 and is correcting to 30: the delta is negative.
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      -90,
      withWeeklyDay([row('a', '11:30'), row('b', '12:00')])
    );

    expect(plan.appointments.map((a) => a.to)).toEqual(['10:00', '10:30']);
  });

  it('reports the shifted end of the bookable day', async () => {
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      120,
      withWeeklyDay([row('a', '09:30')])
    );

    // A 09:00–14:00 day delayed two hours now runs until 16:00, which is the
    // figure that tells reception whether the shift is still practical.
    expect(plan.sessionEnd).toBe('16:00');
  });

  it('reads a 12-hour availability window', async () => {
    // `clinic_availability` stores '09:00 AM' / '06:00 PM', not '09:00'
    // / '18:00'. A 24-hour-only reader takes 06:00 from the end time, decides
    // the window is inverted, and silently shifts nothing at all.
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      60,
      fakeExecutor([
        [row('a', '09:30')],
        [],
        [
          {
            id: 'avail-1',
            isAvailable: true,
            noOfPatients: null,
            startTime: '09:00 AM',
            endTime: '06:00 PM',
            breaksStart: null,
            breaksEnd: null,
            slotMinutes: 30,
            stepMinutes: 0,
          },
        ],
        [],
      ])
    );

    expect(plan.appointments[0].to).toBe('10:30');
    expect(plan.sessionEnd).toBe('19:00');
  });

  it('moves only the session the delay belongs to, not the whole day', async () => {
    // A doctor consulting 09:00–13:00 and again 17:00–21:00. Being an hour late
    // for the morning says nothing about the evening clinic — they will still
    // be there at 17:00, and telling those patients 18:00 is a promise nobody
    // made.
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      60,
      fakeExecutor([
        [row('morning', '09:30'), row('evening', '17:30')],
        [],
        [
          {
            id: 'avail-1',
            isAvailable: true,
            noOfPatients: null,
            startTime: '09:00 AM',
            endTime: '09:00 PM',
            // The long midday gap is what splits the day into two sessions.
            breaksStart: '01:00 PM',
            breaksEnd: '05:00 PM',
            slotMinutes: 30,
            stepMinutes: 0,
          },
        ],
        [],
      ])
    );

    expect(plan.appointments.map((a) => a.appointmentId)).toEqual(['morning']);
    expect(plan.appointments[0].to).toBe('10:30');
    expect(plan.skipped).toEqual([
      { appointmentId: 'evening', reason: 'other_shift' },
    ]);

    // The morning session's own end, not the day's.
    expect(plan.sessionEnd).toBe('14:00');
    expect(plan.shiftWindowLabel).toBe('09:00–13:00');
  });

  it('refuses a shift that would run one session into the next', async () => {
    // 09:00–13:00 then 17:00–21:00: a four-hour shift puts the morning on top
    // of the evening clinic. Refusing is the only honest answer — the
    // alternative is two sessions claiming the same hour.
    await expect(
      ScheduleShiftService.plan(
        CLINIC,
        DOCTOR,
        DATE,
        240,
        fakeExecutor([
          [row('morning', '09:30')],
          [],
          [
            {
              id: 'avail-1',
              isAvailable: true,
              noOfPatients: null,
              startTime: '09:00 AM',
              endTime: '09:00 PM',
              breaksStart: '01:00 PM',
              breaksEnd: '05:00 PM',
              slotMinutes: 30,
              stepMinutes: 0,
            },
          ],
          [],
        ])
      )
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('refuses a shift that would push the bookable window past midnight', async () => {
    // A 24-hour day (00:00–23:55) cannot absorb an hour. Clamping the end to
    // 23:59 would quietly turn a 60-minute shift into a 4-minute *extension*
    // of the day the clinic configured.
    await expect(
      ScheduleShiftService.plan(
        CLINIC,
        DOCTOR,
        DATE,
        60,
        fakeExecutor([
          [],
          [],
          [
            {
              id: 'avail-1',
              isAvailable: true,
              noOfPatients: null,
              startTime: '12:00 AM',
              endTime: '11:55 PM',
              breaksStart: null,
              breaksEnd: null,
              slotMinutes: 5,
              stepMinutes: 0,
            },
          ],
          [],
        ])
      )
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('does not treat a token day as shiftable', async () => {
    const plan = await ScheduleShiftService.plan(
      CLINIC,
      DOCTOR,
      DATE,
      60,
      fakeExecutor([
        [row('a', '09:30')],
        [],
        [
          {
            id: 'avail-1',
            isAvailable: true,
            noOfPatients: 40, // token-based day
            startTime: '09:00',
            endTime: '14:00',
            breaksStart: null,
            breaksEnd: null,
            slotMinutes: 30,
            stepMinutes: 0,
          },
        ],
        [],
      ])
    );

    // There is no window to project, so there is no end to report.
    expect(plan.sessionEnd).toBeNull();
  });
});

describe('MOVABLE_STATUSES', () => {
  /**
   * Guards the allowlist against being "simplified" back into
   * `!isTerminalStatus(...)` later. Missed is the trap: the engine does not
   * consider it terminal, but its time records an appointment the patient
   * never came to, and sliding that forward invents a promise nobody made.
   */
  it('never moves an appointment that is finished or was missed', () => {
    for (const status of ['Completed', 'Cancelled', 'NoShow', 'Missed']) {
      expect(MOVABLE_STATUSES).not.toContain(status);
    }
  });

  it('moves the statuses that are still owed a consultation', () => {
    for (const status of ['Upcoming', 'Pending', 'Patient Arrived']) {
      expect(MOVABLE_STATUSES).toContain(status);
    }
  });
});
