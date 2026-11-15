import { eq } from 'drizzle-orm';
import { database } from '../../../configurations/dbConnection';
import { HttpError } from '../../../middlewear/errorHandler';
import { getISTDateString } from '../../../utils/istDateTime';
import { renderTemplateToPdf } from '../../../utils/pdf.utils';
import { monthlyStatementTemplate } from '../../../utils/pdf/templates/monthlyStatement';
import { ClinicModel } from '../../clinic/models/clinic.model';
import { ClinicFinanceService } from './clinicFinance.service';
import { SettlementService } from './settlement.service';

const PAID = ['completed', 'processed'];
const rupees = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A month of a clinic's money as a PDF, built on request from the figures Finance shows. */
export class MonthlyStatementService {
  /** month is "YYYY-MM" (IST); a month that hasn't started yet is refused. */
  static async build(clinicId: string, month: string) {
    const [year, mon] = month.split('-').map(Number);
    if (month > getISTDateString().slice(0, 7))
      throw new HttpError(422, 'Choose a month that has already started.');
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(new Date(year, mon, 0).getDate()).padStart(2, '0')}`;

    const [summary, settlements, [clinic]] = await Promise.all([
      ClinicFinanceService.getSummary(clinicId, { startDate, endDate }),
      SettlementService.list(clinicId, {
        page: 1,
        pageSize: 200,
        startDate,
        endDate,
      }),
      database
        .select({
          name: ClinicModel.clinicName,
          address: ClinicModel.clinicAddress,
          city: ClinicModel.City,
          state: ClinicModel.State,
          zip: ClinicModel.ZipCode,
        })
        .from(ClinicModel)
        .where(eq(ClinicModel.id, clinicId))
        .limit(1),
    ]);
    if (!clinic) throw new HttpError(404, 'Clinic not found');

    const paid = (
      settlements.data as {
        status: string;
        settlementDate: string | Date;
        utr?: string | null;
        amount: number;
      }[]
    ).filter((s) => PAID.includes(String(s.status).toLowerCase()));
    const online = summary.channelBreakdown?.online?.grossRevenue ?? 0;
    const desk = summary.channelBreakdown?.offline?.grossRevenue ?? 0;
    const monthLabel = new Date(year, mon - 1, 1).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });

    const buffer = await renderTemplateToPdf(monthlyStatementTemplate, {
      monthLabel,
      generatedAt: new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      clinic: {
        name: clinic.name,
        lines: [
          clinic.address,
          [clinic.city, clinic.state, clinic.zip].filter(Boolean).join(', '),
        ].filter(Boolean),
      },
      received: {
        online: rupees(online),
        desk: rupees(desk),
        total: rupees(summary.grossRevenue),
      },
      refunds: {
        total: rupees(summary.refundsIssued),
        count: summary.refundCount ?? 0,
      },
      net: rupees(summary.netRevenue),
      fees: rupees(summary.platformFeeChargedToPatients),
      payouts: paid.map((s) => ({
        date: new Date(s.settlementDate).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        utr: s.utr || '—',
        amount: rupees(s.amount),
      })),
      paidTotal: rupees(paid.reduce((n, s) => n + (Number(s.amount) || 0), 0)),
      pending: rupees(summary.pendingPayout),
    });

    return { buffer, filename: `statement-${month}.pdf` };
  }
}
