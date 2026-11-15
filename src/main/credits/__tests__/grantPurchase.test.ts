import { database } from '../../../configurations/dbConnection';
import { GrantsService } from '../services/core/grants.service';
import { CreditSettingsService } from '../services/core/settings.service';

jest.mock('../../../configurations/dbConnection', () => ({
  database: { insert: jest.fn() },
}));
jest.mock('../../../utils/logger');

// An insert that resolves to `rows`, as onConflictDoNothing().returning() does.
const insertReturning = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['values', 'onConflictDoNothing', 'returning'])
    q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(rows).then(ok);
  return q;
};
const input = {
  clinicId: 'c1',
  creditType: 'whatsapp' as const,
  credits: 500,
  paymentId: 'pay-1',
  reason: 'Bought WhatsApp messages × 500',
};

describe('GrantsService.grantPurchase', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .spyOn(CreditSettingsService, 'getInForce')
      .mockResolvedValue({ expiryDays: 365 } as never);
  });

  it('adds the credits the first time a payment is reported', async () => {
    (database.insert as jest.Mock).mockReturnValueOnce(
      insertReturning([{ id: 'g1' }])
    );
    await expect(GrantsService.grantPurchase(input)).resolves.toEqual({
      added: true,
    });
  });

  it('adds nothing when the same payment is reported again', async () => {
    (database.insert as jest.Mock).mockReturnValueOnce(insertReturning([]));
    await expect(GrantsService.grantPurchase(input)).resolves.toEqual({
      added: false,
    });
  });
});
