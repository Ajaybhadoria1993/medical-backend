import { fetchRazorpayRouteAccount } from '../../../utils/razorpay';
import { PayoutAccountSetupService } from '../services/payoutAccount/payoutAccountSetup.service';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));
jest.mock('../../../utils/logger');
jest.mock('../../../utils/razorpay', () => ({
  fetchRazorpayRouteAccount: jest.fn(),
}));

// Private by design (one caller); reached here to pin when an existing account may be reused.
const own = (provider: unknown, ref = 'ref123') =>
  (PayoutAccountSetupService as any).ownAccountForTakenEmail(provider, ref);
const taken = {
  field: 'email',
  description: 'Merchant email already exists for account - Dq0DXlUGNDNIGK',
};
const fetchAccount = fetchRazorpayRouteAccount as jest.Mock;

describe('reusing an account when Razorpay says the email is taken', () => {
  afterEach(() => jest.resetAllMocks());

  it("reuses it when the account carries this clinic's reference", async () => {
    fetchAccount.mockResolvedValue({
      id: 'acc_Dq0DXlUGNDNIGK',
      reference_id: 'ref123',
    });
    await expect(own(taken)).resolves.toBe('acc_Dq0DXlUGNDNIGK');
    expect(fetchAccount).toHaveBeenCalledWith('acc_Dq0DXlUGNDNIGK');
  });

  it("refuses another clinic's or merchant's account", async () => {
    fetchAccount.mockResolvedValue({
      id: 'acc_Dq0DXlUGNDNIGK',
      reference_id: 'someone-else',
    });
    await expect(own(taken)).resolves.toBeNull();
  });

  it('ignores other errors and a failed lookup', async () => {
    await expect(
      own({ field: 'phone', description: 'bad phone' })
    ).resolves.toBeNull();
    fetchAccount.mockRejectedValue(new Error('down'));
    await expect(own(taken)).resolves.toBeNull();
  });
});
