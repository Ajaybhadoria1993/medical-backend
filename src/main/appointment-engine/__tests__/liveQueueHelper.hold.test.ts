/**
 * Unit tests for buildPayloadFromQueue's hold-awareness — the patient-facing
 * side of the same fix as delayTracker.hold.test.ts.
 *
 * Two things must be true once a patient is held/skipped:
 * 1. Anyone waiting BEHIND them must not count them as "ahead" — they are
 *    paused, not progressing toward being seen.
 * 2. Their OWN payload must show nothing "live" (no countdown, no running-late
 *    flag) — a moving ETA next to "you are on hold" would contradict itself.
 */

import { buildPayloadFromQueue } from '../services/liveQueueHelper';
import type {
  QueueDelayData,
  AppointmentDelayEntry,
} from '../types/engine.types';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

function entry(
  over: Partial<AppointmentDelayEntry> & { appointmentId: string }
): AppointmentDelayEntry {
  return {
    patientId: `p-${over.appointmentId}`,
    userId: `u-${over.appointmentId}`,
    status: 'Patient Arrived',
    scheduledTime: '09:00',
    tokenNo: null,
    projectedStartTime: '09:00',
    estimatedWaitMinutes: 0,
    durationMinutes: 15,
    isOnHold: false,
    ...over,
  };
}

function buildQueueData(appointments: AppointmentDelayEntry[]): QueueDelayData {
  return {
    clinicId: CLINIC,
    doctorId: DOCTOR,
    date: DATE,
    cumulativeDelayMinutes: 0,
    lastCalculatedAt: '2026-08-14T09:05:00.000Z',
    appointments,
  };
}

describe("buildPayloadFromQueue — a held patient is excluded from everyone else's count", () => {
  const queueData = buildQueueData([
    entry({
      appointmentId: 'cur',
      status: 'Confirmed',
      scheduledTime: '09:00',
      projectedStartTime: '09:00',
    }),
    entry({
      appointmentId: 'held1',
      scheduledTime: '09:15',
      projectedStartTime: '09:15',
      isOnHold: true,
      holdReason: 'held',
    }),
    entry({
      appointmentId: 'wait1',
      scheduledTime: '09:30',
      projectedStartTime: '09:20',
    }),
    entry({
      appointmentId: 'wait2',
      scheduledTime: '09:45',
      projectedStartTime: '09:35',
    }),
  ]);

  it("does not count the held patient toward someone behind them's patientsAhead", () => {
    const payload = buildPayloadFromQueue('wait2', queueData);

    // Order is [cur, held1, wait1, wait2]. Without the hold-exclusion, wait2
    // would see 3 patients ahead (cur, held1, wait1). With it, held1 is
    // skipped: only cur and wait1 are actually "ahead" of wait2.
    expect(payload.queue.patientsAhead).toBe(2);
    // Same exclusion, expressed as an absolute rank: cur=1, wait1=2, held1
    // has no rank, so wait2 is 3rd in line, not 4th.
    expect(payload.queue.position).toBe(3);
  });

  it("shows nothing live for the held patient's own payload", () => {
    const payload = buildPayloadFromQueue('held1', queueData, 10);

    expect(payload.isOnHold).toBe(true);
    expect(payload.holdReason).toBe('held');
    // No rank in the line while paused.
    expect(payload.queue.position).toBeNull();
    // No live projection while paused.
    expect(payload.tentativeStartTime).toBeNull();
    expect(payload.isTentative).toBe(false);
    expect(payload.delay.untilSeenMinutes).toBeNull();
    // Suppressed with a 10 min threshold in force — nothing "live" applies
    // while held.
    expect(payload.delay.isLate).toBe(false);
    expect(payload.delay.lateMinutes).toBeNull();
  });

  it('an unheld patient is unaffected — still gets a live projection', () => {
    const payload = buildPayloadFromQueue('wait1', queueData);

    expect(payload.isOnHold).toBe(false);
    expect(payload.holdReason).toBeNull();
    expect(payload.tentativeStartTime).toBe('09:20');
    expect(payload.isTentative).toBe(true);
    // cur=1, held1 has no rank, so wait1 is 2nd in line.
    expect(payload.queue.position).toBe(2);
  });
});

describe('buildPayloadFromQueue — running late follows the live queue', () => {
  const late = (estimatedWaitMinutes: number) =>
    buildQueueData([
      entry({
        appointmentId: 'me',
        estimatedWaitMinutes,
        projectedStartTime: '09:40',
      }),
    ]);

  it('reports the live delay once it passes the threshold', () => {
    const payload = buildPayloadFromQueue('me', late(25), 10);

    expect(payload.delay.isLate).toBe(true);
    expect(payload.delay.lateMinutes).toBe(25);
  });

  it('clears the banner as soon as the live delay is back under the threshold', () => {
    // A stale alert value used to keep "running late" on screen for 24h.
    const payload = buildPayloadFromQueue('me', late(5), 10);

    expect(payload.delay.isLate).toBe(false);
    expect(payload.delay.lateMinutes).toBeNull();
  });
});

describe('buildPayloadFromQueue — queue.stage agrees with the fields beside it', () => {
  const stageOf = (id: string, entries: AppointmentDelayEntry[]) =>
    buildPayloadFromQueue(id, buildQueueData(entries)).queue.stage;

  it('never tells a held patient they are almost there', () => {
    // Held: no place in line, so patientsAhead reads 0 — which used to map to
    // "almost-there" right beside "you are on hold".
    expect(
      stageOf('held', [
        entry({ appointmentId: 'held', isOnHold: true, holdReason: 'held' }),
      ])
    ).toBe('in-queue');
  });

  it('treats a Confirmed patient outside the room as checked in', () => {
    // Taken out of the room keeps `Confirmed`; it used to read as not arrived
    // while isCheckedIn said true.
    const payload = buildPayloadFromQueue(
      'c1',
      buildQueueData([entry({ appointmentId: 'c1', status: 'Confirmed' })])
    );
    expect(payload.isCheckedIn).toBe(true);
    expect(payload.queue.stage).toBe('almost-there');
  });

  it('counts everyone still in line as ahead of a held patient', () => {
    // 0 read as "you're next" for someone reception had paused.
    const payload = buildPayloadFromQueue(
      'held',
      buildQueueData([
        entry({ appointmentId: 'a' }),
        entry({
          appointmentId: 'held',
          status: 'Upcoming',
          isOnHold: true,
          holdReason: 'held',
        }),
        entry({ appointmentId: 'b', status: 'Upcoming' }),
      ])
    );
    expect(payload.isOnHold).toBe(true);
    expect(payload.queue.patientsAhead).toBe(2);
    expect(payload.queue.position).toBeNull();
    // Not checked in yet: the stage stays "not-arrived"; isOnHold shows the pause.
    expect(payload.queue.stage).toBe('not-arrived');
  });

  it('reads not-arrived until reception checks the patient in', () => {
    expect(
      stageOf('u1', [entry({ appointmentId: 'u1', status: 'Upcoming' })])
    ).toBe('not-arrived');
  });

  it('is in-queue with more than 5 ahead, almost-there at 5', () => {
    const line = Array.from({ length: 7 }, (_, i) =>
      entry({ appointmentId: `p${i}` })
    );
    expect(stageOf('p6', line)).toBe('in-queue'); // 6 ahead
    expect(stageOf('p5', line)).toBe('almost-there'); // 5 ahead
  });
});
