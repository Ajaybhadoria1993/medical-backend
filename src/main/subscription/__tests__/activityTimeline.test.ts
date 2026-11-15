import { database } from '../../../configurations/dbConnection';
import { SubscriptionActivityService } from '../services/subscriptionActivity.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { select: jest.fn() },
}));
jest.mock('../../../utils/logger');

// A query builder that resolves to `rows` however it is chained; `limit` is recorded.
let asked = 0;
const rowsOf = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy']) q[m] = () => q;
  q.limit = (n: number) => {
    asked = n;
    return q;
  };
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, ko);
  return q;
};
const row = (i: number) => ({
  id: `a${i}`,
  type: 'renewal_payment',
  title: 'Renewed Clinic',
  description: 'Active until 15 Dec 2026.',
  amount: '499.00',
  currency: 'INR',
  metadata: { paymentId: `p${i}` },
  createdAt: new Date(Date.UTC(2026, 10, 30 - i)),
});

describe('GET /subscription/activity contract', () => {
  it('returns the page the timeline reads: items newest first, hasMore and a createdAt cursor', async () => {
    (database.select as jest.Mock).mockReturnValue(
      rowsOf([row(0), row(1), row(2)])
    );
    const page = await SubscriptionActivityService.list('clinic-1', {
      limit: 2,
    });

    // One extra row is asked for to know whether another page exists.
    expect(asked).toBe(3);
    expect(page).toEqual({
      items: [
        { ...row(0), amount: 499 },
        { ...row(1), amount: 499 },
      ],
      hasMore: true,
      nextCursor: row(1).createdAt.toISOString(),
    });
  });

  it('keeps the limit between 1 and 100 and ends the list with a null cursor', async () => {
    (database.select as jest.Mock).mockReturnValue(
      rowsOf([{ ...row(0), amount: null }])
    );
    const page = await SubscriptionActivityService.list('clinic-1', {
      limit: 500,
    });
    expect(asked).toBe(101);
    expect(page).toMatchObject({
      hasMore: false,
      nextCursor: null,
      items: [{ amount: null }],
    });
  });
});
