/**
 * Unit tests for QueueTickService's change detection.
 *
 * The tick runs every minute against every active doctor, so the thing worth
 * pinning down is not that it recalculates — it is that it stays quiet when
 * nothing moved. A fingerprint that changes on every tick would fan out to
 * every patient socket in every clinic once a minute, which is the failure this
 * design exists to avoid.
 */

import { QueueTickService } from '../services/queueTick.service';
import { QueueDelayData } from '../types/engine.types';
import { realtimeBus, target } from '../../realtime';

const CLINIC = 'clinic-1';
const DOCTOR = 'doctor-1';
const DATE = '2026-08-14';

function entry(over: Partial<QueueDelayData['appointments'][number]> = {}) {
  return {
    appointmentId: 'a1',
    patientId: 'p1',
    userId: 'u1',
    status: 'Upcoming' as const,
    scheduledTime: '09:00',
    tokenNo: null,
    projectedStartTime: '09:00',
    estimatedWaitMinutes: 0,
    durationMinutes: 30,
    ...over,
  };
}

function queue(
  over: Partial<QueueDelayData> = {},
  entries = [entry()]
): QueueDelayData {
  return {
    clinicId: CLINIC,
    doctorId: DOCTOR,
    date: DATE,
    cumulativeDelayMinutes: 0,
    lastCalculatedAt: new Date().toISOString(),
    appointments: entries,
    ...over,
  };
}

/** The fingerprint is private; these tests are about its behaviour, not shape. */
const fingerprintOf = (service: QueueTickService, data: QueueDelayData) =>
  (
    service as unknown as {
      fingerprint: (d: QueueDelayData) => string;
    }
  ).fingerprint(data);

describe('QueueTickService fingerprint', () => {
  let service: QueueTickService;

  beforeEach(() => {
    service = new QueueTickService();
  });

  it('is stable across recalculations that changed nothing', () => {
    // Same queue, recalculated a minute later: lastCalculatedAt differs and
    // nothing a patient could see does. Including that timestamp would make
    // every fingerprint unique and broadcast to everyone every minute.
    const first = queue({ lastCalculatedAt: '2026-08-14T09:00:00.000Z' });
    const second = queue({ lastCalculatedAt: '2026-08-14T09:01:00.000Z' });

    expect(fingerprintOf(service, first)).toBe(fingerprintOf(service, second));
  });

  it('changes when a projected start time moves', () => {
    const before = queue({}, [entry({ projectedStartTime: '09:00' })]);
    const after = queue({}, [entry({ projectedStartTime: '09:30' })]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });

  it('changes when a wait estimate moves', () => {
    const before = queue({}, [entry({ estimatedWaitMinutes: 0 })]);
    const after = queue({}, [entry({ estimatedWaitMinutes: 15 })]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });

  it('changes when a status moves', () => {
    const before = queue({}, [entry({ status: 'Upcoming' })]);
    const after = queue({}, [entry({ status: 'Confirmed' })]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });

  it('changes when the cumulative delay moves', () => {
    const before = queue({ cumulativeDelayMinutes: 0 });
    const after = queue({ cumulativeDelayMinutes: 20 });

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });

  it('changes when an appointment joins or leaves the queue', () => {
    const before = queue({}, [entry({ appointmentId: 'a1' })]);
    const after = queue({}, [
      entry({ appointmentId: 'a1' }),
      entry({ appointmentId: 'a2', scheduledTime: '09:30' }),
    ]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });
});

describe('QueueTickService fingerprint bucketing', () => {
  let service: QueueTickService;

  beforeEach(() => {
    service = new QueueTickService();
  });

  it('ignores a one-minute drift', () => {
    // The case this exists for: a doctor running behind has every waiting
    // patient pinned to "now", so the wait ticks up by one every minute. Left
    // exact, that broadcast to every patient socket in the clinic once a
    // minute, indefinitely.
    const before = queue({}, [entry({ estimatedWaitMinutes: 31 })]);
    const after = queue({}, [entry({ estimatedWaitMinutes: 32 })]);

    expect(fingerprintOf(service, before)).toBe(fingerprintOf(service, after));
  });

  it('still notices a move across a bucket', () => {
    const before = queue({}, [entry({ estimatedWaitMinutes: 29 })]);
    const after = queue({}, [entry({ estimatedWaitMinutes: 31 })]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });

  it('buckets the projected start too', () => {
    const before = queue({}, [entry({ projectedStartTime: '09:31' })]);
    const same = queue({}, [entry({ projectedStartTime: '09:33' })]);
    const later = queue({}, [entry({ projectedStartTime: '09:37' })]);

    expect(fingerprintOf(service, before)).toBe(fingerprintOf(service, same));
    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, later)
    );
  });

  it('never delays a status change', () => {
    // Status is compared exactly: "you're next" must land the moment it is
    // true, whatever the bucket says about the minutes.
    const before = queue({}, [
      entry({ status: 'Upcoming', estimatedWaitMinutes: 31 }),
    ]);
    const after = queue({}, [
      entry({ status: 'Confirmed', estimatedWaitMinutes: 31 }),
    ]);

    expect(fingerprintOf(service, before)).not.toBe(
      fingerprintOf(service, after)
    );
  });
});

describe('QueueTickService overlap guard', () => {
  it('skips a tick while the previous one is still running', async () => {
    const service = new QueueTickService();

    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Hold the first tick open inside its DB lookup, then start a second one.
    jest
      .spyOn(
        service as unknown as {
          findActiveDoctors: () => Promise<unknown[]>;
        },
        'findActiveDoctors'
      )
      .mockImplementation(async () => {
        await blocked;
        return [];
      });

    const first = service.tick();
    const second = await service.tick();

    // A slow tick must not have a second one pile up behind it — that is how a
    // one-minute schedule turns into unbounded concurrent DB work.
    expect(second).toEqual({ doctorsScanned: 0, doctorsBroadcast: 0 });

    release();
    await first;
  });
});

describe('QueueTickService listener gate', () => {
  /**
   * Builds a service whose queue always has content, with the notifier and
   * broadcaster stubbed so the test can assert which of them ran.
   */
  function buildGated(hasListeners: boolean) {
    const service = new QueueTickService();

    const evaluate = jest.fn().mockResolvedValue(undefined);
    const emitQueue = jest.fn();
    const emitPatients = jest.fn().mockResolvedValue(undefined);

    // The collaborators are replaced wholesale rather than spied on: the test
    // is about which of them the gate lets run, not about their internals.
    (service as unknown as { delayTracker: unknown }).delayTracker = {
      recalculate: jest.fn().mockResolvedValue(queue({}, [entry()])),
    };

    (service as unknown as { notifier: unknown }).notifier = {
      evaluateFromCache: evaluate,
    };
    (service as unknown as { broadcaster: unknown }).broadcaster = {
      emitQueueUpdated: emitQueue,
      emitPatientUpdated: emitPatients,
    };
    jest
      .spyOn(
        service as unknown as { hasListeners: () => Promise<boolean> },
        'hasListeners'
      )
      .mockResolvedValue(hasListeners);

    return { service, evaluate, emitQueue };
  }

  const refresh = (service: QueueTickService) =>
    (
      service as unknown as {
        refreshDoctor: (c: string, d: string, date: string) => Promise<boolean>;
      }
    ).refreshDoctor(CLINIC, DOCTOR, DATE);

  // Spied, not module-mocked: loading the service boots app.ts, which calls attach().
  beforeEach(() => {
    jest.spyOn(realtimeBus, 'notify').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('skips the broadcast when nobody is connected', async () => {
    const { service, emitQueue } = buildGated(false);

    await expect(refresh(service)).resolves.toBe(false);
    expect(emitQueue).not.toHaveBeenCalled();
    expect(realtimeBus.notify).not.toHaveBeenCalled();
  });

  it('signals the queue section so web screens refetch', async () => {
    // The web app ignores `queue.updated`; without this signal its delay and
    // estimates froze between events while the clock moved on.
    const { service } = buildGated(true);

    await refresh(service);

    expect(realtimeBus.notify).toHaveBeenCalledWith(
      target.queue(CLINIC, DOCTOR, DATE),
      'queue.recalculated'
    );
  });

  it('still evaluates running-late with nobody connected', async () => {
    // The correctness constraint behind the gate: the per-appointment BullMQ
    // running-late job is only ever scheduled when a patient opens their live
    // queue, so for a queue nobody is watching this tick is the only thing that
    // will notice a doctor crossing the threshold. A push has to reach a
    // patient whether or not their app is open.
    const { service, evaluate } = buildGated(false);

    await refresh(service);

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('broadcasts when someone is connected', async () => {
    const { service, emitQueue } = buildGated(true);

    await expect(refresh(service)).resolves.toBe(true);
    expect(emitQueue).toHaveBeenCalledTimes(1);
  });
});
