// AppointmentMoneySync with an in-memory ledger and a fake visit row: the real balance and status
// rules run; only the database is stood in for. Locks in today's behaviour before the old
// "edit the payment row" path is removed.
import { AppointmentMoneySync } from '../services/appointmentMoneySync.service';
import { AppointmentPaymentModel } from '../models/appointment-payment.model';
import { AppointmentModel } from '../models/appointment.model';
import { appointmentMultipleService } from '../models/appointmentMultipleService.model';

jest.mock('../../../configurations/dbConnection', () => ({ database: {} }));

type Entry = {
  id: string;
  entryType: string;
  amountPaise: number;
  lineRef: string | null;
  reversesEntryId: string | null;
  requestId: string;
  paymentMode?: string | null;
  reason?: string | null;
  gatewayRef?: string | null;
  channel?: string;
};
const ledger: Entry[] = [];

jest.mock('../../money', () => {
  const actual = jest.requireActual('../../money');
  return {
    ...actual,
    MoneyWriteService: {
      // Idempotent by request id, like the real writer; caps are the callers' own checks here.
      record: jest.fn(async (_tx: unknown, input: Omit<Entry, 'id'>) => {
        const again = ledger.find((e) => e.requestId === input.requestId);
        if (again) return again;
        const entry: Entry = {
          ...input,
          lineRef: input.lineRef ?? null,
          reversesEntryId: input.reversesEntryId ?? null,
          id: `e${ledger.length + 1}`,
        };
        ledger.push(entry);
        return entry;
      }),
      entriesOf: jest.fn(async () => [...ledger]),
    },
  };
});

type PayRow = {
  paymentStatus: string;
  paymentMode: string | null;
  price: string;
  primaryServicePrice: string | null;
  refundedAmount?: string | null;
  refundMode?: string | null;
  refundNotes?: string | null;
  transactionId?: string | null;
  gatewayOrderId?: string | null;
};
let row: PayRow | null;
let addons: { serviceId: string; price: string }[];
const visit = {
  clinicId: 'clinic',
  patientId: 'patient',
  doctorId: 'doctor',
  appointmentStatus: 'Confirmed',
};

// Answers each select by the table it reads; updates land on the payment row.
const answer = (table: unknown, joined: boolean) => {
  if (table === AppointmentPaymentModel)
    return row
      ? [
          {
            status: row.paymentStatus,
            mode: row.paymentMode,
            refundMode: row.refundMode ?? null,
            refundedAmount: row.refundedAmount ?? null,
            refundNotes: row.refundNotes ?? null,
            transactionId: row.transactionId ?? null,
            gatewayOrderId: row.gatewayOrderId ?? null,
          },
        ]
      : [];
  if (table === AppointmentModel)
    return joined
      ? row
        ? [
            {
              ...visit,
              status: row.paymentStatus,
              mode: row.paymentMode,
              price: row.price,
              primary: row.primaryServicePrice,
              refundedAmount: row.refundedAmount ?? null,
              refundMode: row.refundMode ?? null,
              transactionId: row.transactionId ?? null,
              gatewayOrderId: row.gatewayOrderId ?? null,
            },
          ]
        : []
      : [visit];
  if (table === appointmentMultipleService) return addons;
  return [];
};
const tx = {
  execute: async () => undefined,
  select: () => ({
    from: (table: unknown) => {
      let joined = false;
      const query = {
        innerJoin: () => {
          joined = true;
          return query;
        },
        where: () => {
          const result = () => answer(table, joined);
          return {
            limit: async () => result(),
            then: (
              ok: (v: unknown) => unknown,
              fail: (e: unknown) => unknown
            ) => Promise.resolve(result()).then(ok, fail),
          };
        },
      };
      return query;
    },
  }),
  update: () => ({
    set: (v: Partial<PayRow>) => ({
      where: async () => {
        if (row) Object.assign(row, v);
      },
    }),
  }),
} as unknown as Parameters<typeof AppointmentMoneySync.afterChange>[0];

const sum = (type: string) =>
  ledger
    .filter((e) => e.entryType === type)
    .reduce((n, e) => n + e.amountPaise, 0);
const status = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { status?: number }) => e.status
  );

beforeEach(() => {
  ledger.length = 0;
  addons = [];
  row = null;
});

describe('afterChange: a row status alone never becomes money (6c)', () => {
  it('Paid with no move: charged only, nothing received', async () => {
    row = {
      paymentStatus: 'Paid',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(sum('charge')).toBe(50000);
    expect(sum('payment')).toBe(0);
  });

  it('a desk payment move pays the bill once; a rerun writes nothing', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      move: {
        kind: 'pay',
        paymentMode: 'Cash',
        channel: 'desk',
        requestId: 'desk-1',
      },
    });
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      move: {
        kind: 'pay',
        paymentMode: 'Cash',
        channel: 'desk',
        requestId: 'desk-1',
      },
    });
    expect(sum('payment')).toBe(50000);
    expect(row.paymentStatus).toBe('Paid');
    expect(ledger).toHaveLength(2);
  });

  it('Refunded with no move: nothing is refunded', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      move: {
        kind: 'pay',
        paymentMode: 'Cash',
        channel: 'desk',
        requestId: 'desk-1',
      },
    });
    row.paymentStatus = 'Refunded';
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(sum('refund')).toBe(0);
  });

  it('Pending with Pay Later: charged, nothing received, stays Pending', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Pay Later',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(sum('charge')).toBe(50000);
    expect(sum('payment')).toBe(0);
    expect(row.paymentStatus).toBe('Pending');
  });

  it('Free Consultation is never overwritten', async () => {
    row = {
      paymentStatus: 'Free Consultation',
      paymentMode: null,
      price: '0',
      primaryServicePrice: '0',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(row.paymentStatus).toBe('Free Consultation');
  });
});

describe('add-ons (the Pay Later fix)', () => {
  const paidVisit = async () => {
    row = {
      paymentStatus: 'Paid',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      move: {
        kind: 'pay',
        paymentMode: 'Cash',
        channel: 'desk',
        requestId: 'desk-1',
      },
    });
  };

  it('chargesOnly: a paid visit does not pay a new add-on by itself (Partly paid, add-on due)', async () => {
    await paidVisit();
    addons = [{ serviceId: 'xray', price: '200' }];
    row!.price = '700';
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      chargesOnly: true,
    });
    expect(sum('charge')).toBe(70000);
    expect(sum('payment')).toBe(50000);
    expect(row!.paymentStatus).toBe('Partly paid');
    expect((await AppointmentMoneySync.balance(tx, 'visit')).due).toBe(20000);
  });

  it('cash for the add-on pays exactly its amount, then the visit is Paid', async () => {
    await paidVisit();
    addons = [{ serviceId: 'xray', price: '200' }];
    row!.price = '700';
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      chargesOnly: true,
    });
    await AppointmentMoneySync.pay(tx, {
      appointmentId: 'visit',
      amountPaise: 20000,
      paymentMode: 'Cash',
      requestId: 'addon-1',
      actorId: 'user',
    });
    expect(sum('payment')).toBe(70000);
    expect(row!.paymentStatus).toBe('Paid');
  });

  it('a pending visit with a cash add-on records only the add-on (Partly paid)', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '700',
      primaryServicePrice: '500',
    };
    addons = [{ serviceId: 'xray', price: '200' }];
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      chargesOnly: true,
    });
    await AppointmentMoneySync.pay(tx, {
      appointmentId: 'visit',
      amountPaise: 20000,
      paymentMode: 'Cash',
      requestId: 'addon-1',
      actorId: 'user',
    });
    expect(sum('payment')).toBe(20000);
    expect((await AppointmentMoneySync.balance(tx, 'visit')).due).toBe(50000);
    expect(row!.paymentStatus).toBe('Partly paid');
  });
});

describe('pay and refund limits', () => {
  it('paying more than is due is refused', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(
      await status(
        AppointmentMoneySync.pay(tx, {
          appointmentId: 'visit',
          amountPaise: 60000,
          paymentMode: 'Cash',
          requestId: 'r1',
          actorId: 'user',
        })
      )
    ).toBe(422);
  });

  it('a part payment shows Partly paid', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    await AppointmentMoneySync.pay(tx, {
      appointmentId: 'visit',
      amountPaise: 30000,
      paymentMode: 'UPI',
      requestId: 'r1',
      actorId: 'user',
    });
    expect(row!.paymentStatus).toBe('Partly paid');
  });

  it('refunding when nothing was received is refused', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user');
    expect(
      await status(
        AppointmentMoneySync.refund(tx, {
          appointmentId: 'visit',
          paymentMode: 'Cash',
          requestId: 'r1',
          actorId: 'user',
        })
      )
    ).toBe(422);
  });
});

describe('afterChange with a direct move (Razorpay and desk events, no guessing)', () => {
  const pendingOnline = () => {
    row = {
      paymentStatus: 'Paid',
      paymentMode: 'Online',
      price: '500',
      primaryServicePrice: '500',
    };
  };
  const onlinePay = {
    kind: 'pay' as const,
    paymentMode: 'Online',
    channel: 'online' as const,
    gatewayRef: 'pay_123',
    requestId: 'razorpay:pay:pay_123',
  };

  it('an online payment is recorded once with its Razorpay id, even if two paths confirm it', async () => {
    pendingOnline();
    await AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
      move: onlinePay,
    });
    await AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
      move: onlinePay,
    });
    const payments = ledger.filter((e) => e.entryType === 'payment');
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      amountPaise: 50000,
      gatewayRef: 'pay_123',
      channel: 'online',
    });
    expect(row!.paymentStatus).toBe('Paid');
  });

  it('a refund keeps its own Razorpay refund id (not the payment id) and is capped at what was received', async () => {
    pendingOnline();
    await AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
      move: onlinePay,
    });
    await AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
      move: {
        kind: 'refund',
        amountPaise: 90000,
        paymentMode: 'Razorpay',
        channel: 'online',
        gatewayRef: 'rfnd_456',
        reason: 'Cancellation refund (policy)',
        requestId: 'razorpay:refund:rfnd_456',
      },
    });
    const refund = ledger.find((e) => e.entryType === 'refund')!;
    expect(refund).toMatchObject({
      amountPaise: 50000,
      gatewayRef: 'rfnd_456',
    });
    expect(row!.paymentStatus).toBe('Refunded');
  });

  it('nothing left to pay writes nothing and does not fail the caller', async () => {
    pendingOnline();
    await AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
      move: onlinePay,
    });
    await expect(
      AppointmentMoneySync.afterChange(tx, 'visit', 'system', {
        move: {
          ...onlinePay,
          gatewayRef: 'pay_999',
          requestId: 'razorpay:pay:pay_999',
        },
      })
    ).resolves.toBeUndefined();
    expect(ledger.filter((e) => e.entryType === 'payment')).toHaveLength(1);
  });

  it('the move is used even if the row status says otherwise (no guessing)', async () => {
    row = {
      paymentStatus: 'Pending',
      paymentMode: 'Cash',
      price: '500',
      primaryServicePrice: '500',
    };
    await AppointmentMoneySync.afterChange(tx, 'visit', 'user', {
      move: {
        kind: 'pay',
        paymentMode: 'Cash',
        channel: 'desk',
        requestId: 'appt:visit:booking',
      },
    });
    expect(sum('payment')).toBe(50000);
    expect(row.paymentStatus).toBe('Paid');
  });
});
