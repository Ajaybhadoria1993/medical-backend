/**
 * The two halves of the no-show feature that broke on a token-based day.
 *
 * Both bugs came from reading a stored value as something it is not: a token
 * booking's '23:59' placeholder as a real slot, and a zone-less `created_at`
 * as a UTC instant. Neither is visible in a type, so they are pinned here.
 */

import { Worker } from 'bullmq';
import { database } from '../../../configurations/dbConnection';
import { DoctorArrivalService } from '../../appointment-engine/services/doctorArrival.service';
import { ScheduleShiftService } from '../../appointment-engine/services/scheduleShift.service';
import { autoNoShowQueue } from '../services/autoNoShow.service';
import { NoShowService } from '../services/noShow.service';

const mockAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

// Other modules in this import graph build a Queue at load time, before the
// spy above exists — so `add` reaches it on call, not at construction.
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: (...args: unknown[]) => mockAdd(...args),
    getJob: jest.fn(),
  })),
  Worker: jest
    .fn()
    .mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

/** A drizzle query builder that resolves to `value` however it is chained. */
const chain = (value: unknown) => {
  const c: Record<string, unknown> = {};
  for (const method of [
    'from',
    'where',
    'limit',
    'innerJoin',
    'leftJoin',
    'orderBy',
  ]) {
    c[method] = jest.fn(() => c);
  }
  c.then = (resolve: (v: unknown) => unknown) => resolve(value);
  return c;
};

/**
 * The worker's processor, captured at construction: the queue is built at
 * import time, so `clearAllMocks` below would erase the record of the call.
 */
const runJob = (Worker as unknown as jest.Mock).mock.calls.find(
  // By name, not position: several queues build a worker in this import graph.
  (call) => call[0] === 'auto-no-show'
)![1] as (job: {
  data: { appointmentId: string; clinicId: string };
}) => Promise<void>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('auto no-show deadline', () => {
  // Far enough ahead that the job is always still in the future.
  const APPOINTMENT_DATE = new Date('2026-10-15');

  /** A 09:00-13:00 morning sitting, in minutes since IST midnight. */
  const morningSession = {
    source: 'weekly' as const,
    slotMinutes: null,
    stepMinutes: null,
    segments: [{ start: 540, end: 780 }],
  };

  const withGracePeriod = (minutes: number) =>
    (database.select as jest.Mock).mockReturnValue(
      chain([{ gracePeriodMinutes: minutes }])
    );

  /** The instant the queued job would run, from the delay it was given. */
  const scheduledInstant = (calledAt: number): number => {
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const options = mockAdd.mock.calls[0][2] as { delay: number };
    return calledAt + options.delay;
  };

  const expectInstant = (actual: number, expected: string) =>
    expect(Math.abs(actual - new Date(expected).getTime())).toBeLessThan(5000);

  it('counts a token booking from the end of its session', async () => {
    // The bug: grace ran from the stored '23:59', so the job fired at 00:14
    // the next morning and the patient was never marked on the day they
    // missed. A token's turn has passed once its sitting is over — 13:00.
    withGracePeriod(15);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(morningSession);

    const calledAt = Date.now();
    await autoNoShowQueue.scheduleAutoNoShow({
      id: 'appt-token',
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      appointmentDate: APPOINTMENT_DATE,
      appointmentTime: '23:59',
      tokenNo: 4,
      sessionIndex: 1,
    });

    // 13:00 IST + 15m grace = 13:15 IST = 07:45Z, not 00:14 the next day.
    expectInstant(scheduledInstant(calledAt), '2026-10-15T07:45:00.000Z');
  });

  it('picks the sitting the token was issued in', async () => {
    // Numbering restarts per shift, so an evening token 4 must be judged
    // against the evening's end, not the morning's.
    withGracePeriod(15);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue({
        ...morningSession,
        segments: [
          { start: 540, end: 780 },
          { start: 1020, end: 1260 },
        ],
      });

    const calledAt = Date.now();
    await autoNoShowQueue.scheduleAutoNoShow({
      id: 'appt-evening',
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      appointmentDate: APPOINTMENT_DATE,
      appointmentTime: '23:59',
      tokenNo: 4,
      sessionIndex: 2,
    });

    // 21:00 IST + 15m = 21:15 IST = 15:45Z.
    expectInstant(scheduledInstant(calledAt), '2026-10-15T15:45:00.000Z');
  });

  it('counts a time-based booking from its own slot', async () => {
    withGracePeriod(15);
    const segments = jest.spyOn(
      ScheduleShiftService,
      'resolveDaySegmentsForTokens'
    );

    const calledAt = Date.now();
    await autoNoShowQueue.scheduleAutoNoShow({
      id: 'appt-time',
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      appointmentDate: APPOINTMENT_DATE,
      appointmentTime: '10:00',
      tokenNo: null,
      sessionIndex: null,
    });

    // 10:00 IST + 15m = 10:15 IST = 04:45Z, with no schedule lookup at all.
    expectInstant(scheduledInstant(calledAt), '2026-10-15T04:45:00.000Z');
    expect(segments).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when no session resolves', async () => {
    // Late is survivable; marking someone absent before their turn is not.
    withGracePeriod(15);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(null);

    const calledAt = Date.now();
    await autoNoShowQueue.scheduleAutoNoShow({
      id: 'appt-orphan',
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      appointmentDate: APPOINTMENT_DATE,
      appointmentTime: '23:59',
      tokenNo: 4,
      sessionIndex: 1,
    });

    // 23:59 IST + 15m = 00:14 IST next day = 18:44Z.
    expectInstant(scheduledInstant(calledAt), '2026-10-15T18:44:00.000Z');
  });

  it('queues nothing for a deadline already past', async () => {
    withGracePeriod(15);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(morningSession);

    await autoNoShowQueue.scheduleAutoNoShow({
      id: 'appt-old',
      clinicId: 'clinic-1',
      doctorId: 'doctor-1',
      appointmentDate: new Date('2020-01-06'),
      appointmentTime: '23:59',
      tokenNo: 4,
      sessionIndex: 1,
    });

    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('clinic no-show list date filter', () => {
  /** Every Date bound drizzle was handed for this query. */
  const boundsOf = (condition: unknown): string[] => {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (node == null) return;
      if (node instanceof Date) {
        found.push(node.toISOString());
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      walk(record.queryChunks);
      walk(record.value);
    };
    walk(condition);
    return found;
  };

  const whereOf = (query: Record<string, unknown>) =>
    boundsOf((query.where as jest.Mock).mock.calls[0][0]);

  const runWithRange = async (start?: string, end?: string) => {
    const query = chain([]);
    (database.select as jest.Mock).mockReturnValue(query);

    await NoShowService.getClinicNoShowList('clinic-1', start, end);

    return whereOf(query);
  };

  it('covers the whole of the last IST day, in any server zone', async () => {
    // The bug: setHours(23,59,59) applied the server's zone to a column
    // holding IST wall clock, so on an IST machine "today" ended at 18:29Z
    // and a 19:19 no-show vanished from a range ending today.
    const bounds = await runWithRange('2026-09-01', '2026-09-09');

    expect(bounds).toContain('2026-09-01T00:00:00.000Z');
    expect(bounds).toContain('2026-09-09T23:59:59.999Z');
  });

  it('holds a no-show marked late in the IST evening', async () => {
    const bounds = await runWithRange('2026-09-09', '2026-09-09');
    // How the driver hands back that zone-less column for a 19:19 IST row.
    const markedAt = new Date('2026-09-09T19:19:00.000Z').getTime();

    const [lower, upper] = bounds.map((iso) => new Date(iso).getTime()).sort();
    expect(markedAt).toBeGreaterThanOrEqual(lower);
    expect(markedAt).toBeLessThanOrEqual(upper);
  });

  it('adds no date bound when the range is omitted', async () => {
    expect(await runWithRange()).toEqual([]);
  });
});

/** A no-show counts against the patient and escalates to penalties, so it must
 * never record the doctor failing to turn up. */
describe('auto no-show — the doctor has to have turned up', () => {
  const evening = {
    source: 'weekly' as const,
    slotMinutes: null,
    stepMinutes: null,
    segments: [
      { start: 540, end: 780 },
      { start: 1020, end: 1260 },
    ],
  };

  const queueToken = (sessionIndex: number) =>
    (database.select as jest.Mock).mockReturnValue(
      chain([
        {
          id: 'appt-1',
          appointmentStatus: 'Upcoming',
          clinicId: 'clinic-1',
          doctorId: 'doctor-1',
          appointmentDate: new Date('2026-10-15'),
          appointmentTime: '23:59',
          tokenNo: 4,
          sessionIndex,
        },
      ])
    );

  const arrival = {
    doctorId: 'doctor-1',
    arrivedAt: '2026-10-15T11:39:00.000Z',
    sessionStart: '17:00',
    source: 'reception' as const,
    createdBy: 'user-1',
  };

  it('leaves the patient alone when the clinic never opened', async () => {
    queueToken(2);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(evening);
    jest.spyOn(DoctorArrivalService, 'getArrival').mockResolvedValue(null);
    const marked = jest.spyOn(NoShowService, 'markAsNoShow');

    await runJob({ data: { appointmentId: 'appt-1', clinicId: 'clinic-1' } });

    expect(marked).not.toHaveBeenCalled();
  });

  it('still marks the patient absent from a clinic that did open', async () => {
    queueToken(2);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(evening);
    jest.spyOn(DoctorArrivalService, 'getArrival').mockResolvedValue(arrival);
    const marked = jest
      .spyOn(NoShowService, 'markAsNoShow')
      .mockResolvedValue({} as never);

    await runJob({ data: { appointmentId: 'appt-1', clinicId: 'clinic-1' } });

    expect(marked).toHaveBeenCalledTimes(1);
  });

  it("asks about the token's own sitting, not the day's first", async () => {
    queueToken(2);
    jest
      .spyOn(ScheduleShiftService, 'resolveDaySegmentsForTokens')
      .mockResolvedValue(evening);
    const lookup = jest
      .spyOn(DoctorArrivalService, 'getArrival')
      .mockResolvedValue(arrival);
    jest.spyOn(NoShowService, 'markAsNoShow').mockResolvedValue({} as never);

    await runJob({ data: { appointmentId: 'appt-1', clinicId: 'clinic-1' } });

    // A morning arrival says nothing about whether the evening clinic ran.
    expect(lookup).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      '2026-10-15',
      '17:00'
    );
  });
});
