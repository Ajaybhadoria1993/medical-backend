/**
 * Unit tests for the realtime signal bus.
 *
 * The bus is the one place the server says "something changed", so the
 * behaviours worth pinning down are the ones a client cannot recover from on
 * its own: a signal carrying a wrong version, or a signal reaching the wrong
 * room. Both are silent failures in production — a screen that never updates
 * looks identical to a clinic where nothing happened.
 */

const mockPipeline = {
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn(),
};

const mockRedis = {
  pipeline: jest.fn(() => mockPipeline),
  get: jest.fn(),
};

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: mockRedis,
}));

jest.mock('../../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { bumpVersion, readVersion } from '../services/streamVersion.service';
import { realtimeBus, REALTIME_EVENT } from '../services/realtimeBus.service';
import { target } from '../utils/sections';
import { rooms } from '../utils/rooms';

/** Minimal stand-in for the socket.io server: records what was emitted where. */
function makeIo() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  return { io: { to } as never, to, emit };
}

/** Lets the bus's fire-and-forget promise chain settle. */
const flush = () => new Promise(process.nextTick);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rooms and sections', () => {
  it('addresses a queue signal to the doctor room, not the whole clinic', () => {
    // The clinic room also holds pharmacy and lab screens, which have no use
    // for one doctor's queue changing.
    const t = target.queue('c1', 'd1', '2026-08-21');
    expect(t.room).toBe(rooms.clinicDoctor('c1', 'd1'));
    expect(t.room).not.toBe(rooms.clinic('c1'));
  });

  it('addresses an appointment signal to the patient, not the clinic', () => {
    const t = target.appointment('a1', 'p1');
    expect(t.room).toBe(rooms.user('p1'));
  });

  it('scopes a queue section by date so counters roll over daily', () => {
    expect(target.queue('c1', 'd1', '2026-08-21').section).not.toBe(
      target.queue('c1', 'd1', '2026-08-22').section
    );
  });

  it('gives every doctor in a clinic a distinct queue section', () => {
    expect(target.queue('c1', 'd1', '2026-08-21').section).not.toBe(
      target.queue('c1', 'd2', '2026-08-21').section
    );
  });

  it('addresses an encounter signal to the doctor room, not the patient', () => {
    // The opposite room from `appointment` above — this is what lets a
    // doctor's own open patient screen see a vitals-only edit at all.
    const t = target.encounter('c1', 'd1', 'a1');
    expect(t.room).toBe(rooms.clinicDoctor('c1', 'd1'));
    expect(t.room).not.toBe(rooms.user('a1'));
  });

  it('gives every appointment a distinct encounter section', () => {
    expect(target.encounter('c1', 'd1', 'a1').section).not.toBe(
      target.encounter('c1', 'd1', 'a2').section
    );
  });

  it('addresses a billing signal to the whole clinic, like board', () => {
    // Reception, admin and billing screens all need to see the same payment
    // state regardless of which doctor an appointment belongs to.
    const t = target.billing('c1');
    expect(t.room).toBe(rooms.clinic('c1'));
  });

  it('addresses a lab signal to the lab room, not the clinic', () => {
    // Narrower on purpose — a lab worklist update should not wake every
    // clinic screen the way `board`/`billing` intentionally do.
    const t = target.lab('l1');
    expect(t.room).toBe(rooms.lab('l1'));
    expect(t.room).not.toBe(rooms.clinic('c1'));
  });

  it('gives every lab a distinct worklist section', () => {
    expect(target.lab('l1').section).not.toBe(target.lab('l2').section);
  });

  it('addresses a staff signal to the whole clinic, like board/billing', () => {
    const t = target.staff('c1');
    expect(t.room).toBe(rooms.clinic('c1'));
  });
});

describe('bumpVersion', () => {
  it('increments monotonically and returns each new value', async () => {
    mockPipeline.exec
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ])
      .mockResolvedValueOnce([
        [null, 2],
        [null, 1],
      ])
      .mockResolvedValueOnce([
        [null, 3],
        [null, 1],
      ]);

    await expect(bumpVersion('queue:c1:d1:2026-08-21')).resolves.toBe(1);
    await expect(bumpVersion('queue:c1:d1:2026-08-21')).resolves.toBe(2);
    await expect(bumpVersion('queue:c1:d1:2026-08-21')).resolves.toBe(3);
  });

  it('refreshes the TTL on every bump, so an all-day queue never expires', async () => {
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 7],
      [null, 1],
    ]);

    await bumpVersion('board:c1');

    expect(mockPipeline.expire).toHaveBeenCalledWith(
      'rt:v:board:c1',
      36 * 60 * 60
    );
  });

  it('returns null when Redis rejects', async () => {
    mockPipeline.exec.mockRejectedValueOnce(new Error('connection lost'));
    await expect(bumpVersion('board:c1')).resolves.toBeNull();
  });

  it('returns null when the INCR itself errored inside the pipeline', async () => {
    mockPipeline.exec.mockResolvedValueOnce([
      [new Error('WRONGTYPE'), null],
      [null, 1],
    ]);
    await expect(bumpVersion('board:c1')).resolves.toBeNull();
  });
});

describe('readVersion', () => {
  it('reports 0 for a section nothing has changed yet', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    await expect(readVersion('board:c1')).resolves.toBe(0);
  });

  it('parses the stored counter', async () => {
    mockRedis.get.mockResolvedValueOnce('42');
    await expect(readVersion('board:c1')).resolves.toBe(42);
  });

  it('falls back to 0 rather than throwing when Redis is down', async () => {
    // A snapshot request must still succeed without Redis. Version 0 makes the
    // client refetch on the next signal, which is the harmless direction.
    mockRedis.get.mockRejectedValueOnce(new Error('connection lost'));
    await expect(readVersion('board:c1')).resolves.toBe(0);
  });
});

describe('realtimeBus.notify', () => {
  it('emits one signal to the section room, carrying the bumped version', async () => {
    const { io, to, emit } = makeIo();
    realtimeBus.attach(io);
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 5],
      [null, 1],
    ]);

    realtimeBus.notify(
      target.queue('c1', 'd1', '2026-08-21'),
      'appointment.completed'
    );
    await flush();

    expect(to).toHaveBeenCalledWith('clinic:c1:doctor:d1');
    expect(emit).toHaveBeenCalledTimes(1);

    const [event, signal] = emit.mock.calls[0];
    expect(event).toBe(REALTIME_EVENT);
    expect(signal).toMatchObject({
      section: 'queue:c1:d1:2026-08-21',
      v: 5,
      reason: 'appointment.completed',
    });
  });

  it('carries no queue data — only the fact that it changed', async () => {
    const { io, emit } = makeIo();
    realtimeBus.attach(io);
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);

    realtimeBus.notify(target.board('c1'), 'appointment.completed');
    await flush();

    // If the payload ever grows appointments/patients, the frontend gains a
    // second source of truth and the two can disagree. That is the exact
    // failure this design exists to remove.
    expect(Object.keys(emit.mock.calls[0][1]).sort()).toEqual([
      'at',
      'reason',
      'section',
      'v',
    ]);
  });

  it('stays silent when no version could be obtained', async () => {
    const { io, emit } = makeIo();
    realtimeBus.attach(io);
    mockPipeline.exec.mockRejectedValueOnce(new Error('connection lost'));

    realtimeBus.notify(target.board('c1'), 'appointment.completed');
    await flush();

    // A signal without a trustworthy version is worse than none: every client
    // would either ignore it forever or refetch at once.
    expect(emit).not.toHaveBeenCalled();
  });

  it('never throws when the socket server is missing', async () => {
    const bus = realtimeBus as unknown as { io: unknown };
    const saved = bus.io;
    bus.io = null;

    expect(() => realtimeBus.notify(target.board('c1'), 'x')).not.toThrow();
    await flush();

    bus.io = saved;
  });

  it('never throws when emitting itself fails', async () => {
    const failing = {
      to: () => ({
        emit: () => {
          throw new Error('socket gone');
        },
      }),
    } as never;
    realtimeBus.attach(failing);
    mockPipeline.exec.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);

    // The caller is on the request path of a write that already committed, so
    // a socket failure must never surface to them.
    expect(() => realtimeBus.notify(target.board('c1'), 'x')).not.toThrow();
    await flush();
  });
});
