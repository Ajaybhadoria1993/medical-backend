import { isNull } from 'drizzle-orm';
import { database } from '../../../../configurations/dbConnection';
import { getOrSetCache, invalidateCache } from '../../../../utils/cache.util';
import {
  BillingTaxRateModel,
  type BillingTaxRate,
} from '../../models/taxRate.model';
import type { GstSplit, TaxSetting } from '../../types/tax.types';
import { envConfig } from '../../../../utils/envConfig';
import { getClinicPort } from '../../ports';
import {
  DEFAULT_TAX,
  gstSplitOf,
  placeOfSupplyOf,
} from '../../utils/invoiceTax.utils';

const CACHE_KEY = 'billing:tax-rates';
const CACHE_TTL_S = 300;

/** The GST settings for MediArogya's own bills: which one applies on a date, and the next one scheduled. */
export class TaxService {
  /** The setting in force at `at`; 18% inclusive until a Super Admin saves one. */
  static async inForce(at: Date = new Date()): Promise<TaxSetting> {
    return (await TaxService.snapshot(at)).current;
  }

  /** The next change after `at`, if one is scheduled. */
  static async upcoming(at: Date = new Date()) {
    return (await TaxService.snapshot(at)).upcoming;
  }

  /** In force and next, from one read of the settings. */
  static async snapshot(at: Date = new Date()) {
    const rows = await TaxService.rows();
    const row = TaxService.latestBy(rows, at);
    const current: TaxSetting = row
      ? { rateBp: row.rateBp, mode: row.mode }
      : DEFAULT_TAX;
    const upcoming =
      rows
        .filter((r) => r.effectiveFrom > at)
        .sort(
          (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
        )[0] ?? null;
    return { current, upcoming };
  }

  /** CGST + SGST or IGST for this clinic's bills, by the same rule its invoice uses. */
  static async splitFor(clinicId: string): Promise<GstSplit> {
    const clinic = await getClinicPort().getBillingParty(clinicId);
    const seller = envConfig.INVOICE_SELLER_STATE_CODE;
    return gstSplitOf(placeOfSupplyOf(clinic?.state, seller), seller);
  }

  /** Call after saving or undoing a setting so every server reads it at once. */
  static invalidate() {
    return invalidateCache(CACHE_KEY);
  }

  /** The newest setting that has started by `at`. */
  private static latestBy(rows: BillingTaxRate[], at: Date) {
    return (
      rows
        .filter((r) => r.effectiveFrom <= at)
        .sort(
          (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
        )[0] ?? null
    );
  }

  /** Every setting not undone; a handful of rows, so all are cached and picked in memory. */
  private static async rows(): Promise<BillingTaxRate[]> {
    const rows = await getOrSetCache(CACHE_KEY, CACHE_TTL_S, () =>
      database
        .select()
        .from(BillingTaxRateModel)
        .where(isNull(BillingTaxRateModel.cancelledAt))
    );
    // The cache stores JSON, so dates come back as strings.
    return rows.map((r) => ({
      ...r,
      effectiveFrom: new Date(r.effectiveFrom),
      createdAt: new Date(r.createdAt),
      cancelledAt: null,
    }));
  }
}
