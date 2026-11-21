import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import handlebars from 'handlebars';
import path from 'path';
import { database } from '../../../../configurations/dbConnection';
import {
  getBufferFromS3,
  uploadBufferToS3,
} from '../../../../configurations/s3/client';
import { HttpError } from '../../../../middlewear/errorHandler';
import { htmlToPdfBuffer } from '../../../../utils/browserPdf';
import { envConfig } from '../../../../utils/envConfig';
import { financialYearOf } from '../../../../utils/financialYear';
import { gstStateCodeOf } from '../../../../utils/gstStateCode';
import { formatISTDate } from '../../../../utils/istDateTime';
import logger from '../../../../utils/logger';
import { subscriptionTaxInvoiceTemplate } from '../../../../utils/pdf/templates/subscriptionTaxInvoice';
import { getClinicPort } from '../../ports';
import { fromPaise } from '../../../money';
import {
  SubscriptionCreditNoteModel,
  SubscriptionInvoiceModel,
  SubscriptionInvoiceSequenceModel,
  SubscriptionPaymentModel,
  type SubscriptionInvoice,
  type SubscriptionPayment,
} from '../../models/subscriptionPayment.model';
import type { InvoiceParty } from '../../types/subscriptionPayment.types';
import { toHistoryItem } from '../../utils/billingHistory.utils';
import { gstSplitOf, placeOfSupplyOf } from '../../utils/invoiceTax.utils';
import {
  gstSplit,
  invoiceNumber,
  rupeesInWords,
} from '../../utils/invoiceTax.utils';
import type { Tx } from '../../types/db.types';

type SaleKind = SubscriptionPayment['kind'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALES = new Set<SaleKind>([
  'plan_purchase',
  'plan_change',
  'renewal',
  'addon_purchase',
  'credit_purchase',
]);
const istDay = (d: Date) =>
  d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const compiled = handlebars.compile(subscriptionTaxInvoiceTemplate);

// Embedded as data so the PDF never depends on a reachable asset URL; null = text name instead.
let logoUri: string | null | undefined;
const invoiceLogo = () => {
  if (logoUri !== undefined) return logoUri;
  try {
    const file = path.join(
      process.cwd(),
      'public',
      'Email-Image',
      'mediarogya-logo.png'
    );
    logoUri = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  } catch (error) {
    logger.warn(
      '[Invoice] Logo not found; the PDF shows the seller name instead.',
      error
    );
    logoUri = null;
  }
  return logoUri;
};

// The stored address often already holds the city, PIN and state; repeat only what is missing.
const partyLines = (p: InvoiceParty) => {
  const address = p.address?.trim() ?? '';
  const has = (part?: string) =>
    !!part && address.toLowerCase().includes(part.toLowerCase());
  const cityPin = [p.city, p.postalCode].filter((x) => x && !has(x)).join(' ');
  const state = p.state && !has(p.state) ? p.state : '';
  return [
    address,
    cityPin,
    state && (p.stateCode ? `${state} (${p.stateCode})` : state),
  ].filter(Boolean);
};

const METHOD_LABELS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
};
const methodLabel = (m: string | null) => (m ? (METHOD_LABELS[m] ?? m) : null);
// Slashes in "MA/26-27/0001" would split the S3 key and the download name.
const pdfName = (number: string) => `${number.replace(/\//g, '-')}.pdf`;

const seller = (): InvoiceParty => ({
  name: envConfig.INVOICE_SELLER_NAME,
  address: envConfig.INVOICE_SELLER_ADDRESS,
  city: envConfig.INVOICE_SELLER_CITY,
  state: envConfig.INVOICE_SELLER_STATE,
  stateCode: envConfig.INVOICE_SELLER_STATE_CODE,
  postalCode: envConfig.INVOICE_SELLER_POSTAL_CODE,
  gstin: envConfig.INVOICE_SELLER_GSTIN || undefined,
});

/** GST invoices for subscription sales: issued once with the payment, never rebuilt. */
export class InvoiceService {
  /** Runs inside the payment transaction; the locked counter row keeps numbers gap-free. */
  static async issue(tx: Tx, payment: SubscriptionPayment) {
    if (!SALES.has(payment.kind) || payment.ownerType !== 'clinic') return null;
    const issuedAt = payment.paidAt ?? new Date();
    const financialYear = financialYearOf(issuedAt);

    const clinic = await getClinicPort().getBillingParty(payment.ownerId);
    const from = seller();
    const buyerCode = gstStateCodeOf(clinic?.state);
    const placeOfSupply = placeOfSupplyOf(clinic?.state, from.stateCode!);
    const billTo: InvoiceParty = {
      name: clinic?.name ?? 'Clinic',
      address: clinic?.address ?? undefined,
      city: clinic?.city ?? undefined,
      state: clinic?.state ?? undefined,
      stateCode: buyerCode ?? undefined,
      postalCode: clinic?.zip ? String(clinic.zip) : undefined,
    };

    const [seq] = await tx
      .insert(SubscriptionInvoiceSequenceModel)
      .values({ financialYear, lastNumber: 1, updatedAt: issuedAt })
      .onConflictDoUpdate({
        target: SubscriptionInvoiceSequenceModel.financialYear,
        set: {
          lastNumber: sql`${SubscriptionInvoiceSequenceModel.lastNumber} + 1`,
          updatedAt: issuedAt,
        },
      })
      .returning({ n: SubscriptionInvoiceSequenceModel.lastNumber });

    const [invoice] = await tx
      .insert(SubscriptionInvoiceModel)
      .values({
        paymentId: payment.id,
        ownerType: payment.ownerType,
        ownerId: payment.ownerId,
        invoiceNumber: invoiceNumber(
          envConfig.INVOICE_PREFIX,
          financialYear,
          seq!.n
        ),
        financialYear,
        status: 'issued',
        issueDate: istDay(issuedAt),
        seller: from,
        billTo,
        placeOfSupply,
        sacCode: envConfig.INVOICE_SAC_CODE,
        currency: payment.currency,
        // The GST frozen on the payment when it was priced, never today's setting.
        taxRateBp: payment.taxRateBp,
        taxMode: payment.taxMode,
        ...gstSplit(
          payment.amountPaise,
          gstSplitOf(placeOfSupply, from.stateCode!) === 'cgst_sgst',
          {
            rateBp: payment.taxRateBp,
            mode: payment.taxMode,
          }
        ),
      })
      .returning();
    return invoice!;
  }

  /** Reverses a refunded sale's invoice in full; once per invoice, inside the caller's transaction. */
  static async issueCreditNote(
    tx: Tx,
    payment: SubscriptionPayment,
    reason: string
  ) {
    const [invoice] = await tx
      .select()
      .from(SubscriptionInvoiceModel)
      .where(eq(SubscriptionInvoiceModel.paymentId, payment.id))
      .limit(1);
    if (!invoice) return null;
    const [existing] = await tx
      .select({ id: SubscriptionCreditNoteModel.id })
      .from(SubscriptionCreditNoteModel)
      .where(eq(SubscriptionCreditNoteModel.invoiceId, invoice.id))
      .limit(1);
    if (existing) return null;
    const issuedAt = new Date();
    const financialYear = financialYearOf(issuedAt);
    const [seq] = await tx
      .insert(SubscriptionInvoiceSequenceModel)
      .values({
        financialYear,
        lastNumber: 0,
        lastCreditNote: 1,
        updatedAt: issuedAt,
      })
      .onConflictDoUpdate({
        target: SubscriptionInvoiceSequenceModel.financialYear,
        set: {
          lastCreditNote: sql`${SubscriptionInvoiceSequenceModel.lastCreditNote} + 1`,
          updatedAt: issuedAt,
        },
      })
      .returning({ n: SubscriptionInvoiceSequenceModel.lastCreditNote });
    const [note] = await tx
      .insert(SubscriptionCreditNoteModel)
      .values({
        invoiceId: invoice.id,
        paymentId: payment.id,
        ownerType: invoice.ownerType,
        ownerId: invoice.ownerId,
        creditNoteNumber: invoiceNumber(
          envConfig.CREDIT_NOTE_PREFIX,
          financialYear,
          seq!.n
        ),
        financialYear,
        issueDate: istDay(issuedAt),
        reason: reason.slice(0, 255),
        taxablePaise: invoice.taxablePaise,
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        totalPaise: invoice.totalPaise,
      })
      .returning();
    return note!;
  }

  /** Paid and refunded sales with their invoices, newest first, in one query. */
  static async history(clinicId: string) {
    const rows = await database
      .select({
        payment: SubscriptionPaymentModel,
        invoice: SubscriptionInvoiceModel,
        creditNoteId: SubscriptionCreditNoteModel.id,
        creditNoteNumber: SubscriptionCreditNoteModel.creditNoteNumber,
      })
      .from(SubscriptionPaymentModel)
      .leftJoin(
        SubscriptionInvoiceModel,
        eq(SubscriptionInvoiceModel.paymentId, SubscriptionPaymentModel.id)
      )
      .leftJoin(
        SubscriptionCreditNoteModel,
        eq(SubscriptionCreditNoteModel.invoiceId, SubscriptionInvoiceModel.id)
      )
      .where(
        and(
          eq(SubscriptionPaymentModel.ownerType, 'clinic'),
          eq(SubscriptionPaymentModel.ownerId, clinicId),
          inArray(SubscriptionPaymentModel.status, ['captured', 'refunded']),
          inArray(SubscriptionPaymentModel.kind, [...SALES])
        )
      )
      .orderBy(desc(SubscriptionPaymentModel.createdAt));
    return rows.map((r) => ({
      ...toHistoryItem(r.payment, r.invoice),
      creditNoteId: r.creditNoteId,
      creditNoteNumber: r.creditNoteNumber,
    }));
  }

  /** The clinic's own invoice PDF; `id` may be the invoice or its payment. Builds it if missing. */
  static async pdfFor(clinicId: string, id: string) {
    // Not a UUID is simply not found, rather than a database cast error.
    if (!UUID.test(id)) throw new HttpError(404, 'Invoice not found');
    const find = () =>
      database
        .select({
          id: SubscriptionInvoiceModel.id,
          invoiceNumber: SubscriptionInvoiceModel.invoiceNumber,
          pdfKey: SubscriptionInvoiceModel.pdfKey,
        })
        .from(SubscriptionInvoiceModel)
        .where(
          and(
            eq(SubscriptionInvoiceModel.ownerType, 'clinic'),
            eq(SubscriptionInvoiceModel.ownerId, clinicId),
            or(
              eq(SubscriptionInvoiceModel.id, id),
              eq(SubscriptionInvoiceModel.paymentId, id)
            )
          )
        )
        .limit(1)
        .then((r) => r[0]);
    let invoice = await find();
    if (!invoice) return InvoiceService.creditNotePdfFor(clinicId, id);
    if (!invoice.pdfKey) {
      await InvoiceService.renderPdf(invoice.id);
      invoice = await find();
    }
    if (!invoice?.pdfKey) {
      throw new HttpError(
        503,
        'The invoice PDF is not ready yet. Please try again in a minute.'
      );
    }
    return {
      pdf: await getBufferFromS3(invoice.pdfKey),
      fileName: pdfName(invoice.invoiceNumber),
    };
  }

  /** The clinic's own credit note PDF by its id; built on first download if missing. */
  private static async creditNotePdfFor(clinicId: string, id: string) {
    const find = () =>
      database
        .select({
          id: SubscriptionCreditNoteModel.id,
          number: SubscriptionCreditNoteModel.creditNoteNumber,
          pdfKey: SubscriptionCreditNoteModel.pdfKey,
        })
        .from(SubscriptionCreditNoteModel)
        .where(
          and(
            eq(SubscriptionCreditNoteModel.ownerType, 'clinic'),
            eq(SubscriptionCreditNoteModel.ownerId, clinicId),
            eq(SubscriptionCreditNoteModel.id, id)
          )
        )
        .limit(1)
        .then((r) => r[0]);
    let note = await find();
    if (!note) throw new HttpError(404, 'Invoice not found');
    if (!note.pdfKey) {
      await InvoiceService.renderCreditNotePdf(note.id);
      note = await find();
    }
    if (!note?.pdfKey) {
      throw new HttpError(
        503,
        'The credit note PDF is not ready yet. Please try again in a minute.'
      );
    }
    return {
      pdf: await getBufferFromS3(note.pdfKey),
      fileName: pdfName(note.number),
    };
  }

  /** Same layout as the invoice, titled Credit Note and pointing at the invoice it reverses. */
  static async renderCreditNotePdf(creditNoteId: string): Promise<void> {
    try {
      const [row] = await database
        .select({
          note: SubscriptionCreditNoteModel,
          invoice: SubscriptionInvoiceModel,
          payment: SubscriptionPaymentModel,
        })
        .from(SubscriptionCreditNoteModel)
        .innerJoin(
          SubscriptionInvoiceModel,
          eq(SubscriptionInvoiceModel.id, SubscriptionCreditNoteModel.invoiceId)
        )
        .innerJoin(
          SubscriptionPaymentModel,
          eq(SubscriptionPaymentModel.id, SubscriptionCreditNoteModel.paymentId)
        )
        .where(eq(SubscriptionCreditNoteModel.id, creditNoteId))
        .limit(1);
      if (!row) return;
      const { note, invoice, payment } = row;
      const day = (d: string) => formatISTDate(new Date(`${d}T00:00:00+05:30`));
      const html = compiled({
        ...InvoiceService.pdfData(invoice, payment),
        invoiceNumber: note.creditNoteNumber,
        issueDate: day(note.issueDate),
        creditNote: {
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: day(invoice.issueDate),
          reason: note.reason,
        },
      });
      const pdf = await htmlToPdfBuffer(html);
      const key = `subscription-credit-notes/${note.financialYear}/${pdfName(note.creditNoteNumber)}`;
      await uploadBufferToS3(pdf, key);
      await database
        .update(SubscriptionCreditNoteModel)
        .set({ pdfKey: key })
        .where(eq(SubscriptionCreditNoteModel.id, creditNoteId));
    } catch (error) {
      logger.error(
        `[Invoice] PDF failed for credit note ${creditNoteId}; it is built on download:`,
        error
      );
    }
  }

  /** After the transaction: a failed PDF leaves pdf_key empty, so download can build it later. */
  static async renderPdf(invoiceId: string): Promise<void> {
    try {
      const [row] = await database
        .select({
          invoice: SubscriptionInvoiceModel,
          payment: SubscriptionPaymentModel,
        })
        .from(SubscriptionInvoiceModel)
        .innerJoin(
          SubscriptionPaymentModel,
          eq(SubscriptionPaymentModel.id, SubscriptionInvoiceModel.paymentId)
        )
        .where(eq(SubscriptionInvoiceModel.id, invoiceId))
        .limit(1);
      if (!row) return;
      const { invoice, payment } = row;
      const html = compiled(InvoiceService.pdfData(invoice, payment));
      const pdf = await htmlToPdfBuffer(html);
      const key = `subscription-invoices/${invoice.financialYear}/${pdfName(invoice.invoiceNumber)}`;
      await uploadBufferToS3(pdf, key);
      await database
        .update(SubscriptionInvoiceModel)
        .set({ pdfKey: key })
        .where(eq(SubscriptionInvoiceModel.id, invoiceId));
    } catch (error) {
      logger.error(
        `[Invoice] PDF failed for invoice ${invoiceId}; it is built on download:`,
        error
      );
    }
  }

  /** What the invoice template shows for one sale. */
  private static pdfData(
    invoice: SubscriptionInvoice,
    payment: SubscriptionPayment
  ) {
    return {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: formatISTDate(new Date(`${invoice.issueDate}T00:00:00+05:30`)),
      logo: invoiceLogo(),
      seller: invoice.seller,
      sellerLines: partyLines(invoice.seller),
      billTo: invoice.billTo,
      billToLines: partyLines(invoice.billTo),
      placeOfSupply:
        invoice.billTo.state &&
        invoice.billTo.stateCode === invoice.placeOfSupply
          ? `${invoice.billTo.state} (${invoice.placeOfSupply})`
          : invoice.placeOfSupply,
      sacCode: invoice.sacCode,
      period:
        payment.periodStart && payment.periodEnd
          ? `${formatISTDate(payment.periodStart)} – ${formatISTDate(payment.periodEnd)}`
          : null,
      paidOn: payment.paidAt ? formatISTDate(payment.paidAt) : null,
      paidVia: methodLabel(payment.paymentMethod),
      transactionId: payment.providerPaymentId,
      // An exclusive GST line is shown in the totals as CGST/SGST or IGST, not as an item.
      lines: payment.lines.items
        .filter((l) => l.kind !== 'tax')
        .map((l, i) => ({
          no: i + 1,
          description: l.description,
          // A part-period line says so, so the lower price reads as pro-rated, not wrong.
          note:
            l.days && l.periodStart && l.periodEnd
              ? `Pro-rated for ${l.days} day${l.days === 1 ? '' : 's'} (${formatISTDate(new Date(l.periodStart))} – ${formatISTDate(new Date(l.periodEnd))}) to match your renewal date`
              : null,
          amount: fromPaise(l.amountPaise),
        })),
      // The rate frozen on this invoice, never today's setting.
      gstRate: invoice.taxRateBp / 100,
      halfRate: invoice.taxRateBp / 200,
      billOfSupply: invoice.taxMode === 'none',
      amountsInclGst: invoice.taxMode === 'inclusive',
      taxable: fromPaise(invoice.taxablePaise),
      cgst: fromPaise(invoice.cgstPaise),
      sgst: fromPaise(invoice.sgstPaise),
      igst: invoice.igstPaise ? fromPaise(invoice.igstPaise) : null,
      total: fromPaise(invoice.totalPaise),
      amountInWords: rupeesInWords(invoice.totalPaise),
    };
  }
}
