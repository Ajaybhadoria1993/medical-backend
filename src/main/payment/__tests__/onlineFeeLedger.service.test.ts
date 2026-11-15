import { MoneyWriteService } from '../../money';
import { DynamicSplitEngine } from '../engine/dynamicSplit.engine';
import type { IFeeConfig } from '../interfaces/splitEngine.types';
import { OnlineFeeLedger } from '../services/onlineFeeLedger.service';

// post() is stubbed: these tests check what the fee writer hands to the ledger.
const post = jest
  .spyOn(MoneyWriteService, 'post')
  .mockImplementation(async () => []);
const tx = {} as Parameters<typeof OnlineFeeLedger.record>[0];

const fee = (feeType: string, rate: number, priority: number): IFeeConfig => ({
  feeName: feeType,
  feeType,
  enabled: true,
  calculationMethod: 'PERCENTAGE',
  calculationBase: 'CLINIC_SERVICE_PRICE',
  rateOrAmount: rate,
  taxRate: 18,
  taxTreatment: 'TAX_EXCLUSIVE',
  priority,
  effectiveFrom: new Date(0),
});
const split = DynamicSplitEngine.calculate(500, [
  fee('CONVENIENCE_FEE', 4, 1),
  fee('CLINIC_COMMISSION', 5, 2),
  fee('GATEWAY_FEE', 2, 3),
  fee('ROUTE_TRANSFER_FEE', 0.25, 4),
]);
const run = (snapshot: unknown) =>
  OnlineFeeLedger.record(tx, {
    clinicId: 'clinic',
    patientId: 'patient',
    doctorId: 'doctor',
    appointmentId: 'visit',
    paymentId: 'pay_1',
    snapshot: snapshot as never,
  });
const sent = () => post.mock.calls[0][1];
const amount = (account: string) =>
  sent().lines.find((l) => l.account === account)?.amountPaise ?? 0;

beforeEach(() => post.mockClear());

describe('OnlineFeeLedger.record', () => {
  it('books every fee as patient-paid, keyed by the Razorpay payment', async () => {
    await run(split.breakdown);
    expect(sent()).toMatchObject({
      requestId: 'razorpay:fees:pay_1',
      gatewayRef: 'pay_1',
      channel: 'online',
      sourceId: 'visit',
    });
    expect(amount('clinic_fees')).toBe(0);
    expect(amount('convenience_fee')).toBe(2000);
    expect(amount('platform_commission')).toBe(2500);
  });

  it('clinic amount + fees through Razorpay = what the patient paid', async () => {
    await run(split.breakdown);
    const clinicPaise = Math.round(split.clinicAmount * 100);
    expect(clinicPaise + amount('gateway_clearing')).toBe(
      Math.round(split.patientTotal * 100)
    );
  });

  it('the journal balances', async () => {
    await run(split.breakdown);
    const net = sent().lines.reduce(
      (n, l) => n + (l.side === 'debit' ? l.amountPaise : -l.amountPaise),
      0
    );
    expect(net).toBe(0);
  });

  it('a booking without a snapshot books nothing', async () => {
    expect(await run(null)).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('a booking with no fees books nothing', async () => {
    const free = DynamicSplitEngine.calculate(500, []);
    expect(await run(free.breakdown)).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });
});
