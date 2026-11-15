import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export function buildSettlementCsv(
  settlement: Record<string, unknown>,
  items: Record<string, unknown>[]
): Buffer {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [
    [
      'Appointment ID',
      'Transfer ID',
      'Clinic Amount',
      'Reversed Amount',
      'Net Amount',
      'Status',
    ],
    ...items.map((item) => [
      item.appointmentId,
      item.providerTransferId,
      item.clinicAmount,
      item.reversedAmount,
      Number(item.clinicAmount || 0) - Number(item.reversedAmount || 0),
      item.status,
    ]),
  ];
  const heading = [
    ['Settlement ID', settlement.providerSettlementId],
    ['Provider', settlement.paymentProvider],
    ['Cycle Start', settlement.cycleStart],
    ['Cycle End', settlement.cycleEnd],
    ['Settled At', settlement.settledAt],
    ['Amount', settlement.amount],
    [],
  ];

  return Buffer.from(
    [...heading, ...rows].map((row) => row.map(escape).join(',')).join('\n'),
    'utf8'
  );
}

export async function buildSettlementPdf(
  settlement: Record<string, unknown>,
  items: Record<string, unknown>[]
): Promise<Buffer> {
  const document = await PDFDocument.create();
  let page = document.addPage([595, 842]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let y = 800;

  const write = (text: string, options?: { bold?: boolean; size?: number }) => {
    if (y < 55) {
      page = document.addPage([595, 842]);
      y = 800;
    }
    page.drawText(text.slice(0, 100), {
      x: 45,
      y,
      size: options?.size || 10,
      font: options?.bold ? bold : regular,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= (options?.size || 10) + 8;
  };

  write('Clinic Settlement Statement', { bold: true, size: 18 });
  y -= 8;
  write(`Settlement: ${String(settlement.providerSettlementId || '')}`);
  write(`Provider: ${String(settlement.paymentProvider || '')}`);
  write(
    `Cycle: ${String(settlement.cycleStart || '')} to ${String(settlement.cycleEnd || '')}`
  );
  write(`Settled at: ${String(settlement.settledAt || '')}`);
  write(`Total amount: INR ${String(settlement.amount || '0')}`, {
    bold: true,
  });
  y -= 12;
  write('Appointment / Transfer / Clinic amount / Reversal / Net / Status', {
    bold: true,
  });

  for (const item of items) {
    const net =
      Number(item.clinicAmount || 0) - Number(item.reversedAmount || 0);
    write(
      `${String(item.appointmentId || '')} / ${String(item.providerTransferId || '-')} / INR ${String(item.clinicAmount || '0')} / INR ${String(item.reversedAmount || '0')} / INR ${net.toFixed(2)} / ${String(item.status || '')}`
    );
  }

  return Buffer.from(await document.save());
}
