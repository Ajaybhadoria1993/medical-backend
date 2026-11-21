import type { PaymentLine } from '../types/subscriptionPayment.types';
import { gstStateCodeOf } from '../../../utils/gstStateCode';
import type { GstSplit, TaxedAmount, TaxSetting } from '../types/tax.types';

/** A GST change that makes clinics pay more needs this many days' notice, unless applied at once. */
export const GST_NOTICE_DAYS = 30;

/** Used until a Super Admin saves a GST setting: what every bill used before dynamic GST. */
export const DEFAULT_TAX: TaxSetting = { rateBp: 1800, mode: 'inclusive' };

/** GST on a price, rounded half up: inclusive takes it out of the price, exclusive adds it, none adds nothing. */
export function applyTax(pricePaise: number, tax: TaxSetting): TaxedAmount {
  if (tax.mode === 'none' || tax.rateBp === 0) {
    return { subtotalPaise: pricePaise, taxPaise: 0, totalPaise: pricePaise };
  }
  if (tax.mode === 'exclusive') {
    const taxPaise = Math.round((pricePaise * tax.rateBp) / 10000);
    return {
      subtotalPaise: pricePaise,
      taxPaise,
      totalPaise: pricePaise + taxPaise,
    };
  }
  const subtotalPaise = Math.round((pricePaise * 10000) / (10000 + tax.rateBp));
  return {
    subtotalPaise,
    taxPaise: pricePaise - subtotalPaise,
    totalPaise: pricePaise,
  };
}

/** A price without its GST: an inclusive price holds it; exclusive and no-GST prices are already net. */
export const netOfTax = (pricePaise: number, tax: TaxSetting) =>
  tax.mode === 'inclusive'
    ? applyTax(pricePaise, tax).subtotalPaise
    : pricePaise;

/** Whether clinics pay more under `next` than under `current` for the same price. */
export const raisesPrice = (current: TaxSetting, next: TaxSetting) =>
  applyTax(100000, next).totalPaise > applyTax(100000, current).totalPaise;

/** Where the sale is supplied: the clinic's state, or the seller's when it is unknown (a B2C sale). */
export const placeOfSupplyOf = (
  buyerState: string | null | undefined,
  sellerStateCode: string
) => gstStateCodeOf(buyerState) ?? sellerStateCode;

/** Same state → CGST + SGST; another state → IGST. The invoice and the checkout both use this. */
export const gstSplitOf = (
  placeOfSupply: string,
  sellerStateCode: string
): GstSplit => (placeOfSupply === sellerStateCode ? 'cgst_sgst' : 'igst');

/** The words a clinic sees, matching its invoice: "GST 18% (CGST 9% + SGST 9%)" or "GST 18% (IGST)". */
export function gstLabel(tax: TaxSetting, split: GstSplit | null) {
  const rate = tax.rateBp / 100;
  if (!split) return `GST ${rate}%`;
  return split === 'igst'
    ? `GST ${rate}% (IGST)`
    : `GST ${rate}% (CGST ${rate / 2}% + SGST ${rate / 2}%)`;
}

/** GST on what a checkout charges, plus the bill line to show it when it is added on top. */
export function withTax(
  netPaise: number,
  tax: TaxSetting,
  split: GstSplit | null = null
) {
  const taxed = applyTax(netPaise, tax);
  const line: PaymentLine | null =
    tax.mode === 'exclusive' && taxed.taxPaise > 0
      ? {
          kind: 'tax',
          description: gstLabel(tax, split),
          amountPaise: taxed.taxPaise,
        }
      : null;
  return { ...taxed, line };
}

/** Splits a charged total (GST already in it) into taxable value and CGST + SGST or IGST; the parts add up exactly. */
export function gstSplit(
  totalPaise: number,
  sameState: boolean,
  tax: TaxSetting = DEFAULT_TAX
) {
  // Whatever the mode, the amount charged already holds the GST, so the split takes it out.
  const { subtotalPaise: taxablePaise, taxPaise } = applyTax(totalPaise, {
    rateBp: tax.mode === 'none' ? 0 : tax.rateBp,
    mode: 'inclusive',
  });
  const cgstPaise = sameState ? Math.floor(taxPaise / 2) : 0;
  const sgstPaise = sameState ? taxPaise - cgstPaise : 0;
  const igstPaise = sameState ? 0 : taxPaise;
  return { taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise };
}

/** e.g. MA/26-27/0001; restarts every financial year. Grows past 9999 and stays within GST's 16 characters up to 999,999. */
export const invoiceNumber = (
  prefix: string,
  financialYear: string,
  n: number
) => `${prefix}/${financialYear.slice(2)}/${String(n).padStart(4, '0')}`;

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];
const upTo99 = (n: number) =>
  n < 20
    ? ONES[n]!
    : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
const upTo999 = (n: number) =>
  [
    n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '',
    n % 100 ? upTo99(n % 100) : '',
  ]
    .filter(Boolean)
    .join(' ');

/** "Rupees One Hundred Ninety Nine and Fifty Paise Only", in the Indian lakh/crore system. */
export const rupeesInWords = (paise: number) => {
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  for (const [size, name] of [
    [1e7, 'Crore'],
    [1e5, 'Lakh'],
    [1e3, 'Thousand'],
  ] as const) {
    if (r >= size) {
      parts.push(`${upTo999(Math.floor(r / size))} ${name}`);
      r %= size;
    }
  }
  if (r) parts.push(upTo999(r));
  const rupees = parts.join(' ') || 'Zero';
  return `Rupees ${rupees}${p ? ` and ${upTo99(p)} Paise` : ''} Only`;
};
