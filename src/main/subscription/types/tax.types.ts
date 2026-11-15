import type { BillingTaxMode } from '../models/taxRate.model';

/** The GST applied to one charge: frozen on the payment and copied onto its invoice. */
export interface TaxSetting {
  /** Basis points: 1800 = 18%. */
  rateBp: number;
  mode: BillingTaxMode;
}

/** How the GST is split on the invoice: same state as the seller or another state. */
export type GstSplit = 'cgst_sgst' | 'igst';

/** A price with its GST: what the clinic pays is `totalPaise`. */
export interface TaxedAmount {
  /** The value before GST (the taxable value). */
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}
