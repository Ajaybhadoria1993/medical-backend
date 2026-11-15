import {
  MoneyWriteService,
  type RecordMoneyInput,
} from '../services/moneyWrite.service';

// A stand-in transaction: earlier entries for the source, an entry already saved under the
// request id (a retry), and every insert captured. No database is touched.
type Saved = {
  id: string;
  entryType: string;
  amountPaise: number;
  reversesEntryId: string | null;
};
const fakeTx = (
  opts: {
    rows?: Saved[];
    repeat?: object | null;
    lastNo?: number;
    journal?: object[];
  } = {}
) => {
  const inserts: Record<string, unknown>[] = [];
  const tx = {
    inserts,
    execute: jest.fn(async () => undefined),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (opts.repeat ? [opts.repeat] : []),
          orderBy: async () => opts.rows ?? [],
          // Awaited as is: the lines a journal request already wrote.
          then: (done: (v: object[]) => void) => done(opts.journal ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(v) ? v : [v];
        inserts.push(...list);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ lastNo: opts.lastNo ?? 1 }],
          }),
          returning: async () => list.map((x) => ({ id: 'new', ...x })),
        };
      },
    }),
  };
  return tx;
};
type Tx = Parameters<typeof MoneyWriteService.record>[0];
const run = (tx: ReturnType<typeof fakeTx>, input: Partial<RecordMoneyInput>) =>
  MoneyWriteService.record(tx as unknown as Tx, {
    clinicId: 'clinic',
    patientId: 'patient',
    sourceType: 'appointment',
    sourceId: 'visit',
    entryType: 'payment',
    amountPaise: 50000,
    channel: 'desk',
    requestId: 'req-1',
    createdBy: 'user',
    ...input,
  });

const charged = (paise: number): Saved => ({
  id: 'c',
  entryType: 'charge',
  amountPaise: paise,
  reversesEntryId: null,
});
const paid = (paise: number): Saved => ({
  id: 'p',
  entryType: 'payment',
  amountPaise: paise,
  reversesEntryId: null,
});
const status = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { status?: number; statusCode?: number }) => e.status ?? e.statusCode
  );
// The clinic line (not its counter line or the receipt-counter upsert) among the captured inserts.
const entryOf = (tx: ReturnType<typeof fakeTx>) =>
  tx.inserts.find((v) => v.account === 'clinic')!;
const linesOf = (tx: ReturnType<typeof fakeTx>) =>
  tx.inserts.filter((v) => 'account' in v);

describe('MoneyWriteService.record: input rules', () => {
  it('refuses an amount that is not above zero', async () => {
    expect(await status(run(fakeTx(), { amountPaise: 0 }))).toBe(422);
  });

  it('a refund needs a reason', async () => {
    expect(
      await status(
        run(fakeTx({ rows: [charged(50000), paid(50000)] }), {
          entryType: 'refund',
        })
      )
    ).toBe(422);
  });

  it('online money needs its gateway reference', async () => {
    expect(
      await status(run(fakeTx(), { channel: 'online', gatewayRef: null }))
    ).toBe(422);
  });
});

describe('MoneyWriteService.record: retries', () => {
  it('the same request id returns the first entry and writes nothing', async () => {
    const first = { id: 'first', requestId: 'req-1' };
    const tx = fakeTx({ repeat: first });
    expect(await run(tx, {})).toBe(first);
    expect(tx.inserts).toHaveLength(0);
  });
});

describe('MoneyWriteService.record: caps (checked after the lock)', () => {
  it('a refund can not be more than was received', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    expect(
      await status(
        run(tx, { entryType: 'refund', amountPaise: 40000, reason: 'r' })
      )
    ).toBe(422);
  });

  it('a refund up to what was received is saved', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    expect(
      await status(
        run(tx, { entryType: 'refund', amountPaise: 30000, reason: 'r' })
      )
    ).toBe('ok');
  });

  it('a write-off can not be more than is due', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    expect(
      await status(
        run(tx, { entryType: 'write_off', amountPaise: 30000, reason: 'r' })
      )
    ).toBe(422);
  });

  it('a capped payment over what is due is refused (a second quick collect)', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(50000)] });
    expect(await status(run(tx, { capToDue: true, amountPaise: 50000 }))).toBe(
      409
    );
    expect(tx.inserts).toHaveLength(0);
  });

  it('a capped payment within what is due is saved', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    expect(await status(run(tx, { capToDue: true, amountPaise: 20000 }))).toBe(
      'ok'
    );
  });

  it('an uncapped payment (the mirror sync) is not checked against due', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(50000)] });
    expect(await status(run(tx, { amountPaise: 10000 }))).toBe('ok');
  });

  it('a correction can not undo more than is left of its entry', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    expect(
      await status(
        run(tx, {
          entryType: 'adjustment',
          reversesEntryId: 'p',
          amountPaise: 40000,
          reason: 'r',
        })
      )
    ).toBe(422);
  });

  it('a correction must name an entry on this record', async () => {
    const tx = fakeTx({ rows: [charged(50000)] });
    expect(
      await status(
        run(tx, {
          entryType: 'adjustment',
          reversesEntryId: 'missing',
          amountPaise: 100,
          reason: 'r',
        })
      )
    ).toBe(422);
  });

  it('takes the source lock before writing', async () => {
    const tx = fakeTx({ rows: [charged(50000)] });
    await run(tx, {});
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});

describe('MoneyWriteService.record: receipts', () => {
  it('a payment gets the next number in the clinic series', async () => {
    const tx = fakeTx({ rows: [charged(50000)], lastNo: 12 });
    const saved = await run(tx, {});
    expect(saved.receiptNo).toMatch(/^R-\d{4}-000012$/);
  });

  it('a charge gets no receipt', async () => {
    const tx = fakeTx();
    await run(tx, { entryType: 'charge' });
    expect(entryOf(tx).receiptNo).toBeNull();
  });

  it('a dated (backfilled) entry uses its own year series', async () => {
    const tx = fakeTx({ rows: [charged(50000)] });
    const saved = await run(tx, {
      occurredAt: new Date('2021-06-15T06:00:00Z'),
    });
    expect(tx.inserts.find((v) => 'lastNo' in v)).toMatchObject({ year: 2021 });
    expect(saved.receiptNo).toBe('R-2021-000001');
  });
});

describe('MoneyWriteService.record: treatment plan entries', () => {
  it('a plan advance gets a receipt from the clinic series', async () => {
    const tx = fakeTx({ lastNo: 7 });
    const saved = await run(tx, {
      sourceType: 'treatment_plan',
      entryType: 'advance',
    });
    expect(saved.receiptNo).toMatch(/^R-\d{4}-000007$/);
  });

  it('paid-at-visit gets no receipt (the visit already has one)', async () => {
    const tx = fakeTx();
    await run(tx, { sourceType: 'treatment_plan', entryType: 'paid_at_visit' });
    expect(entryOf(tx).receiptNo).toBeNull();
  });

  it('a plan refund can not be more than the advance received', async () => {
    const tx = fakeTx({
      rows: [
        {
          id: 'a',
          entryType: 'advance',
          amountPaise: 30000,
          reversesEntryId: null,
        },
      ],
    });
    expect(
      await status(
        run(tx, {
          sourceType: 'treatment_plan',
          entryType: 'refund',
          amountPaise: 40000,
          reason: 'r',
        })
      )
    ).toBe(422);
  });

  it('a write-off keeps who approved it', async () => {
    const tx = fakeTx({
      rows: [
        {
          id: 'c',
          entryType: 'charge',
          amountPaise: 50000,
          reversesEntryId: null,
        },
      ],
    });
    await run(tx, {
      sourceType: 'treatment_plan',
      entryType: 'write_off',
      amountPaise: 10000,
      reason: 'r',
      approvedBy: 'doc',
    });
    expect(entryOf(tx).approvedBy).toBe('doc');
  });
});

describe('MoneyWriteService.record: double entry', () => {
  const balanced = (lines: Record<string, unknown>[]) =>
    lines.reduce(
      (n, l) => n + (l.side === 'debit' ? 1 : -1) * (l.amountPaise as number),
      0
    );

  it('a desk payment is credited to the clinic and debited to the cash drawer', async () => {
    const tx = fakeTx({ rows: [charged(50000)] });
    await run(tx, {});
    const lines = linesOf(tx);
    expect(lines.map((l) => [l.account, l.side])).toEqual([
      ['clinic', 'credit'],
      ['desk_cash', 'debit'],
    ]);
    expect(lines[0].journalId).toBe(lines[1].journalId);
    expect(balanced(lines)).toBe(0);
  });

  it('a charge moves no cash: its counter line is what the patient owes', async () => {
    const tx = fakeTx();
    await run(tx, { entryType: 'charge' });
    expect(linesOf(tx)[1]).toMatchObject({
      account: 'patient_receivable',
      side: 'debit',
    });
  });

  it('an online refund is debited to the clinic and credited to Razorpay', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(50000)] });
    await run(tx, {
      entryType: 'refund',
      channel: 'online',
      gatewayRef: 'rfnd_1',
      reason: 'r',
    });
    expect(linesOf(tx).map((l) => [l.account, l.side])).toEqual([
      ['clinic', 'debit'],
      ['gateway_clearing', 'credit'],
    ]);
  });

  it('a correction of a payment mirrors the payment', async () => {
    const tx = fakeTx({ rows: [charged(50000), paid(30000)] });
    await run(tx, {
      entryType: 'adjustment',
      reversesEntryId: 'p',
      amountPaise: 30000,
      reason: 'r',
    });
    expect(linesOf(tx).map((l) => [l.account, l.side])).toEqual([
      ['clinic', 'debit'],
      ['desk_cash', 'credit'],
    ]);
  });

  it('only the clinic line carries the receipt and is returned', async () => {
    const tx = fakeTx({ rows: [charged(50000)], lastNo: 3 });
    const saved = await run(tx, {});
    expect(saved.account).toBe('clinic');
    expect(linesOf(tx)[1].receiptNo).toBeNull();
  });
});

describe('MoneyWriteService.post: fee journals', () => {
  type PostTx = Parameters<typeof MoneyWriteService.post>[0];
  const post = (
    tx: ReturnType<typeof fakeTx>,
    lines: { account: string; side: string; amountPaise: number }[]
  ) =>
    MoneyWriteService.post(tx as unknown as PostTx, {
      clinicId: 'clinic',
      patientId: 'patient',
      sourceType: 'appointment',
      sourceId: 'visit',
      entryType: 'payment',
      channel: 'online',
      gatewayRef: 'pay_1',
      requestId: 'razorpay:fees:pay_1',
      createdBy: 'system',
      lines: lines as never,
    });

  it('writes a balanced journal netted to one line per account', async () => {
    const tx = fakeTx();
    await post(tx, [
      { account: 'gateway_clearing', side: 'debit', amountPaise: 2000 },
      { account: 'gateway_clearing', side: 'debit', amountPaise: 1000 },
      { account: 'convenience_fee', side: 'credit', amountPaise: 3000 },
    ]);
    expect(linesOf(tx)).toHaveLength(2);
    expect(linesOf(tx)[0]).toMatchObject({
      account: 'gateway_clearing',
      amountPaise: 3000,
    });
  });

  it('refuses a journal that does not balance', async () => {
    await expect(
      post(fakeTx(), [
        { account: 'gateway_clearing', side: 'debit', amountPaise: 2000 },
        { account: 'convenience_fee', side: 'credit', amountPaise: 1000 },
      ])
    ).rejects.toThrow('does not balance');
  });

  it('refuses clinic lines (they need record for caps and receipts)', async () => {
    await expect(
      post(fakeTx(), [
        { account: 'clinic', side: 'credit', amountPaise: 1000 },
        { account: 'gateway_clearing', side: 'debit', amountPaise: 1000 },
      ])
    ).rejects.toThrow('record');
  });

  it('a retry returns the first journal and writes nothing', async () => {
    const first = [{ id: 'a' }, { id: 'b' }];
    const tx = fakeTx({ journal: first });
    expect(
      await post(tx, [
        { account: 'gateway_clearing', side: 'debit', amountPaise: 1000 },
        { account: 'convenience_fee', side: 'credit', amountPaise: 1000 },
      ])
    ).toBe(first);
    expect(tx.inserts).toHaveLength(0);
  });
});
