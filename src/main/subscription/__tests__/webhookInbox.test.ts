import { HttpError } from '../../../middlewear/errorHandler';
import { WebhookService as Inbox } from '../services/billing/webhook.service';

const dispatch = jest.fn();
const updates: Record<string, unknown>[] = [];
let claimed: Record<string, unknown> | null = null;

jest.mock('../../payment/services/razorpayWebhookRouter.service', () => ({
  RazorpayWebhookRouter: { dispatch: (b: unknown) => dispatch(b) },
}));
jest.mock('../../../utils/logger');
const notify = jest.fn();
jest.mock('../../notifications/queues/notification.queue', () => ({
  notify: (...a: unknown[]) => notify(...a),
}));
jest.mock('../../../configurations/dbConnection', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['from', 'where', 'orderBy', 'set']) c[k] = () => c;
    c.limit = async () => result();
    c.returning = async () => result();
    c.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(undefined).then(ok);
    return c;
  };
  return {
    database: {
      select: () => chain(() => [{ id: 'row1' }]),
      update: () => {
        const c = chain(() => (claimed ? [claimed] : []));
        const set = c.set as () => unknown;
        c.set = (v: Record<string, unknown>) => {
          updates.push(v);
          return set();
        };
        return c;
      },
    },
  };
});

const event = {
  id: 'row1',
  eventId: 'evt_1',
  eventType: 'transfer.failed',
  attempts: 1,
  payload: { event: 'transfer.failed' },
};
const last = () => updates[updates.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;
  claimed = event;
});

describe('Razorpay webhook inbox', () => {
  it('runs a stored event of any type through the router and marks it processed', async () => {
    dispatch.mockResolvedValue(undefined);
    await Inbox.processDue();
    expect(dispatch).toHaveBeenCalledWith({ event: 'transfer.failed' });
    expect(last()).toMatchObject({ status: 'processed', error: null });
  });

  it('a failure is marked failed with a retry time', async () => {
    dispatch.mockRejectedValue(new Error('db down'));
    await Inbox.processDue();
    expect(last()).toMatchObject({
      status: 'failed',
      error: 'db down',
      nextAttemptAt: expect.any(Date),
    });
  });

  it('the last failed try alerts Super Admins once', async () => {
    claimed = { ...event, attempts: 10 };
    dispatch.mockRejectedValue(new Error('db down'));
    await Inbox.processDue();
    expect(last()).toMatchObject({ status: 'failed', nextAttemptAt: null });
    expect(notify).toHaveBeenCalledWith(
      'platform.webhook_stuck',
      { eventType: 'transfer.failed', error: 'db down' },
      { jobId: 'platform.webhook_stuck|evt_1' }
    );
  });

  it('a failure with tries left does not alert', async () => {
    dispatch.mockRejectedValue(new Error('db down'));
    await Inbox.processDue();
    expect(notify).not.toHaveBeenCalled();
  });

  it('a business refusal is kept as a note and not retried', async () => {
    dispatch.mockRejectedValue(new HttpError(409, 'Already applied'));
    await Inbox.processDue();
    expect(last()).toMatchObject({
      status: 'processed',
      error: 'Already applied',
    });
  });

  it('an event another server already claimed is skipped', async () => {
    claimed = null;
    await Inbox.processDue();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
