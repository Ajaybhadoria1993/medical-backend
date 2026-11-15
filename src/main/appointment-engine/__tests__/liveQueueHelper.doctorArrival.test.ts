import { database } from '../../../configurations/dbConnection';
import { buildPayloadFromQueue } from '../services/liveQueueHelper';
import { DelayTrackerService } from '../services/delayTracker.service';
import type {
  QueueDelayData,
  AppointmentDelayEntry,
} from '../types/engine.types';

const entry = (
  over: Partial<AppointmentDelayEntry> & { appointmentId: string }
): AppointmentDelayEntry => ({
  patientId: `p-${over.appointmentId}`,
  userId: `u-${over.appointmentId}`,
  status: 'Patient Arrived',
  scheduledTime: '09:30',
  tokenNo: null,
  projectedStartTime: '10:15',
  estimatedWaitMinutes: 45,
  durationMinutes: 15,
  isOnHold: false,
  ...over,
});

const queue = (doctorArrived?: boolean): QueueDelayData => ({
  clinicId: 'clinic-1',
  doctorId: 'doctor-1',
  date: '2026-11-13',
  cumulativeDelayMinutes: 0,
  lastCalculatedAt: '2026-11-13T04:30:00.000Z',
  appointments: [
    entry({ appointmentId: 'a', scheduledTime: '09:00' }),
    entry({ appointmentId: 'me' }),
  ],
  doctorArrived,
});

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-13T04:30:00.000Z')); // 10:00 IST
});
afterAll(() => jest.useRealTimers());

describe('buildPayloadFromQueue before the doctor arrives', () => {
  it('keeps place in line, withholds every projection, flags late past the slot', () => {
    const p = buildPayloadFromQueue('me', queue(false), 15);

    expect(p.doctorArrived).toBe(false);
    expect(p.queue.patientsAhead).toBe(1);
    expect(p.tentativeStartTime).toBeNull();
    expect(p.delay.untilSeenMinutes).toBeNull();
    expect(p.nextUp.label).toBeNull();
    expect(p.delay).toMatchObject({ isLate: true, lateMinutes: 30 });
  });

  it('is not late while the slot is still ahead', () => {
    const q = queue(false);
    q.appointments[1].scheduledTime = '10:30';
    expect(buildPayloadFromQueue('me', q, 15).delay.isLate).toBe(false);
  });

  it("token day: the morning's arrival does not open the evening shift", () => {
    const q = queue(true);
    q.appointments = [
      entry({
        appointmentId: 'm',
        tokenNo: 3,
        sessionIndex: 1,
        doctorArrived: true,
      }),
      entry({
        appointmentId: 'e',
        tokenNo: 2,
        sessionIndex: 2,
        scheduledTime: '17:15',
        doctorArrived: false,
      }),
    ];

    expect(buildPayloadFromQueue('m', q, 15).doctorArrived).toBe(true);
    const evening = buildPayloadFromQueue('e', q, 15);
    expect(evening.doctorArrived).toBe(false);
    expect(evening.tokenNo).toBe(2);
    expect(evening.delay.isLate).toBe(false);
  });

  it('token day: a morning patient stays open after the clock moves to the evening shift', () => {
    const q = queue(false);
    q.appointments = [
      entry({
        appointmentId: 'm',
        tokenNo: 9,
        sessionIndex: 1,
        doctorArrived: true,
      }),
    ];
    expect(buildPayloadFromQueue('m', q, 15).doctorArrived).toBe(true);
  });

  it('shows full details once arrived, and for old cache entries without the flag', () => {
    for (const arrived of [true, undefined]) {
      const p = buildPayloadFromQueue('me', queue(arrived), 15);
      expect(p.doctorArrived).toBe(true);
      expect(p.tentativeStartTime).toBe('10:15');
    }
  });
});

describe('DelayTrackerService.readDoctorArrival on a multi-block day', () => {
  /** Runs the private reader with the given blocks and arrival rows. */
  const run = async (
    sessions: Array<{ start: string; end: string }>,
    arrivedStarts: Array<string | null>,
    entries: AppointmentDelayEntry[]
  ) => {
    const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const breaks = sessions.slice(1).map((s, i) => ({
      startMinutes: min(sessions[i].end),
      endMinutes: min(s.start),
    }));
    const rows = arrivedStarts.map((sessionStart) => ({ sessionStart }));
    (database.select as jest.Mock).mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve(rows) }),
    });
    await (new DelayTrackerService() as any).readDoctorArrival(
      'doctor-1',
      '2026-11-13',
      entries,
      min(sessions[0].start),
      breaks,
      600
    );
    return entries;
  };

  it('time day, separate sittings: the morning arrival does not open the evening', async () => {
    const [morning, evening] = await run(
      [
        { start: '09:00', end: '13:00' },
        { start: '17:00', end: '21:00' },
      ],
      ['09:00'],
      [
        entry({ appointmentId: 'm', scheduledTime: '10:00' }),
        entry({ appointmentId: 'e', scheduledTime: '17:30' }),
      ]
    );
    expect(morning.doctorArrived).toBe(true);
    expect(evening.doctorArrived).toBe(false);
  });

  it('time day, lunch break: the morning arrival covers the afternoon', async () => {
    const [, afternoon] = await run(
      [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
      ['09:00'],
      [
        entry({ appointmentId: 'm', scheduledTime: '10:00' }),
        entry({ appointmentId: 'a', scheduledTime: '15:00' }),
      ]
    );
    expect(afternoon.doctorArrived).toBe(true);
  });

  it('token day: each shift needs its own arrival', async () => {
    const [m, e] = await run(
      [
        { start: '09:00', end: '13:00' },
        { start: '17:00', end: '21:00' },
      ],
      ['17:00'],
      [
        entry({ appointmentId: 'm', tokenNo: 3, sessionIndex: 1 }),
        entry({ appointmentId: 'e', tokenNo: 1, sessionIndex: 2 }),
      ]
    );
    expect(m.doctorArrived).toBe(false);
    expect(e.doctorArrived).toBe(true);
  });
});
