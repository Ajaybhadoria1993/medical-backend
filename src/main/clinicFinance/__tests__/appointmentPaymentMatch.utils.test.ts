import {
  matchAppointmentPayments,
  type RzpPayment,
  type VisitMoney,
} from '../utils/appointmentPaymentMatch.utils';

const pay = (o: Partial<RzpPayment> = {}): RzpPayment => ({
  id: 'pay_1',
  order_id: 'order_1',
  amount: 56310,
  status: 'captured',
  amount_refunded: 0,
  ...o,
});
const visit = (o: Partial<VisitMoney> = {}): VisitMoney => ({
  appointmentId: 'visit_1',
  paymentStatus: 'Paid',
  hasSnapshot: true,
  paidPaise: 50000,
  feePaise: 6310,
  refundedPaise: 0,
  ...o,
});
const run = (
  p: RzpPayment[],
  v: VisitMoney | null,
  ours: { ref: string; appointmentId: string }[] = [],
  refunds: {
    id: string;
    payment_id: string;
    amount: number;
    status: string;
  }[] = []
) =>
  matchAppointmentPayments(
    p,
    refunds,
    new Map(v ? [['order_1', v]] : []),
    ours
  );

describe('matchAppointmentPayments', () => {
  it('a payment recorded with its fees matches', () => {
    expect(run([pay()], visit())).toEqual([]);
  });

  it('money taken with no booking is listed, never fixed', () => {
    expect(run([pay()], null)).toEqual([
      { kind: 'no_booking', ref: 'pay_1', fixable: false },
    ]);
  });

  it('a payment missing on a Paid visit is fixable', () => {
    expect(run([pay()], visit({ paidPaise: 0, feePaise: 0 }))[0]).toMatchObject(
      { kind: 'not_recorded', fixable: true }
    );
  });

  it('a payment missing on a visit not marked Paid needs a person', () => {
    expect(
      run(
        [pay()],
        visit({ paidPaise: 0, feePaise: 0, paymentStatus: 'Pending' })
      )[0]
    ).toMatchObject({ kind: 'not_recorded', fixable: false });
  });

  it('missing fees are fixable only with the booking snapshot', () => {
    expect(run([pay()], visit({ feePaise: 0 }))[0]).toMatchObject({
      kind: 'fees_missing',
      fixable: true,
    });
    expect(
      run([pay()], visit({ feePaise: 0, hasSnapshot: false }))[0]
    ).toMatchObject({
      kind: 'fees_missing',
      fixable: false,
    });
  });

  it('a different amount is listed', () => {
    expect(run([pay({ amount: 60000 })], visit())[0]).toMatchObject({
      kind: 'amount_differs',
      fixable: false,
    });
  });

  it('a refund at Razorpay we did not record is listed', () => {
    expect(
      run([pay({ status: 'refunded', amount_refunded: 50000 })], visit())
    ).toEqual([
      {
        kind: 'refund_missing',
        ref: 'pay_1',
        appointmentId: 'visit_1',
        fixable: false,
      },
    ]);
  });

  it('our refund that Razorpay has not processed is listed', () => {
    const ours = [{ ref: 'rfnd_1', appointmentId: 'visit_1' }];
    expect(run([], null, ours)[0]).toMatchObject({
      kind: 'refund_unknown',
      ref: 'rfnd_1',
    });
    expect(
      run([], null, ours, [
        {
          id: 'rfnd_1',
          payment_id: 'pay_1',
          amount: 50000,
          status: 'processed',
        },
      ])
    ).toEqual([]);
  });

  it('failed or unpaid attempts are ignored', () => {
    expect(run([pay({ status: 'failed' })], null)).toEqual([]);
  });
});
