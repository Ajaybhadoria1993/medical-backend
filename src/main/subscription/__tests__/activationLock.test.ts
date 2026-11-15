import {
  ActivationLockBusyError,
  withSubscriptionActivationLock,
} from '../utils/activationLock.utils';

const store = new Map<string, string>();

jest.mock('../../../configurations/redisConfig', () => ({
  __esModule: true,
  default: {
    set: jest.fn(async (key: string, token: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, token);
      return 'OK';
    }),
    eval: jest.fn(
      async (_script: string, _n: number, key: string, token: string) => {
        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
    ),
  },
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withSubscriptionActivationLock', () => {
  beforeEach(() => {
    store.clear();
  });

  it('returns the work result and releases the lock', async () => {
    await expect(
      withSubscriptionActivationLock('clinic-1', async () => 'done')
    ).resolves.toBe('done');
    expect(store.size).toBe(0);
  });

  it('releases the lock when the work throws', async () => {
    await expect(
      withSubscriptionActivationLock('clinic-1', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(store.size).toBe(0);
  });

  it('runs concurrent activations for one clinic one at a time', async () => {
    const order: string[] = [];
    const run = (name: string) =>
      withSubscriptionActivationLock('clinic-1', async () => {
        order.push(`${name}:start`);
        await sleep(40);
        order.push(`${name}:end`);
      });

    await Promise.all([run('verify'), run('webhook'), run('refresh')]);

    // Never interleaved: each start is immediately followed by its own end.
    expect(order).toHaveLength(6);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].endsWith(':start')).toBe(true);
      expect(order[i + 1]).toBe(order[i].replace(':start', ':end'));
    }
  });

  it('does not block activations for different clinics', async () => {
    const order: string[] = [];
    const run = (clinicId: string) =>
      withSubscriptionActivationLock(clinicId, async () => {
        order.push(`${clinicId}:start`);
        await sleep(40);
        order.push(`${clinicId}:end`);
      });

    await Promise.all([run('clinic-1'), run('clinic-2')]);

    expect(order.slice(0, 2).every((entry) => entry.endsWith(':start'))).toBe(
      true
    );
  });

  it('fails fast without waiting when asked not to wait', async () => {
    let release!: () => void;
    const holder = withSubscriptionActivationLock(
      'clinic-1',
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await sleep(10);

    await expect(
      withSubscriptionActivationLock('clinic-1', async () => 'x', {
        waitMs: 0,
      })
    ).rejects.toBeInstanceOf(ActivationLockBusyError);

    release();
    await holder;
    expect(store.size).toBe(0);
  });

  it('gives up with a 409 once the wait budget is spent', async () => {
    let release!: () => void;
    const holder = withSubscriptionActivationLock(
      'clinic-1',
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await sleep(10);

    await expect(
      withSubscriptionActivationLock('clinic-1', async () => 'x', {
        waitMs: 200,
      })
    ).rejects.toMatchObject({ status: 409 });

    release();
    await holder;
  });
});
